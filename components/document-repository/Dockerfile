# Use Node.js 22.14.0 as the base image
FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y clamav=1.4.3+dfsg-1~deb12u2 clamav-daemon=1.4.3+dfsg-1~deb12u2 && \
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

# --- FIX: Match the backend's working logic ---

# 1. Copy files needed for 'npm install'
COPY document-repository/package*.json ./
COPY shared/lib ./shared-lib

# 2. Run 'npm ci' (root + shared-lib) — uses pinned package-lock.json
RUN npm config set registry https://registry.npmjs.org/ && \
    npm ci --verbose --fetch-timeout 600000
RUN cd shared-lib && npm ci
RUN rm -rf /app/node_modules/shared-lib

# 3. Copy the rest of the application source
COPY document-repository/src/ ./src/
COPY document-repository/scripts/clamav-node.sh ./
RUN chmod +x clamav-node.sh

# --- End of fix ---

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
