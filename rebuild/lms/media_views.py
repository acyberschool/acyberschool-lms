from pathlib import Path

from django.contrib.auth.decorators import login_required
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404

from .models import Membership, PortfolioEntry, Submission


def _staff_for(user, institution):
    if user.is_superuser:
        return True
    return Membership.objects.filter(
        user=user,
        institution=institution,
        role__in=["admin", "instructor"],
    ).exists()


def _protected_file_response(field):
    if not field:
        raise Http404
    response = HttpResponse()
    response["X-Accel-Redirect"] = f"/protected-media/{field.name}"
    response["Content-Disposition"] = f'inline; filename="{Path(field.name).name}"'
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@login_required
def portfolio_evidence(request, entry_id):
    entry = get_object_or_404(PortfolioEntry.objects.select_related("institution", "student"), id=entry_id)
    if request.user.id != entry.student_id and not _staff_for(request.user, entry.institution):
        raise Http404
    return _protected_file_response(entry.evidence_file)


@login_required
def submission_attachment(request, submission_id):
    submission = get_object_or_404(
        Submission.objects.select_related("student", "assignment__course__institution"),
        id=submission_id,
    )
    institution = submission.assignment.course.institution
    if request.user.id != submission.student_id and not _staff_for(request.user, institution):
        raise Http404
    return _protected_file_response(submission.attachment)
