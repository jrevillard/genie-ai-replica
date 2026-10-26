# Headers for the Keycloak surfaces: the login page, the account console,
# the admin console and the theme resources they load.
#
# X-Frame-Options is SAMEORIGIN rather than the DENY of
# security-headers.inc: SAMEORIGIN still refuses a cross-origin frame and
# allows a page of the same origin to frame the surface.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header Referrer-Policy "no-referrer-when-downgrade" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
