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


## 2026-08-31 (later session) — Keycloak auth enabled for both apps *(uncommitted working-tree changes)*

### Branch history
- Briefly undid the main migration (reset to `1170938a1`) on a "release/2.0 only"
  request, then restored to `591038bd0` after establishing that release/2.0 is
  built on main — the Keycloak auth migration IS main's commits and cannot be
  taken separately. Safety branch `backup/main-migration` created (now == HEAD).

### Local Keycloak test environment (infrastructure, not in git)
- `genie-keycloak` container (Keycloak 26, `:8081`): realm `genie`, public
  client `genie-app` with Direct Access Grants enabled, webOrigins for
  `http://localhost:8090`, test user `admin` / `Admin@12345`.
- Same-branch backend harness on `:3000`: this branch's real
  `keycloak-auth-middleware` (JWKS validation), user provisioning, user +
  notification routes, BullMQ workers, real FCM. Replaces the old-JWT demo
  harness.

### Uncommitted code changes
| File | Change |
|---|---|
| `mobile/.../lib/services/user_service.dart` | `login()` → Keycloak ROPC (password grant) + backend profile fetch; returns the legacy flat response shape (fixes a post-login `Null is not a subtype of String` red-screen) |
| `gov-chat-frontend/src/services/authService.js` | `login()` → Keycloak ROPC with the same storage/return contract |
| `gov-chat-frontend/src/services/userService.js` | `login()` delegates to authService (LoginScreen's actual call path); legacy kept as `_legacyLogin` |
| `gov-chat-backend/routes/user-routes.js` | `GET /api/users` no longer returns the user's `encPassword` bcrypt hash |
| `gov-chat-frontend/src/components/LoginScreen.vue` | user's own edit (savedAccounts placeholder removal) — not part of the auth work |

Webapp dev server runs with `VUE_APP_CSP_CONNECT_SRC` extended to allow
`http://localhost:8081`. Mobile debug builds use `adb reverse tcp:8081` so the
token issuer matches what the backend validates.

### Verified
- Token chain: Keycloak token → branch middleware **200** → provisioning
  matched existing user `1162` (email-based legacy migration) → notification
  register OK.
- Mobile: full login on emulator, crash-free after the shape fix, device
  auto-registered; FCM token rotation after app-data wipe handled by the
  pruning path.
- Real-FCM broadcast path unchanged and live on `:3000`.

### Token lifespan + notification channel fix *(same session, uncommitted)*

- **Keycloak token lifespan bumped** (realm `genie`, admin setting — no code):
  access tokens 5 min → **24 h**, SSO/refresh window → **7 days**. Removes the
  pilot-breaking 401s five minutes after login; the proper long-term fix
  remains a refresh interceptor (present in main's vendored mobile auth stack).
- **`weather_alerts` channel fix** (the Phase 2 heads-up issue, both sides now
  agree on one channel):
  - `lib/services/notification_service.dart`: creates the `weather_alerts`
    channel (`Importance.max`) at init and uses it for foreground banners
    (was the never-created `high_importance_channel`).
  - `AndroidManifest.xml`: `default_notification_channel_id: weather_alerts`
    + `default_notification_icon` meta-data (also fixes the white-square icon).
- Verified live: channel registered with Android at importance 5 (MAX), and a
  real tier-4 broadcast with the app **backgrounded** produced a **heads-up
  banner over the home screen** — previously these arrived silently in the
  shade via a fallback channel (Google's own logcat warning confirmed the
  old behaviour).

---

## Appendix A — commits brought in by the main merge (`4db6b868e`)

602 commits / 163 merge requests from the team's main line. Breakdown:
223 fix · 75 feat · 66 docs · 42 chore · 27 refactor · 13 ci · 6 test · 3 perf.

Merge requests (newest first):

- fix/backend-uid-writable-paths
- fix/sast-fspath
- docs/sast-wave4-outcomes
- fix/caps-smoke-hotfix
- fix/sast-wave4-sinks
- fix/sast-compose-hardening
- fix/sast-regex-escape
- fix/sast-exclude-bmad
- docs/cve-wave3-triage
- docs/cve-remediation-methodology
- fix/apt-upgrade-runtime-images
- worktree-genieai-generic-presentation
- fix/opea-base-apt-upgrade
- docs/cve-triage-2026q3
- feat/ci-force-image-rebuild
- fix/container-scanning-template
- fix/sast-exclude-claude
- fix/security-q3-2026
- chore/archive-opea-1.5-upgrade
- feat/opea-1.5-upgrade/prd
- chore/bmad-tooling-bootstrap
- fix/ci-mr-changes-compare
- fix/upgrade-doc-next
- fix/release-cli-image
- docs/release-patch-flow
- chore/changelog-2.0.1
- fix-reranker-slice-default
- fix-upgrade-genieai-role
- fix-promote-tag-pattern
- worktree-fix-max-tokens
- fix-cache-scope
- worktree-fix-upgrade-doc-2
- worktree-fix-promote-scan-report
- worktree-docs-upgrade-guide
- worktree-cve-remediation
- worktree-fix-docs-duplicate-titles
- feat/v2.0.0-release-presentation
- feat/v2.0.0-release-presentation
- chore/release-2.0.0-changelog
- fix/just-chat-no-auto-submit
- docs/release-guide
- fix/just-chat-clears-labels
- fix/remove-max-tokens-default
- feat/multi-turn-vector-blend-833
- fix/ci-dataprep-lock-sync
- feat/ansible-raw-api-deploy
- feat/mr-promote-images
- fix/resolve-image-always
- fix/jinja-repo-url-whitespace
- fix/optional-git-credentials
- fix/optional-gitlab-deploy-token
- ci/phase2b-ansible-gitlab-registry
- feat/better-reranker-contextual-defaults
- feat/quick-help-service-labels
- feat/rag-adaptive-instrumentation
- fix/dataprep-partial-batch-recovery
- fix/dataprep-cold-cache-build
- fix/reranker-tei-429-contract
- fix/label-filter-via-search-start-contract
- fix/compose-retriever-query-params-chatqna
- feat/category-labels-list
- fix/label-filter-via-search-start-contract
- docs/claude-md-drift-audit
- docs/followups
- docs/gpu-fix-readme-trim
- docs/consistency-fixes
- docs/readme-badges-reorient
- feat/reranker-selection-eval-tracing
- docs/rag-observability-sections
- feat/site-design-system-docs
- fix/contextual-max-tokens-env
- fix/label-scope-to-file-labels
- feat/hugo-docs-site
- fix/reranker-adaptive-relevance-formula
- fix/dataprep-batch-exception-logging
- fix/vllm-max-model-len-65k
- fix/contextual-doc-budget-100k
- fix(reranker): default RERANKING_STRATEGY to adaptive (was slice) (!208)
- fix(chatqna): rag.chunk_count metric was always 0 (hasattr on dict) (!207)
- feat(retriever): push BM25 label filter pre-LIMIT (hybrid Part B recall optimization) (!206)
- refactor/rename-token-cost-alpha
- feat/contextual-retrieval
- feat: Contextual Retrieval — Part A (dataprep contextualization) + Part B (retriever BM25+RRF hybrid) (!199)
- fix/scan-config-json-escaping
- fix/rules-changes-dot-gitlab-ci
- docs/debugging-tracing-rules
- fix/832-status-filter-case
- ci/rules-changes-per-image
- fix/dataprep-labeling-perf
- fix/promote-cleanup-skopeo-delete
- fix/831-file-labels-delete-old
- fix/container-scanning-artifact-download
- fix/build-rules-release-branches
- fix/830-documents-search-bar
- ci/security-policies-licenses
- ci/per-image-build-skip
- fix/disable-spotbugs-sast
- ci/release-branch-images
- fix(opea): copy model_cache.py into all service Docker images
- worktree-fix-ansible-gpu-runtime
- docs/gitlab-runner-userns-update
- fix/disable-deprecated-nodejs-sast
- fix/dockerhub-auth-rate-limit
- fix/gpu-runner-memory-4g
- worktree-fix-sentinel-stream-leak2
- worktree-fix-sentinel-stream-leak
- ci/security-testing-suite
- worktree-confidence-display-llm
- fix/promote-digest-extraction
- ci/gitlab-registry-build-scan
- worktree-confidence-score-hybrid
- fix/ingest-upload-date-422
- fix/streaming-msg-separator-leak
- fix/doc-crawl-job-404
- RAG-testing-and-observability-upgrades
- feat/stream-translation
- fix/i18n-locale-parity
- fix/locale-whitelist-config
- fix/rag-grounding-main
- fix/grafana-observability-generic
- fix/826-doc-fixes
- worktree-fix-otel-default-endpoint
- feat/gpu-https-port
- fix/824-deployment-doc-gaps
- fix/docs-validate-ci-job
- fix/828-move-chat-auth
- fix/admin-role-jwt-claims
- fix/827-move-chat-folder-client-error
- feat/dynamic-favicon
- fix/config-mismatch-warning-false-positive
- fix/ci-bare-fallback-rules
- fix/i18n-warning-messages
- fix/welcome-message-i18n-fallback
- feat/query-inspector
- feat/locale-consistency-tests
- feat/configurable-quickhelp-prompts
- chore/husky-pre-commit-lint
- docs/issue-823
- feat/testing-framework/prd
- fix/mobile-stale-tests-pubspec-cleanup
- fix/ansible-validate-mobile-keycloak-vars
- worktree-gitlab-runner-ansible
- feat/design-system-migration
- revert-4174f40e
- feature/sse-streaming
- fix/auth-timeout
- sprint-21-bug-fixes
- feat/testing-framework/planning-updated
- worktree-fix-keycloak-redirect-port
- feat/mobile-oidc/prd
- toolbar-update
- sprint-22-bug-fixes
- fix-lint
- worktree-fix-dockerfile-root
- worktree-fix-frontend-tests
- worktree-add-gitattributes
- worktree-fix-security-headers
- align-tooling
- feature/keycloak-idp-integration
- deployment-stabilization
- document-repository-cleanup
- backend-node-cleanup'
- vue-app-cleanup'

## Appendix B — commits brought in by the release/2.0 merge (`9863cc2cb`)

- docs(upgrade): replace NEXT placeholder with v2.0.1 in upgrade matrix
- fix(ci): use official release-cli image for release:create
- chore(release): changelog v2.0.1
- fix(reranker): default RERANKING_STRATEGY to slice, top_n=3
- fix(docs): add genieai role to PG migration password reset
- fix(ci): restrict promote tag release-* to version branches only
- fix(chatqna): handle max_tokens=None after pydantic upgrade
- fix(ci): scope build cache to branch to prevent stale COPY layers
- fix(docs): add password reset step to PG migration
- fix(ci): promote publishes container scan report with correct image names
- docs: add upgrade guide v2.0.0 → NEXT
- Revert "docs: add PostgreSQL 13→16 migration guide"
- docs: add PostgreSQL 13→16 migration guide
- fix(security): CVE remediation — zero critical+high vulnerabilities
- fix(docs): remove duplicate title+description from section landing pages
- docs: v2.0.0 release presentation — MARP deck
- docs: add v2.0.0 release presentation
- fix(ci): use native release keyword instead of curl+CI_JOB_TOKEN
