# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
# OKF Server — Node.js/Express (CommonJS). Mirrors gov-chat-backend build.
# shared/lib is copied in (the shared library: logger, tracing, metrics, keycloak-auth-service).

FROM node:22 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY okf-server/package*.json ./
COPY shared/lib ./shared-lib
# Install production dependencies only (no eslint/jest/nodemon/prettier/supertest in the runtime image).
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
RUN rm -rf /app/node_modules/shared-lib
COPY okf-server/ ./

FROM node:22
# Security-patch the runtime base: pull current Debian security updates so the
# shipped image does not lag distro point-releases between upstream rebuilds
# (same doctrine as the gov-chat-backend runtime stage). The full node:22 base
# is kept for now — the compose healthcheck probes with wget, which the slim
# base does not ship; slimming is a separate change with its own tool audit.
# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes.
#
# It is the LAST RUN of the runtime stage on purpose: a layer's cache key
# includes its parent, so an upgrade layer with an expensive layer above it
# would re-run that layer on every monthly rebuild.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apt-get update -y -o Acquire::Retries=5 && \
    apt-get upgrade -y --with-new-pkgs --fix-missing -o Acquire::Retries=5 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared-lib ./shared-lib
COPY okf-server/ ./

EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=production
# The shared logger is CONSOLE-ONLY (components/shared/lib/logger.js —
# "Console is the ONLY transport"); stdout is captured by the fluentd
# logging driver. Nothing in this image writes /app/logs.
USER node
CMD ["node", "index.js"]
