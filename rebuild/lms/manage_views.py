from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import AssignmentForm, CourseForm, LessonForm
from .models import Assignment, Course, Lesson, Membership
from .services import convert_office_to_pdf


def _require_staff(user, institution):
    if user.is_superuser:
        return
    member = Membership.objects.filter(user=user, institution=institution).first()
    if not member or member.role not in {"admin", "instructor"}:
        raise Http404


@login_required
def course_edit(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    form = CourseForm(request.POST or None, request.FILES or None, instance=course)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Course updated.")
        return redirect("course_manage", course_id=course.id)
    return render(
        request,
        "lms/form_page.html",
        {"form": form, "title": f"Edit {course.title}", "submit_label": "Save course"},
    )


@require_POST
@login_required
def course_publish_toggle(request, course_id):
    course = get_object_or_404(Course.objects.select_related("institution"), id=course_id)
    _require_staff(request.user, course.institution)
    course.published = not course.published
    course.save(update_fields=["published", "updated_at"])
    messages.success(request, "Course published." if course.published else "Course moved to draft.")
    return redirect("course_manage", course_id=course.id)


@login_required
def lesson_edit(request, lesson_id):
    lesson = get_object_or_404(Lesson.objects.select_related("course", "course__institution"), id=lesson_id)
    _require_staff(request.user, lesson.course.institution)
    original_file = lesson.file.name if lesson.file else ""
    form = LessonForm(request.POST or None, request.FILES or None, instance=lesson)
    if request.method == "POST" and form.is_valid():
        saved = form.save()
        if saved.content_type == "office" and saved.file and (saved.file.name != original_file or not saved.rendered_file):
            convert_office_to_pdf(saved)
        messages.success(request, "Lesson updated.")
        return redirect("course_manage", course_id=saved.course_id)
    return render(
        request,
        "lms/form_page.html",
        {"form": form, "title": f"Edit lesson: {lesson.title}", "submit_label": "Save lesson"},
    )


@require_POST
@login_required
def lesson_delete(request, lesson_id):
    lesson = get_object_or_404(Lesson.objects.select_related("course", "course__institution"), id=lesson_id)
    _require_staff(request.user, lesson.course.institution)
    course_id = lesson.course_id
    lesson.delete()
    messages.success(request, "Lesson removed.")
    return redirect("course_manage", course_id=course_id)


@require_POST
@login_required
def lesson_move(request, lesson_id, direction):
    lesson = get_object_or_404(Lesson.objects.select_related("course", "course__institution"), id=lesson_id)
    _require_staff(request.user, lesson.course.institution)
    siblings = list(lesson.course.lessons.order_by("order", "id"))
    try:
        index = next(i for i, item in enumerate(siblings) if item.id == lesson.id)
    except StopIteration:
        raise Http404

    target_index = index - 1 if direction == "up" else index + 1 if direction == "down" else index
    if 0 <= target_index < len(siblings) and target_index != index:
        target = siblings[target_index]
        lesson_order = lesson.order
        target_order = target.order
        if lesson_order == target_order:
            for position, item in enumerate(siblings, start=1):
                item.order = position
                item.save(update_fields=["order"])
        else:
            lesson.order = target_order
            target.order = lesson_order
            lesson.save(update_fields=["order"])
            target.save(update_fields=["order"])
    return redirect("course_manage", course_id=lesson.course_id)


@login_required
def assignment_edit(request, assignment_id):
    assignment = get_object_or_404(
        Assignment.objects.select_related("course", "course__institution"),
        id=assignment_id,
    )
    _require_staff(request.user, assignment.course.institution)
    form = AssignmentForm(request.POST or None, instance=assignment)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Assignment updated.")
        return redirect("course_manage", course_id=assignment.course_id)
    return render(
        request,
        "lms/form_page.html",
        {"form": form, "title": f"Edit assignment: {assignment.title}", "submit_label": "Save assignment"},
    )


@require_POST
@login_required
def assignment_delete(request, assignment_id):
    assignment = get_object_or_404(
        Assignment.objects.select_related("course", "course__institution"),
        id=assignment_id,
    )
    _require_staff(request.user, assignment.course.institution)
    course_id = assignment.course_id
    assignment.delete()
    messages.success(request, "Assignment removed.")
    return redirect("course_manage", course_id=course_id)
