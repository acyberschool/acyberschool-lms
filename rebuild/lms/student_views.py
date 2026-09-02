from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import get_object_or_404, render

from .models import Course, Enrollment, LessonProgress, Membership, Submission
from .services import course_is_complete, course_progress


def _membership(user, institution):
    if user.is_superuser:
        return Membership(institution=institution, user=user, role="admin")
    return Membership.objects.filter(user=user, institution=institution).first()


def _assignment_status(assignment, student):
    submission = Submission.objects.filter(assignment=assignment, student=student).first()
    if not submission:
        return {
            "label": "Not started",
            "state": "not_started",
            "score": None,
            "submission": None,
        }
    if submission.score is None:
        return {
            "label": "Awaiting grading" if assignment.assignment_type == "essay" else "Submitted",
            "state": "awaiting",
            "score": None,
            "submission": submission,
        }
    passed = float(submission.score) >= assignment.pass_mark
    return {
        "label": "Passed" if passed else "Needs another attempt",
        "state": "passed" if passed else "retry",
        "score": submission.score,
        "submission": submission,
    }


@login_required
def course_player(request, course_id):
    course = get_object_or_404(
        Course.objects.select_related("institution", "instructor"),
        id=course_id,
    )
    member = _membership(request.user, course.institution)
    if not member:
        raise Http404

    enrolled = Enrollment.objects.filter(
        course=course,
        student=request.user,
        active=True,
    ).exists()
    if member.role == "student":
        if not enrolled or not course.published:
            raise Http404

    lessons = list(course.lessons.filter(published=True))
    completed_ids = set(
        LessonProgress.objects.filter(
            student=request.user,
            lesson__in=lessons,
            completed=True,
        ).values_list("lesson_id", flat=True)
    )
    progress = course_progress(course, request.user)
    complete = course_is_complete(course, request.user) if member.role == "student" else False
    assignments = list(course.assignments.filter(published=True))

    assignment_rows = []
    for assignment in assignments:
        status = _assignment_status(assignment, request.user) if member.role == "student" else None
        assignment_rows.append({"assignment": assignment, "status": status})

    return render(
        request,
        "lms/course_player.html",
        {
            "course": course,
            "lessons": lessons,
            "completed_ids": completed_ids,
            "assignments": assignments,
            "assignment_rows": assignment_rows,
            "progress": progress,
            "course_complete": complete,
            "member": member,
        },
    )
