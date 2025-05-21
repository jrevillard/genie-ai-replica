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
COPY package*.json ./

# Use a robust NPM installation strategy
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --verbose --fetch-timeout 600000 || \
    npm install --prefer-offline || \
    npm ci

# Copy the entire backend project
COPY . .

# Expose the backend server port
EXPOSE 3000

# Setup the required environment
ENV JWT_SECRET="UJeFROw+yRJeVOPiUTgdcXzlE2eukTfATZPxBfPkptQLZs+ER+iuSA1BIXiJtw1sS181kiRqdncodVZOWD4sfA=="
ENV JWT_EXPIRES_IN=24h

# Server Configuration
ENV PORT=3000
ENV NODE_ENV=development
ENV API_PREFIX=/api

# File Upload Configuration
ENV UPLOAD_DIR=./uploads
ENV MAX_FILE_SIZE=5242880

# Session Configuration
ENV SESSION_SECRET=your_session_secret_here
ENV SESSION_EXPIRATION_TIME=1800000

# CORS Configuration
ENV CORS_ORIGIN=https://e2e-82-109.ssdcloudindia.net/

# Email configuration
ENV EMAIL_HOST=in-V3.mailjet.com
ENV EMAIL_PORT=587
ENV EMAIL_SECURE=false
ENV EMAIL_USER=187ad3288090609e6e282b07f359acd4
ENV EMAIL_PASSWORD=6615d81ddd46faab7e69eb6710ac364a
ENV EMAIL_FROM="fordendk@gmail.com"
ENV APP_NAME="Huduma AI"
ENV FRONTEND_URL=https://e2e-82-109.ssdcloudindia.net/

# Database connection setup
ENV ARANGO_URL=http://arango-vector-db:8529
ENV ARANGO_DB=node-services
ENV ARANGO_USER=root
ENV ARANGO_PASSWORD=test

# Database backups
ENV BACKUP_DIR=./database_backups
ENV MAX_BACKUPS=5
ENV BACKUP_FORMAT=json

# Logger config
ENV LOG_LEVEL=debug

# Start the backend service
CMD ["node", "index.js"]
