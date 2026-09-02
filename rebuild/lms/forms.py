from pathlib import Path

from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError

from .models import Assignment, Course, Lesson, PortfolioEntry, Question, Submission


def _validate_upload(file, extensions, max_mb, label):
    if not file:
        return file
    extension = Path(file.name).suffix.lower()
    if extension not in extensions:
        allowed = ", ".join(sorted(extensions))
        raise ValidationError(f"{label} must be one of: {allowed}")
    max_bytes = max_mb * 1024 * 1024
    try:
        size = file.size
    except Exception:
        size = 0
    if size and size > max_bytes:
        raise ValidationError(f"{label} must be smaller than {max_mb} MB.")
    return file


class InviteSignupForm(UserCreationForm):
    first_name = forms.CharField(max_length=150)
    last_name = forms.CharField(max_length=150, required=False)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("first_name", "last_name", "password1", "password2")


class CourseForm(forms.ModelForm):
    class Meta:
        model = Course
        fields = ("title", "description", "thumbnail", "published")
        widgets = {"description": forms.Textarea(attrs={"rows": 4})}

    def clean_thumbnail(self):
        return _validate_upload(
            self.cleaned_data.get("thumbnail"),
            {".jpg", ".jpeg", ".png", ".webp"},
            12,
            "Course image",
        )


class LessonForm(forms.ModelForm):
    class Meta:
        model = Lesson
        fields = ("title", "order", "content_type", "body", "file", "external_url", "published")
        widgets = {"body": forms.Textarea(attrs={"rows": 8})}

    def clean(self):
        cleaned = super().clean()
        content_type = cleaned.get("content_type")
        file = cleaned.get("file")
        url = (cleaned.get("external_url") or "").strip()

        rules = {
            "video": ({".mp4", ".webm", ".m4v"}, 500, "Video"),
            "audio": ({".mp3", ".m4a", ".wav", ".ogg"}, 250, "Audio"),
            "image": ({".jpg", ".jpeg", ".png", ".webp"}, 20, "Image"),
            "pdf": ({".pdf"}, 100, "PDF"),
            "office": ({".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".odp", ".ods"}, 100, "Office document"),
        }
        if content_type in rules:
            if not file:
                self.add_error("file", f"Add a {rules[content_type][2].lower()} file.")
            else:
                extensions, max_mb, label = rules[content_type]
                try:
                    _validate_upload(file, extensions, max_mb, label)
                except ValidationError as exc:
                    self.add_error("file", exc)
        elif content_type == "link" and not url:
            self.add_error("external_url", "Add the learning resource URL.")
        return cleaned


class AssignmentForm(forms.ModelForm):
    class Meta:
        model = Assignment
        fields = ("title", "instructions", "assignment_type", "due_at", "pass_mark", "required", "published")
        widgets = {
            "instructions": forms.Textarea(attrs={"rows": 5}),
            "due_at": forms.DateTimeInput(attrs={"type": "datetime-local"}),
        }


class QuestionForm(forms.ModelForm):
    choice_a = forms.CharField(max_length=500)
    choice_b = forms.CharField(max_length=500)
    choice_c = forms.CharField(max_length=500, required=False)
    choice_d = forms.CharField(max_length=500, required=False)
    correct = forms.ChoiceField(choices=[(0, "A"), (1, "B"), (2, "C"), (3, "D")])

    class Meta:
        model = Question
        fields = ("text", "order")
        widgets = {"text": forms.Textarea(attrs={"rows": 3})}

    def save(self, commit=True):
        obj = super().save(commit=False)
        choices = [self.cleaned_data["choice_a"], self.cleaned_data["choice_b"]]
        for key in ("choice_c", "choice_d"):
            if self.cleaned_data.get(key):
                choices.append(self.cleaned_data[key])
        obj.choices = choices
        obj.correct_index = int(self.cleaned_data["correct"])
        if obj.correct_index >= len(choices):
            obj.correct_index = 0
        if commit:
            obj.save()
        return obj


class PortfolioEntryForm(forms.ModelForm):
    class Meta:
        model = PortfolioEntry
        fields = ("title", "reflection", "evidence_file", "evidence_url")
        widgets = {"reflection": forms.Textarea(attrs={"rows": 7})}

    def clean_evidence_file(self):
        return _validate_upload(
            self.cleaned_data.get("evidence_file"),
            {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp"},
            100,
            "Portfolio evidence",
        )


class EssaySubmissionForm(forms.ModelForm):
    class Meta:
        model = Submission
        fields = ("essay_text", "attachment")
        widgets = {"essay_text": forms.Textarea(attrs={"rows": 10})}

    def clean_attachment(self):
        return _validate_upload(
            self.cleaned_data.get("attachment"),
            {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp"},
            100,
            "Assignment attachment",
        )


class GradeSubmissionForm(forms.ModelForm):
    class Meta:
        model = Submission
        fields = ("score", "feedback")
        widgets = {"feedback": forms.Textarea(attrs={"rows": 5})}
