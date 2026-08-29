#!/bin/sh

set -e

export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=utf-8

# A single public URL is enough to configure the bundled web, API, auth and
# collaboration services. This keeps production deployment simple and avoids
# copying the same domain into several settings.
if [ -n "$LEARNHOUSE_PUBLIC_URL" ]; then
    PUBLIC_URL=$(printf '%s' "$LEARNHOUSE_PUBLIC_URL" | sed 's:/*$::')
    PUBLIC_HOST=$(printf '%s' "$PUBLIC_URL" | sed -E 's#^https?://##' | cut -d/ -f1)

    export LEARNHOUSE_DOMAIN="${LEARNHOUSE_DOMAIN:-$PUBLIC_HOST}"
    export LEARNHOUSE_COOKIE_DOMAIN="${LEARNHOUSE_COOKIE_DOMAIN:-$PUBLIC_HOST}"
    export NEXT_PUBLIC_LEARNHOUSE_API_URL="${NEXT_PUBLIC_LEARNHOUSE_API_URL:-$PUBLIC_URL/api/v1/}"
    export NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL="${NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL:-$PUBLIC_URL/}"
    export NEXT_PUBLIC_LEARNHOUSE_DOMAIN="${NEXT_PUBLIC_LEARNHOUSE_DOMAIN:-$PUBLIC_HOST}"
    export NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN="${NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN:-$PUBLIC_HOST}"
    export NEXTAUTH_URL="${NEXTAUTH_URL:-$PUBLIC_URL}"

    case "$PUBLIC_URL" in
        https://*)
            export NEXT_PUBLIC_LEARNHOUSE_HTTPS="True"
            COLLAB_SCHEME="wss"
            ;;
        *)
            export NEXT_PUBLIC_LEARNHOUSE_HTTPS="False"
            COLLAB_SCHEME="ws"
            ;;
    esac
    export NEXT_PUBLIC_COLLAB_URL="${NEXT_PUBLIC_COLLAB_URL:-$COLLAB_SCHEME://$PUBLIC_HOST/collab}"
fi

# Render reserves PORT for the externally routed HTTP server. Keep Next.js on
# its internal 8000 port and move nginx to Render's public port.
if [ "$RENDER" = "true" ]; then
    PUBLIC_PORT="${PORT:-10000}"
    export NEXT_PORT="${NEXT_PORT:-8000}"
    sed -i "s/listen 80;/listen ${PUBLIC_PORT};/" /etc/nginx/conf.d/default.conf
    sed -i "s/listen \[::\]:80;/listen [::]:${PUBLIC_PORT};/" /etc/nginx/conf.d/default.conf
fi

# Wait briefly for an external database before application startup.
if [ -n "$LEARNHOUSE_SQL_CONNECTION_STRING" ]; then
    DB_HOST=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\1/p')
    DB_PORT=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\2/p')
    DB_PORT="${DB_PORT:-5432}"
    if [ -n "$DB_HOST" ] && [ "$DB_HOST" != "localhost" ] && [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "db" ]; then
        echo "Waiting for external database at $DB_HOST:$DB_PORT..."
        timeout 60 sh -c 'until nc -z '"$DB_HOST"' '"$DB_PORT"'; do sleep 1; done' || true
    fi
fi

pm2 start server-wrapper.js --cwd /app/web --name learnhouse-web > /dev/null 2>&1
pm2 start uv --cwd /app/api --name learnhouse-api -- run app.py
pm2 start node --cwd /app/collab --name learnhouse-collab -- dist/index.js

pm2 status
nginx -g 'daemon off;' &
pm2 logs --raw
