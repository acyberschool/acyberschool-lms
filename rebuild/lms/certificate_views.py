from django.shortcuts import render

from .models import Certificate


def verify_certificate(request, certificate_id):
    certificate = (
        Certificate.objects.select_related("course", "course__institution", "student")
        .filter(certificate_id__iexact=certificate_id.strip())
        .first()
    )
    return render(
        request,
        "lms/certificate_verify.html",
        {"certificate": certificate, "certificate_id": certificate_id, "valid": certificate is not None},
        status=200 if certificate else 404,
    )
