FROM nginx:1.28-alpine

RUN apk add --no-cache openssl gettext

# Non-root runtime (#1227): the stock main config assumes a root master (pid
# and log paths under /var, temp dirs under /var/lib/nginx). Replace it with
# the rootless-safe one, and hand the entrypoint's writable state (rendered
# config, certificates) to the nginx user (uid 101) the container runs as.
COPY nginx-rootless.conf /etc/nginx/nginx.conf
RUN mkdir -p /etc/nginx/certs /tmp/nginx_client_body /tmp/nginx_proxy /tmp/nginx_fastcgi /tmp/nginx_uwsgi /tmp/nginx_scgi \
    && chown -R 101:101 /etc/nginx/certs /tmp/nginx_*

# Copy nginx configuration
COPY conf/default.conf.template /etc/nginx/conf.d/default.conf.template
COPY conf/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY conf/hide-upstream-headers.inc /etc/nginx/conf.d/hide-upstream-headers.inc
COPY conf/kong-proxy.inc /etc/nginx/conf.d/kong-proxy.inc
COPY conf/apple-app-site-association /etc/nginx/conf.d/apple-app-site-association
COPY conf/assetlinks.json /etc/nginx/conf.d/assetlinks.json

# Copy ModSecurity configs
COPY modsec/ /etc/nginx/modsec/
COPY modsec-rules/ /etc/nginx/modsec-rules/

# Copy entrypoint script
COPY entrypoint.sh /scripts/entrypoint.sh
RUN chmod +x /scripts/entrypoint.sh

# In-container ports are unprivileged; 80/443 exist only at host publication.
EXPOSE 8080 8443

USER 101

ENTRYPOINT ["/scripts/entrypoint.sh"]
