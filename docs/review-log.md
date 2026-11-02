# Review log — feature/2.0-upgrade

Adversarial review rounds against PLAN.md's own contract (ponytail: shortest
diff/fewest files; test per step; claims must match evidence). Detail moved
here from PLAN.md to keep that file minimal.

## Round 1 — `main..5b865adf` (9 commits, 355 files) → fixed in `2b2e73ec`

Method: 18-agent fleet (6 dimensions) + adversarial verification of every top
finding (12/12 CONFIRMED, 0 refuted) + personal re-derivation.

| # | Finding | Fix |
|---|---------|-----|
| H1 | Real prod creds tracked: `api-gateway-solution/env` (`***REMOVED***`, Konga secret, `***REMOVED***`), same password hardcoded in `docker-compose-t4.yaml:53`, kong dump with SUPERUSER md5 hash | Untracked/deleted; creds placeholder-ized in docs + old compose. **ROTATION owed — PLAN D6 list** |
| H2 | deploy.yml: 6 duplicate `when:` keys → YAML last-key-wins killed deploy_mode gates → local-mode post-deploy HUNG | Conditions merged; `_compose_changed` derived, not hardcoded |
| H3 | graphify-out: 227 files / 6.3MB committed, then ignored without untracking | `git rm -r --cached` |
| H4 | t4/RTX6000 composes: 25 `env_file: .env` vs untracked .env (fresh-clone broken) AND README told users to use them | Deleted; README/GEMINI → `docker-compose.yaml` |
| M1 | Swarm path never activated `gpu-models` profile (GPU services silently absent) | Gate folded into shared `_compose_profiles` (local + swarm + validation) |
| M2 | mock `/embed` spoke OpenAI envelope on TEI's native bare-array path | Both dialects served (`/embed`, `/v1/embeddings`) |
| M3 | mimeTypeValidator (file-type v16 fix) had zero tests; stale "not used anywhere" header | 2-case jest test; suite 58→60 (needs `NODE_OPTIONS=--experimental-vm-modules`) |
| M4 | Grafana OAuth URLs missing `/auth` prefix (KC_HTTP_RELATIVE_PATH) | Prefixed |
| L | env.j2 realm fallback still `genie`; `genie-app` client default exists nowhere; "ALL 12 HEALTHY" was really 11+3 one-shot jobs | All corrected (template + compose defaults + PLAN.md) |

Refuted by verification: nginx-curl healthcheck scare (`nginx:1.28-alpine` ships
curl); "plaintext API keys in kong dumps" (COPY blocks empty — but the md5
superuser hash was real → H1).

## Round 2 — `2b2e73ec..b50c2982` (F4/S2c/S2d/S3/PG-runbook) → fixed in `bacec3eb`

Method: personal line-by-line read of every diff + claims grep + LIVE
verification against the running stack (MOCK_SLOW front-door runs).

| # | Finding | Fix |
|---|---------|-----|
| M1 | Mid-stream upstream error rendered as success: empty bot bubble, query persisted `isAnswered: true` | Frontend `onError` → error state + bubble removal; backend `isAnswered: !!response` |
| M2 | `buildOpeaPayload` "shared by classic + stream" — only stream used it; classic inline builder + stale `e2e-109-198` host default | Classic path now uses it; default → compose service name |
| M3 | *"dataprep missing VLLM_API_KEY"* — **FALSE FINDING, retracted**: already wired (compose ~line 1115, F4 commit); review grep missed it | None (compose rejected the duplicate — caught by `config`) |
| L1 | "SSE renders" unprovable with one-chunk mock; kong leg untested | `MOCK_SLOW=1` mode + docstring recipe; **proven live** below |
| L2 | 87-line stream route had zero tests | First backend jest suite (3/3) |
| L3 | No client-disconnect abort | `res.on('close')` + `writableEnded` + `AbortController`. NB: `req.on('close')` fires at body-consume and aborted EVERY stream — my first attempt, caught by the tests |
| L4 | Runbook "Expect 0 errors" wrong (role-exists collisions expected) | Caveat added |
| L5 | S2d checkbox unchecked; Vue2 `$set` nit | Fixed |

**Bugs only live testing found** (static review could not):
1. Stream route dropped every `b'…'`-wrapped bare-text token (JSON.parse threw,
   catch swallowed) — streaming answers would render empty with real vLLM.
2. Chatqna's `{type: metadata}` event dropped — source docs/confidence never
   reached the streaming UI. Now rides the `done` event.
3. **Refuted claim**: chatqna AGGREGATES the LLM stream and bursts at the end
   (probe: 5×1s chunks arrive together) — token-by-token through chatqna is not
   happening; backend→browser legs stream fine. True token streaming = chatqna
   change, only if wanted.

**Live proof** (front door nginx→kong→backend→chatqna→mock, MOCK_SLOW):
`queryId` +0.03s → 5 deltas +5.07s → `done`+metadata +5.08s — progressive, no
buffering anywhere.

**Incident + repair** (disclosed): rebuild used root `.env` which does NOT match
the live stack's env (`/tmp/env-s2a.env`, 9-char ARANGO_PASSWORD vs 28) →
recreated containers with mismatched secrets, keycloak exited, kong lost `/auth`.
Repaired: stack restored with the correct env, junk second project removed,
durable copy saved as gitignored `.env-s2a-local`.

Suites after both rounds: backend 3/3 · frontend 63/63 · doc-repo 60/60 ·
compose valid · stack healthy.

## Open items
- [ ] **Adem**: rotate D6 credentials (KC bootstrap admin, Konga secret, DB passwords, kong role).
- [x] ~~kong-config restore does not reconcile~~ **ROOT-CAUSED + FIXED (08-30)**: the script's PUT-by-name reconcile is CORRECT — the drift came from the **image baking a stale kong_config.json** (pre-edit layer; `compose run` without `--build` reapplied it). Fix: compose now MOUNTS the file into kong-config (`docker-compose.yaml`), so the declarative source is always current. Verified live: flipped `strip_path` to true → restore reconciled to false with NO rebuild; `/auth` 200 through the front door.
- [x] ~~Stack env durability~~ (08-30): README local-run section now names `.env-s2a-local` + the `--env-file` requirement (mismatched-env recreate incident referenced).
- [x] ~~Route-matrix list unrecorded~~ (08-30): authenticated matrix 14 routes — 11×200; 404s are non-existent bare paths only (`/api/service-categories` real path is `/api/services/categories` → 200; `/api/database/backup` and `/api/logger` bare paths undefined — subpaths only); `POST /api/auth/refresh-token` 400 = validation on route hit. Unauth matrix (F4): all protected 401.
- [ ] helm chart still pins PG13/15 (out of adoption scope — deliberate).
- [ ] `query-routes.js` factory builds on a module-level router: double registration if ever called twice (benign today — one call per process; tests isolate via `jest.resetModules`).
