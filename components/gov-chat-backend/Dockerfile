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
    npm install --verbose --fetch-timeout 600000 || \
    npm install --prefer-offline || \
    npm ci
RUN rm -rf /app/node_modules/shared-lib

COPY gov-chat-backend/ ./
RUN mkdir -p /app/Uploads

FROM node:22

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

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "index.js"]

USER node
