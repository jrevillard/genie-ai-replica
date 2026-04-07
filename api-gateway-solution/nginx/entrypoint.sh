#!/bin/sh
set -e
echo "Injecting variables into default.conf..."
# Read the template and substitute ONLY VUE_APP_CSP_CONNECT_SRC and CORS_ALLOWED_ORIGINS
envsubst '${VUE_APP_CSP_CONNECT_SRC} ${CORS_ALLOWED_ORIGINS}' < /etc/nginx/conf.template/default.conf.template > /etc/nginx/conf.d/default.conf
echo "Substitution complete."
exec "$@"
