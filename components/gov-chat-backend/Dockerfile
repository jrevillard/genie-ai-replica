# Use Node.js 22.14.0 as the base image
FROM node:22.14.0

# Use alternative approach for package installation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        make \
        build-essential \
        && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first
COPY gov-chat-backend/package*.json ./

# Copy the shared-lib directory into the container
COPY shared/lib ./shared-lib

# Use a robust NPM installation strategy
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --verbose --fetch-timeout 600000 || \
    npm install --prefer-offline || \
    npm ci

# Copy the entire backend project
COPY gov-chat-backend/ ./

# Expose the backend server port
EXPOSE 3000

# Define environment variables without sensitive values
# These will be provided at runtime

# Server Configuration
ENV PORT=3000
ENV NODE_ENV=development
ENV API_PREFIX=/api

# File Upload Configuration
ENV UPLOAD_DIR=./uploads
ENV MAX_FILE_SIZE=5242880

# Session Configuration
ENV SESSION_EXPIRATION_TIME=1800000

# CORS Configuration
ENV CORS_ORIGIN=https://e2e-82-109.ssdcloudindia.net/

# Email configuration
ENV EMAIL_HOST=in-V3.mailjet.com
ENV EMAIL_PORT=587
ENV EMAIL_SECURE=false
ENV EMAIL_USER=187ad3288090609e6e282b07f359acd4
ENV EMAIL_FROM="fordendk@gmail.com"
ENV APP_NAME="Huduma AI"
ENV FRONTEND_URL=https://e2e-82-109.ssdcloudindia.net/

# Database connection setup
ENV ARANGO_URL=http://arango-vector-db:8529
ENV ARANGO_DB=node-services
ENV ARANGO_USER=root

# Database backups
ENV BACKUP_DIR=./database_backups
ENV MAX_BACKUPS=5
ENV BACKUP_FORMAT=json

# Logger config
ENV LOG_LEVEL=debug

# Start the backend service
CMD ["node", "index.js"]
