# FCM Notification System & Backend Migration to Main

Branch: `Climate-PolisenseAI-branch` · Key commits: `1170938a1` (notification
implementation) → `4db6b868e` (merge of main + adapted backend) · Aug 2026

---

## 1. What was built — push-notification fan-out (up to 10k+ devices)

Asynchronous, durable broadcast pipeline replacing the old inline send loop
(which ran 20 sequential FCM calls inside one HTTP request and timed out the
warning engine's 10s client).

### Backend (`components/gov-chat-backend/`)

| File | Purpose |
|---|---|
| `services/notification/queue.js` | Dedicated ioredis client (BullMQ requires `maxRetriesPerRequest: null`) on redis-cache **logical db 1**; three queues: broadcast, chunk, maintenance; every transient key carries a 24h TTL (redis runs `noeviction` with no `maxmemory`) |
| `services/notification/token-repository.js` | Device-token registry: single-round-trip AQL UPSERT, **streaming** audience cursor (memory bounded by batch size, not audience size), dynamically-built targeting query (no `LENGTH()==0 OR` fallbacks — verified via `db._explain()` to use the array indexes), soft-deactivate + daily reaping (90d hard-delete, 270d stale) |
| `services/notification/broadcast-repository.js` | `notificationBroadcasts` collection; `_key = sha256(idempotencyKey)` so the primary index *is* the dedup constraint; document written twice per broadcast (create + finalize) with running counters in Redis in between |
| `services/notification/fcm-sender.js` | Firebase Admin init, message construction (string-coerced data, 4KB payload shedding, `ttl` 6h, `collapseKey`, `channelId: weather_alerts`), per-chunk send with `responses[i] ↔ tokens[i]` error mapping, `FCM_TRANSPORT=mock` simulator for load testing |
| `services/notification/error-classifier.js` | FCM error code → prune / retry / fail / abort; **mass-invalid-argument guard**: if >50% of a chunk fails with `invalid-argument`, treat as payload bug and prune nothing |
| `services/notification/broadcast-processor.js` | The two job handlers. Retry narrows the token list *before* throwing, and a Redis sent-set is checked on entry — a crash mid-chunk cannot re-deliver to devices that already received the alert |
| `workers/notification-worker.js` | BullMQ workers: concurrency 4, 8 chunks/s limiter, 5 attempts, full-jitter backoff; in-process by default, standalone-capable (`NOTIFICATION_WORKER_ENABLED=false` + `node workers/notification-worker.js`); exhausted chunks still count toward completion |
| `services/notification-service.js` | Facade: validated register/unregister, `enqueueBroadcast` returns **202 + broadcastId in ~45ms**, live status overlay from Redis counters, health |
| `routes/notification-routes.js` | register/unregister behind auth; **broadcast/status/health behind a fail-closed shared secret** (`timingSafeEqual`; unset secret → 503, closing the previously-open endpoint) |
| `scripts/notification-load-test.js` | seed / run / dedup / clean against the mock transport |
| `scripts/new-schema-scripts/arango-schema.json` | `notificationDeviceTokens` (+6 indexes incl. array indexes for district/crop/alertType targeting) and `notificationBroadcasts` (+TTL index, 90d retention) |

### Warning engine (`components/warning_system_engine/`)
- `app/core/notifier.py`: retrying `requests.Session` (POST explicitly allowed),
  timeout `(5, 30)`, accepts 202, **date-bucketed idempotency keys** on all four
  dispatch paths — a container restart re-running the daily pipeline is
  suppressed as a duplicate instead of double-notifying; dead legacy
  `fcm.googleapis.com/fcm/send` topic fallback removed.

### Mobile — one debug-only change
- `android/app/src/main/../debug/AndroidManifest.xml`: cleartext-HTTP exception
  so debug builds can reach a local backend (`10.0.2.2`). **Release builds and
  all app UI/feature code untouched.**

## 2. Verification (all green)

- **10k mock fan-out**: 202 in 44ms · 2.2s wall clock · sent+failed == matched ·
  489 dead tokens auto-pruned (`active:false`, reason recorded)
- **Idempotency**: 5 concurrent posts, same key → 1 broadcast, 4 `duplicate:true`
- **Crash recovery**: SIGKILL mid-broadcast → resumed; `sent == matched` exactly
  (zero duplicate deliveries)
- **District targeting**: exact counts per district; array indexes confirmed used
- **Real FCM delivery**: emulator received real pushes (foreground + background)
  via a `bangladesh-ews` service account; complete path
  `broadcast API → BullMQ → Firebase Admin → Google FCM → device shade`
- **On merged tree**: jest 64/64 suites (1700 tests), ESLint clean, runtime
  smoke (register → broadcast → completed 3/3)

## 3. Backend migration to main (merge `4db6b868e`)

`origin/main` (now `opensource.unicc.org/un/itu/genie-ai`) had advanced ~750
commits, including a **Keycloak auth migration** and a rewritten backend
Dockerfile (multi-stage, `npm ci`, `USER node`, Arango-wait entrypoint). The
merge brought main in while keeping every branch commit in history.

**Resolution audit — of 263 files this branch changed since divergence:**

- **240 preserved byte-identical** — including *all* of `mobile/` and
  `components/gov-chat-frontend/` (hard-restored and verified: zero diff vs
  `1170938a1`)
- **13 adapted/combined** — the notification backend re-expressed against
  main's structure (Keycloak middleware in routes, createApp/startApp wiring,
  merged package.json/lockfile/schema/compose/env); functionality identical,
  verified by tests
- **10 took main's version / deleted** — superseded by main's rewrite:
  `services/auth-service.js` (deleted — Keycloak), `services/query-service.js`,
  `controllers/authController.js`, `routes/weather-routes.js`,
  `api-gateway-solution/new-config/manage-kong-config.sh`, backend `env`
  template, `components/docker-compose.yaml`, root `env`/`docker-compose.yaml`
  (main's + notification additions). **These edits still exist in history at
  `1170938a1`** — recover any of them with
  `git diff 4db6b868e^2..1170938a1 -- <path>`.

## 4. Known open issues

1. **Mobile login is broken against the merged backend** (verified live):
   main's auth is Keycloak OIDC; `POST /api/auth/login` returns 404. Options:
   demo from `1170938a1` (full flow works there), or adopt main's mobile auth
   flow. The notification broadcast path itself is unaffected (shared secret).
2. **Notification channel**: backend sends `channelId: weather_alerts`; the app
   never creates that channel → background pushes get no heads-up banner
   (Google's own warning observed in logcat). Fix = one
   `createNotificationChannel` call + manifest `default_notification_channel_id`.
3. **District targeting is hardcoded** to `['Dhaka']` in the app
   (`notification_service.dart`) — the district-picker work is designed but not
   yet implemented.
4. `/register` accepts `body.userId` over the authenticated identity
   (deliberately deferred; one-line fix documented).

## 5. Operating it

```bash
# Required env (root env file documents all of these):
NOTIFICATION_BROADCAST_SECRET=$(openssl rand -hex 32)   # broadcasts 503 without it
GOOGLE_APPLICATION_CREDENTIALS=/opt/genie/firebase-service-account.json
FCM_TRANSPORT=real                                       # mock for load tests

# Trigger a broadcast (the warning engine does this automatically):
curl -X POST $API/api/notifications/broadcast \
  -H "Content-Type: application/json" -H "x-notification-secret: $SECRET" \
  -d '{"title":"...","body":"...","districts":["Dhaka"],
       "alertTypes":["weather_warning"],"idempotencyKey":"unique-per-event"}'
# → 202 {broadcastId, statusUrl}; poll statusUrl for sent/failed/pruned counts.
```

Firebase service-account JSON lives outside git (`.secrets/`, gitignored) and
must be readable by the container's `node` user.

## 6. release/2.0 merge (Aug 31)

Merged `origin/release/2.0` (21 stabilization commits): backend CVE bumps
(multer 2.x, nodemailer 9.x, uuid 11, protobufjs override) combined with our
bullmq/firebase-admin, document-repository CVE bumps + crawler fix, overlay
embedding/textgen image bumps, postgres Dockerfile, docs/changelog. Kept ours:
frozen frontend (release's frontend CVE bumps deliberately skipped —
jspdf 4 / @lucide/vue rename pending the unfreeze), gateway, root compose,
main-lineage CI/Dockerfile. The chatqna max_tokens/pydantic fix was not
needed: this branch's chatqna already defaults max_tokens to 1024 and never
passes None. Verified: jest 64/64 with the bumped dependencies.
