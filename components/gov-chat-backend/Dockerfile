FROM node:22.14.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        make \
        build-essential \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY gov-chat-backend/package*.json ./
COPY shared/lib ./shared-lib
RUN ls -l /app/shared-lib && \
    test -f /app/shared-lib/security-headers.js && echo "security-headers.js found" || echo "security-headers.js missing" && \
    test -f /app/shared-lib/security-middleware.js && echo "security-middleware.js found" || echo "security-middleware.js missing"

RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --verbose --fetch-timeout 600000 || \
    npm install --prefer-offline || \
    npm ci
RUN rm -rf /app/node_modules/shared-lib

COPY gov-chat-backend/ ./
RUN ls -l /app && \
    ls -l /app/shared-lib && \
    mkdir -p /app/Uploads

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production
ENV API_PREFIX=/api
ENV UPLOAD_DIR=./Uploads
ENV MAX_FILE_SIZE=5242880
ENV SESSION_EXPIRATION_TIME=1800000
ENV CORS_ORIGIN=https://e2e-82-109.ssdcloudindia.net/
ENV EMAIL_HOST=in-V3.mailjet.com
ENV EMAIL_PORT=587
ENV EMAIL_SECURE=false
ENV EMAIL_USER=187ad3288090609e6e282b07f359acd4
ENV EMAIL_FROM="fordendk@gmail.com"
ENV APP_NAME="Huduma AI"
ENV FRONTEND_URL="https://e2e-82-109.ssdcloudindia.net"
ENV ARANGO_URL=http://arango-vector-db:8529
ENV ARANGO_DB=node-services
ENV ARANGO_USER=root
ENV ARANGO_PASSWORD=test
ENV BACKUP_DIR=./database_backups
ENV MAX_BACKUPS=5
ENV BACKUP_FORMAT=json
ENV LOG_LEVEL=debug
ENV OPEA_HOST=e2e-109-198
ENV OPEA_PORT=8888

CMD ["node", "index.js"]
