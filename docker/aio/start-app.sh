#!/bin/bash
# Wait for postgres + redis (bundled or external) and launch the docmost server.
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

# Decide DB URL: a user-supplied DATABASE_URL wins; otherwise build the
# bundled-cluster URL from the auto-generated credentials.
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[aio-start-app] using external DATABASE_URL"
else
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
  for i in $(seq 1 60); do
    if (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if [[ -n "${REDIS_URL:-}" ]]; then
  echo "[aio-start-app] using external REDIS_URL"
else
  export REDIS_URL="redis://127.0.0.1:6379"
  for i in $(seq 1 60); do
    if (echo > /dev/tcp/127.0.0.1/6379) >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# Required by docmost. APP_URL falls back to localhost; users should override
# via -e APP_URL=https://your-domain when running the container.
export APP_URL="${APP_URL:-http://localhost:3000}"
export APP_SECRET
export PORT="${PORT:-3000}"
export FILE_UPLOAD_SIZE_LIMIT="${FILE_UPLOAD_SIZE_LIMIT:-50mb}"

cd /app
exec pnpm start
