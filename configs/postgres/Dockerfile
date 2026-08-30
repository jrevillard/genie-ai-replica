FROM postgres:16

# Security-patch the base: pull current Debian security updates so the shipped
# image does not lag distro point-releases between upstream rebuilds.
RUN apt-get update && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/*

COPY init-databases.sh /init-databases.sh
RUN chmod +x /init-databases.sh
