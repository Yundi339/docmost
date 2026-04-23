#!/bin/bash
set -e

# Ensure storage dir exists and is writable by node (UID 1000).
# When /app/data/storage is a bind mount, the host directory's owner is preserved
# inside the container. This fixes ownership on every start so the node user can write.
STORAGE_DIR="/app/data/storage"

if [ -d "$STORAGE_DIR" ]; then
  # Only chown if not already owned by node, to avoid unnecessary work on large trees
  if [ "$(stat -c %u "$STORAGE_DIR")" != "1000" ]; then
    echo "[entrypoint] Fixing ownership of $STORAGE_DIR -> node:node"
    chown -R node:node "$STORAGE_DIR" || echo "[entrypoint] chown failed (read-only mount?); continuing"
  fi
fi

# Drop privileges and exec the command as node
exec gosu node "$@"
