FROM node:22.14.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        make \
        build-essential \
        docker.io \
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
ENV UPLOAD_DIR=./Uploads
ENV MAX_FILE_SIZE=5242880
ENV SESSION_EXPIRATION_TIME=1800000

CMD ["node", "index.js"]
