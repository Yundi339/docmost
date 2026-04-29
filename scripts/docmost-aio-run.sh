#!/usr/bin/env bash
# docmost-aio-run.sh
#
# Build & execute (or print) the recommended `docker run` command for the
# Docmost all-in-one image. Postgres and Redis are bundled inside the
# container and bound to 127.0.0.1 only — they are NEVER exposed on the host.
#
# Secrets (PostgreSQL password, APP_SECRET) are auto-generated INSIDE the
# container on first boot and persisted to the data volume. They never appear
# on the host CLI or in `docker inspect`.
#
# Usage:
#   ./docmost-aio-run.sh                       # start container with defaults
#   APP_URL=https://docs.example.com ./docmost-aio-run.sh
#   PORT=8080 ./docmost-aio-run.sh
#   IMAGE=ghcr.io/owner/docmost-aio:my-branch ./docmost-aio-run.sh
#   ./docmost-aio-run.sh --print              # only print the command, do not run
#
# Environment variables:
#   IMAGE         Image to run (default: docmost-aio:latest)
#   CONTAINER     Container name (default: docmost)
#   PORT          Host port to publish (default: 3000)
#   APP_URL       Public URL of the instance (default: http://localhost:PORT)
#   VOLUME        Docker named volume for persistent data (default: docmost-aio-data)
#   RESTART       Restart policy (default: unless-stopped)
#   EXTRA_ARGS    Extra args appended to docker run

set -euo pipefail

IMAGE="${IMAGE:-docmost-aio:latest}"
CONTAINER="${CONTAINER:-docmost}"
PORT="${PORT:-3000}"
APP_URL="${APP_URL:-http://localhost:${PORT}}"
VOLUME="${VOLUME:-docmost-aio-data}"
RESTART="${RESTART:-unless-stopped}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

PRINT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --print) PRINT_ONLY=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# Build argv as an array for safe quoting.
cmd=(
  docker run -d
  --name "$CONTAINER"
  --restart "$RESTART"
  # Allow up to 120s for graceful shutdown (postgres fast shutdown can take
  # tens of seconds on large databases). Docker default is only 10s.
  --stop-timeout 120
  -p "${PORT}:3000"
  -v "${VOLUME}:/app/data"
  -e "APP_URL=${APP_URL}"
)

if [[ -n "$EXTRA_ARGS" ]]; then
  # shellcheck disable=SC2206
  extra=($EXTRA_ARGS)
  cmd+=("${extra[@]}")
fi

cmd+=("$IMAGE")

# Pretty-print the command for the user.
printf '%s' "${cmd[0]}"
for a in "${cmd[@]:1}"; do
  printf ' \\\n  %q' "$a"
done
printf '\n'

if [[ "$PRINT_ONLY" -eq 1 ]]; then
  exit 0
fi

# Refuse to overwrite an existing container of the same name.
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo
  echo "A container named '$CONTAINER' already exists." >&2
  echo "Stop & remove it first:  docker rm -f $CONTAINER" >&2
  exit 1
fi

echo
exec "${cmd[@]}"
