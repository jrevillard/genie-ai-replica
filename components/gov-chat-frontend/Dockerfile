# Frontend image — runtime-config shape ported from upstream GenieAI v2.0.1
# (components/gov-chat-frontend/Dockerfile): build once, configure at start.
# Auth/API endpoints are NO LONGER build args — docker-entrypoint.sh writes
# /app/dist/config.js (window.APP_CONFIG) from container env.
FROM node:22.14.0-alpine AS build

WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy the entire project
COPY . .

# Build the Vue app for production (no VUE_APP_* auth args — runtime config.js)
RUN npm run build

# Runtime: nginx serves the static bundle; entrypoint renders config.js
# and envsubst's ${NGINX_PORT} into nginx.conf
FROM nginx:alpine

WORKDIR /app

COPY --from=build /app/dist /app/dist
RUN chmod -R a+r /app/dist

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8090

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["sh", "-c", "envsubst '$NGINX_PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
