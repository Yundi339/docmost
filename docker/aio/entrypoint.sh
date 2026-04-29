#!/bin/bash
# All-in-one container entrypoint.
# - Generates persistent secrets on first boot (DB password, APP_SECRET).
# - Initialises the bundled PostgreSQL cluster on first boot.
# - Hands off to supervisord which manages postgres + redis + docmost.
#
# All persistent state lives under /app/data which the user mounts as a single
# Docker volume. PostgreSQL and Redis bind to 127.0.0.1 only and are never
# reachable from outside the container.

set -euo pipefail

log() { echo "[aio-entrypoint] $*"; }

: "${PG_DATA:=/app/data/postgres}"
: "${REDIS_DATA:=/app/data/redis}"
: "${AIO_STATE_DIR:=/app/data/aio}"
: "${DOCMOST_DATA:=/app/data/storage}"
: "${PG_VERSION:=15}"

SECRETS_FILE="${AIO_STATE_DIR}/secrets.env"

mkdir -p "$AIO_STATE_DIR" "$DOCMOST_DATA" "$PG_DATA" "$REDIS_DATA"
chown -R node:node "$AIO_STATE_DIR" "$DOCMOST_DATA"
chown -R postgres:postgres "$PG_DATA"
chmod 700 "$PG_DATA"
chown -R redis:redis "$REDIS_DATA"

gen_secret() {
  # 48 url-safe chars from /dev/urandom
  openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48
}

if [[ ! -f "$SECRETS_FILE" ]]; then
  log "First boot detected - generating secrets at $SECRETS_FILE"
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

# Load secrets into env for downstream scripts (sourced into supervisord env via export).
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

# Initialise PostgreSQL cluster + role/database on first boot.
if [[ ! -s "$PG_DATA/PG_VERSION" ]]; then
  log "Initialising PostgreSQL cluster at $PG_DATA"
  /usr/local/bin/aio-init-postgres.sh
fi

# Ensure runtime dirs have correct ownership across restarts.
chown -R postgres:postgres "$PG_DATA" /var/run/postgresql /var/log/postgresql
chown -R redis:redis "$REDIS_DATA"

# Export to supervisord's environment so child programs can read them.
export POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD APP_SECRET PG_VERSION PG_DATA

log "Handing off to: $*"
exec "$@"
