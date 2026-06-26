FROM node:24-bookworm-slim AS node-runtime

FROM node-runtime AS dependencies
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ubuntu:24.04 AS runtime
ARG APP_VERSION=development
ARG GIT_SHA=development
ARG BUILD_TIME=development
LABEL org.opencontainers.image.title="jingyi-reservation-api" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_TIME"
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME \
    PORT=3000 \
    HOME=/home/jingyi

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl tar tini mysql-client-8.0 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 jingyi \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/jingyi --shell /usr/sbin/nologin jingyi

COPY --from=node-runtime /usr/local/ /usr/local/
WORKDIR /app
COPY --from=dependencies --chown=jingyi:jingyi /build/server/node_modules ./server/node_modules
COPY --chown=jingyi:jingyi server ./server
COPY --chown=jingyi:jingyi scripts ./scripts
COPY --chown=jingyi:jingyi deploy ./deploy
COPY --chown=root:root deploy/docker-entrypoint.sh /usr/local/bin/jingyi-entrypoint
RUN chmod 0555 /usr/local/bin/jingyi-entrypoint \
    && mkdir -p /app/server/uploads /var/lib/jingyi/backups /var/lib/jingyi/backup-secondary \
    && chown -R jingyi:jingyi /app/server/uploads /var/lib/jingyi /home/jingyi \
    && chmod 0700 /var/lib/jingyi/backups /var/lib/jingyi/backup-secondary

USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini","--","/usr/local/bin/jingyi-entrypoint"]
CMD ["node","server/src/app.js"]
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/live >/dev/null || exit 1
