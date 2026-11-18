FROM postgres:16

COPY init-databases.sh /init-databases.sh
RUN chmod +x /init-databases.sh

# Security-patch the base: pull current Debian security updates so the shipped
# image does not lag distro point-releases between upstream rebuilds.
#
# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes.
#
# It is the LAST RUN of the runtime stage on purpose: a layer's cache key
# includes its parent, so an upgrade layer with an expensive layer above it
# would re-run that layer on every monthly rebuild.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apt-get update -y -o Acquire::Retries=5 && \
    apt-get upgrade -y --with-new-pkgs --fix-missing -o Acquire::Retries=5 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
