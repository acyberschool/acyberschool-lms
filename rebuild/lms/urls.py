from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("courses/new/", views.course_create, name="course_create"),
    path("courses/<int:course_id>/manage/", views.course_manage, name="course_manage"),
    path("courses/<int:course_id>/lessons/new/", views.lesson_create, name="lesson_create"),
    path("courses/<int:course_id>/assignments/new/", views.assignment_create, name="assignment_create"),
    path("assignments/<int:assignment_id>/questions/new/", views.question_create, name="question_create"),
    path("courses/<int:course_id>/invite/", views.invite, name="invite"),
    path("courses/<int:course_id>/learn/", views.course_player, name="course_player"),
    path("lessons/<int:lesson_id>/complete/", views.lesson_complete, name="lesson_complete"),
    path("assignments/<int:assignment_id>/take/", views.assignment_take, name="assignment_take"),
    path("submissions/<int:submission_id>/grade/", views.grade_submission, name="grade_submission"),
    path("portfolio/", views.portfolio, name="portfolio"),
    path("courses/<int:course_id>/analytics/", views.course_analytics, name="course_analytics"),
    path("courses/<int:course_id>/ai/", views.ai_assistant, name="ai_assistant"),
    path("courses/<int:course_id>/certificate/", views.certificate_download, name="certificate_download"),
]
