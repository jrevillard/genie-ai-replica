---
baseline_commit: pending
---
# Story 2.7: Source sync (Git/S3) + change detection + origin health

Status: deferred (2026-08-14)
Story key: `2-7-source-sync-git-s3-change-detection` | GitLab: #883 (`prd::okf-server`, `okf-server::epic-2`)
Epic: 2 (OKF Server — Repository Ingestion & Management) | Branch: `feat/okf-server`
FRs: **FR-1** (register source, validated reachable, creds from secret store), **FR-2** (sync + change-detect + origin health + graceful fallback), **FR-27** (doc-repo = retained source of truth) | ADRs: okf-016, okf-021 (D2 zip contract), okf-032

> **Scope honesty (critic-verified):** "sync completes" = **bundle accepted by the 2.5 route (202 + file_id)**. Actual indexing is a known dead-end until the ingestionWorker (Story 2.9.4) lands — the 2.5 fire-and-forget kick calls `_ingestFileById` directly (dataprep must be reachable), but there is no retry/queue. The story states this explicitly; it does NOT imply end-to-end indexing.

## Story

As a **platform engineer**,
I want **to register a Git or S3 source for an OKF repository and have it synced on schedule or webhook, with change detection (no full re-ingest) and origin-health monitoring**,
so that **repositories stay current, survive origin deletion (FR-27), and stewards are alerted when the origin disappears.**

## Acceptance Criteria

1. **Source registration + reachability validation (FR-1).** `PUT /api/okf/repos/:repo_id/source` (tools-admin) accepts `{type: 'git'|'s3', endpoint, ref|prefix, credentialsRef, syncSchedule}` (the existing joi `sourceSchema` at validators/repository-validator.js:16-22 — extended), validates the source is **reachable** (git: `git ls-remote`; S3: `headBucket`/`listObjectsV2` maxKeys:1), and **validates that `credentialsRef` RESOLVES** — an unset/empty `OKF_SOURCE_CRED_<REF>` env var is a structured 400 at registration, never a silent 2am 401. Credentials are **env-var names** (injected via `.env`/ansible-vault — the deployment's secret store per architecture.md:291), **never persisted in plaintext** (only the ref name is stored). The webhook HMAC secret follows the same discipline.
2. **Git sync + change detection.** Scheduled or webhook-triggered sync clones/fetches (shallow where possible), computes changed concepts via **`git diff --name-status OLD..NEW`** (NOT `--name-only` — the critic verified `--name-only` cannot classify **deletions**; `--name-status` yields A/M/D per path. This is a deliberate refinement of FR-2's `--name-only` shorthand). Added/modified concepts → included in the bundle; **deleted concepts are classified only** (recorded in okf_sources; actual retraction is the orchestrator's job, Story 2.9.1 — deferred, stated).
3. **S3 sync + change detection.** `listObjectsV2` (ETag/LastModified comparison vs the recorded per-file hashes); changed objects → bundle; deleted objects → classified (same deferral).
4. **SHA-256 idempotency (NFR-S4).** Per-file content hashes are recorded in okf_sources; a re-sync with unchanged hashes performs **no bundle upload** (no re-ingest). This feeds ADR-okf-021 §5's content-hash dedup.
5. **Bundle = zip of changed `.md` files (ADR-okf-021 D2, from day one).** The sync builds a **zip** (jszip, MIT — passes prd.md:498 licensing; lockfile committed in the same commit) and POSTs it to the **existing 2.5 bundle route** (`/api/files/ingest-bundle` with `graph_name=OKF_{repo_id}`, `repo_id` UUID). **This zip becomes the permanent versioned retained copy (FR-27)** — an interim non-zip format would strand data in a non-contract format that 2.9.5's unzip can never consume.
6. **Baseline-advancement state machine (critic high).** `last_commit_sha` (git) / marker (S3) advances **ONLY after successful bundle handoff (202 + file_id recorded)** — never on malware-reject (the 2.5 route returns 400 MALWARE_DETECTED → baseline stays; next sync retries), never ahead of a failed handoff. A crash between the 202 and the okf_sources write → the next sync re-uploads (duplicate retained copy; acceptable until 2.9.5's content-hash dedup — stated). Partial multi-bundle syncs leave the baseline at the last fully-handed-off SHA.
7. **Origin health + graceful fallback (FR-2/FR-27).** A periodic reachability check (same `ls-remote`/`headBucket` probes) writes `origin_reachable` + `last_error` to okf_sources. Origin deleted/inaccessible → **steward alerted** (log + okf_sources health + surfaced in the repo read API), **serving continues from the retained document-repository copy** — zero query-time origin dependency. **Remote URLs are scrubbed from error output before persisting `last_error`** (git writes URLs into errors; credentials could leak via URL-embedded tokens).
8. **Scheduling = the repo's own pattern.** A `sourceSyncWorker` mirroring **crawlWorker's setTimeout recursive poll + ArangoDB due-job scan** (crawlWorker.js:70-84 — no cron dependency; node-cron is ISC, outside the permissive list). Env-gated (`OKF_SOURCE_SYNC_ENABLED`, default off) + documented **replicas:1** constraint; **per-repo in-flight lock** (ArangoDB-based) guards the same-replica trigger race.
9. **Webhooks (additive, not the baseline).** `POST /api/okf/repos/:repo_id/source/webhook` mounts **OUTSIDE the router-wide `authenticate` middleware** (okf-routes.js:9 — external git hosts cannot present Keycloak tokens) with **per-source HMAC validation** (Node built-in `crypto`; secret via the same env-ref discipline). Scheduled poll remains the sovereignty baseline (PRD line 554); webhooks are a latency optimization.
10. **Service account = least privilege (critic high).** The sync's doc-repo calls use a **new realm role `okf-service`** (mirroring the existing `dataprep-service` precedent: genie-realm.yaml:44-45,149-156) — NOT the realm `admin` role. The 2.5 bundle route's `authorizeRole` becomes `['Admin', 'okf-service']`. Client `okf-server-client` (serviceAccountsEnabled; `KC_OKF_CLIENT_SECRET` env). Blast radius: the sync account can only ingest bundles, not delete/retract/label.
11. **okf_sources minimal writer (this story; 2.9.8 deepens it).** Writes `repo_id`, `last_commit_sha`/`last_sync_marker`, `last_sync_at`, `origin_reachable`, `last_error` (scrubbed), `last_bundle_file_id`. (The collection + unique `(repo_id)` index already exist in collections.js:13,32 — ensured on boot, currently unused.)
12. **Standards.** MELT (withSpan + shared logger + `okf_source_sync_operations_total` counter); all exceptions handled + logged; joi at the boundary; snake_case responses; direct AQL; ITU copyright headers; package-lock committed; ESLint/Prettier clean; Jest tests. CI: `scan:okf-server` is **blocking** (.gitlab-ci.yml:892 — allow_failure:false).

## Tasks / Subtasks

- [ ] **T1 — Source registration + validation** (AC: 1)
  - [ ] Extend `validators/repository-validator.js` sourceSchema (ref→branch/tag for git; prefix for S3; `syncSchedule` cron-like interval string).
  - [ ] `services/source-sync-service.js`: `registerSource(repo_id, source, actor)` — resolve `OKF_SOURCE_CRED_${credentialsRef}` (400 `CREDENTIALS_UNRESOLVED` if unset/empty), probe reachability (git `ls-remote` / S3 `headBucket`), write `source` on the repo doc (already in UPDATABLE_FIELDS) + upsert okf_sources.
  - [ ] `routes/repos-routes.js`: `PUT /:repo_id/source`, `GET /:repo_id/source` (tools-admin).
- [ ] **T2 — Git adapter (native git behind a thin adapter)** (AC: 2)
  - [ ] `services/source-adapters/git-adapter.js` — `execFile('git', ...)` (git 2.39.5 verified in node:22 full image, Dockerfile:16; zero new deps, zero Dockerfile change); `lsRemote()`, `fetch()`, `diffNameStatus(oldSha, newSha)` (returns A/M/D per path), `readFileAt(ref, path)`. URL-scrubbing on errors before persisting.
- [ ] **T3 — S3 adapter** (AC: 3)
  - [ ] Add `@aws-sdk/client-s3` (Apache-2.0, lockfile committed). `services/source-adapters/s3-adapter.js` — custom-endpoint support (MinIO/Ceph); `list()` (ETag/LastModified), `getObject()`.
- [ ] **T4 — Sync engine + change detection + zip bundle** (AC: 2,3,4,5,6)
  - [ ] `services/source-sync-service.js` `syncRepo(repo_id)`: acquire per-repo lock → adapter.listChanges(baseline) → filter by SHA-256 (NFR-S4 skip-unchanged) → build **zip** (jszip) of changed `.md` → POST 2.5 route (axios, `okf-service` token) → **on 202**: advance baseline + write okf_sources (incl. `last_bundle_file_id`); **on 400 MALWARE**: do NOT advance, write `last_error`, alert; deletions classified + recorded only.
- [ ] **T5 — Worker + scheduling** (AC: 8)
  - [ ] `workers/sourceSyncWorker.js` mirroring crawlWorker (setTimeout recursive poll + ArangoDB due-scan of okf_repositories with source.syncSchedule); env-gated `OKF_SOURCE_SYNC_ENABLED`; per-repo in-flight lock; MELT.
- [ ] **T6 — Origin health checker** (AC: 7)
  - [ ] Periodic probe (same adapters' reachability methods) → okf_sources `origin_reachable` + scrubbed `last_error`; surfaced in the repo read API (repository-service getById extends with source health).
- [ ] **T7 — Webhook endpoint + HMAC** (AC: 9)
  - [ ] Mount OUTSIDE `authenticate` (a sibling router in okf-routes.js); per-source HMAC (crypto.timingSafeEqual); secret via env-ref; triggers syncRepo (fire-and-forget).
- [ ] **T8 — Keycloak `okf-service` role + client** (AC: 10)
  - [ ] `configs/keycloak/genie-realm.yaml`: realm role `okf-service` + client `okf-server-client` (serviceAccountsEnabled; `KC_OKF_CLIENT_SECRET`), mirroring dataprep-service; doc-repo bundle route `authorizeRole(['Admin','okf-service'])`; okf-server obtains the service token (client_credentials).
- [ ] **T9 — Tests** (AC: all)
  - [ ] Unit: adapters (mock execFile/aws-sdk), sync engine (baseline advancement, malware-no-advance, SHA-256 skip, deletion classification), health checker, webhook HMAC (timing-safe + reject). Route: registration validation (unresolvable cred ref → 400), source CRUD auth.
- [ ] **T10 — Lint/format/verify** (AC: 12)
  - [ ] `cd components/okf-server && npx eslint . && npx prettier --check . && npm test`; `cd genie-ai-overlay` untouched (no Python change).

## Dev Notes

### Verified facts (from the 5-agent analysis + adversarial critic — cite, don't re-derive)
- **git IS in the runtime image**: `node:22` full Debian, `git version 2.39.5` (verified live via `docker run --rm node:22 git --version`; Dockerfile:16 runtime stage). Two analyzers wrongly claimed otherwise — native git needs **zero Dockerfile change** and gives exact `--name-status` semantics; isomorphic-git has **no built-in diff** (would need hand-rolled tree-walking).
- **The repo doc already has `source`** as an opaque passthrough (repository-service.js:139, UPDATABLE_FIELDS line 32); the joi sourceSchema already exists (validators:16-22). Registration adds **validation**, not the field.
- **okf_sources exists** (collections.js:13) with a unique `(repo_id)` index (:32) — ensured on boot, never written.
- **The 2.5 route contract** (fileController.js:1014-1076): joi `graph_name` pattern `/^OKF_[a-f0-9-]+$/` + `repo_id` `.uuid()` + ownership assertion + ClamAV + **fire-and-forget `_ingestFileById` kick** + 202. Malware → 400 `MALWARE_DETECTED`. **`repo_id` must be the okf-server's UUID repo_id.**
- **No worker drains Pending files** (crawlWorker polls crawl_job only) — hence the scope-honesty note above.
- **Webhook constraint**: okf-routes.js:9 applies `authenticate` router-wide — the webhook MUST mount outside it.
- **CI**: `scan:okf-server` **blocking** (.gitlab-ci.yml:892). `verify:dataprep-lock` not triggered.
- **Scheduling precedent**: crawlWorker.js:70-84 (setTimeout recursive poll + due-scan), started from the require.main block — never from createApp.

### Licensing (all verified live from npm)
jszip MIT · @aws-sdk/client-s3 Apache-2.0 · **avoid node-cron (ISC — outside MIT/Apache-2.0/BSD)** · Node crypto (built-in). No other new deps.

### Inherited lessons from 2.1-2.5 reviews
Shared libs IMPORTED not copied · MELT on every method · all exceptions handled + logged · joi at the boundary · direct AQL · red-green tests · code-review catches real defects (the 2.5 dead-end) — expect the same scrutiny.

### Out of scope
- Deletion **retraction** (classify only; orchestrator 2.9.1 retracts) · okf_sources deep model (2.9.8) · content-hash dedup of retained copies (2.9.5) · the ingestionWorker (2.9.4) · orchestrator-owned ingest sequencing (2.9.1).

### References
- Code: repository-service.js:31-32,134-151 · validators/repository-validator.js:16-22 · collections.js:13,32 · okf-routes.js:8-12 · repos-routes.js:12-19 · fileController.js:1014-1076 (2.5 route) · crawlWorker.js:70-84,95-101 · genie-realm.yaml:44-45,98-103,149-156 · docker-compose.yaml:1038-1039 · .gitlab-ci.yml:892.
- Planning: PRD FR-1/FR-2/FR-27, NFR-S1/S4, §9 · ADR-okf-016, okf-021 (D2 zip), okf-032 · epics.md Story 2.7/2.9.8 · architecture.md:291 (env-vault secret store).
- Analysis: 5-agent workflow wm0jd3leq (4 analyzers + critic; critic verdict "NOT READY as-analyzed" — all its corrections are incorporated above).

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
