import secrets
from datetime import timedelta

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Avg
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone

from .forms import (
    AssignmentForm,
    CourseForm,
    EssaySubmissionForm,
    GradeSubmissionForm,
    InviteSignupForm,
    LessonForm,
    PortfolioEntryForm,
    QuestionForm,
)
from .models import (
    Answer,
    Assignment,
    Course,
    Enrollment,
    Institution,
    Invitation,
    Lesson,
    LessonProgress,
    Membership,
    PortfolioEntry,
    Submission,
)
from .services import ask_ai, certificate_pdf, convert_office_to_pdf, course_is_complete, course_progress, get_or_create_certificate


def home(request):
    return redirect("dashboard" if request.user.is_authenticated else "login")


def _membership(user, institution):
    if user.is_superuser:
        return Membership(institution=institution, user=user, role="admin")
    return Membership.objects.filter(user=user, institution=institution).first()


def _require_staff(user, institution):
    member = _membership(user, institution)
    if not member or member.role not in {"admin", "instructor"}:
        raise Http404
    return member


def _default_institution_for(user):
    if user.is_superuser:
        return Institution.objects.order_by("id").first()
    member = Membership.objects.filter(user=user).select_related("institution").order_by("id").first()
    return member.institution if member else None


@login_required
def dashboard(request):
    memberships = list(Membership.objects.filter(user=request.user).select_related("institution"))
    if request.user.is_superuser and not memberships:
        institutions = list(Institution.objects.all())
    else:
        institutions = [m.institution for m in memberships]
    can_manage = request.user.is_superuser or any(m.role in {"admin", "instructor"} for m in memberships)

    staff_courses = Course.objects.filter(institution__in=institutions, instructor=request.user)
    if request.user.is_superuser:
        staff_courses = Course.objects.all()
    enrolled = Enrollment.objects.filter(student=request.user, active=True).select_related("course", "course__institution")
    student_cards = [{"enrollment": e, "progress": course_progress(e.course, request.user)} for e in enrolled]
    return render(request, "lms/dashboard.html", {
        "memberships": memberships,
        "staff_courses": staff_courses,
        "student_cards": student_cards,
        "can_manage": can_manage,
    })


def join_invitation(request, code):
    invitation = get_object_or_404(Invitation.objects.select_related("institution", "course"), code=code)
    if not invitation.usable:
        return render(request, "lms/invite_expired.html", {"invitation": invitation})

    if request.user.is_authenticated:
        user = request.user
        Membership.objects.update_or_create(
            institution=invitation.institution,
            user=user,
            defaults={"role": invitation.role},
        )
        if invitation.course and invitation.role == "student":
            Enrollment.objects.get_or_create(course=invitation.course, student=user)
        invitation.used_at = timezone.now()
        invitation.save(update_fields=["used_at"])
        return redirect("dashboard")

    existing_user = User.objects.filter(email__iexact=invitation.email).first() or User.objects.filter(username__iexact=invitation.email).first()
    if existing_user:
        return render(request, "lms/join_existing.html", {"invitation": invitation})

    form = InviteSignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save(commit=False)
        user.username = invitation.email.lower()
        user.email = invitation.email.lower()
        user.save()
        Membership.objects.create(institution=invitation.institution, user=user, role=invitation.role)
        if invitation.course and invitation.role == "student":
            Enrollment.objects.create(course=invitation.course, student=user)
        invitation.used_at = timezone.now()
        invitation.save(update_fields=["used_at"])
        login(request, user)
        return redirect("dashboard")
    return render(request, "lms/join.html", {"form": form, "invitation": invitation})


@login_required
def course_create(request):
    institution = _default_institution_for(request.user)
    if not institution:
        messages.error(request, "Your account is not attached to an institution yet.")
        return redirect("dashboard")
    _require_staff(request.user, institution)
    form = CourseForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        course = form.save(commit=False)
        course.institution = institution
        course.instructor = request.user
        course.save()
        return redirect("course_manage", course_id=course.id)
    return render(request, "lms/form_page.html", {"form": form, "title": "Create course", "submit_label": "Create course"})


@login_required
def course_manage(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    return render(request, "lms/course_manage.html", {
        "course": course,
        "lessons": course.lessons.all(),
        "assignments": course.assignments.all(),
    })


@login_required
def lesson_create(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    form = LessonForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        lesson = form.save(commit=False)
        lesson.course = course
        lesson.save()
        if lesson.content_type == "office":
            convert_office_to_pdf(lesson)
        return redirect("course_manage", course_id=course.id)
    return render(request, "lms/form_page.html", {"form": form, "title": f"Add lesson to {course.title}", "submit_label": "Add lesson"})


@login_required
def assignment_create(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    form = AssignmentForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        assignment = form.save(commit=False)
        assignment.course = course
        assignment.save()
        if assignment.assignment_type == "quiz":
            return redirect("question_create", assignment_id=assignment.id)
        return redirect("course_manage", course_id=course.id)
    return render(request, "lms/form_page.html", {"form": form, "title": "Create assignment", "submit_label": "Create assignment"})


@login_required
def question_create(request, assignment_id):
    assignment = get_object_or_404(Assignment.objects.select_related("course", "course__institution"), id=assignment_id)
    _require_staff(request.user, assignment.course.institution)
    form = QuestionForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        question = form.save(commit=False)
        question.assignment = assignment
        question.save()
        if request.POST.get("add_another"):
            return redirect("question_create", assignment_id=assignment.id)
        return redirect("course_manage", course_id=assignment.course.id)
    return render(request, "lms/question_form.html", {"form": form, "assignment": assignment, "questions": assignment.questions.all()})


@login_required
def invite(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    invite_url = None
    if request.method == "POST":
        email = request.POST.get("email", "").strip().lower()
        if email:
            existing = User.objects.filter(email__iexact=email).first() or User.objects.filter(username__iexact=email).first()
            if existing:
                Membership.objects.get_or_create(institution=course.institution, user=existing, defaults={"role": "student"})
                Enrollment.objects.get_or_create(course=course, student=existing)
                messages.success(request, f"{email} has been enrolled.")
            else:
                invitation = Invitation.objects.create(
                    institution=course.institution,
                    course=course,
                    email=email,
                    role="student",
                    code=secrets.token_urlsafe(24),
                    expires_at=timezone.now() + timedelta(days=14),
                )
                invite_url = request.build_absolute_uri(reverse("join_invitation", args=[invitation.code]))
    return render(request, "lms/invite.html", {"course": course, "invite_url": invite_url})


@login_required
def course_player(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution", "instructor"), id=course_id)
    member = _membership(request.user, course.institution)
    enrolled = Enrollment.objects.filter(course=course, student=request.user, active=True).exists()
    if not member or (member.role == "student" and not enrolled):
        raise Http404
    lessons = list(course.lessons.filter(published=True))
    completed_ids = set(LessonProgress.objects.filter(student=request.user, lesson__in=lessons, completed=True).values_list("lesson_id", flat=True))
    progress = course_progress(course, request.user)
    complete = course_is_complete(course, request.user) if member.role == "student" else False
    return render(request, "lms/course_player.html", {
        "course": course,
        "lessons": lessons,
        "completed_ids": completed_ids,
        "assignments": course.assignments.filter(published=True),
        "progress": progress,
        "course_complete": complete,
        "member": member,
    })


@login_required
def lesson_complete(request, lesson_id):
    if request.method != "POST":
        raise Http404
    lesson = get_object_or_404(Lesson.objects.select_related("course"), id=lesson_id)
    if not Enrollment.objects.filter(course=lesson.course, student=request.user, active=True).exists():
        raise Http404
    progress, _ = LessonProgress.objects.get_or_create(lesson=lesson, student=request.user)
    progress.mark_complete()
    return redirect("course_player", course_id=lesson.course.id)


@login_required
def assignment_take(request, assignment_id):
    assignment = get_object_or_404(Assignment.objects.select_related("course"), id=assignment_id, published=True)
    if not Enrollment.objects.filter(course=assignment.course, student=request.user, active=True).exists():
        raise Http404
    existing = Submission.objects.filter(assignment=assignment, student=request.user).first()

    if assignment.assignment_type == "quiz":
        if request.method == "POST":
            questions = list(assignment.questions.all())
            submission, _ = Submission.objects.get_or_create(assignment=assignment, student=request.user)
            submission.answers.all().delete()
            correct = 0
            for question in questions:
                raw = request.POST.get(f"q_{question.id}")
                if raw is None:
                    continue
                selected = int(raw)
                Answer.objects.create(submission=submission, question=question, selected_index=selected)
                if selected == question.correct_index:
                    correct += 1
            submission.score = round((correct / len(questions)) * 100, 2) if questions else 0
            submission.graded_at = timezone.now()
            submission.save(update_fields=["score", "graded_at"])
            return redirect("assignment_take", assignment_id=assignment.id)
        return render(request, "lms/quiz.html", {"assignment": assignment, "existing": existing})

    form = EssaySubmissionForm(request.POST or None, request.FILES or None, instance=existing)
    if request.method == "POST" and form.is_valid():
        submission = form.save(commit=False)
        submission.assignment = assignment
        submission.student = request.user
        submission.score = None
        submission.graded_at = None
        submission.save()
        messages.success(request, "Your work has been submitted.")
        return redirect("course_player", course_id=assignment.course.id)
    return render(request, "lms/essay.html", {"assignment": assignment, "form": form, "existing": existing})


@login_required
def grade_submission(request, submission_id):
    submission = get_object_or_404(Submission.objects.select_related("assignment", "assignment__course", "assignment__course__institution", "student"), id=submission_id)
    _require_staff(request.user, submission.assignment.course.institution)
    form = GradeSubmissionForm(request.POST or None, instance=submission)
    if request.method == "POST" and form.is_valid():
        graded = form.save(commit=False)
        graded.graded_by = request.user
        graded.graded_at = timezone.now()
        graded.save()
        return redirect("course_analytics", course_id=submission.assignment.course.id)
    return render(request, "lms/grade.html", {"submission": submission, "form": form})


@login_required
def portfolio(request):
    institution = _default_institution_for(request.user)
    if not institution:
        raise Http404
    form = PortfolioEntryForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        entry = form.save(commit=False)
        entry.student = request.user
        entry.institution = institution
        entry.save()
        return redirect("portfolio")
    entries = PortfolioEntry.objects.filter(student=request.user, institution=institution)
    return render(request, "lms/portfolio.html", {"form": form, "entries": entries})


@login_required
def course_analytics(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    enrollments = list(course.enrollments.filter(active=True).select_related("student"))
    rows = []
    for enrollment in enrollments:
        student = enrollment.student
        submissions = Submission.objects.filter(student=student, assignment__course=course).select_related("assignment")
        pending = list(submissions.filter(assignment__assignment_type="essay", score=None))
        rows.append({
            "student": student,
            "progress": course_progress(course, student),
            "average_score": submissions.exclude(score=None).aggregate(v=Avg("score"))["v"],
            "submitted": submissions.count(),
            "pending_essays": pending,
            "complete": course_is_complete(course, student),
        })
    return render(request, "lms/analytics.html", {
        "course": course,
        "rows": rows,
        "assignments": course.assignments.all(),
        "complete_count": sum(1 for row in rows if row["complete"]),
    })


@login_required
def ai_assistant(request, course_id):
    if request.method != "POST":
        raise Http404
    course = get_object_or_404(Course, id=course_id)
    member = _membership(request.user, course.institution)
    if not member:
        raise Http404
    question = request.POST.get("question", "").strip()
    if not question:
        return JsonResponse({"answer": "Ask a question about the course."})
    return JsonResponse({"answer": ask_ai(question, course)})


@login_required
def certificate_download(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    if not Enrollment.objects.filter(course=course, student=request.user, active=True).exists():
        raise Http404
    if not course_is_complete(course, request.user):
        messages.error(request, "Complete the course and required assignments before downloading your certificate.")
        return redirect("course_player", course_id=course.id)
    certificate = get_or_create_certificate(course, request.user)
    return FileResponse(certificate_pdf(certificate), as_attachment=True, filename=f"Acyberschool_{course.slug}_certificate.pdf")
