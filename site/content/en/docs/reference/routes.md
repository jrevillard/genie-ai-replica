---
title: "Public routes (Kong / Nginx / Envoy Gateway)"
weight: 4
description: "Path-prefix → backend service mapping, CORS, rate limits, and the public allowlist — for the Compose (Kong + Nginx) and Kubernetes (Envoy Gateway) edges."
mode: reference
persona: deployer
owner: docs-stewards
last_reviewed: 2026-11-17
---

## Purpose

The path-prefix → backend service mapping for every public route. Useful
when configuring an external proxy, a Cloudflare worker, or debugging a 404.

**Two edges ship.** Docker Compose and Docker Swarm front the stack with
**Nginx** (TLS termination) in front of **Kong** (API gateway). The Helm
chart fronts it with **Envoy Gateway** (Gateway API) — there is no Kong
and no Nginx in the Kubernetes data path. Pick the section that matches
the deployment.

## Docker Compose / Swarm — Nginx (TLS termination)

| Path | Upstream | Notes |
|---|---|---|
| `/` | frontend (Vue SPA) | Static; SPA fallback to `/index.html` |
| `/api/*` | kong (port 8000) | All API calls |
| `/grafana/*` | kong (port 8000) | Kong routes to grafana |
| `/auth/*` | kong (port 8000) | Kong routes to keycloak |
| `/assets/*` | frontend | Static assets |
| `/robots.txt` | nginx | Static, served by Nginx |

## Docker Compose / Swarm — Kong (API gateway)

| Path-prefix | Service | Auth | Rate limit |
|---|---|---|---|
| `/api/*` (fallback) | express-api | JWT (per-route) | service-wide 1000 / min on express-api |
| `/api/auth/*` | express-api | none (refresh-token cookie) | service-wide |
| `/api/auth/refresh-token` | express-api | none (cookie) | service-wide |
| `/api/auth/login` | express-api | none | service-wide |
| `/api/me` | express-api | JWT | service-wide |
| `/api/queries` | express-api | JWT | service-wide |
| `/api/chat/*` | express-api | JWT | service-wide |
| `/api/admin/*` | express-api | JWT + role `admin` | service-wide |
| `/Uploads/*` | backend (`express.static`) | public | none |

Per-route rate limits are NOT configured in Kong — the 1000/min limit is
applied service-wide to `express-api`. `/api/health` and `/api/public/*`
have no dedicated Kong routes; they are reached via the `/api` fallback
(`api-fallback` route, `strip_path: false`).

## Kubernetes — Envoy Gateway (HTTPRoute)

The chart renders one `HTTPRoute` (Gateway API). Gateway API resolves
rules **by rule-list order, first match wins — not longest-prefix** — so
the more specific paths come first:

| Match | Upstream Service | Notes |
|---|---|---|
| `PathPrefix /api/files` | document-repository | Upload + file API |
| `PathPrefix /api/labels` | document-repository | Label API |
| `PathPrefix /api/` | backend | All other API calls |
| `Exact /api` | backend | The bare form — `PathPrefix /api/` does not match it |
| `Exact /api-docs` | backend | Swagger UI |
| `PathPrefix /api-docs/` | backend | Swagger sub-paths |
| `Exact /api-docs.json` | backend | The OpenAPI document |
| `PathPrefix <keycloak context path>/` | keycloak | The context path is configurable (`data.keycloak.httpRelativePath`) |
| `Exact <keycloak context path>` | keycloak | The bare form |
| `PathPrefix /grafana` | genieai-grafana-service | Only when the Grafana tier is enabled |
| `PathPrefix /` | frontend | SPA catch-all — everything unmatched lands here |

> `PathPrefix` matches on **path elements**, not on raw string prefixes.
> `/api-docs.json` matches neither `/api-docs` nor `/api-docs/`, which is
> why the OpenAPI document needs its own `Exact` rule — without it the
> request falls through to the SPA catch-all and returns the SPA's
> `index.html` instead of JSON.

## Sensitive paths (blocked)

**Compose / Swarm only.** The Nginx config blocks the following prefixes
with `404 Not Found`:

```
~ /\.(?!well-known)        # any dotfile except .well-known
~ /(BitKeeper|\.git|\.svn|\.hg|CVS)   # version control dirs
```

Other paths (`/node_modules`, `/.npmrc`, `/.docker`, `/.dockerignore`,
`/.vscode`, `/.idea`, `/Dockerfile`, `/docker-compose.yaml`, `/secrets/`,
`/adminer`, `/phpmyadmin`, `/.gitignore`, `/.env`) are NOT explicitly
blocked by Nginx. Defense-in-depth at the backend layer (Helmet + CSP)
provides additional protection.

**The Kubernetes edge has no equivalent rule.** The chart's `HTTPRoute`
carries no dotfile or version-control blocking — an unmatched path
(including `/.git`, `/.env`) falls through to the SPA catch-all. The
frontend image ships no such files, so the SPA answers 404 for them
rather than serving content, but the block is not made at the edge. On a
cluster that must not answer dotfile paths at all, add a `HTTPRoute`
rule (or a `RequestHeaderModifier`/`SecurityPolicy`) ahead of the
catch-all.

## CORS

Configured **in the backend** (not Kong, not Nginx, not Envoy). The
allowlist comes from `CORS_ALLOWED_ORIGINS` (comma-separated). Kong does
not add CORS headers; the backend sets them via the `cors` middleware.

On Kubernetes the chart can additionally render a Gateway API
`SecurityPolicy` for CORS (`ingress.cors.allowOrigins`); empty = the
policy is not rendered and the edge adds no CORS headers.

## Rate limit

| Surface | Limit |
|---|---|
| Per consumer (JWT sub) on `express-api` — **Compose / Swarm only** | **1000 / minute** (service-wide, policy=local, limit_by=consumer) |
| Per IP (Nginx) | _not configured_ |
| **Kubernetes** | **no rate limiting is configured** — the chart renders no rate-limit policy on the `HTTPRoute`, and there is no Kong. A client that expects a 429 after 1000 requests will never see one |

## OTel forwarding

Kong has an OTel plugin enabled by the restore script (`kong-restore.sh`).
It emits request spans with attributes:

| Attribute | Source |
|---|---|
| `kong.route` | Kong route name |
| `kong.service` | Kong service name |
| `http.method` / `http.target` | Nginx-equivalent |
| `http.status_code` | response status |

The Kong tracing sampling rate is `KONG_TRACING_SAMPLING_RATE` (default
`1.0`). When set below `1.0`, Kong uses probabilistic sampling
consistent with `OTEL_TRACES_SAMPLER_RATE` in app services.

On Kubernetes there is no Kong: the edge is Envoy Gateway, and the
request spans come from the Envoy Gateway controller's own tracing
configuration.

## Related

- [Reference → Environment variables](/docs/reference/env-vars/) — `CORS_ALLOWED_ORIGINS` etc.
- [Configure → CORS / CSP](/docs/configure/cors-csp/)
- [Operations → Security hardening](/docs/operate/security-hardening/)
- [Deployment → Kubernetes Deployment](/docs/deploy/kubernetes/) — the edge topologies and their knobs
