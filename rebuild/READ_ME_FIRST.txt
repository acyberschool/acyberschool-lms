ACYBERSCHOOL CLEAN LMS TEST

1. Make sure Docker Desktop is open and fully running.

2. Double click:
   Start_Acyberschool_Clean_Rebuild.command

3. Wait. The first start can take several minutes because Docker builds the classroom and LibreOffice document renderer.

4. Your browser will open automatically at:
   http://127.0.0.1:8095

5. Sign in with the local test administrator details shown in the Terminal window.

6. Test the classroom in this order:
   Create a course
   Add text, video, audio, image, PDF or Office lessons
   Add a quiz or essay assignment
   Publish the course
   Invite a student
   Join using the student invitation
   Complete lessons and assignments
   Check tutor analytics
   Add a portfolio entry
   Complete the course and open the certificate

7. When you finish testing, double click:
   Stop_Acyberschool_Clean_Rebuild.command

IMPORTANT

This test classroom uses its own PostgreSQL database and uploaded file storage.
It does not alter the old Acyberschool LMS, old database or old Cloudflare tunnel.
Stopping the test classroom keeps the clean test database and uploads for the next session.
