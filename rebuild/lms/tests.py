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
    Question,
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

    def test_full_instructor_to_student_certificate_journey(self):
        client = Client()
        client.force_login(self.instructor)

        response = client.post(
            reverse("course_create"),
            {
                "title": "Practical AI at Work",
                "description": "A complete classroom journey.",
            },
        )
        self.assertEqual(response.status_code, 302)
        course = Course.objects.get(title="Practical AI at Work")
        self.assertEqual(course.slug, "practical-ai-at-work")
        self.assertFalse(course.published)

        response = client.post(
            reverse("lesson_create", args=[course.id]),
            {
                "title": "Start here",
                "order": 1,
                "content_type": "text",
                "body": "AI can help with a task when the goal and context are clear.",
                "published": "on",
            },
        )
        self.assertEqual(response.status_code, 302)
        lesson = Lesson.objects.get(course=course, title="Start here")

        response = client.post(
            reverse("assignment_create", args=[course.id]),
            {
                "title": "Check your understanding",
                "instructions": "Choose the correct answer.",
                "assignment_type": "quiz",
                "pass_mark": 60,
                "required": "on",
                "published": "on",
            },
        )
        self.assertEqual(response.status_code, 302)
        assignment = Assignment.objects.get(course=course, title="Check your understanding")

        response = client.post(
            reverse("question_create", args=[assignment.id]),
            {
                "text": "What improves an AI task?",
                "order": 1,
                "choice_a": "A clear goal and context",
                "choice_b": "No context at all",
                "choice_c": "",
                "choice_d": "",
                "correct": "0",
            },
        )
        self.assertEqual(response.status_code, 302)
        question = Question.objects.get(assignment=assignment)

        response = client.post(reverse("course_publish_toggle", args=[course.id]))
        self.assertEqual(response.status_code, 302)
        course.refresh_from_db()
        self.assertTrue(course.published)

        invited_email = "newlearner@example.com"
        response = client.post(reverse("invite", args=[course.id]), {"email": invited_email})
        self.assertEqual(response.status_code, 200)
        invitation = Invitation.objects.get(course=course, email=invited_email)

        client.logout()
        response = client.get(reverse("join_invitation", args=[invitation.code]))
        self.assertEqual(response.status_code, 200)
        response = client.post(
            reverse("join_invitation", args=[invitation.code]),
            {
                "first_name": "New",
                "last_name": "Learner",
                "password1": "Acyb3rSchool-Test-987!",
                "password2": "Acyb3rSchool-Test-987!",
            },
        )
        self.assertEqual(response.status_code, 302)
        learner = User.objects.get(email=invited_email)
        self.assertTrue(Enrollment.objects.filter(course=course, student=learner, active=True).exists())

        response = client.get(reverse("course_player", args=[course.id]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Start here")
        self.assertContains(response, "Check your understanding")

        response = client.post(reverse("lesson_complete", args=[lesson.id]))
        self.assertEqual(response.status_code, 302)
        self.assertFalse(course_is_complete(course, learner))

        response = client.post(
            reverse("assignment_take", args=[assignment.id]),
            {f"q_{question.id}": "0"},
        )
        self.assertEqual(response.status_code, 302)
        submission = Submission.objects.get(assignment=assignment, student=learner)
        self.assertEqual(float(submission.score), 100.0)
        self.assertTrue(course_is_complete(course, learner))

        response = client.get(reverse("certificate_download", args=[course.id]))
        self.assertEqual(response.status_code, 200)
        certificate = Certificate.objects.get(course=course, student=learner)

        client.logout()
        response = client.get(reverse("verify_certificate", args=[certificate.certificate_id]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Verified")
        self.assertContains(response, "Practical AI at Work")
        self.assertContains(response, "New Learner")
