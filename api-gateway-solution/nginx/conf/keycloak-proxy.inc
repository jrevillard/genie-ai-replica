# Proxy settings for the Keycloak routes.
#
# The Kong address is an nginx variable set in the server block, so it is
# resolved at request time and nginx starts even when the Kong container is
# not up yet. The public HTTPS port is a variable for the same reason: the
# host may publish the container on another port than the one it listens on.
#
# Note: when proxy_pass uses a variable, nginx does NOT perform path
# prefix substitution — the full request URI is forwarded as-is.
proxy_pass http://$kong_addr;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $https_port;
proxy_connect_timeout 300s;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
