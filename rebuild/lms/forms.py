from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from .models import Course, Lesson, Assignment, Question, PortfolioEntry, Submission


class InviteSignupForm(UserCreationForm):
    first_name = forms.CharField(max_length=150)
    last_name = forms.CharField(max_length=150, required=False)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("first_name", "last_name", "password1", "password2")


class CourseForm(forms.ModelForm):
    class Meta:
        model = Course
        fields = ("title", "slug", "description", "thumbnail", "published")
        widgets = {"description": forms.Textarea(attrs={"rows": 4})}


class LessonForm(forms.ModelForm):
    class Meta:
        model = Lesson
        fields = ("title", "order", "content_type", "body", "file", "external_url", "published")
        widgets = {"body": forms.Textarea(attrs={"rows": 8})}


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


class EssaySubmissionForm(forms.ModelForm):
    class Meta:
        model = Submission
        fields = ("essay_text", "attachment")
        widgets = {"essay_text": forms.Textarea(attrs={"rows": 10})}


class GradeSubmissionForm(forms.ModelForm):
    class Meta:
        model = Submission
        fields = ("score", "feedback")
        widgets = {"feedback": forms.Textarea(attrs={"rows": 5})}
