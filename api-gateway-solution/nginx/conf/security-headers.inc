# security-headers.conf
# Common Security Headers (included in each location block)
# Domain-specific headers (CSP, CORS) are defined per-location in default.conf.template

# Basic Security Headers
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;

# Strict Transport Security with preload
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

# Referrer Policy
add_header Referrer-Policy "no-referrer-when-downgrade" always;

# Permissions Policy — the value is set once, in the server block, and read
# from there. The server-level add_header is not inherited by a location that
# declares add_header directives of its own, so it has to be repeated here.
add_header Permissions-Policy $permissions_policy always;
