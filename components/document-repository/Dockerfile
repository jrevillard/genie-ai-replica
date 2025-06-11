# Use Node.js 22.14.0 as the base image
FROM node:22.14.0

# Install system dependencies required for clamscan and other packages
# RUN apt-get update && apt-get install -y \
#     clamav \
#     clamav-daemon \
#     && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY document-repository/package*.json ./

# Install app dependencies
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --verbose --fetch-timeout 600000 || \
    npm install --prefer-offline || \
    npm ci

# Copy app source
COPY document-repository/src/ ./src/

# Copy shared-lib with all contents
#RUN rm -rf /app/src/shared-lib/*.js
COPY shared/lib/ ./scr/shared-lib/

# Create directories for uploads and logs
RUN mkdir -p uploads logs

# Debug: List contents of directories
RUN ls -la /app && \
    ls -la /app/src/shared-lib

RUN [ -f /app/src/shared-lib/logger.js ] || { echo "logger.js missing!"; exit 1; }
RUN [ -f /app/src/shared-lib/db-connection-service.js ] || { echo "db-connection-service.js missing!"; exit 1; }

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=development
ENV PORT=3000
ENV ARANGO_URL=http://localhost:8529
ENV ARANGO_DB=document_repository
ENV ARANGO_USER=root
ENV ARANGO_PASSWORD=Password1234
ENV UPLOAD_DIR=./uploads
ENV MAX_FILE_SIZE=5242880

# Start the application
CMD ["node", "src/server.js"] 