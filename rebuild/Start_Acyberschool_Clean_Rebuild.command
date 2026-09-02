#!/bin/zsh
set -e

clear
printf '\nACYBERSCHOOL CLEAN LMS\n\n'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is not installed or its command is unavailable."
  echo "Open Docker Desktop, then run this file again."
  echo ""
  read "?Press Return to close..."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running yet."
  echo "Open Docker Desktop, wait until it is ready, then run this file again."
  echo ""
  read "?Press Return to close..."
  exit 1
fi

echo "Starting the new Acyberschool classroom..."
echo "This uses a separate database and does not touch the old LMS."
echo ""

docker compose up -d --build

echo ""
echo "Waiting for the classroom to become ready..."
READY=0
for i in {1..60}; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/login/ || true)
  if [ "$CODE" = "200" ] || [ "$CODE" = "302" ]; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -ne 1 ]; then
  echo "The classroom did not become ready in time."
  echo "The containers have been left running so the build is not lost."
  echo ""
  echo "Please send a screenshot of this window."
  read "?Press Return to close..."
  exit 1
fi

echo ""
echo "The new Acyberschool classroom is ready."
echo ""
echo "Browser: http://127.0.0.1:8095"
echo "Admin email: admin@acyberschool.com"
echo "Temporary local password: ChangeMeNow123!"
echo ""
open http://127.0.0.1:8095

echo "The browser has been opened."
echo "Leave this window open while you test."
echo ""
read "?Press Return when you are finished testing..."
