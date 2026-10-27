# Upstream response headers that nginx replaces with its own.
#
# nginx is the single authority for the security and CORS headers: the
# upstream's copies are stripped, and nginx sets them per location.
#
# The list lives in an include because a location that declares any
# proxy_hide_header of its own stops inheriting the server's list — a
# location that hides one header has to hide all of them, or the rest
# leak through next to nginx's own.
proxy_hide_header X-Powered-By;
proxy_hide_header Server;
proxy_hide_header X-Content-Type-Options;
proxy_hide_header X-Frame-Options;
proxy_hide_header X-XSS-Protection;
proxy_hide_header Strict-Transport-Security;
proxy_hide_header Referrer-Policy;
proxy_hide_header Content-Security-Policy;
proxy_hide_header Permissions-Policy;
proxy_hide_header Feature-Policy;
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Methods;
proxy_hide_header Access-Control-Allow-Headers;
proxy_hide_header Access-Control-Allow-Credentials;
proxy_hide_header Access-Control-Max-Age;
proxy_hide_header Access-Control-Expose-Headers;
proxy_hide_header X-Kong-Proxy-Latency;
