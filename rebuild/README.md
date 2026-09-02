# Acyberschool Clean LMS Rebuild

This folder contains the isolated replacement classroom. It does not use or alter the legacy LearnHouse database, media volumes, Cloudflare tunnel or production containers.

## Local browser test

On macOS, run:

`Start_Acyberschool_Clean_Rebuild.command`

The launcher checks Docker, builds the clean LMS, waits for the login page to respond, then opens `http://127.0.0.1:8095` in the browser.

The local preview is bound to `127.0.0.1` only. It is not exposed to the public internet.

Default local administrator:

* Email: `admin@acyberschool.com`
* Password: `ChangeMeNow123!`

These defaults are for the isolated local preview only. Production requires environment supplied secrets.

## Current product scope

The clean rebuild provides:

* institution and role based access
* instructor course creation
* course publishing
* student invitations and enrolment
* text, image, video, audio, PDF and Office lessons
* protected lesson media
* quizzes with automatic scoring
* essay submissions with instructor grading and feedback
* learner progress tracking
* tutor analytics
* learner portfolio entries and evidence uploads
* course AI assistant when a Gemini key is configured
* course completion rules
* downloadable certificates

## Isolation

The Docker project uses its own containers and named volumes:

* `acyberschool-clean-db`
* `acyberschool-clean-web`
* `acyberschool-clean-nginx`
* `acyberschool_clean_db`
* `acyberschool_clean_media`
* `acyberschool_clean_static`

The old LMS can remain running while this build is tested.
