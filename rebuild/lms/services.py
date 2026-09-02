import re
import secrets
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import requests
from django.conf import settings
from django.core.files import File
from django.utils.text import slugify
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

from .models import Certificate, LessonProgress


def convert_office_to_pdf(lesson):
    if not lesson.file:
        return
    source = Path(lesson.file.path)
    if source.suffix.lower() not in {".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".odp", ".ods"}:
        return
    with tempfile.TemporaryDirectory() as tmp:
        try:
            subprocess.run(
                ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, str(source)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
        except Exception:
            return
        produced = Path(tmp) / f"{source.stem}.pdf"
        if produced.exists():
            with produced.open("rb") as fh:
                lesson.rendered_file.save(f"{slugify(lesson.title)}.pdf", File(fh), save=True)


def course_progress(course, student):
    lessons = course.lessons.filter(published=True)
    total = lessons.count()
    if total == 0:
        return 0
    completed = LessonProgress.objects.filter(student=student, lesson__in=lessons, completed=True).count()
    return round((completed / total) * 100)


def course_is_complete(course, student):
    if course_progress(course, student) < 100:
        return False
    for assignment in course.assignments.filter(published=True, required=True):
        submission = assignment.submissions.filter(student=student).first()
        if not submission or submission.score is None or float(submission.score) < assignment.pass_mark:
            return False
    return True


def get_or_create_certificate(course, student):
    cert, _ = Certificate.objects.get_or_create(
        course=course,
        student=student,
        defaults={"certificate_id": f"ACYS-{secrets.token_hex(8).upper()}"},
    )
    return cert


def certificate_pdf(certificate):
    buffer = BytesIO()
    width, height = landscape(A4)
    c = canvas.Canvas(buffer, pagesize=(width, height))
    brand = colors.HexColor("#C90046")
    ink = colors.HexColor("#111827")
    muted = colors.HexColor("#667085")

    c.setTitle(f"Acyberschool Certificate {certificate.certificate_id}")
    c.setStrokeColor(brand)
    c.setLineWidth(5)
    c.rect(28, 28, width - 56, height - 56)
    c.setStrokeColor(colors.HexColor("#E5E7EB"))
    c.setLineWidth(1)
    c.rect(42, 42, width - 84, height - 84)

    c.setFillColor(brand)
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(width / 2, height - 92, "ACYBERSCHOOL")

    c.setFillColor(ink)
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(width / 2, height - 145, "Certificate of Completion")

    c.setFillColor(muted)
    c.setFont("Helvetica", 13)
    c.drawCentredString(width / 2, height - 182, "This certifies that")

    learner_name = certificate.student.get_full_name() or certificate.student.username
    c.setFillColor(ink)
    c.setFont("Helvetica-Bold", 25)
    c.drawCentredString(width / 2, height - 228, learner_name)

    c.setFillColor(muted)
    c.setFont("Helvetica", 13)
    c.drawCentredString(width / 2, height - 263, "has successfully completed")

    c.setFillColor(ink)
    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(width / 2, height - 304, certificate.course.title)

    c.setFillColor(muted)
    c.setFont("Helvetica", 11)
    c.drawCentredString(width / 2, height - 335, certificate.course.institution.name)

    issued = certificate.issued_at.strftime("%d %B %Y")
    verify_url = f"{settings.ACYBERSCHOOL_PUBLIC_URL}/verify/{certificate.certificate_id}/"
    c.setFillColor(ink)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(78, 92, f"Issued: {issued}")
    c.drawRightString(width - 78, 92, f"Certificate ID: {certificate.certificate_id}")
    c.setFillColor(muted)
    c.setFont("Helvetica", 9)
    c.drawCentredString(width / 2, 67, f"Verify this certificate at {verify_url}")

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer


def _pdf_text(path, max_pages=24, max_chars=12000):
    try:
        reader = PdfReader(str(path))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:max_pages])
        return text[:max_chars]
    except Exception:
        return ""


def _lesson_ai_text(lesson):
    parts = []
    if lesson.body:
        parts.append(lesson.body[:8000])
    if lesson.content_type == "pdf" and lesson.file:
        parts.append(_pdf_text(lesson.file.path))
    elif lesson.content_type == "office" and lesson.rendered_file:
        parts.append(_pdf_text(lesson.rendered_file.path))
    return "\n".join(part for part in parts if part).strip()


def _course_context(course, max_chars=32000):
    parts = [f"Course: {course.title}", course.description or ""]
    for lesson in course.lessons.filter(published=True).order_by("order", "id"):
        text = _lesson_ai_text(lesson)
        if text:
            parts.append(f"Lesson {lesson.order} — {lesson.title}\n{text}")
        if sum(len(part) for part in parts) >= max_chars:
            break
    return "\n\n".join(parts)[:max_chars]


def _course_lookup_answer(question, course):
    if not course:
        return "Ask a question about the course and I will use the available learning material to help you find the answer."

    stop = {"the", "and", "for", "that", "with", "what", "when", "where", "which", "this", "from", "have", "about", "your", "into", "does", "how", "why", "are", "was", "were", "can", "could", "would", "should"}
    terms = [word for word in re.findall(r"[a-z0-9]+", question.lower()) if len(word) >= 3 and word not in stop]
    candidates = []
    for lesson in course.lessons.filter(published=True).order_by("order", "id"):
        text = _lesson_ai_text(lesson)
        if not text:
            continue
        lowered = text.lower()
        score = sum(lowered.count(term) for term in terms)
        candidates.append((score, lesson, text))

    candidates.sort(key=lambda item: (item[0], -item[1].order), reverse=True)
    selected = [item for item in candidates if item[0] > 0][:3] or candidates[:2]
    if not selected:
        return "I could not find course text to answer from yet. Try asking about a lesson after the instructor adds written material or a document."

    sections = []
    for _, lesson, text in selected:
        clean = " ".join(text.split())
        excerpt = clean[:1100]
        if len(clean) > 1100:
            excerpt += "…"
        sections.append(f"Lesson {lesson.order}: {lesson.title}\n{excerpt}")
    return "Here is the most relevant material I found in this course:\n\n" + "\n\n".join(sections)


def ask_ai(question, course=None):
    context = _course_context(course) if course else ""
    if not settings.GEMINI_API_KEY:
        return _course_lookup_answer(question, course)

    prompt = (
        "You are the Acyberschool learning assistant. Answer clearly, practically and concisely. "
        "Use the supplied course material as the primary source. If the answer is not supported by the course material, say so. "
        "Do not invent course facts or grades.\n\n"
        f"{context}\n\nStudent question: {question}"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
    try:
        response = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=45)
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return _course_lookup_answer(question, course)
