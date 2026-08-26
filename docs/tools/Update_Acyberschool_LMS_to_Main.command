#!/bin/zsh

# Acyberschool LMS — switch the existing local installation to the
# Acyberschool production image published from GitHub main.
# This does NOT delete the database, users, courses, uploads or Docker volumes.

set -u
IMAGE="ghcr.io/acyberschool/acyberschool-lms:main"

clear
echo "============================================================"
echo "        ACYBERSCHOOL LMS — LOAD CURRENT MAIN BUILD"
echo "============================================================"
echo
echo "This keeps your existing courses, users and data."
echo "It only replaces the application image with the Acyberschool build."
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "STOP: Docker is not installed."
  echo "Open Docker Desktop, then run this file again."
  echo
  read "?Press Return to close..."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "STOP: Docker Desktop is not running."
  echo "Open Docker Desktop and wait until it says Engine running."
  echo "Then run this file again."
  echo
  read "?Press Return to close..."
  exit 1
fi

echo "✓ Docker is running"
echo
echo "Finding your Acyberschool LMS installation..."

ROOT=""
COMPOSE=""
candidate_dirs=(
  "$HOME/.learnhouse/acyberschool"
  "$HOME/Acyberschool Learning/learnhouse/acyberschool"
  "$HOME/Acyberschool Learning/learnhouse"
  "$HOME/Acyberschool Learning/acyberschool"
)

for d in "${candidate_dirs[@]}"; do
  if [[ -f "$d/docker-compose.yml" ]]; then
    ROOT="$d"
    COMPOSE="$d/docker-compose.yml"
    break
  elif [[ -f "$d/compose.yml" ]]; then
    ROOT="$d"
    COMPOSE="$d/compose.yml"
    break
  fi
done

if [[ -z "$ROOT" ]]; then
  for base in "$HOME/.learnhouse" "$HOME/Acyberschool Learning"; do
    if [[ -d "$base" ]]; then
      found=$(find "$base" -maxdepth 5 -type f \( -name "docker-compose.yml" -o -name "compose.yml" \) 2>/dev/null | head -n 1)
      if [[ -n "$found" ]]; then
        ROOT="${found:h}"
        COMPOSE="$found"
        break
      fi
    fi
  done
fi

if [[ -z "$ROOT" || -z "$COMPOSE" ]]; then
  echo
echo "STOP: I could not find the existing LMS installation automatically."
  echo "Nothing has been changed."
  echo "Take a screenshot of this window and send it to ChatGPT."
  echo
  read "?Press Return to close..."
  exit 1
fi

echo "✓ Found LMS at:"
echo "  $ROOT"
echo
cd "$ROOT" || exit 1

OVERRIDE="$ROOT/docker-compose.acyberschool.yml"
cat > "$OVERRIDE" <<EOF
services:
  learnhouse-app:
    image: ${IMAGE}
EOF

echo "Downloading the Acyberschool production build..."
echo "This can take a few minutes the first time."
echo

if ! docker pull "$IMAGE"; then
  echo
echo "STOP: GitHub did not allow this Mac to download the production image."
  echo "Your existing LMS has NOT been damaged or deleted."
  echo "Take a screenshot of this window and send it to ChatGPT."
  echo
  read "?Press Return to close..."
  exit 1
fi

echo
echo "✓ Acyberschool image downloaded"
echo
echo "Switching the LMS to the new build..."

if ! docker compose -f "$COMPOSE" -f "$OVERRIDE" up -d --remove-orphans; then
  echo
echo "STOP: Docker could not start the updated LMS."
  echo "Your data is still preserved."
  echo "Take a screenshot of this window and send it to ChatGPT."
  echo
  read "?Press Return to close..."
  exit 1
fi

echo
echo "Waiting for the LMS to become ready..."
sleep 12

PORT="8080"
if [[ -f "$ROOT/.env" ]]; then
  ENV_PORT=$(grep -E '^HTTP_PORT=' "$ROOT/.env" 2>/dev/null | tail -n 1 | cut -d= -f2 | tr -d '"' | tr -d '[:space:]')
  if [[ -n "$ENV_PORT" ]]; then
    PORT="$ENV_PORT"
  fi
fi

URL="http://localhost:${PORT}"

echo
echo "============================================================"
echo "                 UPDATE COMPLETE"
echo "============================================================"
echo
echo "Acyberschool LMS is now using:"
echo "  $IMAGE"
echo
echo "Opening:"
echo "  $URL"
echo
open "$URL" >/dev/null 2>&1 || true

echo "Keep Docker Desktop running while testing."
echo
read "?Press Return to close this window..."
