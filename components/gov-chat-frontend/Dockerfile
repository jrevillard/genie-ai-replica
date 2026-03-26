FROM node:22.14.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22.14.0-alpine

WORKDIR /app

RUN npm install -g http-server

COPY --from=build /app/dist /app/dist

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8090

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["sh", "-c", "http-server /app/dist -p ${PORT:-8090} ${HTTP_SERVER_EXTRA_ARGS:-}"]
