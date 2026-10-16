# Headers shared by every runtime-config location (the ^~ /config/ prefix
# location, the = /runtime/config.js and = /theme-fallback.css exact matches,
# and the @theme_fallback named location). Included via
# `include /etc/nginx/nginx-revalidate-headers.inc;` so a header change
# lands everywhere at once.
add_header Cache-Control "no-cache, must-revalidate" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
