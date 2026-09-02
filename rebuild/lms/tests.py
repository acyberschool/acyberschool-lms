from datetime import timedelta

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from .models import (
    Assignment,
    Certificate,
    Course,
    Enrollment,
    Institution,
    Invitation,
    Lesson,
    LessonProgress,
    Membership,
    Submission,
)
from .services import course_is_complete


class CleanLmsCriticalFlowTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(name="Acyberschool", slug="acyberschool")
        self.instructor = User.objects.create_user(
            username="instructor@acyberschool.com",
            email="instructor@acyberschool.com",
            password="test-pass-12345",
        )
        Membership.objects.create(institution=self.institution, user=self.instructor, role="instructor")
        self.student = User.objects.create_user(
            username="student@example.com",
            email="student@example.com",
            password="test-pass-12345",
        )
        Membership.objects.create(institution=self.institution, user=self.student, role="student")
        self.course = Course.objects.create(
            institution=self.institution,
            instructor=self.instructor,
            title="AI Foundations",
            slug="ai-foundations",
            published=False,
        )
        Enrollment.objects.create(course=self.course, student=self.student)

    def test_student_cannot_open_unpublished_course(self):
        client = Client()
        client.force_login(self.student)
        response = client.get(reverse("course_player", args=[self.course.id]))
        self.assertEqual(response.status_code, 404)

    def test_invitation_rejects_wrong_signed_in_account(self):
        invitation = Invitation.objects.create(
            institution=self.institution,
            course=self.course,
            email="invited@example.com",
            role="student",
            code="secure-invite-test",
            expires_at=timezone.now() + timedelta(days=2),
        )
        wrong_user = User.objects.create_user(
            username="wrong@example.com",
            email="wrong@example.com",
            password="test-pass-12345",
        )
        client = Client()
        client.force_login(wrong_user)
        response = client.get(reverse("join_invitation", args=[invitation.code]))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Enrollment.objects.filter(course=self.course, student=wrong_user).exists())
        invitation.refresh_from_db()
        self.assertIsNone(invitation.used_at)

    def test_required_assignment_controls_completion(self):
        self.course.published = True
        self.course.save(update_fields=["published"])
        lesson = Lesson.objects.create(course=self.course, title="Lesson 1", order=1, published=True)
        progress = LessonProgress.objects.create(lesson=lesson, student=self.student)
        progress.mark_complete()
        assignment = Assignment.objects.create(
            course=self.course,
            title="Required quiz",
            assignment_type="quiz",
            pass_mark=70,
            required=True,
            published=True,
        )
        self.assertFalse(course_is_complete(self.course, self.student))
        submission = Submission.objects.create(assignment=assignment, student=self.student, score=60)
        self.assertFalse(course_is_complete(self.course, self.student))
        submission.score = 80
        submission.save(update_fields=["score"])
        self.assertTrue(course_is_complete(self.course, self.student))

    def test_certificate_verification_page(self):
        certificate = Certificate.objects.create(
            course=self.course,
            student=self.student,
            certificate_id="ACYS-TEST123456",
        )
        response = self.client.get(reverse("verify_certificate", args=[certificate.certificate_id]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Verified")
        self.assertContains(response, "AI Foundations")
        self.assertContains(response, "student@example.com")
