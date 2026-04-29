#!/bin/bash
# Wait for postgres + redis (managed by supervisord) and launch the docmost server.
# Reads secrets from /app/data/aio/secrets.env (created by aio-entrypoint.sh).

set -euo pipefail

SECRETS_FILE="${AIO_STATE_DIR:-/app/data/aio}/secrets.env"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "[aio-start-app] secrets file missing: $SECRETS_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

# Wait for postgres TCP socket on localhost.
for i in $(seq 1 60); do
  if (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Wait for redis.
for i in $(seq 1 60); do
  if (echo > /dev/tcp/127.0.0.1/6379) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Required by docmost. APP_URL falls back to localhost; users should override
# via -e APP_URL=https://your-domain when running the container.
export APP_URL="${APP_URL:-http://localhost:3000}"
export APP_SECRET
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
export REDIS_URL="redis://127.0.0.1:6379"
export PORT="${PORT:-3000}"
export FILE_UPLOAD_SIZE_LIMIT="${FILE_UPLOAD_SIZE_LIMIT:-50mb}"

cd /app
exec pnpm start
