#!/bin/bash
set -u

BASE_DIR="/Users/evaoloo/.learnhouse/acyberschool"
LIVE_URL="https://classroom.acyberschool.com"
RELEASE_SHA="00088104eca0ce78dc758c30c90aafacf898dd05"
RELEASE_SHORT="0008810"
NEW_IMAGE="ghcr.io/acyberschool/acyberschool-lms:main-${RELEASE_SHORT}"
OFFICE_IMAGE="ghcr.io/acyberschool/acyberschool-lms-office-worker:main-${RELEASE_SHA}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/Desktop/Acyberschool-LMS-Backups/$STAMP"
OVERRIDE_FILE="$BASE_DIR/docker-compose.acyberschool-release.yml"
TEMP_ENV="/tmp/acyberschool-office-worker-${STAMP}.env"
mkdir -p "$BACKUP_DIR"
trap 'rm -f "$TEMP_ENV" >/dev/null 2>&1 || true' EXIT

clear
echo "ACYBERSCHOOL LEARNHOUSE LMS RESTORE"
echo
echo "Release: ${RELEASE_SHORT}"
echo "Target:  ${LIVE_URL}"
echo
echo "This preserves the database, users, courses, uploads, portfolios,"
echo "assignments, submissions, progress and all Docker volumes."
echo "Cloudflare will not be changed."
echo

fail() {
  echo
  echo "RESTORE STOPPED SAFELY"
  echo "$1"
  echo
  echo "No Docker volumes were deleted."
  echo "Backup folder: $BACKUP_DIR"
  echo
  read -r -p "Press Return to close..."
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker was not found."
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running."
[ -d "$BASE_DIR" ] || fail "The existing Acyberschool production folder was not found."
cd "$BASE_DIR" || fail "Could not open the production folder."

echo "[1/9] Finding the existing LearnHouse production stack..."
APP_CONTAINER="$(docker ps --format '{{.ID}} {{.Names}} {{.Image}}' | awk '$2 ~ /^learnhouse-app-/ {print $1; exit}')"
if [ -z "$APP_CONTAINER" ]; then
  APP_CONTAINER="$(docker ps --format '{{.ID}} {{.Names}} {{.Image}}' | awk '$3 ~ /acyberschool\/acyberschool-lms/ {print $1; exit}')"
fi
[ -n "$APP_CONTAINER" ] || fail "The running LearnHouse application container could not be found."
SERVICE="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$APP_CONTAINER" 2>/dev/null)"
PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$APP_CONTAINER" 2>/dev/null)"
WORKDIR="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$APP_CONTAINER" 2>/dev/null)"
CONFIG_FILES="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$APP_CONTAINER" 2>/dev/null)"
[ -n "$SERVICE" ] || fail "Could not identify the LearnHouse application service."
[ -n "$PROJECT" ] || fail "Could not identify the LearnHouse Compose project."
[ -n "$WORKDIR" ] || WORKDIR="$BASE_DIR"
echo "      Existing LearnHouse app found."

COMPOSE_ARGS=()
if [ -n "$CONFIG_FILES" ]; then
  IFS=',' read -r -a CFG_ARRAY <<< "$CONFIG_FILES"
  for cfg in "${CFG_ARRAY[@]}"; do
    cfg="$(echo "$cfg" | xargs)"
    [ -f "$cfg" ] && COMPOSE_ARGS+=("-f" "$cfg")
  done
fi
if [ ${#COMPOSE_ARGS[@]} -eq 0 ]; then
  [ -f "$BASE_DIR/docker-compose.yml" ] || fail "docker-compose.yml was not found."
  COMPOSE_ARGS+=("-f" "$BASE_DIR/docker-compose.yml")
  [ -f "$BASE_DIR/docker-compose.acyberschool.yml" ] && COMPOSE_ARGS+=("-f" "$BASE_DIR/docker-compose.acyberschool.yml")
fi

echo
echo "[2/9] Verifying the existing Acyberschool organization..."
INSTANCE_BEFORE="$(curl -fsS --max-time 15 "${LIVE_URL}/api/v1/instance/info" 2>/dev/null || true)"
echo "$INSTANCE_BEFORE" | grep -q '"default_org_slug"[[:space:]]*:[[:space:]]*"acyberschool"' || fail "The live LMS did not report the Acyberschool organization. No deployment was attempted."
echo "      Acyberschool organization confirmed."

DB_CONTAINER="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}} {{.Image}} {{.Names}}' | awk '$2 ~ /pgvector|postgres/ {print $1; exit}')"
if [ -z "$DB_CONTAINER" ]; then
  DB_CONTAINER="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | awk '$3 ~ /^learnhouse-db-/ {print $1; exit}')"
fi
[ -n "$DB_CONTAINER" ] || fail "The existing LearnHouse PostgreSQL container could not be found."

echo
echo "[3/9] Pulling the exact validated release before changing production..."
docker pull "$NEW_IMAGE" >/dev/null || fail "The validated LearnHouse application image could not be pulled."
docker pull --platform linux/amd64 "$OFFICE_IMAGE" >/dev/null || fail "The Office preview worker image could not be pulled."
echo "      Release images downloaded."

echo
echo "[4/9] Backing up the production database and configuration..."
docker exec "$DB_CONTAINER" sh -lc 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' > "$BACKUP_DIR/database.sql" 2>"$BACKUP_DIR/database-backup.log"
[ $? -eq 0 ] && [ -s "$BACKUP_DIR/database.sql" ] || fail "Database backup failed or was empty. Production was not changed."
DB_BYTES="$(wc -c < "$BACKUP_DIR/database.sql" | tr -d ' ')"
[ "$DB_BYTES" -ge 1024 ] || fail "Database backup was unexpectedly small. Production was not changed."
docker inspect "$APP_CONTAINER" > "$BACKUP_DIR/app-container-before.json" 2>/dev/null || true
docker inspect "$DB_CONTAINER" > "$BACKUP_DIR/db-container-before.json" 2>/dev/null || true
docker volume ls > "$BACKUP_DIR/docker-volumes-before.txt" 2>/dev/null || true
docker ps -a > "$BACKUP_DIR/docker-containers-before.txt" 2>/dev/null || true
for cfg in "$BASE_DIR"/docker-compose*.yml "$BASE_DIR"/docker-compose*.yaml "$BASE_DIR"/.env; do
  [ -f "$cfg" ] && cp -p "$cfg" "$BACKUP_DIR/" 2>/dev/null || true
done
OLD_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER" 2>/dev/null)"
[ -n "$OLD_IMAGE_ID" ] || fail "Could not record the current application image for rollback."
ROLLBACK_TAG="acyberschool-lms:rollback-${STAMP}"
docker tag "$OLD_IMAGE_ID" "$ROLLBACK_TAG" || fail "Could not create the rollback image tag."
echo "      Database backup and rollback image are ready."

echo
echo "[5/9] Preparing the release overlay..."
cat > "$OVERRIDE_FILE" <<YAML
services:
  ${SERVICE}:
    image: ${NEW_IMAGE}
YAML
FULL_COMPOSE_ARGS=("${COMPOSE_ARGS[@]}" "-f" "$OVERRIDE_FILE")

rollback_app() {
  echo
  echo "A live health check failed. Restoring the previous application image..."
  cat > "$OVERRIDE_FILE" <<YAML
services:
  ${SERVICE}:
    image: ${ROLLBACK_TAG}
YAML
  docker compose -p "$PROJECT" --project-directory "$WORKDIR" "${FULL_COMPOSE_ARGS[@]}" up -d --no-deps --force-recreate "$SERVICE" >/dev/null 2>&1 || true
  docker rm -f acyberschool-office-worker >/dev/null 2>&1 || true
  echo "Previous application image restored."
  echo "Backup folder: $BACKUP_DIR"
  echo
  read -r -p "Press Return to close..."
  exit 1
}

echo
echo "[6/9] Replacing only the LearnHouse application service..."
docker compose -p "$PROJECT" --project-directory "$WORKDIR" "${FULL_COMPOSE_ARGS[@]}" up -d --no-deps --force-recreate "$SERVICE" >/dev/null || rollback_app
NEW_APP="$(docker compose -p "$PROJECT" --project-directory "$WORKDIR" "${FULL_COMPOSE_ARGS[@]}" ps -q "$SERVICE" 2>/dev/null)"
[ -n "$NEW_APP" ] || rollback_app
sleep 6
[ "$(docker inspect -f '{{.State.Running}}' "$NEW_APP" 2>/dev/null || echo false)" = "true" ] || rollback_app
echo "      LearnHouse application is running."

echo
echo "[7/9] Starting the protected PowerPoint preview worker..."
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$NEW_APP" > "$TEMP_ENV" 2>/dev/null || rollback_app
chmod 600 "$TEMP_ENV" 2>/dev/null || true
NETWORK="$(docker inspect -f '{{range $name, $cfg := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$NEW_APP" 2>/dev/null | head -n 1)"
[ -n "$NETWORK" ] || rollback_app
docker rm -f acyberschool-office-worker >/dev/null 2>&1 || true
docker run -d --name acyberschool-office-worker --restart unless-stopped --platform linux/amd64 --env-file "$TEMP_ENV" --volumes-from "$NEW_APP" --network "$NETWORK" "$OFFICE_IMAGE" >/dev/null || rollback_app
sleep 3
[ "$(docker inspect -f '{{.State.Running}}' acyberschool-office-worker 2>/dev/null || echo false)" = "true" ] || rollback_app
echo "      PowerPoint preview worker is running."

echo
echo "[8/9] Checking the Acyberschool organization through the restored LMS..."
INSTANCE_OK="false"
for attempt in 1 2 3 4 5 6; do
  INSTANCE="$(curl -fsS --max-time 15 "${LIVE_URL}/api/v1/instance/info" 2>/dev/null || true)"
  if echo "$INSTANCE" | grep -q '"default_org_slug"[[:space:]]*:[[:space:]]*"acyberschool"'; then INSTANCE_OK="true"; break; fi
  sleep 5
done
[ "$INSTANCE_OK" = "true" ] || rollback_app
echo "      Acyberschool organization resolves correctly."

echo
echo "[9/9] Checking the live classroom..."
LIVE_OK="false"
for attempt in 1 2 3 4 5 6; do
  HTTP_CODE="$(curl -L -sS -o "$BACKUP_DIR/live-check.html" -w "%{http_code}" --max-time 20 "$LIVE_URL/" 2>/dev/null || true)"
  case "$HTTP_CODE" in 200|301|302|303|307|308) LIVE_OK="true"; break ;; esac
  sleep 5
done
[ "$LIVE_OK" = "true" ] || rollback_app
grep -qi "Organization not found" "$BACKUP_DIR/live-check.html" 2>/dev/null && rollback_app

echo
echo "RESTORE COMPLETED"
echo
echo "Acyberschool LearnHouse release: ${RELEASE_SHORT}"
echo "Live classroom: $LIVE_URL"
echo "Database and learner data: preserved"
echo "Cloudflare: unchanged"
echo "Backup: $BACKUP_DIR"
echo
echo "You can now open classroom.acyberschool.com in your browser."
echo
read -r -p "Press Return to close..."
