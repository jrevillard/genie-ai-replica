# SUPERSEDED by sprint/plan.md — archived 09-26. Do not resume.

# PLAN.md — Agrivisory (product) on GenieAI 2.0.1 (framework)
> **READ FIRST every session. Working doc — DELETE when done.**
> Adem answers in-file (⏳ table). Claude proceeds only when the items above a ▶️ are settled.

## Frame
Agrivisory = product : agri frontend + its style, weather, Sesotho, farmer profiles, mobile, Keycloak-F5 auth, doc-repo, admin dashboard, RBAC, helm.
GenieAI = framework: overlay RAG services, compose structure, deploy tooling — take what we need, 2.0.1 now.
🔸 DECIDE (Adem picks) · ✏️ INPUT (Adem supplies) · ▶️ DO (Claude)

## Rules
- Ponytail mode, always: laziest working solution, shortest diff.
- Talk before changes; split steps freely; keep this file minimal.
- **Read PLAN.md at the start of every call; update it at the end of every call.**
- Code: very minimal comments. Few files/folders — reuse upstream's.
- Every step ends with: a test proving it works (prefer GenieAI's own tests), then a keep-or-drop decision.
- Branch `feature/2.0-upgrade`; main stays clean. **No pushes — work + test all local; push only when Adem says.**

## ⏳ WAITING ON ADEM
| # | Question | Answer |
|---|---|---|
| D1 | Approve adoption map? | implicit yes (no edits; object anytime) |
| D2 | Product services in generated compose? | all, selectable later |
| D3 | PG16 bump now? | yes — **ingestion + DB migration = LAST task of the whole project** |
| I1 | Target host? | placeholders |
| D5 | Image source? | works for both azure + local, ansible-switched ✔ (deploy_mode) |
| D6 | First GPU chat round-trip? | **No VM access now** — deferred ("pipe later"); no-LLM tests until then. ALSO: rotate the exposed VLLM bearer JWT when VMs return. **+ rotate (were git-committed): KC bootstrap admin (value redacted — in old git history; being discarded), Konga TOKEN_SECRET, kong/postgres (value redacted), KC DB (value redacted), kong DB role (md5 in old dump), legacy genie-ai-manager (value redacted).** |

## ⚠️ PROD-DEPLOY REQUIREMENTS (from local login fix, bfd46419/3a2c1734/26b5739d)
1. Set `VUE_APP_KEYCLOAK_IDP_HINT=itu-users` in prod env — restores seamless ITU IdP redirect (default now empty). ✔ wired in env.j2
2. ~~Strip dev seed users~~ ✔ DONE — realm file ships without users (26b5739d).
3. Fresh-prod keycloak needs realm-as-code: itu-users IdP broker + F5 BROKER_ID mapper (see S2 open items).
4. ~~Register/forgot env-switchable~~ ✔ DONE — `VUE_APP_REGISTRATION_URL` / `VUE_APP_PASSWORD_RESET_URL` (26b5739d).

## Steps
1. DEPLOY+LIBS — IN PROGRESS
   - a) adoption map ✔ (D1–I1 settled)
   - b) ▶️ ansible in, stripped, placeholder env ✔ **KEPT** (commit 1eb271e; test: syntax-check ×3 + var-merge green)
   - c–f) ▶️ merged execution ✔ **KEPT** — v2.0.1 compose+overlay+build-support adopted; deploy_mode local|swarm; keycloak = replica two-postgres (PG16, secrets via env); http-service behind `legacy-auth` profile; env.j2 §22 product vars; weather RAG re-ported (dataprep patch superseded by 2.0.1, kept docling fallback). Tests: syntax ×3 · env render both modes · compose config both modes · overlay pytest **648 passed**
2. BACKBONE — backend + RAG on 2.0.1; frontend API-compat + streaming UI. (queue DECIDEs when here)
3. SECURITY — sweep adopted framework code only (product code done: f7b7bce, 67a124c).
LAST. Re-ingestion + Postgres data migration (after everything else).

## Adoption map (D1)
| GenieAI 2.0.1 piece | Verdict |
|---|---|
| `deploy/ansible/` (docker + socket-proxy roles, deploy.yml, deploy-gpu.yml, templates, example inventory) | TAKE — minus gitlab-runner, minus ITU host vars/vaults |
| `genie-ai-overlay/` (8 service dirs + tests + build-patches + pyproject) | TAKE wholesale, then re-apply product patch on chatqna / api_protocol / dataprep |
| `docker-compose.yaml` + `docker-compose.gpu.yaml` + `env/env.t4` structure | TAKE as base; fold product services in |
| Version pins, Postgres 13→16 | TAKE |
| Their frontend · their login/auth · `_bmad*` · `site/` · CI/gitlab-runner · their agent configs · `test-results/` · `tools/` | NEVER (maybe use the tools) |

Product code adoption never touches: `components/`, `mobile/`, `helm/`, `infrastructure/`, `docs/`, repo meta.

## Log (newest last)
- **Review detail (both rounds: findings, credits, refutations, open items): [docs/review-log.md](docs/review-log.md)**
- 08-27: created; recon: upstream ships `deploy/ansible/`, replica none.
- 08-27: D1–I1 answered; rules set (ponytail / tests per step / minimal files & comments / ingestion last).
- 08-27: no-push rule set. S1b done+kept (1eb271e): 40-file tree → 19 files; runner+socket-proxy+ITU/cloud envs deleted; gpu group → gpu_api_nodes; placeholder env agrivisory. D5 queued (image source). README.md (780 L) still mentions runner — trim eventually.
- 08-27: D5 answered — deploy must work with local build AND Azure registry, ansible-switchable. Roadmap checklist added.
- 08-28: S1g README trim (b3473f7d). S1 COMPLETE.
- 08-28: S2a PASS — local `compose up` (project `agrivisory`, core, no GPU profiles): **11 healthchecked core services + 3 one-shot jobs (kong-migrations, kong-config, db-migrations) green** — earlier logged as "12 healthy", wrong count; front-door /api/health 200; keycloak+keycloak-db boot (realm provisioning pending = S2); NLLB CPU worker warmup ~9 min on first boot (inherent, T4 prod also CPU-translates). Fixes: frontend healthcheck /health→/ (9e0bf585). Note: first `up` had nginx blocked on unhealthy frontend — recreate after fix; old `genie-elsalvador-*` project still running on this machine (user may clean).
- 08-28: LOGIN FIX (3a2c1734) — was: login forced kc_idp_hint=itu-users + ITU registration link + hardcoded prod keycloak URL; no realm existed. Now: realm agrivisory imported (configs/keycloak/agrivisory-realm.json, --import-realm), IdP hint env-driven (VUE_APP_KEYCLOAK_IDP_HINT), frontend → https://localhost/auth, kong keycloak-route strip_path=false. Verified: realm 200 through nginx→kong→keycloak; auth endpoint renders form with PKCE enforced. Seeds: agrivisory-admin/agrivisory-admin, demo-farmer/demo-farmer (LOCAL DEV ONLY). OPEN (S2): backend↔keycloak user provisioning (Arango users vs realm users), F5 IdP mapper for prod, kong-config update-in-place semantics.

## Roadmap
**S1 DEPLOY+LIBS**
- [x] a) adoption map settled (D1–I1)
- [x] b) ansible tree in, stripped, placeholder env · syntax ×3 · KEPT (1eb271e)
- [x] c) image source switch local↔registry (deploy_mode) · env render both modes ✓
- [x] d) compose adopted + product services folded (keycloak two-PG, http-service legacy-auth profile, product env) · compose config both modes ✓
- [x] e) overlay 2.0.1 in + weather re-port (dataprep patch superseded) · pytest 648 ✓
- [x] f) PG16 + pins (in adopted compose) · compose config ✓
- [x] g) README trimmed — generic env examples + deploy_mode doc (b3473f7d)

**S2 BACKBONE**
- [x] a) local `compose up` core stack — 11 healthchecked + 3 one-shot jobs green · /api/health 200 via nginx→kong→backend · keycloak boots · doc-repo OK (fix: frontend healthcheck → `/`)
- [x] a2) HARDENING ✔ (26b5739d): register/forgot env knobs (VUE_APP_REGISTRATION_URL / VUE_APP_PASSWORD_RESET_URL, local defaults); realm file seed-free (fresh local setups use keycloak register link); deduped shadowed goToForgotPassword
- [x] a3) login→Arango bridge ✔ (332c6966) — JIT already existed; added 005-seed-admin (ADMIN_BOOTSTRAP_EMAIL email-link) + /api/me/context + realm/client fixes. Battery: admin→me 200 role Admin; demo-farmer→403 pendingApproval. GOTCHA (fixed): realm JSON's client defaultClientScopes omitted keycloak's 'basic' scope → access tokens had NO sub → every API call 401. Also: rendered env had KEYCLOAK_REALM=genie (re-render after vars change!).
- [x] a4) NO-LLM battery — **COMPLETE ✔** (see log 08-28): route matrix 13/14 · admin health 5 good + 4 graceful · jest 58/58 + 26/26 · **real dataprep pipeline E2E via mock inference (upload→ClamAV→doc-repo→dataprep→Arango chunks embedded→retriever returns them)** · mocks on host via host.docker.internal:host-gateway · key gotchas documented in commit
- [ ] b) GPU chat round-trip — **BLOCKED on VM access** (wire VLLM/TEI endpoints to T4 when available)
- [x] b) backend wired to 2.0.1 RAG endpoints · chat round-trip — via mock inference (107f2f7b); GPU variant = item above
- [x] c) frontend API-compat, style untouched · build + login + chat — S2c COMPLETE (107f2f7b): jest 57/57, 8/8 endpoints 200, chat round-trip API-level
- [x] d) streaming chat UI (cherry-pick) · SSE renders — S2d COMPLETE (a517ec09) + round-2 fixes (see log): SSE verified PROGRESSIVE through the full front door (nginx→kong→backend) with MOCK_SLOW; token-by-token per-chunk from chatqna is NOT possible (it aggregates the LLM stream and bursts — see log)
- [x] e) delete old files — DONE EARLY (08-28 review): t4/RTX6000 composes + env/env-T4/.env out (composes were broken on fresh clone, carried hardcoded KC admin password, README pointed users at them; README/GEMINI now point at docker-compose.yaml)

**S3 SECURITY**
- [x] sweep + checklist — **0 OPEN FINDINGS** ✔ (pass of 08-28, commit follows):
  1. secret files untracked (.env/env/env-T4/nginx certs) ✓
  2. known-committed creds absent from tracked files ✓ (this pass neutralized the last one: legacy genie-ai-manager password in install guide + http-service test.py → CHANGE_ME; ADD to D6 rotation list)
  3. compose: keycloak pinned 26.7.2, no KC_PROXY=edge, http-service 127.0.0.1 ✓ (arango 8529 host-publish kept deliberately — local tooling; firewall on deploy)
  4. kong admin (8001) not published ✓; cors entries disabled + asserted by upstream tests (kept deliberately)
  5. realm JSON ships no users, dev-scoped redirect URIs ✓
  6. ansible: no_log on secret tasks (7 sites), .env rendered 0600 ✓
  7. new S2 code: stream route emits literal errors (no internals), auth via router.use ✓
  8. env.j2 observability vars now render-safe (CHANGE_ME defaults in agrivisory vars — review's OPEN item closed)
  OUT-OF-SCOPE noted: helm chart PG13/15 pins (helm/ untouched by adoption); git HISTORY retains old secrets (accepted — private repo; rotate, see D6)

**LAST**
- [x] Postgres migration — **RUNBOOK REHEARSED + WRITTEN** ✔ (b50c2982): deploy/ansible/docs/pg-upgrade-runbook.md. Local rehearsal: PG13+PG15 seeded → dump → restore → kong+keycloak verified on PG16. Caught landmine: md5 hashes from PG13 rejected by PG16 scram → ALTER ROLE re-hash step. EXECUTION still needs the VM (real volumes).
- [ ] full re-ingestion of corpus (bge-m3 embedding change!)
- [ ] final validation + Adem's push call

- 08-28: ADVERSARIAL REVIEW (18-agent fleet + personal pass, 12 findings CONFIRMED / 0 refuted) → fixed in one commit: untracked api-gateway-solution/env + kong backup dumps (superuser md5 hash inside) + 227 graphify-out files (6.3MB); placeholder-ized real creds in 2 docs + old-config compose; deploy.yml 6 duplicate `when:` keys (local-mode post-deploy HUNG — last-key-wins killed the mode gates) + gpu-models profile now in shared _compose_profiles (swarm path + validation get it too, not just local up); grafana OAuth URLs got the /auth prefix; env.j2 realm/client fallbacks genie→agrivisory / genie-app→itu-agrivisory-client (same unify in compose defaults); mock-gpu /embed was OpenAI-envelope-on-TEI-path (wrong dialect) → now bare array + /v1/embeddings envelope added, binds 127.0.0.1, wiring recipe in docstring (smoke-tested); mimeTypeValidator got its first test (2 cases, 60/60 total, needed NODE_OPTIONS=--experimental-vm-modules for ESM dynamic import under jest) + stale "not used anywhere" header deleted. ROTATION list in D6 expanded. OPEN (from review, not fixed): env.j2 observability vars (GRAFANA_ADMIN_PASSWORD, KC_GRAFANA_CLIENT_SECRET, KONG_DB_PASSWORD) undefined → render empty when observability enabled; route-matrix 13/14 list never recorded (paste into log next run); helm chart still pins PG13/15 (out of adoption scope).

← **YOU ARE HERE: BMAD ADOPTED (f4f94ff1) — Epic 1 (cleanup: audit items a+b+c → stories 1.1-1.5) is next; then Epic 2 (rtx6000 install stories 2.1-2.7). Plan file: ~/.claude/plans/i-am-gonna-sak-swirling-lantern.md**

- 09-26: PULLED the 12 laptop commits (fast-forward → 0b12efb2; their doc-repo test script verified on Linux). BMAD v6.12 installed full (bmm/tea/cis/wds + Claude skills, mirrors upstream's _bmad/), audit inventory saved as _bmad-output/planning-artifacts/audit-vm-commits-2026-09.md (19 findings — headline: vllm_gpu_util wrong var = vLLM at 0.55 not 0.85; keycloak_public_key CHANGE_ME ships verbatim; deploy-gpu.yml missing NVIDIA fix), project-context.md written from the fork→now lessons. Decisions: rtx6000 FRESH install (no data migration), a10 deleted, full BMAD.

- 08-30: OPEN-ITEMS SWEEP (e855ed19) — kong-config drift ROOT-CAUSED: script's PUT-reconcile was always right; the IMAGE baked a stale pre-edit kong_config.json (compose run without --build reapplied it). Fix: compose MOUNTS the file (always current, no rebuild). Verified live true→false reconcile + /auth 200. Route matrix recorded (auth'd: 11×200, 404s = bare paths only; unauth from F4: 401s). README env-file note (.env-s2a-local + --env-file). Remaining review-log opens: D6 rotations (Adem, VM-day), helm PG pins (deliberate), router double-registration nit (benign).

- 08-29: REVIEW ROUND 2 (2b2e73ec..b50c2982, personal line-by-line) → fixes verified LIVE against the running stack:
  - **stream route dropped every b'...'-wrapped bare-text token** (JSON.parse threw → catch swallowed) and **dropped chatqna's {type:metadata} event** (source docs/confidence never reached the streaming UI). Both fixed in query-routes.js; locked by backend jest (3 tests, first backend suite — jest.config + shared-lib mock per doc-repo pattern). PROVEN via MOCK_SLOW front-door run: queryId +0.03s, 5 deltas +5.07s, done+metadata +5.08s (nginx→kong→backend progressive, no buffering).
  - **chatqna aggregates the LLM stream** — all tokens burst at once after generation ends (direct probe: 5 chunks × 1s all arrive together). "Token-by-token render arrives with real vLLM" is REFUTED for this chatqna; backend→browser legs stream fine. True token streaming = chatqna change, later if wanted.
  - M1: mid-stream error now shows error state (frontend onError + empty-bubble removal + backend `isAnswered: !!response`); M2: buildOpeaPayload now actually shared (classic path uses it; stale 'e2e-109-198' default → compose service name); disconnect abort uses res.on(close)+writableEnded (req.on(close) fires at body-consume — aborted every stream: my bug, caught by tests).
  - **FALSE FINDING retraced (M3)**: dataprep VLLM_API_KEY was already wired (compose line ~1115, F4 commit) — my review grep missed it. No change needed.
  - **kong-config drift bug CONFIRMED (was OPEN since S2)**: file says keycloak-route strip_path:false but restore re-created the route with true → /auth 404 through the gateway until manually patched. The restore script does not reconcile existing objects with the file. NEEDS a real fix (script or deck) — added below.
  - GOTCHA (ops): the live stack's env is **/tmp/env-s2a.env** (9-char ARANGO_PASSWORD; root .env has different values — using it recreates containers with mismatched secrets vs volumes). /tmp is volatile — move it to an untracked durable path before next recreate. Recovery from today's clash: restored with env-s2a.env, junk second project removed, kong route patched, all healthy again.
  - mock-gpu: MOCK_SLOW=1 mode (SSE chunks 1s apart) + front-door curl -N recipe in docstring; MOCK_HOST documented. Runbook: restore-errors caveat (role-exists expected). PLAN d) checkbox closed.
  - NEW OPEN: kong-config restore must honor the declarative file (strip_path etc.); stack env file durability; route-matrix 13/14 list still unrecorded (Adem: paste from terminal history).

- 08-28: S2d OPTION A COMPLETE (a517ec09) — SSE streaming wired E2E: backend `/api/queries/stream` (persist-up-front, normalize any upstream to {queryId}/{delta}/{done}, finalize+analytics), frontend streamingService (chunk-safe parser, fallback-before-first-event) + ChatBotComponent live bubble with silent fallback; 63/63 frontend tests; verified live through chatqna (its b'...'-wrapped non-stream bodies handled). Token-by-token RENDER arrives with real vLLM (S2b, VM-gated) — code path identical.

- 08-28: brief cut of the deck → docs/team-update-2026-08-28-brief.md — restructured per Adem: 3 workstreams (Deployment/RAG/Security) with changed+why+status each; ansible/installation-playbook angle on deployment; playbook listed under What's left (full 15-slide version stays)
- 08-28: team-update deck → docs/team-update-2026-08-28.md (v3, per Adem "first one was better"): v1 bones + ONE framing slide (job + selective merge compressed), pipeline proofs as arrow-diagrams with mocked legs marked, progress bars instead of checkbox lists, receipts slide (648/60/26/57/13-14/216k), review slide, what's-left, asks. Throwaway — delete after presenting.

- 08-28: S2c COMPLETE (107f2f7b) — frontend jest 57/57 · 8/8 API endpoints 200 with admin token · **full mock-backed chat round-trip**: POST /api/queries → backend → chatqna → embedding(mock) → retriever(REAL Arango maize chunks) → reranker(mock) → vLLM(mock) → response persisted. extra_hosts host.docker.internal added to embedding/chatqna/textgen/translation. Query body shape: {userId, sessionId, messages:[{role,content}]} (sessionId from POST /api/sessions).

- 08-28: F4 COMPLETE (9c533944) — real dataprep pipeline E2E via mock inference: upload→ClamAV→doc-repo→dataprep (chunk+BM25 labels+graph+mock embeddings)→Arango GRAPH_TEST_SOURCE (embedded:true)→retriever /v1/retrieval returns the maize chunk (note: v2.0.1 retriever = port 7000, path /v1/retrieval, body needs top-level text+embedding). Mock topology: host-run (MOCK_HOST=0.0.0.0) + host.docker.internal:host-gateway extra_hosts (in-container localhost never reaches host). Key wiring: VLLM_API_KEY non-empty (empty → 'Bearer ' illegal header) while OPENAI_API_KEY stays UNSET (truthy → vendored parent hits api.openai.com + crashes in its openai<1.0 except-path). F4 also fixed: doc-repo realm public key wiring; file-type fileTypeFromBuffer (real Phase-S bug, caught by battery).

**BMAD ADOPTION (09-26, f4f94ff1)**
- [x] pull 12 laptop commits (0b12efb2) + audit → planning artifact
- [x] install BMAD v6 full + project-context.md (fork→now lessons codified)
- [ ] **Epic 1 cleanup:** 1.1 delete a10 · 1.2 docs 3→1 (vm-deploy-runbook.md) · 1.3 rtx6000 vars fixes (vllm_gpu_utilization rename, keycloak_public_key assert, registry comment, FILL IN header, gitignore dupe) · 1.4 deploy-gpu NVIDIA parity · 1.5 placeholder-env decision
- [ ] **Epic 2 rtx6000 install:** 2.1 box preflight · 2.2 vars/vault (fresh secrets) · 2.3 deploy local mode opea+gpu-models · 2.4 health gate · 2.5 real-model chat (S2b) · 2.6 re-ingestion bge-m3 · 2.7 realm bring-up
