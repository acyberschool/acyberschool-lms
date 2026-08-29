#!/bin/zsh
set -u
HOST="classroom.acyberschool.com"
IMAGE="ghcr.io/acyberschool/acyberschool-lms:main"
clear
echo "ACYBERSCHOOL LMS — CONFIGURE AI, EMAIL & PUBLIC HOST"
echo "This keeps the existing localhost:8080 LMS and all data."
if ! docker info >/dev/null 2>&1; then echo "STOP: Start Docker Desktop first."; read "?Press Return..."; exit 1; fi
ROOT="$HOME/.learnhouse/acyberschool"
if [[ -f "$ROOT/docker-compose.yml" ]]; then COMPOSE="$ROOT/docker-compose.yml"; elif [[ -f "$ROOT/compose.yml" ]]; then COMPOSE="$ROOT/compose.yml"; else echo "STOP: LMS not found at $ROOT"; read "?Press Return..."; exit 1; fi
if ! curl -sSf http://localhost:8080 >/dev/null 2>&1; then echo "STOP: localhost:8080 is not responding."; read "?Press Return..."; exit 1; fi
echo "Paste your OpenAI API key. Nothing will appear."
read -s "OPENAI_KEY?OpenAI API key: "; echo
if [[ -z "$OPENAI_KEY" || "$OPENAI_KEY" != sk-* ]]; then echo "STOP: Invalid-looking OpenAI API key."; read "?Press Return..."; exit 1; fi
HTTP=$(curl -sS -o /tmp/acyber-ai-test.json -w "%{http_code}" https://api.openai.com/v1/responses -H "Authorization: Bearer $OPENAI_KEY" -H "Content-Type: application/json" -d '{"model":"gpt-5.4-mini","input":"Reply exactly OK","max_output_tokens":16}' || true)
rm -f /tmp/acyber-ai-test.json
if [[ "$HTTP" != "200" ]]; then echo "STOP: OpenAI returned HTTP $HTTP."; [[ "$HTTP" == "429" ]] && echo "The API account needs usable billing/quota."; OPENAI_KEY=""; read "?Press Return..."; exit 1; fi
echo "OpenAI works."
echo "Paste the 16-digit Google App Password for acyberschool@gmail.com. Nothing will appear."
read -s "APP_PASS?Google App Password: "; echo
APP_PASS=$(echo "$APP_PASS" | tr -d ' ')
if [[ ${#APP_PASS} -lt 16 ]]; then echo "STOP: Invalid-looking Google App Password."; OPENAI_KEY=""; APP_PASS=""; read "?Press Return..."; exit 1; fi
MAILFILE=$(mktemp)
cat > "$MAILFILE" <<EOF
From: Acyberschool <acyberschool@gmail.com>
To: acyberschool@gmail.com
Subject: Acyberschool LMS email test

Acyberschool LMS outbound email is configured.
EOF
if ! curl --silent --show-error --url smtp://smtp.gmail.com:587 --ssl-reqd --user "acyberschool@gmail.com:$APP_PASS" --mail-from acyberschool@gmail.com --mail-rcpt acyberschool@gmail.com --upload-file "$MAILFILE" >/dev/null 2>&1; then rm -f "$MAILFILE"; echo "STOP: Gmail did not accept the App Password."; OPENAI_KEY=""; APP_PASS=""; read "?Press Return..."; exit 1; fi
rm -f "$MAILFILE"
echo "Outbound email works."
cd "$ROOT" || exit 1
ENV="$ROOT/.env"; touch "$ENV"; cp "$ENV" "$ROOT/.env.backup-before-launch-$(date +%Y%m%d-%H%M%S)"
for V in LEARNHOUSE_SITE_NAME LEARNHOUSE_SITE_DESCRIPTION LEARNHOUSE_CONTACT_EMAIL LEARNHOUSE_DOMAIN LEARNHOUSE_FRONTEND_DOMAIN LEARNHOUSE_SSL LEARNHOUSE_TENANCY LEARNHOUSE_ALLOWED_ORIGINS LEARNHOUSE_COOKIE_DOMAIN LEARNHOUSE_IS_AI_ENABLED LEARNHOUSE_AI_PROVIDER LEARNHOUSE_AI_API_KEY LEARNHOUSE_AI_MODEL_FAST LEARNHOUSE_AI_MODEL_STANDARD LEARNHOUSE_AI_MODEL_PRO LEARNHOUSE_EMAIL_PROVIDER LEARNHOUSE_SYSTEM_EMAIL_ADDRESS LEARNHOUSE_SYSTEM_EMAIL_SENDER_NAME LEARNHOUSE_SMTP_HOST LEARNHOUSE_SMTP_PORT LEARNHOUSE_SMTP_USERNAME LEARNHOUSE_SMTP_PASSWORD LEARNHOUSE_SMTP_USE_TLS; do sed -i '' "/^${V}=/d" "$ENV"; done
cat >> "$ENV" <<EOF
LEARNHOUSE_SITE_NAME=Acyberschool
LEARNHOUSE_SITE_DESCRIPTION=Learning that moves into work.
LEARNHOUSE_CONTACT_EMAIL=acyberschool@gmail.com
LEARNHOUSE_DOMAIN=$HOST
LEARNHOUSE_FRONTEND_DOMAIN=$HOST
LEARNHOUSE_SSL=true
LEARNHOUSE_TENANCY=single
LEARNHOUSE_ALLOWED_ORIGINS=https://$HOST,http://localhost:8080
LEARNHOUSE_COOKIE_DOMAIN=$HOST
LEARNHOUSE_IS_AI_ENABLED=true
LEARNHOUSE_AI_PROVIDER=openai
LEARNHOUSE_AI_API_KEY=$OPENAI_KEY
LEARNHOUSE_AI_MODEL_FAST=gpt-5.4-nano
LEARNHOUSE_AI_MODEL_STANDARD=gpt-5.4-mini
LEARNHOUSE_AI_MODEL_PRO=gpt-5.4
LEARNHOUSE_EMAIL_PROVIDER=smtp
LEARNHOUSE_SYSTEM_EMAIL_ADDRESS=acyberschool@gmail.com
LEARNHOUSE_SYSTEM_EMAIL_SENDER_NAME=Acyberschool
LEARNHOUSE_SMTP_HOST=smtp.gmail.com
LEARNHOUSE_SMTP_PORT=587
LEARNHOUSE_SMTP_USERNAME=acyberschool@gmail.com
LEARNHOUSE_SMTP_PASSWORD=$APP_PASS
LEARNHOUSE_SMTP_USE_TLS=true
EOF
chmod 600 "$ENV"
cat > "$ROOT/docker-compose.acyberschool-launch.yml" <<'EOF'
services:
  learnhouse-app:
    environment:
      LEARNHOUSE_SITE_NAME: "${LEARNHOUSE_SITE_NAME}"
      LEARNHOUSE_SITE_DESCRIPTION: "${LEARNHOUSE_SITE_DESCRIPTION}"
      LEARNHOUSE_CONTACT_EMAIL: "${LEARNHOUSE_CONTACT_EMAIL}"
      LEARNHOUSE_DOMAIN: "${LEARNHOUSE_DOMAIN}"
      LEARNHOUSE_FRONTEND_DOMAIN: "${LEARNHOUSE_FRONTEND_DOMAIN}"
      LEARNHOUSE_SSL: "${LEARNHOUSE_SSL}"
      LEARNHOUSE_TENANCY: "${LEARNHOUSE_TENANCY}"
      LEARNHOUSE_ALLOWED_ORIGINS: "${LEARNHOUSE_ALLOWED_ORIGINS}"
      LEARNHOUSE_COOKIE_DOMAIN: "${LEARNHOUSE_COOKIE_DOMAIN}"
      LEARNHOUSE_IS_AI_ENABLED: "${LEARNHOUSE_IS_AI_ENABLED}"
      LEARNHOUSE_AI_PROVIDER: "${LEARNHOUSE_AI_PROVIDER}"
      LEARNHOUSE_AI_API_KEY: "${LEARNHOUSE_AI_API_KEY}"
      LEARNHOUSE_AI_MODEL_FAST: "${LEARNHOUSE_AI_MODEL_FAST}"
      LEARNHOUSE_AI_MODEL_STANDARD: "${LEARNHOUSE_AI_MODEL_STANDARD}"
      LEARNHOUSE_AI_MODEL_PRO: "${LEARNHOUSE_AI_MODEL_PRO}"
      LEARNHOUSE_EMAIL_PROVIDER: "${LEARNHOUSE_EMAIL_PROVIDER}"
      LEARNHOUSE_SYSTEM_EMAIL_ADDRESS: "${LEARNHOUSE_SYSTEM_EMAIL_ADDRESS}"
      LEARNHOUSE_SYSTEM_EMAIL_SENDER_NAME: "${LEARNHOUSE_SYSTEM_EMAIL_SENDER_NAME}"
      LEARNHOUSE_SMTP_HOST: "${LEARNHOUSE_SMTP_HOST}"
      LEARNHOUSE_SMTP_PORT: "${LEARNHOUSE_SMTP_PORT}"
      LEARNHOUSE_SMTP_USERNAME: "${LEARNHOUSE_SMTP_USERNAME}"
      LEARNHOUSE_SMTP_PASSWORD: "${LEARNHOUSE_SMTP_PASSWORD}"
      LEARNHOUSE_SMTP_USE_TLS: "${LEARNHOUSE_SMTP_USE_TLS}"
EOF
OVERRIDE="$ROOT/docker-compose.acyberschool.yml"
if [[ ! -f "$OVERRIDE" ]]; then printf 'services:\n  learnhouse-app:\n    image: %s\n' "$IMAGE" > "$OVERRIDE"; fi
docker pull "$IMAGE" >/dev/null || exit 1
docker compose --env-file "$ENV" -f "$COMPOSE" -f "$OVERRIDE" -f "$ROOT/docker-compose.acyberschool-launch.yml" up -d --remove-orphans || exit 1
OPENAI_KEY=""; APP_PASS=""
sleep 8
echo "DONE: AI, invitation email and classroom.acyberschool.com settings are loaded."
read "?Press Return to close..."
