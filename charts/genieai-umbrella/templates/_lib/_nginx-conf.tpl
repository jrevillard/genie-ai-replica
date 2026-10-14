{{- /*
Rendered once, consumed twice: the nginx-override ConfigMap mounts it as
default.conf.template, and the Deployment template carries its sha256 as
a pod annotation — the image renders the template at container start
only, so without the checksum annotation a ConfigMap update never
reloads nginx and the pod keeps serving the previous configuration.
*/ -}}
{{- define "genieai-umbrella.nginxConf" -}}
# Upstream Service names + ports. These are NOT templated against
# values.yaml — ConfigMaps are not rendered from values by Helm or
# Flux, so operators changing a Service port must update BOTH the
# Service spec (templates/services/<name>.yaml) AND this block, or
# nginx 502s silently when the upstream port no longer matches.
upstream genieai_frontend { server frontend:80; }
upstream genieai_backend  { server backend:80; }
upstream genieai_docrepo  { server document-repository:80; }
upstream genieai_keycloak { server keycloak-service:8080; }
server {
  listen 8080;
  # Exact-match /healthz beats the catch-all `location /` below, so
  # the readiness/liveness probe and helm-test pod validate nginx
  # itself rather than proxying through to the frontend index page.
  location = /healthz { return 200 'ok'; add_header Content-Type text/plain; }
  location /api/      { proxy_pass http://genieai_backend; }
  location /api-docs/ { proxy_pass http://genieai_backend; }
  # Document-repository API paths (Kong parity: files-route + labels-route,
  # strip_path=false). Longest-prefix wins over /api/, no path rewrite.
  location /api/files { proxy_pass http://genieai_docrepo; }
  location /api/labels { proxy_pass http://genieai_docrepo; }
  location /uploads/  { proxy_pass http://genieai_docrepo; }
  # Keycloak OIDC endpoints, same-origin with the SPA (the frontend's
  # oidcConfig falls back to ${origin}/auth). proxy_pass carries no
  # URI part, so the original /auth-prefixed path reaches Keycloak
  # as-is (its http-relative-path is /auth). Host/X-Forwarded-* are
  # required: without them Keycloak derives its issuer from the
  # upstream name (keycloak-service:8080) and every browser
  # redirect/token call misses.
  location /auth/ {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://genieai_keycloak;
  }
  location /          { proxy_pass http://genieai_frontend; }
}
{{- end -}}
