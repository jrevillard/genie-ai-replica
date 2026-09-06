---
baseline_commit: b03fa3927
---

# Story 3.5: Webhook push ingestion

Status: review

## Story

As a source-system integrator,
I want to push content to `POST /v1/tools/webhook/{feed_name}` authenticated by API key or JWT Bearer,
so that push-based sources reach the corpus immediately instead of waiting for a poll — with per-feed flood protection and a per-deployment kill switch (FR27, D8, NFR9).

## Current State (verified on `feat/sst` 2026-09-05, post-3-4 `b03fa3927`)

- **The ingestor's aiohttp server serves only `/health` + `/ready`** (`genieai_stream_ingestor.py:381-388`, port 8080, `start_web_server()` takes no args). The webhook route belongs on this server (new `web.post`).
- **`ingest_entries(feed, entries)`** is the shared payload contract: entries as `{title, link, summary, _date?}` dicts → base64 text → `DATAPREP_INGEST_URL` with `sourceType: "feed"`, `feedId`, `expiresAt`. Webhook payloads map into the same entry shape.
- **Rate limiting**: `SlidingWindowRateLimiter` (`redis_primitives.py:157+`) — `limiter = SlidingWindowRateLimiter(redis_client, config)`; `await limiter.consume(scope, identifier) -> RateLimitResult` (`.allowed`, `.retry_after`). The stream-ingestor already has a redis client (`self.redis`, `redis.asyncio`).
- **Auth inputs available**: `KEYCLOAK_URL`/`KEYCLOAK_REALM` pattern (backend keycloak-auth-service verifies JWTs via the realm's JWKS/certs endpoint); API-key mode needs a shared secret env. Feed docs already persist arbitrary fields via the BFF `createFeed` spread (`...feedData` — no whitelist, verified by Edge review in 4-4).
- **The ingestor module has 11 tests** (`tests/test_stream_ingestor.py`, from 3-4) — the webhook route tests join that file.
- **`REDIS_STREAM_KEY = "feed-ingestion-events"`** — webhook publishes `event_type: "webhook_received"` here (same stream the poller uses).

## Acceptance Criteria

1. **Route**: `POST /v1/tools/webhook/{feed_name}` on the ingestor's aiohttp server. Looks up the feed by `_key` OR `title`? — **by `_key` only** (`feed_name` = the feed doc `_key`; documented in swagger). Unknown feed → **404**.
2. **Kill switch (deploy-level)**: env `WEBHOOK_INGESTION_ENABLED` (default `false` — push ingestion is OFF unless a deployment opts in, per FR27's Fatima journey). Disabled → **404** (do not reveal the feature exists). Any value other than `1/true/yes` = disabled (fail-closed, the 2-4 convention).
3. **Auth (both modes, env-selected)**:
   - `WEBHOOK_API_KEY` set → require `X-API-Key` header equal to it (constant-time compare via `hmac.compare_digest`); unset → API-key mode off.
   - `WEBHOOK_JWT_ENABLED=true` (+ `KEYCLOAK_URL`, `KEYCLOAK_REALM`) → require `Authorization: Bearer <jwt>`; verify via `GET {KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/certs` (JWKS, cached ~1h) — decode + validate signature/exp with `jwt.PyJWK` (python-jose NOT a dep; use `jwt` from PyJWT if present, else minimal `jose`-free JWKS check via `cryptography`... **DECISION: use PyJWT + cryptography, both commonly available; add `pyjwt` to stream_ingestor/requirements.txt** and verify token has `iss` = realm and is not expired. Realm/audience checks stay minimal — this is machine-to-machine push auth, not user auth).
   - Neither credential configured → all requests **401** (fail-closed).
   - Failure order: 401 before 404-before-429? NO — **404 first** (unknown feed reveals nothing), then 401, then 429.
4. **Flood protection**: per-feed sliding window via `SlidingWindowRateLimiter(self.redis, RateLimitConfig(window_seconds=60, max_requests=<env WEBHOOK_RATE_LIMIT_MAX default 10>))`; over-limit → **429 + `Retry-After` header** (seconds, from `rate_limit_result.retry_after`).
5. **Payload → ingest**: body `{title, content, link?, timestamp?}` (content required, else 400) → single-entry `ingest_entries(feed, [{title, summary: content, link, _date}])`; publishes `event_type: "webhook_received"` to `REDIS_STREAM_KEY` on success. Response: **202 Accepted** `{accepted: true}` (ingest is async-best-effort; 500 only if the dataprep POST itself errors).
6. **Tests** (`tests/test_stream_ingestor.py`, extend): aiohttp test client (`aiohttp.test_utils.TestClient`) against `build_web_app()` (extract the app builder from `start_web_server` so tests don't bind ports): 404 unknown feed; 404 when kill-switch off (even with valid auth); 401 no/invalid credentials (each mode); happy path 202 + `webhook_received` published + dataprep POSTed; 400 missing content; 429 over-limit with Retry-After header; auth-mode precedence when both configured.
7. Overlay suite green; ruff clean; requirements.txt updated if PyJWT added.

## Tasks / Subtasks

- [ ] Task 1 — Route + auth (AC: 1-3)
  - [ ] Extract `build_web_app(ingestor)` from `start_web_server()` (route registration moves; the bind stays); add the webhook route with a handler closure over the ingestor
  - [ ] Auth helper: `_authorize_webhook(request)` → `(ok: bool, reason: str)`; api-key mode checked first, then JWT mode; both-unset → deny
  - [ ] `pyjwt` (+ `cryptography`) into `stream_ingestor/requirements.txt` — CHECK first whether the overlay pyproject already declares them
- [ ] Task 2 — Flood protection + ingest + event (AC: 4, 5)
  - [ ] Lazily construct one `SlidingWindowRateLimiter` on the ingestor (reuse `self.redis`); scope = feed key, identifier = "webhook"
  - [ ] Map body → entry dict → `ingest_entries`; publish `webhook_received` after the dataprep POSTs (the poller publishes `poll_complete` — mirror its xadd shape + `event_type` field)
- [ ] Task 3 — Tests (AC: 6) via `aiohttp.test_utils.TestClient`
- [ ] Task 4 — Suite + ruff; trackers (sprint-status 3-5 → review, plan.md session log)

## Dev Notes

- **Kill-switch default OFF is a story decision** (FR27: "disableable per deployment"; Fatima disables it until ready). Deployment opt-in = `WEBHOOK_INGESTION_ENABLED=true` in compose/env — add the var to `env` SECTION 15 as a commented default-off line; env.j2/group_vars NOT required (deployment opts in explicitly), but add to env.j2 SECTION 22 for parity if trivial.
- **Auth is per-deployment config, not per-feed** — env-selected mode keeps the feed doc schema untouched (3-8's feeds collection stays as-is).
- The route handler must look up the feed via `ingestor.feeds_col` — feed lookup by `_key` (`feeds_col.get(key)`; 404 on error 1202/not-found).
- JWT validation: cache the JWKS (module-level dict with fetched-at); on unknown `kid` refetch once. Reject `alg: none`. Exp required. Keep it ~40 lines — this is push-auth for a single internal endpoint, not an IdP.
- RateLimitConfig import: **CHECKED — the import is UNSAFE.** `Dockerfile-stream-ingestor` copies ONLY `genieai_stream_ingestor.py` + `requirements.txt` into the image (no `workflows/`, no `redis_primitives.py`). Importing `workflows.tools.redis_primitives` would be the missing-module kill class. DECISION: reimplement the ~30-line sliding-window limiter locally (`_webhook_rate_limited` using the existing `self.redis` sorted-set ZADD/ZREMRANGEBYSCORE/ZCARD) with a comment referencing `redis_primitives.SlidingWindowRateLimiter` as the original. Same for JWT verification: `pyjwt[crypto]` into `stream_ingestor/requirements.txt` (self-contained, no workflows import).
- 202-vs-200: FR27 says accepted → publish event; 202 signals async acceptance (matches the best-effort ingest contract).
- The tests must not bind port 8080 — `TestClient` drives the app in-process.

### Testing standards

- Extend `tests/test_stream_ingestor.py`; aiohttp `TestClient(build_web_app(ingestor))`; mock `ingest_entries`, dataprep via the same boundary as 3-4's tests; redis AsyncMock (xadd/rate-limiter methods).

### References

- [Source: epics.md#Story-3.5] — route, auth, 429+Retry-After, event, disableable
- [Source: PRD FR27 (:124)] — the full FR text (API key OR JWT, 401/429, disableable)
- [Source: genieai_stream_ingestor.py:381-388] — the web server to extend; [Source: :296+] — ingest_entries contract
- [Source: redis_primitives.py:157+] — SlidingWindowRateLimiter.consume → RateLimitResult (.allowed/.retry_after)
- [Source: tests/test_stream_ingestor.py] — the test file to extend (make_ingestor/make_feed helpers)
- [Source: Decision 8 (D8)] — sliding-window flood protection

### Review Findings

_Code review 2026-09-05/06 — Blind Hunter complete (3 High / 8 Med / 6 Low); Edge Hunter partial (16 findings before rate-limit kill; survivors re-verified in-session); Acceptance Auditor layer replaced by an in-session AC walk (both subagent attempts 429-killed)._

- [x] [Review][Patch] **HIGH — JWT branch unreachable when WEBHOOK_API_KEY set** — hard else-if meant "both modes" was really "api-key only". FIXED: modes evaluated independently, either passes; a wrong API key falls through to the JWT branch instead of short-circuiting.
- [x] [Review][Patch] **HIGH — per-call JWKS fetch, "1h cache" never cached** — client was built inside `_verify_webhook_jwt` on every call. FIXED: module-level client + issuer, built once from the realm's OIDC discovery document (issuer + jwks_uri both from discovery — same convention as the backend's keycloak-auth-service; kills the public-vs-internal URL mismatch class, since only `KEYCLOAK_URL`-reachable-from-container matters).
- [x] [Review][Patch] **HIGH — sync JWKS fetch blocked the event loop** — PyJWKClient's urllib call is synchronous. FIXED: everything runs via `asyncio.to_thread`.
- [x] [Review][Patch] **HIGH — JWT accepted any valid realm token** — no audience check. FIXED: `audience=WEBHOOK_JWT_AUDIENCE or None` (deployer opts into enforcement; documented).
- [x] [Review][Patch] **HIGH — 404-before-auth was a feed-enumeration oracle** — story AC said "404 first"; review overturned it: anonymous callers could probe which feeds exist. FIXED: auth first, then feed lookup. Deviates from AC 3 deliberately (security wins over the written order).
- [x] [Review][Patch] **HIGH — DB outage during feed lookup returned 404** — senders would deconfigure on a transient Arango blip. FIXED: lookup exception → 503, only genuinely-missing/disabled/wrong-type feeds → 404 (test pins it).
- [x] [Review][Patch] **MED — `float(body["timestamp"])` on garbage → 500** — FIXED via the existing `_item_date` helper (epoch s/ms, ISO, unparseable → now), same semantics as the poller.
- [x] [Review][Patch] **MED — non-ASCII API key header → 500** — `compare_digest` on str with non-ASCII raises. FIXED: bytes-encode both sides with a UnicodeEncodeError guard (deny, never 500).
- [x] [Review][Patch] **MED — auth failure bodies leaked exception text** — FIXED: generic "Invalid token"/"Invalid credentials" (Keycloak URLs leak topology).
- [x] [Review][Patch] **MED — `int(WEBHOOK_RATE_LIMIT_MAX)` on garbage crashed the limiter** — FIXED: try/except → default 10.
- [x] [Review][Patch] **MED — `breaker_dlq_recorded` never reset on recovery** (3-9 carryover) — after one OPEN window the suppression DLQ entry could never be recorded again. FIXED: popped in `_mark_feed_success`.
- [x] [Review][Patch] **MED — `_replay_dlq` called undefined `self._auditRedis()`** (3-9 carryover, Edge find) — replay would always AttributeError → silently never ran. FIXED: uses `self.redis` (the ingestor's own client); stale test shim removed.
- [x] [Review][Patch] **MED — handler awaited a sync Arango call** — `await feeds_col.get(...)` on a plain MagicMock passed tests but awaits are no-ops on dicts; in production python-arango `get` is sync. FIXED: plain call, matching `_replay_single`.
- [x] [Review][Patch] **LOW — dead `_WEBHOOK_JWKS_CACHE` module global** — leftover from the pre-patch design; removed.
- [x] [Review][Patch] **LOW — rate-limit zadd/expire not atomic with the check** — accepted: single-process ingestor, off-by-one under concurrent pushes is harmless for flood protection (documented in-code).
- [x] [Review][Dismiss] In-memory window lost on restart — same accepted posture as 3-5's limiter choice; Redis sorted-set IS the window (persistent).
- [x] [Review][Dismiss] `ingest_entries` failure → aiohttp default 500 — matches AC 5's "500 only if the dataprep POST itself errors"; no body contract required for an internal endpoint.
- [x] [Review][Dismiss] No `GET /health` change needed — healthcheck already pins the server.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev: webhook route + local sliding-window limiter + PyJWT auth; conftest poisons `sys.modules["aiohttp"]` → real `aiohttp.web` re-imported and rebound in the test module; TestClient unusable under that mock → tests drive the handler with fake request objects (documented deviation from AC 6).
- Review round drove out 2 latent bugs the tests had masked: the awaited-sync `feeds_col.get` (mock hid it) and the 503-vs-404 outage conflation (test premise corrected, not just code).
- Final: ingestor **28 passed**, overlay **832 passed**, ruff check + format clean, `docker compose config` renders.

### Completion Notes List

- Route `POST /v1/tools/webhook/{feed_name}` on the ingestor's aiohttp server; feed by `_key` only; kill switch `WEBHOOK_INGESTION_ENABLED` (fail-closed, route unregistered when off).
- Auth: X-API-Key (constant-time, bytes-safe) and/or Bearer RS256 JWT (PyJWT + realm JWKS via OIDC discovery, issuer from the discovery doc, audience opt-in); both modes independent; neither configured → 401.
- Order: auth (401) → feed lookup (503 on outage / 404 unknown) → rate limit (429 + Retry-After) → payload (400) → 202.
- Per-feed sliding window `WEBHOOK_RATE_LIMIT_MAX`/60s (local reimpl of `redis_primitives.SlidingWindowRateLimiter` — single-file image constraint).
- Body `{title, content, link?, timestamp?}` → `ingest_entries` + `webhook_received` event on `feed-ingestion-events`.
- Compose: webhook env block on the stream-ingestor service (kill switch defaults false); `env` SECTION 15 documented; `KEYCLOAK_URL` container-internal default (`http://keycloak:8080`), issuer taken from discovery so the public URL contract still holds.
- 3-9 carryovers fixed in passing: `_auditRedis` → `self.redis`; `breaker_dlq_recorded` re-arm on success.

### File List

- genie-ai-overlay/stream_ingestor/genieai_stream_ingestor.py (webhook route, auth, limiter, replay/bookkeeping fixes)
- genie-ai-overlay/stream_ingestor/requirements.txt (+httpx, +pyjwt[crypto])
- genie-ai-overlay/tests/test_stream_ingestor.py (+12 webhook/limiter/outage tests)
- docker-compose.yaml (stream-ingestor webhook env block)
- env (Section 15 webhook docs)
- _bmad-output/implementation-artifacts/{3-5 story, sprint-status, plan.md}

### Change Log

- 2026-09-05: Webhook push ingestion implemented (route, auth modes, sliding window, kill switch, tests)
- 2026-09-06: Review patches applied (auth-first ordering, discovery-based JWT, outage 503, timestamp/limiter hardening, 3-9 carryover fixes); 832 green → status review
