#!/bin/bash
set -e

# Ensure storage dir exists and is writable by node (UID 1000).
# When /app/data/storage is a bind mount, the host directory's owner is preserved
# inside the container. This fixes ownership on every start so the node user can write.
STORAGE_DIR="/app/data/storage"

# Only root can chown / gosu-switch. If we're already running as non-root
# (e.g. platform enforces USER, or `docker run --user` was used), skip privilege
# manipulation and exec the command directly.
if [ "$(id -u)" = "0" ]; then
  if [ -d "$STORAGE_DIR" ]; then
    # Only chown if not already owned by node, to avoid unnecessary work on large trees
    if [ "$(stat -c %u "$STORAGE_DIR")" != "1000" ]; then
      echo "[entrypoint] Fixing ownership of $STORAGE_DIR -> node:node"
      chown -R node:node "$STORAGE_DIR" || echo "[entrypoint] chown failed (read-only mount?); continuing"
    fi
  fi
  # Drop privileges and exec the command as node
  exec gosu node "$@"
else
  # Already non-root; just run the command
  exec "$@"
fi
