FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

COPY . .
# The image-baked theme fallback is generated from the canonical token file at
# build time (single source of truth; no committed duplicate). The /config bind
# mount shadows /app/dist/config at runtime, so the copy must live at the dist
# root, outside the mount point.
#
# The build marker (#1851): the e2e pre-flight reads /build-info.json to know
# WHICH BUILD a venue serves — a stale venue fails specs for product-reasons
# that read like test defects, and a run that names the served build cannot
# file that misleading issue. CI passes GIT_SHA (the full commit sha); a
# build that skips it carries "unknown" and the pre-flight says so. The
# marker lives at the dist ROOT too: the /config bind mount would shadow it
# there, and nginx's `location /` serves a real dist file as-is.
ARG GIT_SHA=unknown
RUN npm run build \
    && printf '{"git_sha":"%s"}\n' "${GIT_SHA}" > dist/build-info.json \
    && cp dist/config/theme-variables.css dist/theme-fallback.css

# Pinned tag, not nginx:alpine: the Dockerfile chowns /app/dist/runtime to
# the NUMERIC uid 101, so a floating tag whose nginx uid could shift would
# freeze wrong ownership into the image. Same tag the edge nginx uses.
FROM nginx:1.28-alpine

# Pull current Alpine security updates at build time (CVE remediation
# playbook): the rolling base tag does not refresh on its own between
# upstream rebuilds.
#
# The unpin is mandatory, not cosmetic: the official image pins
# nginx=1.28.3-r1 in /etc/apk/world, and `apk upgrade` refuses to move a
# pinned package — so the Alpine security rebuilds never landed and the
# frontend kept shipping CVE-2026-9256 (fixed in r2), CVE-2026-49975 (r3),
# CVE-2026-42055 (r4), CVE-2026-42533 and CVE-2026-60005 (r6). Alpine v3.23
# publishes 1.28.3-r7; dropping the pin lets apk move the whole nginx set in
# one transaction (same upstream 1.28.3 — the r-series are security
# rebuilds, ABI stable). `apk info -v nginx` prints the EXACT package version
# (with the Alpine -r revision) into the build log: the build itself is the
# proof that the image left r1.
RUN sed -i 's/^nginx=.*/nginx/' /etc/apk/world \
    && apk upgrade --no-cache \
    && apk info -v nginx

WORKDIR /app

COPY --from=build /app/dist /app/dist
RUN chmod -R a+r /app/dist

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY nginx-revalidate-headers.inc /etc/nginx/nginx-revalidate-headers.inc
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Non-root runtime (#1227): the entrypoint writes the runtime config into
# /app/dist/runtime and the CMD renders nginx.conf into /tmp (the stock
# /etc/nginx location is root-owned) — hand the runtime dir to the nginx
# user (101); the nginx temp paths live under /tmp, which the runtime
# creates itself.
RUN mkdir -p /app/dist/runtime \
    && chown -R 101:101 /app/dist/runtime

# In-container port is unprivileged (8090); nothing below 1024 is needed.
EXPOSE 8090

USER 101

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["sh", "-c", "envsubst '$NGINX_PORT' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf && exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]
