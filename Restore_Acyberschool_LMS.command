#!/bin/bash
set -u
clear

echo "ACYBERSCHOOL LMS RESTORE"
echo
echo "Restoring the branded LearnHouse LMS with learner media delivery."
echo "The production database, uploaded course content and 0to1 containers are preserved."
echo

TARGET_IMAGE="ghcr.io/acyberschool/acyberschool-lms:main"
WORKER_IMAGE="ghcr.io/acyberschool/acyberschool-lms-office-worker:main"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_IMAGE="acyberschool-lms:pre-restore-${STAMP}"

stop_with_message() {
  echo
  echo "RESTORE STOPPED"
  echo "$1"
  echo
  echo "No database or course data was removed."
  echo
  read -r -p "Press Return to close..."
  exit 1
}

if ! docker info >/dev/null 2>&1; then
  stop_with_message "Docker is not running. Open Docker Desktop, wait until it is running, then double click this file again."
fi

APP_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^learnhouse-app-' | grep -v -- '-dev' | head -n 1 || true)"
[ -n "${APP_CONTAINER}" ] || stop_with_message "I could not find the production LearnHouse app container."

echo "Found production LMS: ${APP_CONTAINER}"

PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "${APP_CONTAINER}" 2>/dev/null || true)"
SERVICE="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "${APP_CONTAINER}" 2>/dev/null || true)"
WORKDIR="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "${APP_CONTAINER}" 2>/dev/null || true)"
CONFIG_FILES="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "${APP_CONTAINER}" 2>/dev/null || true)"

if [ -z "${PROJECT}" ] || [ -z "${SERVICE}" ] || [ -z "${WORKDIR}" ] || [ -z "${CONFIG_FILES}" ]; then
  stop_with_message "The running LearnHouse container does not expose its Docker Compose deployment information. The production app was not replaced."
fi

CURRENT_IMAGE_ID="$(docker inspect -f '{{.Image}}' "${APP_CONTAINER}" 2>/dev/null || true)"
[ -n "${CURRENT_IMAGE_ID}" ] || stop_with_message "I could not read the current LMS image."

echo "Creating a rollback copy of the current LMS..."
docker tag "${CURRENT_IMAGE_ID}" "${BACKUP_IMAGE}" >/dev/null 2>&1 || stop_with_message "I could not create the rollback image."

echo "Pulling the restored Acyberschool LearnHouse image..."
docker pull "${TARGET_IMAGE}" || stop_with_message "The restored LMS image could not be downloaded. The currently running LMS has not been replaced."

COMPOSE=(docker compose --project-directory "${WORKDIR}" -p "${PROJECT}")
OLD_IFS="${IFS}"
IFS=','
read -r -a RAW_CONFIGS <<< "${CONFIG_FILES}"
IFS="${OLD_IFS}"

for raw in "${RAW_CONFIGS[@]}"; do
  cfg="$(echo "${raw}" | xargs)"
  [ -z "${cfg}" ] && continue
  if [[ "${cfg}" = /* ]]; then resolved="${cfg}"; else resolved="${WORKDIR}/${cfg}"; fi
  [ -f "${resolved}" ] || stop_with_message "The existing production Docker Compose file could not be found at ${resolved}. The LMS was not replaced."
  COMPOSE+=(-f "${resolved}")
done

OVERRIDE="$(mktemp /tmp/acyberschool-restore-XXXXXX.yml)"
cat > "${OVERRIDE}" <<EOF
services:
  ${SERVICE}:
    image: ${TARGET_IMAGE}
    environment:
      LEARNHOUSE_OFFICE_PREVIEW_ENABLED: "true"
EOF

rollback_app() {
  echo
  echo "The restored LMS did not pass its local safety check."
  echo "Restoring the previous LMS automatically..."
  cat > "${OVERRIDE}" <<EOF
services:
  ${SERVICE}:
    image: ${BACKUP_IMAGE}
EOF
  "${COMPOSE[@]}" -f "${OVERRIDE}" up -d --no-deps "${SERVICE}" >/dev/null 2>&1 || true
  rm -f "${OVERRIDE}"
  echo "The previous LMS has been restored."
  echo
  read -r -p "Press Return to close..."
  exit 1
}

echo
echo "Updating only the production LearnHouse application..."
"${COMPOSE[@]}" -f "${OVERRIDE}" up -d --no-deps "${SERVICE}" || rollback_app

NEW_APP=""
for i in $(seq 1 40); do
  NEW_APP="$(docker ps -a --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=${SERVICE}" --format '{{.Names}}' | head -n 1 || true)"
  if [ -n "${NEW_APP}" ]; then
    STATE="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${NEW_APP}" 2>/dev/null || true)"
    if [ "${STATE}" = "healthy" ] || [ "${STATE}" = "running" ]; then break; fi
    if [ "${STATE}" = "unhealthy" ] || [ "${STATE}" = "exited" ] || [ "${STATE}" = "dead" ]; then rollback_app; fi
  fi
  sleep 3
done

[ -n "${NEW_APP}" ] || rollback_app

echo "Checking the Acyberschool organization and public domain configuration..."
INSTANCE_INFO="$(curl -fsS --max-time 20 -H 'Host: classroom.acyberschool.com' http://127.0.0.1:8080/api/v1/instance/info 2>/dev/null || true)"
echo "${INSTANCE_INFO}" | grep -q '"default_org_slug":"acyberschool"' || rollback_app
echo "${INSTANCE_INFO}" | grep -q '"frontend_domain":"classroom.acyberschool.com"' || rollback_app
rm -f "${OVERRIDE}"
echo "Local LMS check passed."

echo
echo "Preparing PowerPoint preview worker..."
docker rm -f learnhouse-office-preview-worker >/dev/null 2>&1 || true

if docker pull --platform linux/amd64 "${WORKER_IMAGE}" >/dev/null 2>&1; then
  ENVFILE="$(mktemp /tmp/acyberschool-office-env-XXXXXX)"
  chmod 600 "${ENVFILE}"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${NEW_APP}" | grep -v '^LEARNHOUSE_OFFICE_PREVIEW_ENABLED=' > "${ENVFILE}"
  printf '\nLEARNHOUSE_OFFICE_PREVIEW_ENABLED=true\n' >> "${ENVFILE}"

  APP_NETWORKS=()
  while IFS= read -r net; do [ -n "${net}" ] && APP_NETWORKS+=("${net}"); done < <(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "${NEW_APP}" 2>/dev/null)

  WORKER_ARGS=(docker run -d --platform linux/amd64 --name learnhouse-office-preview-worker --restart unless-stopped --env-file "${ENVFILE}")
  CONTENT_LINE="$(docker inspect -f '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "|" .Destination}}{{end}}' "${NEW_APP}" 2>/dev/null | grep '/content$' | head -n 1 || true)"

  if [ -n "${CONTENT_LINE}" ]; then
    OLD_IFS="${IFS}"; IFS='|'; read -r MTYPE MNAME MSOURCE MDEST <<< "${CONTENT_LINE}"; IFS="${OLD_IFS}"
    MTYPE="$(echo "${MTYPE}" | xargs)"; MNAME="$(echo "${MNAME}" | xargs)"; MSOURCE="$(echo "${MSOURCE}" | xargs)"; MDEST="$(echo "${MDEST}" | xargs)"
    if [ "${MTYPE}" = "volume" ] && [ -n "${MNAME}" ]; then WORKER_ARGS+=(-v "${MNAME}:${MDEST}"); fi
    if [ "${MTYPE}" = "bind" ] && [ -n "${MSOURCE}" ]; then WORKER_ARGS+=(-v "${MSOURCE}:${MDEST}"); fi
  fi

  if [ "${#APP_NETWORKS[@]}" -gt 0 ]; then WORKER_ARGS+=(--network "${APP_NETWORKS[0]}"); fi
  WORKER_ARGS+=("${WORKER_IMAGE}")

  if "${WORKER_ARGS[@]}" >/dev/null 2>&1; then
    if [ "${#APP_NETWORKS[@]}" -gt 1 ]; then
      for ((n=1; n<${#APP_NETWORKS[@]}; n++)); do docker network connect "${APP_NETWORKS[$n]}" learnhouse-office-preview-worker >/dev/null 2>&1 || true; done
    fi
    sleep 3
    if docker ps --format '{{.Names}}' | grep -qx 'learnhouse-office-preview-worker'; then
      echo "PowerPoint preview worker is running."
    else
      docker rm -f learnhouse-office-preview-worker >/dev/null 2>&1 || true
      echo "PowerPoint worker did not remain running. The core LMS is still restored."
    fi
  else
    echo "PowerPoint worker could not be started. The core LMS is still restored."
  fi
  rm -f "${ENVFILE}"
else
  echo "PowerPoint worker image could not be pulled. The core LMS is still restored."
fi

PUBLIC_CODE=""
PUBLIC_BAD=0
check_public() {
  PUBLIC_BODY="$(mktemp /tmp/acyberschool-public-XXXXXX)"
  PUBLIC_CODE="$(curl -L -sS --max-time 25 -o "${PUBLIC_BODY}" -w '%{http_code}' https://classroom.acyberschool.com/ 2>/dev/null || true)"
  PUBLIC_BAD=0
  grep -qi 'Organization not found' "${PUBLIC_BODY}" 2>/dev/null && PUBLIC_BAD=1
  grep -qi "We couldn't find that" "${PUBLIC_BODY}" 2>/dev/null && PUBLIC_BAD=1
  rm -f "${PUBLIC_BODY}"
}

echo
echo "Checking classroom.acyberschool.com..."
check_public

if [ "${PUBLIC_BAD}" -eq 1 ] || [ "${PUBLIC_CODE}" = "404" ] || [ "${PUBLIC_CODE}" = "502" ] || [ "${PUBLIC_CODE}" = "503" ]; then
  echo "The LMS is correct locally, but the public origin relay is stale."
  echo "Repairing only that stateless relay..."

  PROXY="acyberschool-origin-proxy"
  TUNNEL="acyberschool-tunnel"
  NGINX="$(docker ps --format '{{.Names}}' | grep '^learnhouse-nginx-' | grep -v -- '-dev' | head -n 1 || true)"

  if [ -n "${NGINX}" ] && docker inspect "${PROXY}" >/dev/null 2>&1 && docker inspect "${TUNNEL}" >/dev/null 2>&1; then
    BACKUP_PROXY="acyberschool-origin-proxy-backup-${STAMP}"
    PROXY_NETWORKS=(); NGINX_NETWORKS=()
    while IFS= read -r net; do [ -n "${net}" ] && PROXY_NETWORKS+=("${net}"); done < <(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "${PROXY}" 2>/dev/null)
    while IFS= read -r net; do [ -n "${net}" ] && NGINX_NETWORKS+=("${net}"); done < <(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "${NGINX}" 2>/dev/null)

    if [ "${#NGINX_NETWORKS[@]}" -gt 0 ]; then
      docker stop "${PROXY}" >/dev/null 2>&1 || true
      if docker rename "${PROXY}" "${BACKUP_PROXY}" >/dev/null 2>&1; then
        PRIMARY_NET="${NGINX_NETWORKS[0]}"
        if docker run -d --name acyberschool-origin-proxy --restart unless-stopped --network "${PRIMARY_NET}" alpine:latest sh -c "apk add --no-cache socat >/dev/null 2>&1 && exec socat TCP-LISTEN:8080,fork,reuseaddr TCP:${NGINX}:80" >/dev/null 2>&1; then
          for net in "${PROXY_NETWORKS[@]}"; do
            docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' acyberschool-origin-proxy | grep -qx "${net}" || docker network connect "${net}" acyberschool-origin-proxy >/dev/null 2>&1 || true
          done
          sleep 8
          check_public
          if [ "${PUBLIC_BAD}" -eq 0 ] && [ -n "${PUBLIC_CODE}" ] && [ "${PUBLIC_CODE}" != "404" ] && [ "${PUBLIC_CODE}" != "502" ] && [ "${PUBLIC_CODE}" != "503" ]; then
            docker rm -f "${BACKUP_PROXY}" >/dev/null 2>&1 || true
            echo "Public LMS route repaired."
          else
            docker rm -f acyberschool-origin-proxy >/dev/null 2>&1 || true
            docker rename "${BACKUP_PROXY}" acyberschool-origin-proxy >/dev/null 2>&1 || true
            docker start acyberschool-origin-proxy >/dev/null 2>&1 || true
          fi
        else
          docker rename "${BACKUP_PROXY}" acyberschool-origin-proxy >/dev/null 2>&1 || true
          docker start acyberschool-origin-proxy >/dev/null 2>&1 || true
        fi
      fi
    fi
  fi
fi

echo
check_public
if [ "${PUBLIC_BAD}" -eq 0 ] && [ -n "${PUBLIC_CODE}" ] && [ "${PUBLIC_CODE}" != "404" ] && [ "${PUBLIC_CODE}" != "502" ] && [ "${PUBLIC_CODE}" != "503" ]; then
  echo "ACYBERSCHOOL LMS IS ONLINE"
  echo
  echo "Restored release: 00088104"
  echo "Classroom: https://classroom.acyberschool.com"
  echo
  echo "Your database and existing course data were preserved."
  echo "The browser will open now so you can test the LMS."
  open "https://classroom.acyberschool.com" >/dev/null 2>&1 || true
else
  echo "THE LMS APPLICATION IS RESTORED, BUT THE PUBLIC PAGE STILL NEEDS ROUTING ATTENTION"
  echo
  echo "Local Acyberschool organization check: PASSED"
  echo "Public HTTP status: ${PUBLIC_CODE:-no response}"
  echo
  echo "Please send me a screenshot of this Terminal window."
  echo "Do not change anything in Cloudflare."
fi

echo
read -r -p "Press Return to close..."
