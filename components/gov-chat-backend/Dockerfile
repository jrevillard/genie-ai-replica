FROM node:22 AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        make \
        build-essential \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY gov-chat-backend/package*.json ./
COPY shared/lib ./shared-lib

RUN npm config set registry https://registry.npmjs.org/ && \
    npm ci --verbose --fetch-timeout 600000
RUN rm -rf /app/node_modules/shared-lib

COPY gov-chat-backend/ ./
RUN mkdir -p /app/Uploads

FROM node:22-slim

# Security-patch the runtime base and keep the shipped image at current Debian
# point-releases. The slim base drops the build toolchain (build-essential,
# python3, make) that the full node:22 image ships but the runtime never needs —
# removing the linux-libc-dev kernel-headers CVE surface from the scan.
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        wget \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*
# wget: docker-entrypoint.sh waits for ArangoDB with a wget probe, and the
# compose healthcheck (docker-compose.yaml backend service) uses wget --spider.
# The full node:22 image shipped it; node:22-slim does not.

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared-lib ./shared-lib
COPY --from=builder /app/Uploads ./Uploads
COPY gov-chat-backend/ ./

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production
ENV UPLOAD_DIR=./Uploads
ENV MAX_FILE_SIZE=5242880
ENV SESSION_EXPIRATION_TIME=1800000

COPY gov-chat-backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# The app runs as the unprivileged `node` user, so every directory it writes to
# must be writable by uid 1000. transformers.js downloads its translation model
# into a cache directory INSIDE node_modules (copied from the root-owned builder
# stage), and the winston logger opens ./logs relative to WORKDIR — pre-create
# and chown both, or the CPU translation fallback crashes with EACCES the first
# time it engages (e.g. GPU endpoint unreachable). Uploads and data get the same
# treatment because named volumes inherit the ownership of the image directory
# they are first mounted on.
RUN mkdir -p /app/node_modules/@xenova/transformers/.cache /app/logs /app/Uploads /app/data && \
    chown -R node:node /app/node_modules/@xenova/transformers/.cache /app/logs /app/Uploads /app/data

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "index.js"]

USER node
