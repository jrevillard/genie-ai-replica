FROM alpine:3.22
RUN apk add --no-cache curl jq
COPY restore-kong-config.sh kong_config.json /opt/kong-config/
WORKDIR /opt/kong-config
RUN chmod +x restore-kong-config.sh

# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes.
#
# It is the LAST RUN of the runtime stage on purpose: a layer's cache key
# includes its parent, so an upgrade layer with an expensive layer above it
# would re-run that layer on every monthly rebuild.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apk upgrade --no-cache

USER 1000
ENTRYPOINT ["sh", "restore-kong-config.sh"]
