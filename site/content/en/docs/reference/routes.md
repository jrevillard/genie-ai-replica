---
title: "Kong / Nginx routes"
weight: 4
description: "Path-prefix → backend service mapping, CORS, rate limits, and the public allowlist."
mode: reference
persona: deployer
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Purpose

The path-prefix → backend service mapping for every public route. Useful
when configuring an external proxy, a Cloudflare worker, or debugging a 404.

## Nginx (TLS termination)

| Path | Upstream | Notes |
|---|---|---|
| `/` | frontend (Vue SPA) | Static; SPA fallback to `/index.html` |
| `/api/*` | kong (port 8000) | All API calls |
| `/grafana/*` | kong (port 8000) | Kong routes to grafana |
| `/auth/*` | kong (port 8000) | Kong routes to keycloak |
| `/assets/*` | frontend | Static assets |
| `/robots.txt` | nginx | Static, served by Nginx |

## Kong (API gateway)

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

## Sensitive paths (blocked)

The Nginx config blocks the following prefixes with `404 Not Found`:

```
~ /\.(?!well-known)        # any dotfile except .well-known
~ /(BitKeeper|\.git|\.svn|\.hg|CVS)   # version control dirs
```

Other paths (`/node_modules`, `/.npmrc`, `/.docker`, `/.dockerignore`,
`/.vscode`, `/.idea`, `/Dockerfile`, `/docker-compose.yaml`, `/secrets/`,
`/adminer`, `/phpmyadmin`, `/.gitignore`, `/.env`) are NOT explicitly
blocked by Nginx. Defense-in-depth at the backend layer (Helmet + CSP)
provides additional protection.

## CORS

Configured **in the backend** (not Kong, not Nginx). The allowlist comes
from `CORS_ALLOWED_ORIGINS` (comma-separated). Kong does not add CORS
headers; the backend sets them via the `cors` middleware.

## Rate limit

| Surface | Limit |
|---|---|
| Per consumer (JWT sub) on `express-api` | **1000 / minute** (service-wide, policy=local, limit_by=consumer) |
| Per IP (Nginx) | _not configured_ |

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

## Related

- [Reference → Environment variables](/docs/reference/env-vars/) — `CORS_ALLOWED_ORIGINS` etc.
- [Configure → CORS / CSP](/docs/configure/cors-csp/)
- [Operate → Security hardening](/docs/operate/security-hardening/)