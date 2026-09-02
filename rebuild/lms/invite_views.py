from django.contrib.auth import login
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from .forms import InviteSignupForm
from .models import Enrollment, Invitation, Membership


def _redeem(invitation, user):
    Membership.objects.update_or_create(
        institution=invitation.institution,
        user=user,
        defaults={"role": invitation.role},
    )
    if invitation.course and invitation.role == "student":
        Enrollment.objects.get_or_create(course=invitation.course, student=user)
    invitation.used_at = timezone.now()
    invitation.save(update_fields=["used_at"])


def join_invitation(request, code):
    invitation = get_object_or_404(
        Invitation.objects.select_related("institution", "course"),
        code=code,
    )
    if not invitation.usable:
        return render(request, "lms/invite_expired.html", {"invitation": invitation})

    invited_email = invitation.email.strip().lower()

    if request.user.is_authenticated:
        signed_in_email = (request.user.email or request.user.username or "").strip().lower()
        if not request.user.is_superuser and signed_in_email != invited_email:
            return render(
                request,
                "lms/invite_wrong_account.html",
                {"invitation": invitation, "signed_in_email": signed_in_email},
                status=403,
            )
        _redeem(invitation, request.user)
        return redirect("course_player", course_id=invitation.course_id) if invitation.course_id else redirect("dashboard")

    existing_user = (
        User.objects.filter(email__iexact=invited_email).first()
        or User.objects.filter(username__iexact=invited_email).first()
    )
    if existing_user:
        return render(request, "lms/join_existing.html", {"invitation": invitation})

    form = InviteSignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save(commit=False)
        user.username = invited_email
        user.email = invited_email
        user.save()
        _redeem(invitation, user)
        login(request, user)
        return redirect("course_player", course_id=invitation.course_id) if invitation.course_id else redirect("dashboard")

    return render(request, "lms/join.html", {"form": form, "invitation": invitation})
