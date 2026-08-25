FROM nginx:1.28-alpine

RUN apk add --no-cache openssl=3.3.7-r0 gettext=0.22.5-r0

# Copy nginx configuration
COPY conf/default.conf.template /etc/nginx/conf.d/default.conf.template
COPY conf/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY conf/apple-app-site-association /etc/nginx/conf.d/apple-app-site-association
COPY conf/assetlinks.json /etc/nginx/conf.d/assetlinks.json

# Copy ModSecurity configs
COPY modsec/ /etc/nginx/modsec/
COPY modsec-rules/ /etc/nginx/modsec-rules/

# Copy entrypoint script
COPY entrypoint.sh /scripts/entrypoint.sh
RUN chmod +x /scripts/entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/scripts/entrypoint.sh"]
