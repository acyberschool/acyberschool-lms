from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import Http404
from django.shortcuts import get_object_or_404, render

from .models import Course, Enrollment, LessonProgress, Membership, PortfolioEntry, Submission
from .services import course_is_complete, course_progress


def _require_staff(user, institution):
    if user.is_superuser:
        return
    if not Membership.objects.filter(
        user=user,
        institution=institution,
        role__in=["admin", "instructor"],
    ).exists():
        raise Http404


@login_required
def learner_detail(request, course_id, student_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    student = get_object_or_404(User, id=student_id)
    if not Enrollment.objects.filter(course=course, student=student, active=True).exists():
        raise Http404

    lessons = list(course.lessons.filter(published=True))
    progress_records = {
        item.lesson_id: item
        for item in LessonProgress.objects.filter(student=student, lesson__in=lessons).select_related("lesson")
    }
    lesson_rows = [
        {
            "lesson": lesson,
            "completed": bool(progress_records.get(lesson.id) and progress_records[lesson.id].completed),
            "completed_at": progress_records.get(lesson.id).completed_at if progress_records.get(lesson.id) else None,
        }
        for lesson in lessons
    ]

    assignment_rows = []
    for assignment in course.assignments.filter(published=True):
        submission = Submission.objects.filter(assignment=assignment, student=student).first()
        passed = bool(
            submission
            and submission.score is not None
            and float(submission.score) >= assignment.pass_mark
        )
        assignment_rows.append(
            {
                "assignment": assignment,
                "submission": submission,
                "passed": passed,
            }
        )

    portfolio_entries = PortfolioEntry.objects.filter(
        student=student,
        institution=course.institution,
    )

    return render(
        request,
        "lms/learner_detail.html",
        {
            "course": course,
            "student": student,
            "progress": course_progress(course, student),
            "complete": course_is_complete(course, student),
            "lesson_rows": lesson_rows,
            "assignment_rows": assignment_rows,
            "portfolio_entries": portfolio_entries,
        },
    )
