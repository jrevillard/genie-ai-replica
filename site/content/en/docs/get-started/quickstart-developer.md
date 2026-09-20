---
title: "Quickstart: Developer — ship a backend change in 30 minutes"
weight: 4
description: "Run the backend stack with Docker Compose, edit code on the host, rebuild one image, see the change live through NGINX, and run the Jest suite."
mode: tutorial
persona: developer
owner: docs-stewards
last_reviewed: 2026-09-19
---

## Goal

In **30 minutes** you will have the GENIE.AI backend stack running in Docker
Compose, added one new GET route to the backend, registered it, written a Jest
test for it, rebuilt only the `backend` image, hit the route through NGINX to
confirm it works, and run the full Jest suite green inside the running
container. No GPU services, no OPEA stack required.

## Prerequisites

| What | Why | Verify |
|---|---|---|
| Docker Engine 23+ with Compose v2 | Container runtime + compose file format | `docker --version` (≥ 23) and `docker compose version` (v2.x) |
| 8 GB RAM free on the host | ArangoDB + Redis + Keycloak + PostgreSQL + Kong + NGINX + backend + frontend + document-repository | `free -h` |
| Git | Clone the repo | `git --version` |
| A POSIX shell | `bash`, `zsh`, or `fish` (examples use `bash`) | `echo $SHELL` |
| A code editor with JS/Vue support | Backend is Node.js 22 / Express | VS Code, IntelliJ, Neovim, … |

> {{< callout type="info" >}}
> You **do not** install Node.js locally. The dev loop runs the backend inside
> its own container (`node:22`), so the Node version, native deps, and
> ArangoDB client headers match CI exactly. Skip `npm install` on the host.
> {{< /callout >}}

## Architecture: where the backend fits

The backend (`components/gov-chat-backend`) is the BFF (Backend-for-Frontend)
sitting between NGINX/Kong (the only host-exposed entry points) and every
other service. In dev mode Compose brings up the whole stack on a single
overlay network; only NGINX publishes ports 80/443 to the host.

```text
                  ┌──────────────────────────────────────────────┐
   Browser ─────► │ nginx  (host: 80, 443)                       │
                  │   └─► kong  (8000)  ─► routes by path prefix │
                  └──────────────────────────────────────────────┘
                                          │
              ┌───────────────────────────┼─────────────────────────────────┐
              ▼                           ▼                                 ▼
   ┌────────────────────┐    ┌────────────────────────┐    ┌────────────────────────┐
   │ backend  (3000)    │    │ frontend (5173)        │    │ document-repository    │
   │ Node.js / Express  │    │ Vue 3 SPA, served      │    │ (3001) — file uploads  │
   │ THE THING YOU EDIT │    │ as static assets       │    └────────────────────────┘
   └────────────────────┘    └────────────────────────┘
              │
   ┌──────────┴───────────┐   ┌─────────────────────┐   ┌─────────────────────┐
   ▼                      ▼   ▼                     ▼   ▼                     ▼
arango-vector-db (8529)  redis-cache (6379)   keycloak (8080)         clamav (3310)
  Graph + vectors          Cache             OIDC issuer             AV scanner
```

`docker-compose.yaml` declares the full topology. The backend's `depends_on:`
block pins its required state — `arango-vector-db` and `redis-cache` must be
healthy, and `keycloak-config` plus `db-migrations` (one-shots) must have
exited 0. Compose enforces all of this when you ask for any service.

## Step 1 — Clone and seed `.env`

```bash
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai

cp env .env
$EDITOR .env      # set at minimum:
                  #   ARANGO_PASSWORD, POSTGRES_PASSWORD,
                  #   KONG_DB_PASSWORD, KEYCLOAK_DB_PASSWORD,
                  #   KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_CLIENT_SECRET,
                  #   KC_DATAPREP_CLIENT_SECRET
```

**Never commit `.env`** — it is gitignored, contains secrets, and passwords
with characters like `+` or `)` break `source .env`. Extract individual values
with `grep ^KEY .env | cut -d= -f2-` instead.

## Step 2 — Start the dependency stack (no GPU)

Bring up only what backend development needs. The list below is the minimum
**transitive set**; `depends_on:` chains in `docker-compose.yaml` would pull
most of it automatically, but writing it out makes the order explicit:

```bash
docker compose up -d \
  postgres kong-migrations kong kong-config \
  keycloak keycloak-config postgres-init \
  arango-vector-db db-migrations \
  redis-cache clamav \
  backend frontend document-repository \
  nginx
```

What you are **not** starting: the `opea` / `gpu-models` profiles (`vllm`,
`tei`, `embedding`, `reranker`, `dataprep-arango-service`,
`retriever-arango-service`, `chatqna-xeon-backend-server`, `translation`,
`guardrail`, …). Those need a GPU and are not on the backend dev path.

## Step 3 — Verify dependencies are healthy

```bash
docker compose ps
```

Each row tells a story. Healthy lines you should see:

| Service | Expected state | Why it matters |
|---|---|---|
| `postgres` | `running (healthy)` | Kong's DB |
| `kong-migrations` | `exited (0)` | One-shot, prepares Kong schema |
| `kong-config` | `exited (0)` | One-shot, applies declarative config |
| `kong` | `running (healthy)` | API gateway |
| `keycloak` | `running (healthy)` | OIDC issuer |
| `keycloak-config` | `exited (0)` | One-shot, imports the `genie` realm |
| `postgres-init` | `exited (0)` | One-shot, creates Keycloak/Kong DBs |
| `arango-vector-db` | `running (healthy)` | Graph + vector store |
| `db-migrations` | `exited (0)` | One-shot, creates Arango collections |
| `redis-cache` | `running (healthy)` | Backend cache |
| `clamav` | `running (healthy)` | Document-repository AV |
| `backend` | `running (healthy)` | **The thing you edit** |
| `frontend`, `document-repository`, `nginx` | `running (healthy)` | The rest of the UI path |

The backend healthcheck is `wget --spider http://localhost:3000/api/health`
(10 s interval, 5 retries, 90 s start period). It usually reaches `healthy`
within ~2 minutes. While you wait:

```bash
docker compose logs -f backend          # live tail
docker compose logs --tail=200 keycloak-config db-migrations   # one-shots
```

## Step 4 — Add a new GET route to `routes/`

Routes live in `components/gov-chat-backend/routes/<name>-routes.js` and
each exports an `express.Router()`. Create a new file or extend an existing
one. The smallest useful example — a **public** `whoami` route that returns
the caller's claims (unauthenticated for the dev loop; you'd gate it with
`keycloakAuthMiddleware` in real code):

```js
// components/gov-chat-backend/routes/dev-routes.js
'use strict';

const express = require('express');
const router = express.Router();

router.get('/api/dev/whoami', (req, res) => {
  res.status(200).json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    // proves your edit is live
    git_sha: 'dev',
  });
});

module.exports = router;
```

> {{< callout type="tip" >}}
> Use `@swagger` JSDoc above each handler — `swagger-jsdoc` picks it up and
> publishes it on `/api-docs`. See existing route files for the pattern.
> {{< /callout >}}

## Step 5 — Register the route in `index.js`

Routes are registered through a single config array near the top of
`components/gov-chat-backend/index.js`. **Add one entry** (don't scatter
`app.use()` calls):

```js
// ROUTE_CONFIGS — append a new entry for your route file
const ROUTE_CONFIGS = [
  // … existing entries …
  { file: 'dev-routes', paths: ['/api/dev'], serviceName: null },
  // … rest …
];
```

Two flags matter:

- `serviceName: null` — your route takes no service dependency. The loader
  does `app.use(path, router)` directly.
- `keycloakAuth: true` — add it when the route must reject anonymous calls.
  Internally this adds `keycloakAuthMiddleware.authenticate` in front of your
  router. Skip it for genuinely public endpoints (`/api/health`,
  `/api/dev/whoami` in this tutorial).

## Step 6 — Add a Jest test under `__tests__/routes/`

The backend uses the `createApp()` pattern: tests build an isolated Express
instance with `supertest`, no live backend needed. Existing test files
follow a stable recipe — mock the heavy modules once at the top, then write
focused `describe()` blocks.

```js
// components/gov-chat-backend/__tests__/routes/dev-routes.test.js
'use strict';

const request = require('supertest');
const { createApp } = require('../../index');

describe('GET /api/dev/whoami', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();
    app = createApp({ services: {} }).app;
  });

  it('returns server metadata', async () => {
    const res = await request(app).get('/api/dev/whoami');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      git_sha: 'dev',
    });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});
```

`createApp({ services: {} }).app` returns a ready-to-use Express instance
with all middleware mounted. The full list of service mocks you need
(side-effect imports of `index.js`) is in any existing test file —
`logger-routes.test.js` is the simplest template.

## Step 7 — Rebuild the backend image

The host source tree is **not** bind-mounted at runtime — it is copied in at
**build** time. Every code change therefore needs a rebuild:

```bash
docker compose build backend
```

Build context is `components/`; the Dockerfile is
`components/gov-chat-backend/Dockerfile`. First build is slow (~1 min);
subsequent builds are incremental thanks to BuildKit layer cache. To force a
cold rebuild (e.g. after `package.json` changes):

```bash
docker compose build backend --no-cache
```

## Step 8 — Recreate the backend container

```bash
docker compose up -d backend
```

Compose tears down the old container, starts a fresh one from the new image,
and waits for the healthcheck. Watch it come up:

```bash
docker compose ps backend                  # should be "running (healthy)" within ~30s
docker compose logs -f --tail=100 backend  # exit with Ctrl-C
```

## Step 9 — Curl your new route through NGINX

The backend container has no host port — every request goes through NGINX →
Kong → backend on the overlay network. Because `/api/dev/whoami` is
unauthenticated:

```bash
curl -sk https://localhost/api/dev/whoami | jq .
# {
#   "status": "ok",
#   "serverTime": "2026-09-19T10:23:45.123Z",
#   "uptimeSeconds": 17,
#   "nodeVersion": "v22.x.x",
#   "git_sha": "dev"
# }
```

For a route that is `keycloakAuth: true`, mint a realm token first (see
[Contribute → Dev workflow](/docs/contribute/dev-workflow/) or the Server
Testing playbook in `.claude/rules/SERVER-TESTING.md`), then:

```bash
curl -sk https://localhost/api/me -H "Authorization: Bearer $GENIE_TOKEN"
```

If you do not see your edit, the most likely cause is that you skipped Step 7
— go back and `docker compose build backend && docker compose up -d backend`.

## Step 10 — Run tests inside the running container

The dev image bakes in `node_modules`, Jest, ESLint, and Prettier, so you do
not need to install anything. Exec into the running container:

```bash
docker compose exec backend npm test
```

Targeted runs:

```bash
docker compose exec backend npm run test:contract    # route-handler tests only
docker compose exec backend npm run test:coverage    # with coverage
docker compose exec backend npx jest __tests__/routes/dev-routes.test.js   # one file
```

A green run ends with `Test Suites: N passed, N total` and `Snapshots: 0`
(unless you changed a snapshot).

> {{< callout type="warning" >}}
> `MODULE_NOT_FOUND` inside the container means the image is older than the
> host's `package.json`/`package-lock.json`. **Always rebuild** before
> re-running tests: `docker compose build backend && docker compose up -d
> backend`.
> {{< /callout >}}

## What's next

- **Where to put a new route** — [Backend → API contracts](/docs/backend/api-contracts-backend/).
- **Branching, commits, and the test pyramid** — [Contribute → Dev workflow](/docs/contribute/dev-workflow/).
- **Open a merge request** — [Contribute → How to open a MR](/docs/contribute/how-to-mr/).
- **OTel spans in your route** — [Observe → Tracing](/docs/observe/tracing/).
- **Trace failures end-to-end** — [Observe → Dashboards](/docs/observe/dashboards/).
- **Service topology in detail** — [Architecture → Overview](/docs/architecture/architecture/).
- **Full bring-up including TLS and secrets** — [Quickstart: Deployer](/docs/get-started/quickstart-deployer/).

## Tips

- **Live-reload logs** — `docker compose logs -f --tail=200 backend` shows
  stdout/stderr as it flows. Add `--no-log-prefix` to drop the `[service]`
  prefix when grepping.
- **Shell into the running container** — `docker compose exec backend sh`
  gives you a debug shell with `node`, `npm`, `jest`, and the full source
  tree mounted read-only at `/app`. Use `node -e "require('./routes/dev-routes')"`
  to verify a route file parses.
- **Attach the Node debugger** — set `NODE_OPTIONS=--inspect=0.0.0.0:9229`
  via override, restart the container, then attach VS Code's "Attach to
  Node Process" to `localhost:9229`. (Requires `9229:9229` in
  `docker-compose.override.yaml`.)
- **Reset one service** — `docker compose restart backend` reuses the current
  image; `docker compose up -d --force-recreate backend` rebuilds the
  container without rebuilding the image.
- **Skip the rest of the stack** — bring up only the deps you need:
  `docker compose up -d backend` pulls `arango-vector-db`, `redis-cache`,
  `clamav`, `keycloak-config`, `db-migrations` automatically through
  `depends_on:`.
- **Skip the wait** — most one-shots run in 10–30 s. `keycloak-config` can
  take ~2 min the first time it imports the realm.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose build backend` re-downloads every layer | BuildKit cache evicted (after `docker system prune`, low disk) | Run once to warm the cache; subsequent builds are incremental. Pin the cache with `BUILDKIT_CACHE_DIR` or use the [Ansible registry cache](/docs/deploy/install-guide/). |
| `docker compose up -d backend` shows `Up` but never reaches `healthy` | Old container still holding the network alias, or stale image | `docker compose down backend && docker compose up -d backend`. If still stuck, `docker image rm <backend-image-sha> && docker compose build backend`. |
| Edit does not appear at the endpoint | Skipped the rebuild — host source is **build-time** copy, not bind-mount | Re-run Steps 7–8 (`docker compose build backend && docker compose up -d backend`). |
| `npm test` crashes with `MODULE_NOT_FOUND` | Image built before a `package.json` change landed on the host | Rebuild: `docker compose build backend && docker compose up -d backend`, then re-run the test. |
| NGINX returns 502 / 503 | A dependency is not healthy (most often `keycloak-config` or `db-migrations` still running) | `docker compose ps` and wait for the one-shots to reach `exited (0)` and the rest to be `(healthy)`. |
| `curl https://localhost/api/dev/whoami` returns 404 | Route not registered in `ROUTE_CONFIGS`, or path mismatch, or container was not rebuilt | Verify `index.js` has the new `ROUTE_CONFIGS` entry, the path matches, and you ran Steps 7–8. `docker compose logs backend \| grep "Mounting dev-routes"`. |
| Port 80 / 443 already in use on the host | Another web server or leftover container | `sudo lsof -iTCP:80 -sTCP:LISTEN` to find the offender; stop it or remap `NGINX_HTTP_PORT`/`NGINX_HTTPS_PORT` in `.env`. |
| Host edit picked up by the **wrong** service | You edited `components/shared/` (used by multiple images) and only rebuilt one | `grep -R "<file>" components/*/Dockerfile* genie-ai-overlay/*/Dockerfile*` to find dependents, rebuild each. |
| `docker compose exec backend` returns `Error response from daemon: Container ... is not running` | Backend container crashed on boot | `docker compose logs backend` — most often a missing `.env` secret or a syntax error in `index.js`. |
| Jest run reaches the real ArangoDB and hangs | Accidentally ran `npm run setup-db` instead of `npm test`, or a test imports a setup script | The default Jest config does not load setup scripts — verify you used `npm test`. For tests against the real DB, see `tests/` (not `__tests__/`). |

## Related

- [Quickstart: Deployer](/docs/get-started/quickstart-deployer/) — full
  environment bring-up, including TLS, secrets, and the observability stack.
- [Quickstart: Contributor](/docs/get-started/quickstart-contributor/) — for
  docs/i18n/QA contributions that don't touch the backend.
- [Contribute → Dev workflow](/docs/contribute/dev-workflow/) — branching,
  commits, and the test pyramid.
- [Contribute → Repo layout](/docs/contribute/repo-layout/) — what lives
  where in `components/`.
- [Backend → API contracts](/docs/backend/api-contracts-backend/) — route
  conventions, error shapes, and Swagger tooling.
- [Architecture → Trust boundaries](/docs/architecture/trust-boundaries/) —
  what runs inside the Compose network vs. on the host.
- [Report a problem with these docs](/docs/contribute/how-to-mr/).