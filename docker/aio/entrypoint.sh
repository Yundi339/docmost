#!/bin/bash
# All-in-one container entrypoint.
#
# Default mode: bundled PostgreSQL + Redis + Docmost, all under one container.
# Override mode: point at external services by setting DATABASE_URL and/or
# REDIS_URL (same env names as the standard Docmost image) — the matching
# bundled service is then NOT started.
#
# Persistent state lives under /app/data (mount it as a single Docker volume).

set -euo pipefail

log() { echo "[aio-entrypoint] $*"; }

: "${PG_DATA:=/app/data/postgres}"
: "${REDIS_DATA:=/app/data/redis}"
: "${AIO_STATE_DIR:=/app/data/aio}"
: "${DOCMOST_DATA:=/app/data/storage}"
: "${PG_VERSION:=15}"

SECRETS_FILE="${AIO_STATE_DIR}/secrets.env"

# --- decide which bundled services to start ----------------------------------
# Convention follows the rest of Docmost: setting DATABASE_URL / REDIS_URL
# points the app at an external service. When set, the matching bundled
# service is NOT started.
BUNDLE_POSTGRES=true
BUNDLE_REDIS=true

if [[ -n "${DATABASE_URL:-}" ]]; then
  BUNDLE_POSTGRES=false
  log "Bundled PostgreSQL DISABLED — using external DATABASE_URL"
fi

if [[ -n "${REDIS_URL:-}" ]]; then
  BUNDLE_REDIS=false
  log "Bundled Redis DISABLED — using external REDIS_URL"
fi

mkdir -p "$AIO_STATE_DIR" "$DOCMOST_DATA"
chown -R node:node "$AIO_STATE_DIR" "$DOCMOST_DATA"
if [[ "$BUNDLE_POSTGRES" == "true" ]]; then
  mkdir -p "$PG_DATA"
  chown -R postgres:postgres "$PG_DATA"
  chmod 700 "$PG_DATA"
fi
if [[ "$BUNDLE_REDIS" == "true" ]]; then
  mkdir -p "$REDIS_DATA"
  chown -R redis:redis "$REDIS_DATA"
fi

# --- generate / load secrets --------------------------------------------------
gen_secret() {
  openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48
}

if [[ ! -f "$SECRETS_FILE" ]]; then
  log "First boot detected — generating secrets at $SECRETS_FILE"
  POSTGRES_PASSWORD="$(gen_secret)"
  APP_SECRET_GEN="$(gen_secret)"
  umask 077
  cat > "$SECRETS_FILE" <<EOF
# Auto-generated on first boot. Do not edit unless you know what you are doing.
POSTGRES_USER=docmost
POSTGRES_DB=docmost
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
APP_SECRET=${APP_SECRET_GEN}
EOF
  chown node:node "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi

# Capture user-supplied APP_SECRET (via `-e APP_SECRET=...`) BEFORE sourcing
# secrets.env, so a user-provided key always wins over the auto-generated one.
APP_SECRET_OVERRIDE="${APP_SECRET:-}"

set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

if [[ -n "$APP_SECRET_OVERRIDE" ]]; then
  export APP_SECRET="$APP_SECRET_OVERRIDE"
fi

# --- bootstrap bundled postgres on first boot --------------------------------
if [[ "$BUNDLE_POSTGRES" == "true" && ! -s "$PG_DATA/PG_VERSION" ]]; then
  log "Initialising PostgreSQL cluster at $PG_DATA"
  /usr/local/bin/aio-init-postgres.sh
fi

# Re-apply ownership across restarts
if [[ "$BUNDLE_POSTGRES" == "true" ]]; then
  chown -R postgres:postgres "$PG_DATA" /var/run/postgresql /var/log/postgresql
fi
if [[ "$BUNDLE_REDIS" == "true" ]]; then
  chown -R redis:redis "$REDIS_DATA"
fi

# --- assemble supervisord config ---------------------------------------------
RUNTIME_CONF=/etc/supervisor/supervisord.conf
cp /etc/supervisor/supervisord.base.conf "$RUNTIME_CONF"
if [[ "$BUNDLE_POSTGRES" == "true" ]]; then
  cat /etc/supervisor/program-postgres.conf >> "$RUNTIME_CONF"
fi
if [[ "$BUNDLE_REDIS" == "true" ]]; then
  cat /etc/supervisor/program-redis.conf >> "$RUNTIME_CONF"
fi
cat /etc/supervisor/program-docmost.conf >> "$RUNTIME_CONF"

# --- export downstream environment -------------------------------------------
export POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD APP_SECRET PG_VERSION PG_DATA
export BUNDLE_POSTGRES BUNDLE_REDIS
# DATABASE_URL / REDIS_URL pass through unchanged when provided by the user;
# start-app.sh will fall back to bundled localhost URLs when they are empty.
export DATABASE_URL="${DATABASE_URL:-}"
export REDIS_URL="${REDIS_URL:-}"

log "Starting supervisord (postgres=$BUNDLE_POSTGRES redis=$BUNDLE_REDIS)"
exec "$@"
