FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

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
