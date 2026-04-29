# All-in-One image: Docmost + PostgreSQL + Redis bundled into a single container.
# Intended for small/single-host deployments. Postgres and Redis are bound to
# 127.0.0.1 only — they are NEVER exposed outside the container.

# Stage 1: build the app (mirrors the main Dockerfile builder stage)
FROM node:22-slim AS builder

RUN npm install -g pnpm@10.4.0

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 2: runtime with postgres + redis + supervisord
FROM node:22-slim AS runtime

ARG POSTGRES_VERSION=15

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PG_VERSION=${POSTGRES_VERSION} \
    PG_DATA=/app/data/postgres \
    PG_RUN=/var/run/postgresql \
    PG_LOG=/var/log/postgresql \
    REDIS_DATA=/app/data/redis \
    DOCMOST_DATA=/app/data/storage \
    AIO_STATE_DIR=/app/data/aio

RUN npm install -g pnpm@10.4.0 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      curl bash gosu ca-certificates tini \
      postgresql postgresql-contrib \
      redis-server \
      supervisor \
      openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# App artifacts
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/client/dist /app/apps/client/dist
COPY --from=builder /app/apps/server/package.json /app/apps/server/package.json
COPY --from=builder /app/packages/editor-ext/dist /app/packages/editor-ext/dist
COPY --from=builder /app/packages/editor-ext/package.json /app/packages/editor-ext/package.json
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm*.yaml /app/
COPY --from=builder /app/.npmrc /app/.npmrc
COPY --from=builder /app/patches /app/patches

# Install prod deps as node user (pnpm needs writable home)
RUN chown -R node:node /app
USER node
RUN pnpm install --frozen-lockfile --prod
USER root

# Layout for runtime data. Postgres + Redis live UNDER /app/data so a single
# volume mount captures all persistent state.
RUN mkdir -p "$DOCMOST_DATA" "$AIO_STATE_DIR" "$PG_RUN" "$PG_LOG" \
 && chown -R node:node "$DOCMOST_DATA" "$AIO_STATE_DIR" \
 && chown -R postgres:postgres "$PG_RUN" "$PG_LOG"

# Bundled config / scripts
COPY docker/aio/supervisord.base.conf /etc/supervisor/supervisord.base.conf
COPY docker/aio/program-postgres.conf /etc/supervisor/program-postgres.conf
COPY docker/aio/program-redis.conf /etc/supervisor/program-redis.conf
COPY docker/aio/program-docmost.conf /etc/supervisor/program-docmost.conf
COPY docker/aio/redis.conf /etc/redis/redis-aio.conf
COPY docker/aio/entrypoint.sh /usr/local/bin/aio-entrypoint.sh
COPY docker/aio/init-postgres.sh /usr/local/bin/aio-init-postgres.sh
COPY docker/aio/start-app.sh /usr/local/bin/aio-start-app.sh
RUN chmod +x /usr/local/bin/aio-*.sh

# All persistent state under /app/data so a single volume covers everything.
VOLUME ["/app/data"]

EXPOSE 3000

# tini handles signal forwarding/zombie reaping for the supervisord tree
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aio-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
