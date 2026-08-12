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
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared-lib ./shared-lib
COPY okf-server/ ./

EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=production
# Logger writes file transports to /app/logs (volume-mounted in docker-compose as
# ${DATA_DIR}/logs/okf-server:/app/logs); stdout is also captured by the fluentd logging driver.
USER node
CMD ["node", "index.js"]
