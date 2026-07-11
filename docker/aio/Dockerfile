# All-in-One image: Docmost + PostgreSQL + Redis bundled into a single container.
# Intended for small/single-host deployments. Postgres and Redis are bound to
# 127.0.0.1 only — they are NEVER exposed outside the container.

# Keep dependency layers independent from source and version changes. This is
# important for Registry-backed deployments: most application changes should
# only add fresh build-output layers.
FROM node:22-trixie-slim AS pnpm-base

RUN npm install -g pnpm@10.34.5

WORKDIR /app

FROM pnpm-base AS builder-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/editor-ext/package.json packages/editor-ext/package.json
COPY patches ./patches

RUN pnpm install --frozen-lockfile

# Stage 1: build the app (mirrors the main Dockerfile builder stage)
FROM builder-deps AS builder

ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

COPY . .
RUN pnpm build

# Pin the bundled data services to their official images. Copying Redis from
# its official Trixie image keeps the runtime on one libc family while the
# PostgreSQL image supplies the matching server binaries and system user.
FROM redis:8.6.3-trixie AS redis-runtime

# Stage 2: runtime with postgres + redis + supervisord
FROM postgres:18.4-trixie AS runtime

ARG POSTGRES_VERSION=18

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PG_VERSION=${POSTGRES_VERSION} \
    PG_DATA=/app/data/postgres \
    PG_RUN=/var/run/postgresql \
    PG_LOG=/var/log/postgresql \
    REDIS_DATA=/app/data/redis \
    DOCMOST_DATA=/app/data/storage \
    AIO_STATE_DIR=/app/data/aio

COPY --from=pnpm-base /usr/local /usr/local
COPY --from=redis-runtime /usr/local/bin/redis-server /usr/local/bin/redis-cli /usr/local/bin/

RUN groupadd --gid 1000 node \
 && useradd --uid 1000 --gid node --shell /bin/bash --create-home node \
 && groupadd --system redis \
 && useradd --system --gid redis --home-dir /var/lib/redis --no-create-home redis \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      curl bash ca-certificates tini \
      supervisor \
      openssl \
 && rm -rf /var/lib/apt/lists/* \
 && node --version \
 && pnpm --version \
 && /usr/lib/postgresql/${POSTGRES_VERSION}/bin/postgres --version \
 && redis-server --version

WORKDIR /app

# Install production dependencies before copying build output. Their layer only
# changes when the lockfile, package manifests, or patches change.
COPY --chown=node:node --from=builder /app/apps/server/package.json /app/apps/server/package.json
COPY --chown=node:node --from=builder /app/packages/editor-ext/package.json /app/packages/editor-ext/package.json
COPY --chown=node:node --from=builder /app/package.json /app/package.json
COPY --chown=node:node --from=builder /app/pnpm*.yaml /app/
COPY --chown=node:node --from=builder /app/.npmrc /app/.npmrc
COPY --chown=node:node --from=builder /app/patches /app/patches

# pnpm creates its temporary files and node_modules directly under /app.
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
RUN chmod 755 /usr/local/bin/aio-*.sh \
 && chmod 644 /etc/redis/redis-aio.conf /etc/supervisor/*.conf

# APP_VERSION belongs after the large stable layers. It is intentionally set
# before the small application-output layers so a version bump does not force
# PostgreSQL/Redis or production dependencies to be uploaded again.
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

# App artifacts are the layers expected to change for normal application work.
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --chown=node:node --from=builder /app/apps/client/dist /app/apps/client/dist
COPY --from=builder /app/packages/editor-ext/dist /app/packages/editor-ext/dist
RUN chmod -R a+rX \
      /app/apps/server/dist \
      /app/apps/client/dist \
      /app/packages/editor-ext/dist

# All persistent state under /app/data so a single volume covers everything.
VOLUME ["/app/data"]

EXPOSE 3000

# tini handles signal forwarding/zombie reaping for the supervisord tree
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aio-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
