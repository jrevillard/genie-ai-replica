# Changelog — 2026-08-31

Branch: `Climate-PolisenseAI-branch` · Covers this session's commits
(2026-08-30 → 2026-08-31). Full technical detail in
`NOTIFICATION_AND_BACKEND_MIGRATION.md`.

---

## 2026-08-31

### `9863cc2cb` — Merge release/2.0: CVE remediation + stabilization fixes
*20 files changed, +10,189 / −10,055*

- **Backend dependency CVE bumps**, combined with the notification stack's
  deps: `multer` 1.4.5 → **2.2.0**, `nodemailer` 6 → **9.0.3**,
  `uuid` 9 → **11**, `protobufjs` override 7.5.5; lockfile regenerated with
  `bullmq` + `firebase-admin` retained.
- **document-repository**: dependency CVE bumps, Dockerfile bump, crawler fix.
- **genie-ai-overlay**: embedding/textgen base-image bumps; the release
  `max_tokens`/pydantic fix was *not* needed — this branch's chatqna already
  defaults `max_tokens` to 1024 and never passes `None`.
- **configs/postgres**: Dockerfile bump; docs: v2.0.1 changelog, upgrade
  guide, release presentation.
- **Deliberately kept ours**: frozen `gov-chat-frontend/` (release's frontend
  CVE bumps — jspdf 4, `@lucide/vue` rename — deferred to the unfreeze),
  api-gateway config, root docker-compose, main-lineage CI/Dockerfile.
- Verified: backend jest **64/64 suites (1,700 tests)** with the bumped
  dependencies; `mobile/` and `gov-chat-frontend/` byte-identical to
  `1170938a1`.

## 2026-08-30

### `237154abe` — adding env file
*1 file, +323* — committed `env.txt` (local environment values).
⚠ Not yet pushed; contains credentials — strip-or-rotate decision pending.

### `93bb51269` — docs: notification system + backend migration summary
*1 file, +114* — added `NOTIFICATION_AND_BACKEND_MIGRATION.md`: implementation
docs, verification results, merge audit, known issues, operating guide.

### `4db6b868e` — Merge main into Climate-PolisenseAI-branch
*2,605 files changed, +631,404 / −214,804*

- Migrated the backend to main's lineage (~750 team commits): **Keycloak
  auth layer** (replaces JWT password login), multi-stage Dockerfile
  (`npm ci`, `USER node`, Arango-wait entrypoint), backend test suite +
  ESLint + CI, tracing/metrics.
- Carried the **FCM notification fan-out** in, adapted to Keycloak and the
  new `createApp`/`startApp` structure (via `8ef23544b`).
- Added `warning_system_engine/` to the compose stack with idempotent
  broadcast dispatch.
- **Freeze honored**: all of `mobile/` and `components/gov-chat-frontend/`
  hard-restored byte-identical to `1170938a1` (including ~800 files that
  would otherwise have auto-merged from main).
- Superseded by main's rewrite (recoverable from `1170938a1`):
  `auth-service.js`, `query-service.js` local edits, `authController.js`,
  `weather-routes.js`, old env/compose templates.
- Known consequence (documented): mobile password login (`POST
  /api/auth/login`) does not exist on the Keycloak backend — demo login runs
  against pre-merge commit `1170938a1`.

### `8ef23544b` — Add FCM push-notification fan-out backend
*54 files, +13,964 / −2,370* (merged in via `4db6b868e`)

- Async broadcast pipeline for 10k+ devices: BullMQ on redis-cache (db 1),
  500-token chunks, streaming audience query with array indexes, retry with
  narrowed token lists + Redis sent-set dedup (zero duplicate delivery on
  crash), per-error-code token pruning with mass-invalid-argument guard,
  idempotency-key dedup, fail-closed broadcast secret.
- Verified end-to-end: 10k mock fan-out in 2.2s; real FCM delivery to an
  Android emulator (foreground + background); crash recovery with
  `sent == matched` exactly.
