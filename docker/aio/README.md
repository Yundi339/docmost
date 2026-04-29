# Docmost All-in-One (AIO) container

Single-container distribution that bundles **Docmost + PostgreSQL + Redis** behind
a `supervisord` process. Designed for small/single-host deployments where you
do not want to manage a separate database or cache.

## Security model

- **PostgreSQL** binds to `127.0.0.1:5432` *inside* the container only. It is
  **not** published on the host and not reachable from the Docker network.
- **Redis** binds to `127.0.0.1:6379` *inside* the container only. Same as above.
- Database credentials and `APP_SECRET` are generated **inside the container**
  on first boot using `openssl rand` and persisted to `/app/data/aio/secrets.env`
  with `0600` permissions. They never appear on the host CLI or in
  `docker inspect`.
- Persistent state (DB, Redis AOF, file storage, secrets) lives under `/app/data`
  — mount **one** Docker volume there.

## Persistence layout

Everything that must survive a container restart is under `/app/data`:

| Path                     | Contents                                  |
| ------------------------ | ----------------------------------------- |
| `/app/data/postgres`     | PostgreSQL cluster (`PGDATA`)             |
| `/app/data/redis`        | Redis AOF (`appendonly yes`)              |
| `/app/data/storage`      | Docmost file uploads / attachments        |
| `/app/data/aio/secrets.env` | Auto-generated DB password & APP_SECRET (0600) |

A single `-v docmost-aio-data:/app/data` mount captures all of it.

## Graceful shutdown

`tini` (PID 1) forwards `SIGTERM` to `supervisord`, which stops the bundled
processes in reverse start order:

1. **docmost** (`SIGTERM`, 30s) — drains HTTP, closes DB/Redis pool.
2. **redis** (`SIGTERM`, 30s) — flushes AOF, exits.
3. **postgres** (`SIGINT`, 60s) — *fast shutdown*: cancels active queries,
   runs a final checkpoint, flushes WAL, exits cleanly.

Total worst case ≈ 120s. Docker's default `docker stop` timeout is **10s**, so
either run with the helper (which sets `--stop-timeout 120`) or stop manually:

```bash
docker stop -t 120 docmost
```

If Docker `SIGKILL`s before postgres finishes, you can lose the latest
unflushed transactions. (PostgreSQL is crash-safe — it will recover from WAL
on next start — but giving it time to checkpoint avoids that recovery work.)

## Quick start

```bash
# Pull or build the image, then run via the helper:
./scripts/docmost-aio-run.sh
```

Override common settings via env vars:

```bash
APP_URL=https://docs.example.com PORT=8080 ./scripts/docmost-aio-run.sh
```

Print the resulting `docker run` without executing:

```bash
./scripts/docmost-aio-run.sh --print
```

## Building locally

```bash
docker build -f docker/aio/Dockerfile -t docmost-aio:local .
IMAGE=docmost-aio:local ./scripts/docmost-aio-run.sh
```

## Hybrid mode (external PostgreSQL / Redis)

The container starts the bundled PG + Redis by default. If you want to keep the
AIO image but reuse an external DB or cache (e.g. RDS, Elasticache, your own
cluster), pass the same env vars the standard Docmost image accepts:

| Variable        | Behavior                                                      |
| --------------- | ------------------------------------------------------------- |
| `DATABASE_URL`  | When set, bundled Postgres is **not** started; app uses this URL. |
| `REDIS_URL`     | When set, bundled Redis is **not** started; app uses this URL. |

Example (external PG, bundled Redis):

```bash
docker run -d --name docmost \
  --restart unless-stopped --stop-timeout 120 \
  -p 3000:3000 -v docmost-aio-data:/app/data \
  -e APP_URL=https://docs.example.com \
  -e DATABASE_URL='postgresql://user:pass@db.example.com:5432/docmost?sslmode=require' \
  ghcr.io/<owner>/docmost-aio:<tag>
```

Setting both URLs degrades the AIO image to a plain Docmost container (only the
docmost process runs under supervisord) — handy for migrating from single-box
AIO to a split deployment without switching images.

## Persistence and upgrades

- `docker rm` only removes the container; the named volume keeps your data.
- To upgrade: `docker stop -t 120 docmost && docker rm docmost && docker pull <new-tag> && docker run ... -v docmost-aio-data:/app/data <new-tag>`. App migrations run on startup.
- The bundled PostgreSQL major version is pinned to **15**. A future bump (PG 16+) will require `pg_upgrade` or dump/restore and will be called out in the release notes.

## Building via GitHub Actions

Use the **AIO (All-in-One) Image** workflow (manual dispatch). Inputs:

- `ref`: branch / tag / SHA to build (defaults to the current ref).
- `tag`: image tag suffix (defaults to the branch name).
- `push`: when `true`, pushes to `ghcr.io/<owner>/docmost-aio`.

Each run uploads a `.tar.gz` of the image (amd64 and arm64) plus the helper
script as artifacts.

## Layout

```
docker/aio/
  Dockerfile          # bundles app + postgres + redis + supervisord
  supervisord.conf    # process manager config
  entrypoint.sh       # generates secrets, initialises postgres
  init-postgres.sh    # initdb + role/db creation (first boot only)
  start-app.sh        # waits for deps, starts docmost
  redis.conf          # localhost-only redis config
scripts/
  docmost-aio-run.sh  # host helper: builds & runs the docker run command
```
