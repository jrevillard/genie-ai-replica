# The base tag is the fix, and the reason is the PIN, not the tag itself.
# The official nginx image pins nginx=<exact version> in /etc/apk/world, and
# `apk upgrade` refuses to move a pinned package. On the 1.28 line that pin
# went stale upstream (nginx=1.28.3-r1 while Alpine published 1.28.3-r7), so
# this image kept shipping CVE-2026-9256, CVE-2026-49975, CVE-2026-42055,
# CVE-2026-42533 and CVE-2026-60005 — and no `apk upgrade` could ever move it
# (measured: the world file read out of the published 1.28-alpine layer).
# The 1.30 line IS maintained upstream: the image ships Alpine v3.24's
# current 1.30.6-r1, which carries all five fixes (1.30.1-r0 .. 1.30.4-r0).
FROM nginx:1.30-alpine

# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes.
#
# It comes FIRST in the runtime stage, and that is deliberate: the layers
# below it rewrite paths the nginx PACKAGE owns (/etc/nginx/nginx.conf, the
# removal of /etc/nginx/conf.d/default.conf). A package that moves would
# restore its own files over ours, so our writes have to come AFTER the
# upgrade. Everything below is cheap (a package add, COPYs, a chown), so
# busting this layer monthly costs nothing.
#
# Pull current Alpine security updates at build time (CVE remediation
# playbook): the rolling base tag does not refresh on its own between
# upstream rebuilds.
#
# The nginx package itself is pinned by the upstream image (reproducibility:
# the tag must not change behaviour under an `apk upgrade`), and on the
# maintained 1.30 line that pin is the current one — upstream bumps it and
# `--pull` picks it up. So this layer refreshes everything the pin does not
# cover, and leaves nginx alone on purpose.
#
# `apk info -v nginx` prints the EXACT package version (with the Alpine -r
# revision) into the build log: the build itself is the proof of what ships.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apk upgrade --no-cache \
    && apk info -v nginx

RUN apk add --no-cache openssl gettext

# Non-root runtime (#1227): the stock main config assumes a root master (pid
# and log paths under /var, temp dirs under /var/lib/nginx). Replace it with
# the rootless-safe one, and hand the entrypoint's writable state (rendered
# config, certificates) to the nginx user (uid 101) the container runs as.
COPY nginx-rootless.conf /etc/nginx/nginx.conf
# The stock package ships a conf.d/default.conf (listen 80, stock welcome
# page). nginx-rootless.conf deliberately includes NO conf.d/* glob — the
# rendered server block is staged at /tmp/rendered-default.conf and the
# main config references it by absolute path — so the stock file is
# already unreachable; the rm below is belt-and-braces so a future conf.d
# include cannot resurrect a root-era :80 listener (and crash-loop on
# runtimes that keep the unprivileged-port floor). The certs directory is
# the one path the entrypoint writes that the image owns as root; the
# nginx temp paths live under /tmp, which the runtime creates itself.
RUN rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /etc/nginx/certs \
    && chown -R 101:101 /etc/nginx/certs

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
