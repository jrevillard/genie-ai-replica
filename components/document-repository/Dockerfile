# Use Node.js 22.14.0 as the base image
FROM node:22.14.0

# Install system dependencies required for clamscan and other packages
RUN apt-get update && \
    apt-get install -y clamav clamav-daemon && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure freshclam to not notify clamd during initial update
RUN sed -i 's/^NotifyClamd/#NotifyClamd/' /etc/clamav/freshclam.conf

# Update clamd.conf to use TCP instead of socket
RUN sed -i 's/^LocalSocket /#LocalSocket /' /etc/clamav/clamd.conf \
    && sed -i 's/^FixStaleSocket /#FixStaleSocket /' /etc/clamav/clamd.conf \
    && sed -i 's/^LocalSocketGroup /#LocalSocketGroup /' /etc/clamav/clamd.conf \
    && sed -i 's/^LocalSocketMode /#LocalSocketMode /' /etc/clamav/clamd.conf \
    && echo 'TCPSocket 3310' >> /etc/clamav/clamd.conf \
    && echo 'TCPAddr 0.0.0.0' >> /etc/clamav/clamd.conf

# Create app directory
WORKDIR /app

# Copy startup script
COPY document-repository/scripts/clamav-node.sh ./
RUN chmod +x clamav-node.sh

# Copy package files
COPY document-repository/package*.json ./

# --- FIX ---
# Copy shared-lib to the /shared/lib/ directory at the container's root.
# Your code (e.g., /app/src/app.js) uses require('../../shared/lib/logger'),
# which resolves to /shared/lib/logger.js.
COPY shared/lib/ /shared/lib/

# Install app dependencies
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --verbose --fetch-timeout 600000 || \
    npm install --prefer-offline || \
    npm ci

# Copy app source
COPY document-repository/src/ ./src/

# Create directories for uploads and logs
RUN mkdir -p uploads logs

# Debug: List contents of directories and check for files in the *correct* path
RUN ls -la /app && \
    ls -la /shared/lib
RUN [ -f /shared/lib/logger.js ] || \
    { echo "logger.js missing!"; exit 1; }
RUN [ -f /shared/lib/db-connection-service.js ] || \
    { echo "db-connection-service.js missing!"; exit 1; }

# Expose the port the app runs on
EXPOSE 3001 3310

# Set environment variables
ARG ARANGO_PASSWORD
ENV NODE_ENV=development
ENV PORT=3001
ENV ARANGO_URL=http://arango-vector-db:8529
ENV ARANGO_DB=node-services
ENV ARANGO_USER=root
ENV ARANGO_PASSWORD=$ARANGO_PASSWORD
ENV UPLOAD_DIR=./uploads
ENV MAX_FILE_SIZE=524288000
ENV MAX_FILES_UPLOAD=10

# Start the application
CMD ["bash", "/app/clamav-node.sh"]
