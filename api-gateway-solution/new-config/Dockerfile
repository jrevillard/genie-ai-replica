FROM alpine:3.21
RUN apk add --no-cache curl jq
COPY restore-kong-config.sh kong_config.json /opt/kong-config/
WORKDIR /opt/kong-config
RUN chmod +x restore-kong-config.sh
USER 1000
ENTRYPOINT ["sh", "restore-kong-config.sh"]
