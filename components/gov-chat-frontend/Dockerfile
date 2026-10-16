FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

COPY . .
# The image-baked theme fallback is generated from the canonical token file at
# build time (single source of truth; no committed duplicate). The /config bind
# mount shadows /app/dist/config at runtime, so the copy must live at the dist
# root, outside the mount point.
RUN npm run build && cp dist/config/theme-variables.css dist/theme-fallback.css

FROM nginx:alpine

WORKDIR /app

COPY --from=build /app/dist /app/dist
RUN chmod -R a+r /app/dist

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY nginx-revalidate-headers.inc /etc/nginx/nginx-revalidate-headers.inc
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8090

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["sh", "-c", "envsubst '$NGINX_PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
