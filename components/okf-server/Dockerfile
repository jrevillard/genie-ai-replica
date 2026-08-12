# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
# OKF Server — Node.js/Express (CommonJS). Mirrors gov-chat-backend build.
# shared/lib is copied in (the shared library: logger, tracing, metrics, keycloak-auth-service).

FROM node:22 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY okf-server/package*.json ./
COPY shared/lib ./shared-lib
RUN npm install --production=false
RUN rm -rf /app/node_modules/shared-lib
COPY okf-server/ ./

FROM node:22
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared-lib ./shared-lib
COPY okf-server/ ./

EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=production
# #356: logger is stdout-only (no Winston file transports) — no logs/ dir needed.
USER node
CMD ["node", "index.js"]
