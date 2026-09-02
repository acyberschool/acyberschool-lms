#!/bin/sh
set -e

python manage.py migrate --run-syncdb --noinput
python manage.py collectstatic --noinput

python manage.py shell <<'PY'
import os
from django.contrib.auth.models import User
from lms.models import Institution, Membership

email = os.getenv("ACYBERSCHOOL_ADMIN_EMAIL", "admin@acyberschool.com").lower()
password = os.getenv("ACYBERSCHOOL_ADMIN_PASSWORD", "ChangeMeNow123!")
first_name = os.getenv("ACYBERSCHOOL_ADMIN_FIRST_NAME", "Acyberschool")

user, created = User.objects.get_or_create(username=email, defaults={"email": email, "first_name": first_name, "is_staff": True, "is_superuser": True})
if created:
    user.set_password(password)
else:
    user.email = email
    user.is_staff = True
    user.is_superuser = True
user.save()

institution, _ = Institution.objects.get_or_create(slug="acyberschool", defaults={"name": "Acyberschool"})
Membership.objects.update_or_create(institution=institution, user=user, defaults={"role": "admin"})
PY

exec gunicorn acyberschool.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-3} --timeout 120
