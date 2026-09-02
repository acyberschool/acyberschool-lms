from django.contrib.auth.models import User
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone


class Institution(models.Model):
    name = models.CharField(max_length=160)
    slug = models.SlugField(unique=True)
    logo = models.ImageField(upload_to="institutions/logos/", blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Membership(models.Model):
    ROLE_CHOICES = [("admin", "Admin"), ("instructor", "Instructor"), ("student", "Student")]
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="institution_memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "user"], name="unique_institution_member")]


class Course(models.Model):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="courses")
    title = models.CharField(max_length=200)
    slug = models.SlugField()
    description = models.TextField(blank=True)
    thumbnail = models.ImageField(upload_to="courses/thumbnails/", blank=True)
    instructor = models.ForeignKey(User, on_delete=models.PROTECT, related_name="courses_taught")
    published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "slug"], name="unique_course_slug_per_institution")]
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class Enrollment(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="enrollments")
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name="enrollments")
    enrolled_at = models.DateTimeField(auto_now_add=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["course", "student"], name="unique_course_enrollment")]


class Lesson(models.Model):
    CONTENT_TYPES = [
        ("text", "Text"),
        ("video", "Video"),
        ("audio", "Audio"),
        ("image", "Image"),
        ("pdf", "PDF"),
        ("office", "Word, PowerPoint or Excel"),
        ("link", "External link"),
    ]
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="lessons")
    title = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=1)
    content_type = models.CharField(max_length=20, choices=CONTENT_TYPES, default="text")
    body = models.TextField(blank=True)
    file = models.FileField(upload_to="lessons/files/", blank=True)
    rendered_file = models.FileField(upload_to="lessons/rendered/", blank=True)
    external_url = models.URLField(blank=True)
    published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.course.title}: {self.title}"


class LessonProgress(models.Model):
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="progress_records")
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name="lesson_progress")
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["lesson", "student"], name="unique_lesson_progress")]

    def mark_complete(self):
        self.completed = True
        self.completed_at = timezone.now()
        self.save(update_fields=["completed", "completed_at"])


class Assignment(models.Model):
    TYPE_CHOICES = [("quiz", "Quiz"), ("essay", "Essay")]
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="assignments")
    title = models.CharField(max_length=200)
    instructions = models.TextField(blank=True)
    assignment_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    due_at = models.DateTimeField(null=True, blank=True)
    pass_mark = models.PositiveIntegerField(default=60, validators=[MinValueValidator(0), MaxValueValidator(100)])
    required = models.BooleanField(default=True)
    published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class Question(models.Model):
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name="questions")
    order = models.PositiveIntegerField(default=1)
    text = models.TextField()
    choices = models.JSONField(default=list)
    correct_index = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]


class Submission(models.Model):
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name="submissions")
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name="assignment_submissions")
    essay_text = models.TextField(blank=True)
    attachment = models.FileField(upload_to="submissions/", blank=True)
    score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    feedback = models.TextField(blank=True)
    graded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="graded_submissions")
    submitted_at = models.DateTimeField(auto_now_add=True)
    graded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["assignment", "student"], name="unique_assignment_submission")]


class Answer(models.Model):
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(Question, on_delete=models.CASCADE)
    selected_index = models.PositiveIntegerField()


class PortfolioEntry(models.Model):
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name="portfolio_entries")
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="portfolio_entries")
    title = models.CharField(max_length=200)
    reflection = models.TextField()
    evidence_file = models.FileField(upload_to="portfolio/", blank=True)
    evidence_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class Certificate(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="certificates")
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name="certificates")
    certificate_id = models.CharField(max_length=64, unique=True)
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["course", "student"], name="unique_course_certificate")]


class Invitation(models.Model):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="invitations")
    course = models.ForeignKey(Course, on_delete=models.CASCADE, null=True, blank=True, related_name="invitations")
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=Membership.ROLE_CHOICES, default="student")
    code = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def usable(self):
        return self.used_at is None and self.expires_at > timezone.now()
