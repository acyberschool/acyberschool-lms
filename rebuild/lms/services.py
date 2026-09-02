import json
import os
import secrets
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import requests
from django.conf import settings
from django.core.files import File
from django.utils.text import slugify
from reportlab.lib.pagesizes import A4
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
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    c.setTitle(f"Acyberschool Certificate {certificate.certificate_id}")
    c.setFont("Helvetica-Bold", 26)
    c.drawCentredString(width / 2, height - 150, "ACYBERSCHOOL")
    c.setFont("Helvetica", 15)
    c.drawCentredString(width / 2, height - 210, "Certificate of Completion")
    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString(width / 2, height - 285, certificate.student.get_full_name() or certificate.student.username)
    c.setFont("Helvetica", 14)
    c.drawCentredString(width / 2, height - 330, "has successfully completed")
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(width / 2, height - 380, certificate.course.title)
    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, 110, f"Certificate ID: {certificate.certificate_id}")
    c.drawCentredString(width / 2, 90, certificate.issued_at.strftime("Issued %d %B %Y"))
    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer


def ask_ai(question, course=None):
    if not settings.GEMINI_API_KEY:
        return "The course AI is ready in the platform but the AI service key has not been connected yet."
    context = ""
    if course:
        lesson_text = "\n\n".join(
            f"{lesson.title}: {lesson.body[:2500]}" for lesson in course.lessons.filter(published=True).exclude(body="")[:12]
        )
        context = f"Course: {course.title}\n{course.description}\n{lesson_text}\n\n"
    prompt = (
        "You are the Acyberschool learning assistant. Answer clearly and practically. "
        "Use the supplied course material when it is relevant. Do not invent course facts.\n\n"
        f"{context}Student question: {question}"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
    try:
        response = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=45)
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return "The course AI could not respond just now. Please try again."
