# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
# OKF Server — Node.js/Express (CommonJS). Mirrors gov-chat-backend build.
# shared/lib is copied in (the shared library: logger, tracing, metrics, keycloak-auth-service).

FROM node:22-trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY okf-server/package*.json ./
COPY shared/lib ./shared-lib
# Install production dependencies only (no eslint/jest/nodemon/prettier/supertest in the runtime image).
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
RUN rm -rf /app/node_modules/shared-lib
COPY okf-server/ ./

# The runtime is the SLIM base: the full one (buildpack-deps) shipped the
# build toolchain — gcc, make, python3, perl, mercurial, subversion,
# mariadb-dev, linux-libc-dev — and none of it is used at runtime: the
# okf-server code calls no external process (the git source adapter, story
# 2-7, is deferred and not in the tree). The full base measured 2506
# container findings (11 Critical, 373 HIGH) against 237 for the slim one
# (2026-11-18) — a toolchain nobody calls, shipped to production.
#
# wget is installed explicitly: the compose healthcheck probes with it and
# the slim base ships neither wget nor curl.
FROM node:22-trixie-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared-lib ./shared-lib
COPY okf-server/ ./

# Security-patch the runtime base: pull current Debian security updates so the
# shipped image does not lag distro point-releases between upstream rebuilds
# (same doctrine as the gov-chat-backend runtime stage). The runtime base is
# now the slim one (see above): the compose healthcheck probes with wget,
# which the slim base does not ship, so wget is installed explicitly.
#
# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes.
#
# It comes AFTER the COPY layers on purpose: a layer's cache key includes its
# parent, so busting the upgrade layer re-runs the layers that follow it —
# and the node_modules COPY is not cheap.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apt-get update -y -o Acquire::Retries=5 && \
    apt-get upgrade -y --with-new-pkgs --fix-missing -o Acquire::Retries=5 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=production
# The shared logger is CONSOLE-ONLY (components/shared/lib/logger.js —
# "Console is the ONLY transport"); stdout is captured by the fluentd
# logging driver. Nothing in this image writes /app/logs.
USER node
CMD ["node", "index.js"]
