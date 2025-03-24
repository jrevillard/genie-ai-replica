# Use Node.js 22.14.0 as the base image
FROM node:22.14.0-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

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
ENV CORS_ORIGIN=http://localhost:8080

# Email configuration
ENV EMAIL_HOST=in-V3.mailjet.com
ENV EMAIL_PORT=587
ENV EMAIL_SECURE=false
ENV EMAIL_USER=187ad3288090609e6e282b07f359acd4
ENV EMAIL_PASSWORD=6615d81ddd46faab7e69eb6710ac364a
ENV EMAIL_FROM="fordendk@gmail.com"
ENV APP_NAME="Huduma AI"
ENV FRONTEND_URL=http://localhost:8090


# Start the backend service
CMD ["node", "index.js"]

