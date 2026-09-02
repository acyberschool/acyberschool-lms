# Acyberschool Clean LMS Rebuild

This directory is a clean, isolated LMS implementation created after the production recovery path was stopped.

## Scope in this build

Instructor and admin:

* create and publish courses
* add text, video, audio, images, PDF, Office documents and links
* Office documents are converted to PDF for browser reading when LibreOffice can render them
* create quizzes and essays
* invite and enrol students
* review essays and grade submissions
* view learner progress, scores and completion

Student:

* join with an invitation link
* play video and audio in the browser
* read text, PDF and converted Office documents
* mark lessons complete
* answer quizzes and submit essays
* use the course AI assistant when a Gemini key is configured
* maintain an applied learning portfolio
* download a certificate after course and required assignment completion

## Isolation

The rebuild uses its own containers and its own named database and media volumes. It does not use or modify the old LearnHouse production database.

## Local browser test

From this directory:

```sh
docker compose up -d --build
```

Then open `http://localhost:8095`.

Default local admin credentials are intentionally temporary and must be replaced before production:

* email: `admin@acyberschool.com`
* password: `ChangeMeNow123!`

Production deployment must set `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `ACYBERSCHOOL_ADMIN_PASSWORD`, trusted hosts and cookie security in environment variables.

## Production cutover

Do not point `classroom.acyberschool.com` at this build until browser acceptance testing is complete. The old production stack remains untouched as a safety copy.
