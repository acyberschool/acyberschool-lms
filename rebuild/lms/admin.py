from django.contrib import admin
from .models import (
    Institution, Membership, Course, Enrollment, Lesson, LessonProgress,
    Assignment, Question, Submission, Answer, PortfolioEntry, Certificate, Invitation,
)

for model in [
    Institution, Membership, Course, Enrollment, Lesson, LessonProgress,
    Assignment, Question, Submission, Answer, PortfolioEntry, Certificate, Invitation,
]:
    admin.site.register(model)

admin.site.site_header = "Acyberschool Administration"
admin.site.site_title = "Acyberschool"
admin.site.index_title = "Platform administration"
