FROM alpine:3.22
RUN apk add --no-cache curl=8.14.1-r3 jq=1.8.1-r0
COPY restore-kong-config.sh kong_config.json /opt/kong-config/
WORKDIR /opt/kong-config
RUN chmod +x restore-kong-config.sh
USER 1000
ENTRYPOINT ["sh", "restore-kong-config.sh"]
