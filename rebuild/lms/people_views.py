import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.http import Http404
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone

from .models import Institution, Invitation, Membership


def _admin_membership(user):
    if user.is_superuser:
        institution = Institution.objects.order_by("id").first()
        return institution, True
    membership = (
        Membership.objects.filter(user=user, role="admin")
        .select_related("institution")
        .order_by("id")
        .first()
    )
    return (membership.institution, True) if membership else (None, False)


@login_required
def people(request):
    institution, allowed = _admin_membership(request.user)
    if not allowed or not institution:
        raise Http404

    invite_url = None
    email_sent = False
    if request.method == "POST":
        email = request.POST.get("email", "").strip().lower()
        if not email:
            messages.error(request, "Enter the instructor email address.")
        else:
            existing = User.objects.filter(email__iexact=email).first() or User.objects.filter(username__iexact=email).first()
            if existing:
                Membership.objects.update_or_create(
                    institution=institution,
                    user=existing,
                    defaults={"role": "instructor"},
                )
                messages.success(request, f"{email} is now an instructor.")
                return redirect("people")

            invitation = Invitation.objects.create(
                institution=institution,
                course=None,
                email=email,
                role="instructor",
                code=secrets.token_urlsafe(24),
                expires_at=timezone.now() + timedelta(days=14),
            )
            invite_url = request.build_absolute_uri(reverse("join_invitation", args=[invitation.code]))
            if settings.EMAIL_HOST:
                try:
                    send_mail(
                        subject="You are invited to teach on Acyberschool",
                        message=(
                            f"You have been invited to join {institution.name} as an instructor on Acyberschool.\n\n"
                            f"Open this secure link to create or connect your account:\n{invite_url}\n\n"
                            "This invitation expires in 14 days."
                        ),
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[email],
                        fail_silently=False,
                    )
                    email_sent = True
                except Exception:
                    messages.warning(request, "The invitation was created, but the email could not be sent. Copy the invitation link below.")

    members = Membership.objects.filter(institution=institution).select_related("user").order_by("role", "user__first_name", "user__email")
    pending = Invitation.objects.filter(institution=institution, course=None, used_at=None, expires_at__gt=timezone.now()).order_by("-created_at")
    return render(
        request,
        "lms/people.html",
        {
            "institution": institution,
            "members": members,
            "pending": pending,
            "invite_url": invite_url,
            "email_sent": email_sent,
        },
    )
