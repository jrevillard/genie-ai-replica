# document-repository — multi-stage build
# Stage 1 (builder, full node:22) compiles native npm modules with the full
# toolchain. Stage 2 (node:22-slim runtime) ships no build toolchain: the slim
# base drops build-essential/python3/make and their linux-libc-dev kernel-header
# dependency chain, removing that CVE surface from the scan. An apt upgrade
# pulls current Debian security updates so the image never lags point-releases.
FROM node:22 AS builder

WORKDIR /app

# 1. Copy files needed for 'npm install'
COPY document-repository/package*.json ./
COPY shared/lib ./shared-lib

# 2. Run 'npm ci' (root + shared-lib) — uses pinned package-lock.json
RUN npm config set registry https://registry.npmjs.org/ && \
    npm ci --verbose --fetch-timeout 600000
RUN cd shared-lib && npm ci
RUN rm -rf /app/node_modules/shared-lib

# ======== Runtime ========
FROM node:22-slim

# System dependencies: ClamAV for upload scanning (+ current security updates).
# clamdscan is a Recommends of clamav-daemon but the app's scanner preference
# and clamav-node.sh's readiness loop both invoke it explicitly. curl backs the
# compose healthcheck (docker-compose.yaml doc-repo service).
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends clamav clamav-daemon clamdscan curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure freshclam
RUN sed -i 's/^NotifyClamd/#NotifyClamd/' /etc/clamav/freshclam.conf

# Configure clamd
RUN sed -i 's/^LocalSocket /#LocalSocket /' /etc/clamav/clamd.conf \
    && sed -i 's/^FixStaleSocket /#FixStaleSocket /' /etc/clamav/clamd.conf \
    && sed -i 's/^LocalSocketGroup /#LocalSocketGroup /' /etc/clamav/clamd.conf \
    && sed -i 's/^LocalSocketMode /#LocalSocketMode /' /etc/clamav/clamd.conf \
    && echo 'TCPSocket 3310' >> /etc/clamav/clamd.conf \
    && echo 'TCPAddr 0.0.0.0' >> /etc/clamav/clamd.conf

# Create app directory
WORKDIR /app

# Application: node_modules from the builder stage + source.
# shared-lib ships as a real directory (sources + its own nested node_modules
# from the builder's `cd shared-lib && npm ci`) — ~12 src files require() it
# via relative paths (e.g. require('../shared-lib')), so it must exist on disk.
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared-lib ./shared-lib
COPY document-repository/src/ ./src/
COPY document-repository/scripts/clamav-node.sh ./
RUN chmod +x clamav-node.sh

# Create directories for uploads and logs
RUN mkdir -p uploads logs

# Expose ports
EXPOSE 3001 3310

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV ARANGO_URL=http://arango-vector-db:8529
ENV ARANGO_USER=root
ENV UPLOAD_DIR=./uploads
ENV MAX_FILE_SIZE=52428800
ENV MAX_FILES_UPLOAD=10

# Start the application
CMD ["bash", "/app/clamav-node.sh"]
