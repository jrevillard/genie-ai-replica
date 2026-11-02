# SPRINT — Auth Convergence + Production-Ready Deploy (rtx6000)

## BOOTSTRAP — READ THIS FIRST (fresh session: start here, nothing else needed)

You are working on **Agrivisory** (Lesotho agriculture advisory, ITU/BDT 9LES25007) built on
the **GenieAI framework**. Repo: `/home/adem/Desktop/Coding/genie-ai-replica-itu`, branch
`feature/2.0-upgrade`. First read `_bmad-output/project-context.md` (stack rules, gotchas,
anti-patterns — every rule there traces to a real incident).

- This `sprint/plan.md` **supersedes root PLAN.md** (archived in `sprint/attic/` — do not resume it).
- **GenieAI v2.0.1 is the permanent reference for EVERYTHING.** Pinned locally as tags
  `v2.0.1` / `upstream-v2.0.1` (remote `upstream`). Never vendor upstream files — port and
  attribute. Before adding/changing anything, check what upstream does:
  `git show upstream-v2.0.1:<path>` · `git diff upstream-v2.0.1...HEAD -- <path>`.
  Index: [sprint/reference/genieai-v201.md](reference/genieai-v201.md).
- **ASK-FIRST is law** (this may go to production with real users). Any irreversible or
  user-facing action needs a DECIDE entry answered by Adem in
  [sprint/decisions.md](decisions.md) §OPEN **before you act**. If it deletes data, deletes a
  component, changes login UX, touches certs/domains, or is user-visible — it is a DECIDE.
  Never resolve a DECIDE yourself; never infer silence as consent.
- **Silent fallbacks are bugs.** No CHANGE_ME/FILL-IN placeholder passes an assert. Preflight
  coherence checks fail loudly.
- Every story ends with its test gate green (§ Test gates) before it is done. Run the suites,
  don't assume.
- Ponytail mode (shortest working diff, fewest files) per project-context.md.
- **No commits or pushes without Adem's go.** Branch `feature/2.0-upgrade`; forward fixes
  only; one commit per story, path-scoped. Propose the commit/push moment, WAIT for the
  answer, then execute (S-11).
- Work order = § Epic order. Current state = § Status. Log your session at the end (§ Log).

## Status
| ID | Story | State | Gated by | Commit |
|---|---|---|---|---|
| C0 | sprint/ scaffold + PLAN.md retirement | **done** | — | (this commit) |
| A1 | upstream auth recon → reference §Auth | **done** | — | (this commit) |
| A2 | realm-as-code (genie-realm.yaml + config-cli) | **done** | DEC-2,4,5 ✔ | (this commit) |
| A3 | gateway/keycloak root-context flip | **done** | A2 ✔ | (this commit) |
| A4 | frontend oidc-client-ts swap + runtime config.js | **done** | DEC-3,11 ✔ | (this commit) |
| A5 | backend jose verifier + single middleware + iss_sub | **done** | — | (this commit) |
| A6 | JIT provisioning service | **done** | DEC-6 ✔ | (this commit) |
| A7 | auth cleanups + http-service deletion | **done** | DEC-7,8 ✔ | (this commit) |
| A8 | mobile impact audit | **done** | — | (this commit) |
| B1 | cert_mode decision point + preflight | **done** | DEC-1 ✔ | (this commit) |
| B2 | preflight coherence play | **done** | — | (this commit) |
| B3 | SSOT refactor (models/domain-derived/dead vars) | **done** | DEC-9 ✔ | (this commit) |
| B4 | docs/users.md | **done** | DEC-3 ✔ | (this commit) |
| B5 | rtx6000 vars hygiene + deploy-gpu NVIDIA parity | **done** | — | (this commit) |
| C1 | delete a10 env | **done** | — | (this commit) |
| C2 | 3 VM docs → docs/deploy-rtx6000.md | **done** | — | (this commit) |
| C3 | placeholder env fate | **done** | DEC-9 ✔ | (this commit) |
| D1 | rtx6000 preflight (B2+B1 plays) + config eyeball | **done** | gate green | (this commit) |
| D2 | deploy (+`admin_bootstrap_email` runbook) | **done** | D1 ✔ | (this commit) |
| D3 | auth E2E real domain (+sendVerifyEmail click-test) | **done*** | D2 ✔ | |
| D4 | real-model chat round-trip (granite) | **done** | D3 ✔ | |
| D5 | re-ingestion + retrieval checks (bge-m3) | blocked | F3 ✔ (D5 must not ingest before F3+F10) | |
| F1 | deploy provenance + coordinated recreate | doing (final fresh pass running) | DEC-17 ✔ | |
| F2 | bytes-repr wire format kill | **done*** (code+tests; live proof after F1) | — | |
| F3 | unblock D5 ingestion | todo | DEC-18 | |
| F4 | translation honest-or-running | todo | DEC-19 | |
| F5 | IDOR object-level authz | **done*** (code+tests; 2 residuals DEC-20) | — | |
| F6 | perimeter closures | partial (Arango bind landed; rotation DEC-21) | DEC-21 | |
| F7 | dashboard truth I | **done*** (code; live values after F1) | — | |
| F8 | dashboard truth II (admin actions) | todo | DEC-22 | |
| F9 | streaming chat integrity | **done*** (code+tests; Stop button + V6 residual open) | — | |
| F10 | graph protection (pre-D5) | todo | F3 ✔ | |
| F11 | API/data integrity | partial (escaper/CORS/emailNotice landed; filters open) | — | |
| F12 | chat UX polish + trust signals | partial (zoom/keys landed; cancel-wipe open) | — | |
| F13 | docs & config truth | todo (runs LAST) | DEC-23 | |
| F14 | translation model swap + pending-screen fix | partial: (b) done; (a) superseded by DEC-25 | DEC-24 | |
| F15 | NLLB-200-3.3B GPU translation sidecar | **done*** (code+tests; live probes after deploy — DEC-25) | DEC-25 ✔ | |
| G1 | deploy window completion (arango→playbook→nllb) | **done** (AUTH-OK; sidecar healthy; probes 200 both legs) | — | |
| G2 | language contract: English-response rule all sessions | **done*** (code+tests; live after deploy) | DEC-26 ✔ | |
| G3 | repetition params reach vLLM (fix drop + SSOT knob) | **done*** (code+tests; live after deploy) | — | |
| G4 | streaming degeneration guard | **done*** (code+tests; live after deploy) | — | |
| G5 | Sesotho parity live proof (Epic G DoD) | **done** (LIVE-VERIFIED with Adem 10-01: ST question → Sesotho translation of the EN refusal) | G1-G4 ✔ | |
| H1 | graph protection execution (F10) | **done*** (code+tests 716; live proofs ride H.2/H.3) | — | (this commit) |
| H2 | corpus ingestion run | blocked (corpus source — Adem) | H1 ✔ | |
| H3 | retrieval verification (BM25+vector) | todo | H2 ✔ | |
| H4 | grounded-answer live proof (10-01 scenario green) | todo | H3 ✔ | |
| I1 | kill/delete stuck-Ingesting docs (+boot reconciliation) | **done*** (code+tests 10-03; live after deploy) | — | |
| I2 | chunks inherit document label + same-crop extras (INTERIM) | **done** (LIVE-VERIFIED 10-04 with Adem: default on every chunk, same-crop extras kept) | — | (this commit) |
| I3 | chunk size 3000/300 + per-chunk file header (Category/Services) | **done** (LIVE-VERIFIED 10-04 Adem: "I3 worked") | — | bcdbe523 |
| I4 | related-documents sidebar + confidence render | **done** (LIVE-VERIFIED 10-04) | — | d84e62d4 |
| J1 | ST-mode answer parity with real corpus (Adem brings paired transcripts) | **done** (LIVE-VERIFIED 10-04: ST renders EN-shaped — root cause was the translation leg destroying markdown; NLLB wording quality = separate residual) | — | 29fc74dd |
| J2 | landing-page button chats always "no info" (investigate) | **done** (LIVE-VERIFIED 10-04 Adem) | DEC-27 ✔ | 279ef1fd |
| J3 | model prompts editable from UI (reference: main-branch commits) | **moved 10-05 → Epic K story K.2** (tracker sprint/plan_10_05.md, DEC-29) | DEC-29 ✔ | |
| K1 | settings foundation: file-registry mechanism (port + attribute) | **done*** (code+tests 777/259+harness; live proof landed with the K-window deploy) | DEC-29 ✔ | 78b0dcc2 |
| K2 | LLM prompts + gen params editable from UI (absorbs J.3) | **done** (LIVE-VERIFIED 10-05: panel prompt edit took effect on next chat) | DEC-29 ✔ | 78b0dcc2 |
| K3 | retriever + reranker tuning editable from UI | **done*** (code+tests 848/279/283; live proof in shared K-window) | DEC-29 ✔ | 78b0dcc2 |
| K0 | reranker-failure resilience: degrade + retry + JSON errors, not cascading 500 (live-found 10-05) | **done*** (code+tests 868+harness; DEC-25b vLLM 0.50 rides same window) | — | 5896a98e |
| K7 | conversation threading: always send conversation + 20-msg cap + multi-turn blend ON (trace-verified: frontend gated history on tree-selection) | **done** (LIVE-VERIFIED 10-07: follow-ups resolve CAMIX correctly) | — | |
| K4 | admin dashboard refresh (replace read-only AI card, staleness sweep) | todo | K2/K3 ✔ | |
| K5 | thinking spinner (port 89f9bdbe+0e6f8bd8) | todo | — | |
| K6 | notification banner fix (port 8f525259; verify ours first) | todo | — | |
| L1 | one brand logo (remove ITU+FAO+app-icon trio; Adem's asset) | todo | — | |
| L2 | login page look (port from main; Keycloak-hosted reality — verify w/ Adem) | todo | — | |
| L3 | pending screen (port LSO repo 6b6829b9, feature/landing-polish) | todo | — | |
| L4 | color theme, light default (collaborative; palette in webpage assets) | todo | — | |
| L5 | admin fixes: active translation model shown + Pipeline Settings UI | todo | — | |
| J4 | quick-help buttons: hierarchy set + admin CRUD/order/enable (DEC-28) | **done** (LIVE-VERIFIED 10-04: EN/ST buttons, admin CRUD, ST drafts editable) | DEC-28 ✔ | 279ef1fd |

## Epic order
C0 ✔ → A1-A8 ✔ → B1-B5 ✔ → C1 ✔ → C2 ✔ → C3 ✔ → D1 ✔ → D2 ✔ → D3 ✔ → D4 ✔ (+D4b) → **F** (hardening) → **G ✔** → **H** (ingestion; H2 gated on Adem's corpus) → **I ✔** (post-first-ingest fixes I1-I4 — complete 10-04) → D5 → F13 → **J ✔** (J1/J2/J4 done+live; J3 moved into K) → **K** (pipeline settings & operability K1-K6; tracker plan_10_05.md) → **L** (frontend identity & polish L1-L5; tracker plan_frontend.md — new session, skills note inside)
Wave-1 of F is code-complete-but-undeployed; D5 is gated behind F3+F10 (embedding-poison guard).

## Critical path — what to do in what order, and what is holding what
**ONE rule: everything below is blocked on Adem's answers. Code is ready; decisions aren't.**

0. ~~**URGENT (DEC-24, 09-30)**~~ — (a) translation model swap: SUPERSEDED by DEC-25 —
   AfriSLM hung like gemma (F14 verdict); F15 landed facebook/nllb-200-3.3B on the
   `nllb-translate` sidecar (code+tests done, deploys per deploy-rtx6000.md §8.1);
   (b) pending-screen "Back to Login" fix: DONE (09-30).

1. **NOW — answer DEC-17** (one line in decisions.md §OPEN) → unblocks **F1: the single coordinated
   recreate**. That one redeploy window carries EVERYTHING currently sitting code-done-but-not-live:
   wave-1 (F2 bytes-repr decoder, F5 IDOR guards, F7 dashboard truth, F9 streaming integrity, F11 escaper),
   **D4b** (boot resilience: worker respawn, model-cache volume, TranslationService-optional, kong-restart
   task, smoke timing), and **F6's Arango loopback bind**. Note: F1's "d4-fix never deployed" premise is
   STALE (d4-fix verified live 09-29 — chat works); the recreate is still needed for the above.
   *Holding it: DEC-17 (you).*
2. **In the same window — live proofs**: chat round-trip with clean text (F2), non-admin IDOR probe (F5),
   admin dashboard real values (F7), port 8529 closed from outside (F6), first-boot model-cache populate
   (D4b). *Holding it: the recreate (step 1).*
3. **URGENT-SOON — DEC-21** (rotation): Arango was internet-facing (auth-on, plaintext) until the bind
   lands; rotate ARANGO_PASSWORD + review 8529 logs for foreign IPs during the window. *Holding it: you.*
4. **F3 (DEC-18: dataprep callback auth) → F10 (graph protection) → D5 (re-ingestion)** — the path to
   grounded, cited answers (the "not great" chat closes here). D5 MUST NOT ingest before F3+F10
   (wrong-dimension vectors are persistent poison). *Holding it: DEC-18 (you).*
5. **F4 (DEC-19: is Sesotho a must?)** — can run parallel to step 4; decides gemma-translation vs
   English-with-notice. *Holding it: DEC-19 (you).*
6. **F5 close-out (DEC-20: check-email oracle deletion + AI-Engineer role)** — small, after the probes.
7. **F8 (DEC-22: backup mechanism — decide AFTER F6's bind is live) → F11/F12 remainders → F13 (DEC-23:
   GRAPH flip timing — runs LAST, pulls final numbers into docs).**
8. **Post-D follow-ups (no blockers, queue at will):** DEC-15 swarm+Azure epic ·
   DEC-13 un-reject button · mobile flutter_appauth migration · branding.
Stories verbatim: [epic-a](epics/epic-a-auth-convergence.md) ·
[epic-b](epics/epic-b-deploy-ux.md) · [epic-c](epics/epic-c-cleanup.md) ·
[epic-d](epics/epic-d-rtx6000-install.md) ·
[epic-f](epics/epic-f-hardening.md)

## DECIDE registry (mirror — ledger of record: decisions.md)
DEC-1..DEC-12 **ALL SETTLED** — answers + rationale in [decisions.md](decisions.md) §SETTLED.
**DEC-1 SETTLED 09-27:** cert_mode=letsencrypt · domain=**agriconnect.site** (DNS already →
box, ports 80/443 verified open, IP stable) · certbot_email ***REMOVED***
(placeholder-by-choice, will change later — zero-cost). rtx6000 vars updated; localhost
swept. B1 unblocked.
**DEC-7 OUTCOME (A8, 09-27): mobile BROKEN — never on Keycloak; speaks the deleted legacy
protocol (auth_proxy/user_service/password_proxy → auth/login, auth/refresh-token, auth/me,
auth/register, reset-password*, verify-email; api_service.dart:10 hardcodes the stale
genie-ai.itu.int base) → 401 on every request post-A5/A7; no sessions calls (zero debt there);
no ACCOUNT_PENDING handling. Follow-up fix = flutter_appauth migration (PKCE S256, scheme
callback, secure storage, pending screens) — filed, NOT a deploy blocker. Evidence:
epic-a §A8 findings.**
**LEDGER CLEAR (09-28):** zero OPEN DECIDEs. **DEC-13 SETTLED 09-27:** reject not terminal —
flip-back route + admin button filed as follow-up. **DEC-14 SETTLED 09-27:** www included in
the LE cert (`-d agriconnect.site -d www.agriconnect.site` in the certbot entrypoint); no
redirect needed (`server_name _`); D3 smoke hits both names. **DEC-15 SETTLED 09-28:** target
architecture = swarm + Azure; sequencing = D2 deploys rehearsed LOCAL mode first, swarm = post-D
epic (ACR + build pipeline + deploy.yml Azure rework + stack re-deploy — see §Follow-ups);
amends DEC-9's "local" from permanent to first-stage. **DEC-16 SETTLED 09-28, SUPERSEDED 09-30:**
system email moved off the personal Gmail relay to DreamHost domain mail — sender `noreply@agriconnect.site`
(smtp.dreamhost.com:587 STARTTLS, mailbox creds in vault, SPF on the domain); DEC-16-R resolved
without a sending service.
**LEDGER CLEAR AGAIN (09-29): DEC-17..23 ALL SETTLED with Adem.** DEC-17 recreate window
APPROVED (conditional on staleness one-liners; DEC-21 rotation rides same window) · DEC-18
dataprep = service-account client (realm slot exists; wire in F3) · DEC-19 Sesotho primary +
interim notice, better-translation-model reminder = DEC-19-R in §Follow-ups · DEC-20 oracle
BLIND (not deleted) + AI-Engineer tabs hidden · DEC-21 rotate-with-F1 + 8529 log review ·
DEC-22 arangodump in backend image (lands after F6 bind) · DEC-23 clean GRAPH flip before D5,
pilot data disposable. F1 is now fully ungated.

## Follow-ups (walk one by one)
Each item also lives in its home artifact; this list is the index Adem works through:
- **DEC-16-R — professional email sender** · home: [decisions.md](decisions.md) §SETTLED DEC-16 + deferred-work.md · swap Gmail relay for Brevo/SendGrid free tier: 4 vault lines + email_from → noreply@agriconnect.site + SPF/DKIM records on agriconnect.site DNS (~15 min; Adem owns the DNS panel).
- **DEC-19-R — better translation model** · home: [decisions.md](decisions.md) §SETTLED DEC-19 · Adem: "on this item we will use a better model" — when F4/model choice starts, surface options (larger gemma vs NLLB-distilled vs other) for his pick BEFORE finalizing the translation path. REMINDER HOOK: fire at F4 kickoff.
- **DEC-13 implementation — un-reject flip-back** · home: needs one (backend route + admin-UI button; DEC-13 settled "not terminal" 09-27) · small story, whenever prioritized.
- ~~**rtx6000 SSH access from this machine**~~ · **DONE 09-28**: key generated here (`adem@archlinux`), authorized from the laptop, verified (`ok from jl-vm-511428`). Recon bycatch: hostname jl-vm-511428 (kills the vars.yml TODO); GPU live: RTX PRO 6000 Blackwell, driver 595.58.03, 96 GB.
- **DEC-15 — swarm migration epic (post-D)** · home: [decisions.md](decisions.md) §SETTLED DEC-15 · target = swarm + Azure. Work breakdown: (1) Azure Container Registry; (2) build+push for product images (Azure Pipelines or on-box script — stack deploy cannot build); (3) deploy.yml swarm-path rework: `/-/raw/` template (~:241, ~:289) → Azure items-API URL + PAT header, stale GitLab comments :235-236; (4) `docker stack` re-deploy of the live local stack (brief downtime, planned). Repo swap later = repo_url/repo_branch vars + registry token in vault. Spin as epic-e when D closes.
- **D2 runbook — set `admin_bootstrap_email`** · home: [epic-d D2](epics/epic-d-rtx6000-install.md) · unset = first admin lands Pending (chicken-and-egg; 005-seed is the bypass).
- **D3 checklist — live sendVerifyEmail click-test** · home: [epic-d D3](epics/epic-d-rtx6000-install.md) · only A6 proxy call never live-tested (smoke had no SMTP); KC 400 → add client_id/redirect_uri.
- **Backup automation (audit F8/critic)** · home: [epic-f F8](epics/epic-f-hardening.md) · `database_backups/` dir exists with NO writer; no restore path; needs owner + mechanism (DEC-22).
- **Monitoring owner (audit critic)** · home: needs a decision · ITU SharePoint monitor targets the retired agrivisory.itu.int; observability stack unenableable on this branch (configs dropped); currently NOTHING watches the box.
- **Backend Arango 'default' handle unauthorized (10-03 find)** · home: needs triage · backend logs `[DB_TEST] Connection test failed for default: not authorized` hourly (318/24h) — some backend Arango connection still uses pre-DEC-21-rotation creds (doc-repo's test passes; reads 200). Trace which service/handle ('default' db) before H2 ingestion writes depend on it.
- **Concurrency/capacity sweep R8** · home: audit report open-questions · rate-limit-killed twice overnight; sizes what N simultaneous farmers do to one 0.85 GPU slice.
- **A7 sweep additions** · home: [epic-a A7](epics/epic-a-auth-convergence.md) · dead frontend auth methods + stale dist/ + EMAIL_PASSWORD env scrub (real fix = DEC-10 rotation).
- **EMAIL_PASSWORD plaintext in tracked backend env** · home: deferred-work.md (A5 flag) · pre-existing git-history exposure; DEC-10 rotates at install; scrub rides with A7.
- **Mobile Keycloak migration (DEC-7 follow-up fix)** · home: deferred-work.md (A8) · mobile speaks the deleted legacy protocol → 401 on everything; fix = flutter_appauth + PKCE S256 + pending screens; realm client already provisioned; NOT a deploy blocker.
**Rule:** a story with an unresolved DECIDE cannot leave "doing"; D never starts with an OPEN
DECIDE that blocks it.

## BMAD links
| Sprint artifact | _bmad-output/ counterpart |
|---|---|
| epics/*.md (stories) | _bmad-output/planning-artifacts/ (as produced) |
| audit-vm-commits | planning-artifacts/audit-vm-commits-2026-09.md ✔ |
| auth-port sweep (A1 exit) | test-artifacts/auth-port-sweep.md ✔ |
| project rules | project-context.md ✔ |
| epic-f (night-audit hardening) | test-artifacts/d4-night-audit.md ✔ (+ machine artifacts `d4-night-audit-machine/`, context card `implementation-artifacts/epic-F-context.md`) |
| per-epic review outputs | test-artifacts/epic-X-review.md (to come) |

## Test gates
overlay pytest (`cd genie-ai-overlay && pytest`, expect 648) · doc-repo `npm test` (60) ·
frontend `npm test` (**228** after A7) ·
`components/gov-chat-frontend/test-runtime-config.sh` (A4 standing gate) ·
backend `npm test` (**168** after A7; needs `NODE_OPTIONS=--experimental-vm-modules`) ·
doc-repo `npm test` (**86** after A5; same flag) ·
kong-config jest **34** (grew in A3: flip pinned) ·
`configs/keycloak/test-realm-contract.sh` (A2 standing gate) · `docker compose config` both modes after
compose/template touches · `ansible-playbook --syntax-check` per remaining inventory (×2 post-C1) + deploy-gpu + `--check` dry-run after
ansible touches · live front-door checks for auth stories (well-known 200, login round-trip,
401 recovery).

## Workflows (run at defined exits)
A1 exit: auth-port verification sweep (agent per auth leg vs upstream diff) →
`_bmad-output/test-artifacts/auth-port-sweep.md`. Per-epic close: adversarial review, 3 lenses
(silent-fallback / security / upstream-drift) → `test-artifacts/epic-X-review.md`. B2 exit:
red-team preflight (plant bad vars, all must be caught). Pre-D: consolidated pass/fail table.

## Log (newest last)

- 10-19: **EPIC N OPENED — RAG eval toolchain: RAGAS + parameter selection
  (tracker sprint/plan_10_17.md, Adem ask: port upstream's rag-benchmarks/eval
  so we can measure RAG quality and choose RAG parameters with evidence; no
  CI in this epic).** Recon done 10-19 (upstream `main` via shallow fetch):
  gold→anchor→RAGAS toolchain in `tests/rag-benchmarks/eval/` + the parameter
  chooser (`calibrate.py` offline sweep: CONTEXT_DECAY_FACTOR × confusion ×
  MIN_VALUE_THRESHOLD, F1-ranked; async `run_rag_config_test_async.py` live
  grid; `enrich_xlsx_v2` Compare/Calibrate tabs). Local `tests/` has only the
  OLD sync sweep; overlay already has all tuned knobs (grep-verified). Stories
  N.1–N.7 + LAST; DEC-36 (gold corpus — same act names H2's corpus), DEC-37
  (retire stale sync sweep), DEC-38 (RAGAS judge endpoint) — all three
  ANSWERED 10-19 (see decisions.md): xlsx from Adem, delete+port, granite.

- 10-08: **L.2 CLOSED — login page live (Adem confirmed) + the theme-staleness
  mystery root-caused by a 6-agent source-level workflow.** The fix that
  worked: `docker exec agrivisory-app-keycloak-1 rm -rf
  /opt/keycloak/data/tmp/kc-gzip-cache` (zero downtime). Truth (KC 26.7.2
  source-verified): theme css reads live from the mount per request; the
  stale layer is a no-freshness-check GZIP DISK CACHE in the container
  writable layer (survives docker restart); the /resources/<hash>/ URL hash
  is KC's DB migration id (never content-derived); browsers cache 30 days;
  curl lies (no gzip). Runbook row: docs/deploy-rtx6000.md §10; memory
  keycloak-theme-caching; plan_frontend lessons corrected. Epic L fully
  closed except L.4 (theme/light-default).

- 10-07: **EPIC M OPENED — user-facing UI simplification (tracker
  sprint/plan_10_07.md, Adem's 3 items): M.1 separate/simplified UI for
  regular users (kill right bars + top bar for farmers) · M.2 farmer-profile
  grey map (blocked on his screenshot) · M.3 chat-output formatting +
  conciseness.** Suggested order M.2 → M.1 → M.3. Epic L state unchanged:
  L.2 = one docker-restart-from-done, L.4 still open (plan_frontend.md).

- 10-06/07: **EPIC L EXECUTED (L-session; full record: plan_frontend.md +
  spec-l* files). L.5 part1+2 ✓live** (active-translation card, readiness-
  keyed; prompt textareas full-width — root cause: ZERO css for textareas,
  intrinsic 20-col boxes). **L.1 ✓live** (shield logo, DEC-31; review
  caught the Huduma fallback rebrand + broken-img glyph). **L.3 ✓live**
  (Keletso pending-screen port bf57593f+6b6829b9, lineage-verified; F14b
  kept). **Keletso landing work ✓live** (hero WIRED by us — their branch
  shipped it unwired; 8 Basotho icons mapped to DEC-28 _keys; mascot
  removed at Adem's call; their a39b1d4c ChatHistoryComponent overwrite
  REJECTED — teammate to revert on LSO; st keys owed by Keletso).
  **L.2 saga:** v1 (main-look wrapper+KC theme) REVERTED by Adem → v2
  wrapper (Keletso-style, DEC-32b) ✓live → KC theme iterated LIVE 4 rounds
  (DEC-32c/32d: logo→no-logo→side-brand→**card-only final**; css pushed
  4af61447, verified on box disk 4679B; LAST STEP = docker restart the
  REAL keycloak container name — KC caches theme css per boot, earlier
  restart hit a nonexistent name; then private-window check). **K.9 filed**
  (app oversized at 100% zoom, "perfect at 67%"; global zoom 0.7 shipped+
  reverted same day at Adem's call; per-surface sizing pass, plan_10_05).
  Durable lessons → plan_frontend.md §Session lessons + project-context.md
  (vue-cli build gate for css stories — L.2 deploy died on css-loader
  url() while jest stayed green) + memory (keycloak theme cache). Commits
  this session: 3258b05d 711e0990 c17c4908 e9bf117d e56d9f68 d37d927b
  7771f301 8ea93ce5 e9dde400 c67d6cae b11f94c4 9a95a456 4af61447 (all
  pushed). L.4 = last open story.

- 09-30: EMAIL SAGA (logged late — BMAD drift corrected per Adem): Adem switched SMTP to Dreamhost
  (noreply@agriconnect.site, DEC-16-R landed early — backend approval/notify emails WORK live).
  Keycloak verify-email failed: (1) my kcadm --fields reads returned {} for a POPULATED map —
  tooling artifact, cost two wrong "not saved" verdicts (full-realm fetch is the reliable read);
  (2) real failure = Java(angus-mail) "Password based SMTP connect failed" on 587+STARTTLS —
  config/creds/network all proven good (Node backend sends through the same mailbox; TCP+DNS fine
  from the KC container). Suspect: Java TLS handling of the STARTTLS upgrade. 465/SSL try PARKED
  per Adem. INTERIM TEST (Adem's call): realm verify-email OFF — register → Pending → notify →
  approve → approval email, all backend-email legs. Also: "page has expired" = stale KC auth
  session tab (fresh/incognito fixes). Frontend fix+redesign for the pending screen (2d7cc27a +
  88ce400f) still NOT deployed — rides the next frontend deploy. F5-residuals spec approved but
  implementation pending (rate-limited classifier interrupted the edit).

- 09-26: C0 done — sprint/ scaffolded from 2 recon scouts + design agent (auth deep-dive map,
  deploy-UX audit w/ 19-finding prior audit). DEC-1..10 seeded OPEN. PLAN.md → attic (secrets
  sanitized). Fresh sessions start at this BOOTSTRAP block.
- 09-26: DEC-1..DEC-10 answered with Adem. DEC-2..DEC-10 SETTLED: pure-local users, no ITU
  brokering · open self-reg + Pending + auto first admin from vault · access 300s + SSO 8h/12h ·
  stock theme (branding follow-up) · legacy-data discard confirmed · mobile audit-first,
  break→follow-up · http-service deletion confirmed · granite + local build, one-place model
  switching via B3 · rotate-at-install (D2). DEC-1 HALF-OPEN: cert_mode=letsencrypt chosen;
  FQDN + certbot email still pending → B1 and all of D remain gated by DEC-1 (correction of
  earlier "all settled" note — ledger question bundles cert_mode + domain).
- 09-26: A1 done — 12-gap map in reference §Auth (upstream path + local target + note each),
  verified by 3-agent sweep (frontend/backend/realm-deploy); corrections + net-new finds applied.
  Key flags for downstream: A3 front-door AC must use `/auth/realms/…` (no root route);
  A4 storage = sessionStorage defaults upstream (memory-only is aspirational) — pick
  InMemoryWebStorage or amend AC; A2 must create all 5 realm clients (grafana/mobile wiring
  already exists) + delete env.j2 IdP vars; local kong double-/auth hazard today (transformer
  + KC_HTTP_RELATIVE_PATH both live) — A3 flip fixes. Sweep: test-artifacts/auth-port-sweep.md.
- 09-26: A2 done via bmad-build (spec-a2-realm-as-code.md, status done). genie-realm.yaml +
  config-cli sidecar + keycloak root context + agrivisory-realm.json deleted + env.j2 IdP/redirect
  vars gone + SSO knobs (DEC-4). 3-layer review: 12 patches applied + re-verified (incl. admin
  emailVerified hardening, grafana-secret asserts, committed test-realm-contract.sh — new
  standing gate), 4 deferrals filed (A3 owns internal /auth repoint incl. grafana URLs
  :1795-1796; IMPORT_CACHE rotation semantics settle at D2; Sesotho locale → branding;
  plain-http dev → A4 gate), DEC-12 opened (remember-me dropped, non-blocking). Live smoke:
  realm applied, 7 clients, knobs live, well-known 200 root context, assert path proven.
  Upstream bugs found: config-and-sleep eval no-op assert (fixed, worth reporting upstream),
  raw-text $(env:) substitution trap in comments. Next: A3.
- 09-26: A3 done via bmad-build (spec-a3-gateway-root-context.md, status done). Kong keycloak-route
  strip_path:true (transformer kept — public URLs keep /auth), dead auth-login/refresh routes
  deleted from BOTH kong configs + de-fanged from manage-kong-config.sh (was PUT-resurrecting
  them); all internal /auth URLs repointed (backend/dataprep/chatqna/grafana) + two dies-in-A5
  stopgaps (KEYCLOAK_JWKS_URI, KEYCLOAK_TOKEN_URL — legacy code defaults would have 404'd).
  Live front-door proven: well-known 200 via kong, issuer single-/auth, jwks 200, deleted routes
  404-by-name; nginx template confirmed routing /auth→kong (smoke = front-door-faithful).
  Adem amended the frozen login-route matrix row (fallthrough, not 404 — recorded in spec
  change log). Review pass 1: 5 patches (incl. kong jest suite now PINS the flip — 26→34, hub
  gate updated), 4 evidence-backed rejections, 2 deferrals (stale nginx/kong artifacts cleanup;
  in-place kong restore never deletes absent routes → upgrade runbook note). DEC-11 still gates
  A4; A5 unblocked next (A4 needs DEC-11 answered first).
- 09-26: A4 done via bmad-build (spec-a4-frontend-oidc-swap.md, status done; net −4.6k lines).
  oidc-client-ts swap complete: oidcConfig + 218L UserManager service + claims Vuex (+user getter,
  fixes latent WeatherPanel bug) + /callback + guard; httpService 401→signinSilent retry-once
  (single-flight); ALL legacy screens/services/routes deleted (grep 0); runtime config.js via
  entrypoint (realm default agrivisory — real catch: upstream defaults genie + never feeds realm);
  Dockerfile → nginx runtime shape (+.dockerignore, single-node mirrored). DEC-11 pinned by
  exact-shape config test (no userStore override). Suite 63→224 (upstream auth suite ported,
  REAL router + mounted CallbackView tests). Review pass 1: 18 patches (nginx /config.js no-cache
  was the topper — immutable-1yr cache would've frozen runtime config; 3 legacy localStorage
  readers fixed: streamingService/FileDetailsDialog/AdminDashboard; pending-approval screen
  repointed, trigger → A6; CallbackView structured error per frozen matrix; entrypoint hardened:
  // reject, quote-injection reject). New standing gate: test-runtime-config.sh. Wire-level:
  authorize redirect proven vs real KC. Full browser round-trip lands with A5/A6 (backend legacy
  interim). Deferred: post-logout listener question, dev-serve flow note. Next: A5.
- 09-26: A5 done via bmad-build (spec-a5-backend-verifier.md, status done). Backend + doc-repo
  converged: jose verifier (public-door discovery, 5-min JWKS cache, forceRefresh 2-attempt),
  single global middleware (PUBLIC_PATHS query-proof, req.user/req.claims, requireAdmin),
  user-provisioning-service ported verbatim (A6 layers product deltas), logout-only authController
  (sessions bound to iss_sub), identity iss_sub (004 strips keycloakId; 002 index pre-existing).
  Deleted: dual-alg middleware (13 route imports), password-grant proxy, auth-service, doc-repo
  HS256+RS256 fallback verifier, jsonwebtoken+jwks-rsa+bcrypt deps, itu.int fallbacks, A3
  stopgaps. Review pass 1: 13 patches — headline: 3 dead admin gates (req.user.role scalar),
  SSRF gate on expired-token UserInfo probe (upstream bug), query-string PUBLIC_PATHS 401s,
  503 outage semantics, JIT_PROTECTED_FIELDS strip port, doc-repo role lists → ['Admin'],
  sessions bound to req.user.iss_sub. 4 new suites pin the security property (mounted 401,
  provisioning AQL, logout, me-context). Backend 3→108, doc-repo 60→86; kong pins updated
  (stopgap retirement = designed trigger). Live smoke: client_credentials token via kong door
  → 200+provisioning; garbage/expired 401; non-admin 403; doc-repo same. A6 scope expanded
  (email-change flow, force-logout revocation, Pending gating, pending-approval trigger,
  admin-notify). FLAGGED: committed backend env file has plaintext EMAIL_PASSWORD (pre-existing;
  DEC-10 rotates; scrub filed). Next: A6.
- 09-27: A6 done via bmad-build (spec-a6-jit-provisioning.md, status done). Pending/approval lifecycle live: JIT
  provision writes status Pending (USER_APPROVAL_REQUIRED knob, 'True'-bool hardened) + profile stubs + fire-and-forget
  admin-notify (lookup fixed to roles array); middleware gate Pending→403 ACCOUNT_PENDING, Rejected/disabled→403;
  frontend httpService redirects any ACCOUNT_PENDING to the existing /pending-approval screen (dynamic import, no
  module cycle). keycloak-proxy-service ported (upstream deleteUser/updateOwnProfile + 4 marked local extensions:
  assign/removeRealmRole, revokeUserSessions, sendVerifyEmail — KC-26-corrected endpoints from live smoke: POST
  /logout, POST role-mappings). Approve-as-Admin syncs the realm role BEFORE the doc write (role lands on next token,
  AC proven live); email-change via KC Account API; force-logout = real KC revocation + iss_sub sweep bug fix; GDPR
  delete = KC user + files + PII nullify. Admin queue/approve/reject endpoints already existed — A6 made them feed
  from JIT provisioning. Review pass 1: 16 patches (erasure completeness ×3, reject revocation, SMTP-non-blocking,
  KC 401/403→502 loop fix, env validation, 3 regression tests incl. the self-approve strip pin), 3 defers (sendVerifyEmail
  redirect params → D2; un-reject product question; A7 dead-frontend-method sweep). FALSE-finding corrected: first-admin
  "chicken-and-egg" was the smoke stack missing ADMIN_BOOTSTRAP_EMAIL — 005-seed IS the bypass (status Active + now
  roles:['admin']); D2 RUNBOOK: set ADMIN_BOOTSTRAP_EMAIL or first admin lands Pending. Backend 108→164, frontend
  224→227. Live smoke: 403 ACCOUNT_PENDING on first token → approve → same-token 200 (evict proven); Admin approve →
  realm admin in next token; force-logout → refresh 400; delete → KC user gone + PII nullified. Next: B5.
- 09-27 (post-A6, per Adem): epic order → strict one-by-one (A7 next; B5 back to numeric slot —
  its post-A6 placement was a planning interleave, no dependency). A6 follow-ups separated into
  §Follow-ups (one line each): DEC-13 un-reject question opened in decisions.md; ADMIN_BOOTSTRAP_EMAIL
  runbook comment added to epic-d D2; sendVerifyEmail live click-test added to epic-d D3 checklist;
  A7 sweep scope extended (dead frontend auth methods, dist/, EMAIL_PASSWORD scrub). plan/epics/
  decisions edits uncommitted — ride with A7's story commit or a chore commit at Adem's call.
- 09-27: A7 done via bmad-build (spec-a7-auth-cleanups.md, status done; 48+ files, +~350/−3.7k).
  Sweep: GET_AUTH_TOKEN_URL/KEYCLOAK_PUBLIC_KEY/KEYCLOAK_CLIENT_SECRET/VUE_APP_IDP_HINT (+REGISTRATION/
  PASSWORD_RESET_URL, AUTH_SERVICE_*, env.j2 JWT_SECRET) = 0 across AC roots — sole sanctioned grep hit is
  teardown's own `docker rm -f http-service` migration guard (pre-A7 stacks orphan the :6666 container
  otherwise). http-service fully deleted (overlay dir incl. hardcoded-creds test.py, compose block,
  legacy-auth profile, README/guide/UNICC doc trees, legacy chatqna test script). userService.js 675→~60L
  (per-method zero-consumer grep gate); UserEditDialog password-reset button gone (was 404ing; DEC-3),
  force-logout button un-deadened (accessToken-never-exists disabled state); 3 inert tracked env files +
  20 tracked dist/ files untracked (gitignore `components/*/env`); migration 004 stops stripping the
  A6-live loginName/role. ONE addition: GET /api/me (whitelisted req.user) restores the 3 identity
  screens left 404ing by A5 — Settings/UserProfile/ChatFolders; getCurrentUserInfo repointed + pinned.
  Review pass 1: 14 patches (headline: Settings id-chain never read _key — found by all 3 layers;
  plus migration-004 live-field conflict, JWT_SECRET env.j2 block, README wrong client name, test pins);
  3 defers (helm/property-tests http-service convergence, history-secrets → DEC-10 checklist, dev .env
  template → C2). Counts: overlay 648 ✓✓, backend 164→168, frontend 227→228; compose both modes;
  ansible ×3. DEC-7 settles at A8 (next). Epic order note: this commit also carries the 09-27 sprint
  bookkeeping (strict one-by-one reorder, D1–D5 split, §Follow-ups, DEC-13).
- 09-27: A8 done (direct audit, A1 pattern — no code). VERDICT: mobile BROKEN, follow-up fix, not a
  deploy blocker (DEC-7's contingency branch — the expected "Keycloak AppAuth → unaffected" was wrong).
  mobile/genie_ai_mobile is a live, maintained Flutter app that was NEVER on Keycloak: it speaks the
  deleted legacy local-credential protocol (auth/login {loginName,encPassword} etc. via auth_proxy/
  user_service/password_proxy), hardcodes the stale genie-ai.itu.int base, and 401s on EVERY request
  post-A5/A7 (global gate; no guest path). No sessions calls (A5 contract change = zero mobile debt);
  no ACCOUNT_PENDING handling. Realm mobile client already provisioned (public + PKCE S256 + scheme
  callback) — ready for the migration that doesn't exist yet; mobile README still documents legacy
  flows (doc gap). Findings + grep evidence: epic-a §A8; DEC-7 outcome recorded in decisions.md +
  §DECIDE registry; follow-up fix (flutter_appauth migration) filed in deferred-work + §Follow-ups.
  **EPIC A COMPLETE (A1–A8).** Next: B1 — which forces DEC-1's pending half (FQDN + certbot email);
  Adem to bring both when B1 starts.
- 09-27: B1 done via bmad-build (spec-b1-cert-mode-preflight.md, status done; DEC-1 settled same day —
  letsencrypt · agriconnect.site · certbot email; Adem's rtx6000 vars edits ride in this commit). cert_mode
  decision point live: one var (letsencrypt|provided|selfsigned) replaces self_signed_certs (deprecation
  guard fails loud if the old var lingers); tasks/preflight-cert.yml runs tags:always BEFORE install/prepare
  (pinned by a --list-tasks gate): enum + per-mode asserts (LE: FQDN≠localhost + email≠CHANGE_ME +
  replicas≠0 [type-coerced]; provided: files in the RESOLVED env-group dir — group_names[0] bug dead, zero-
  ^agrivisory-group now fails instead of guessing; selfsigned: dev-only localhost); stale-cert trap in any
  mode with EXACT-token CN/SAN matching (substring bypass caught in review); GPU rule enforced
  (gpu_self_signed_certs + gpu_node_host → opea_ssl_skip_verify="1"). nginx entrypoint: ONE generator,
  selfsigned-only (CN+SAN=domain, IP-aware), exits loud in LE/provided — exec-tested; smoke hits
  https://agriconnect.site with issuer-keyed validate_certs (LE-issued only — first-deploy race killed) +
  hairpin rescue. New negative-assert gate precedent: test-preflight-cert.sh 22 rows. Review pass 1: 14
  patches (substring trap, LE smoke race, YAML-int coercions, env-group fallback, deprecation guard,
  entrypoint exec+wiring pins [exposed a TERM-trap wait bug], README enable-steps). DEC-14 opened (www
  coverage — answer before D2). Next: B2. Full rtx6000 --check awaits Adem's vault (one command).
- 09-27: B2 done via bmad-build (spec-b2-preflight-coherence.md, status done). tasks/preflight.yml runs
  FIRST in both playbooks (tags: always, pre-mutation): single-assert placeholder sweep over a jinja-mapped
  var list (13 always-live + conditional grafana/swarm sets; dead vars exempt; nginx_public_domain swept),
  deploy_mode/observability enums (string-coerced), pre-mutation deployment plan (email redacted, profiles
  mirroring the now-coerced run path), confirm gate (assert-based, domain≠localhost, YAML-bool tolerant).
  deploy-gpu.yml gets the gpu-scope play (play-name discriminator — -e cannot spoof ansible_play_name).
  Deploy-time vault assert slimmed to live vars. RED-TEAM exit workflow ran (2 adversarial agents, 40
  probes): 16 bugs found+fixed — criticals: -e could shadow preflight_offenders (kill the whole sweep) or
  inject preflight_scope (skip the gate) → entry-guard asserts; type escapes (bool domain → https://True)
  → string-type pins; FALSE POSITIVE on legit secrets ("ExchangeMenu2024!x") → word-boundary fix; multi-
  ^agrivisory-group cert/vars divergence → ==1 assert. Plus synonyms/whitespace/reject-list/EMAIL-coherence/
  gpu-key-shape hardening; Cyrillic confusables = documented ceiling. Coordinator re-planted all four
  criticals with unseen values — all caught. Gates: test-preflight.sh 72 checks (49 B2 + chained 22 B1 +
  render-diff + wiring ×2), syntax ×3+gpu. Live catch with REAL rtx6000 vars: only offender =
  swarm_registry_url: CHANGE_ME (audit #3 — B5 hygiene or Adem one-liner before D1). Next: B3.
- 09-27: B3 done via bmad-build (spec-b3-ssot.md, status done). Single source = group_vars/all.yml: models
  once (granite; bge-m3 promoted to default — 3 hand-copies die; reranker/translation), TEI knobs var-fed
  (kills the 128-vs-8 compose/template split), contextual block pinned at TODAY'S runtime (Adem chose
  preserve; recipe values = one-place D5 edit), image pins (vllm :latest→v0.10.0; TEI/images env-reachable),
  computed browser vars (api/CSP×2/CORS from nginx_public_domain, https_port-aware) — all env hand-copies +
  localhost remnants deleted. ADMIN EMAIL SSOT: genie_admin_email (vault) now feeds BOTH GENIE_ADMIN_EMAIL
  and ADMIN_BOOTSTRAP_EMAIL (were two disagreeing vars = guaranteed first-admin chicken-and-egg); equality
  test-pinned + NEW 005-seed migration test (re-point/promote branches — previously zero coverage on the
  exact path the value change exercises). Dead chains deleted end-to-end: postgres_password chain, 8 no-op
  emissions, KEYCLOAK_URL dead emission, B2-exempted vars from env files, rtx6000 vault-legend rewritten,
  2 dead facts entries, dead health-filter. Compose fallbacks aligned (meta-llama gone ×4, docling cuda→cpu
  fallback, GPU-template model fallbacks un-staled). Epic-AC AMENDED at checkpoint: `grep genie_admin=0`
  was wrong post-A2 (all hits live realm-bootstrap) — replaced by the SSOT unification. Behavior-preservation
  PROVEN: resolved compose byte-identical pre/post. Review pass 1: 10 patches (005 test, noenv full-set pin,
  SSOT-override guard, computed-var greps, stderr-clean compose check, https-port derivation, docker-CLI
  guard); 2 findings refuted, 2 were review-diff scoping artifacts. Gates: test-preflight.sh 79 checks,
  backend 171, syntax ×3+gpu, compose both modes. PENDING ADEM: delete local untracked env/env-T4 + stale
  root .env (secrets; .env shadows plain docker compose). Next: B4.
- 09-27: B4 done via bmad-build (spec-b4-users-doc.md, status done). docs/users.md (250L, 10 sections):
  the deployer's user-lifecycle page — register→Pending→approve→roles, every URL/endpoint/knob exact;
  role honesty (realm admin = the only authorization role; labels gate nothing; roles ARE mirrored for
  display/notify while authorization reads only the token); Grafana admin→Admin/else-Viewer; first-admin
  runbook incl. the B3 email-SSOT warning; EMAIL knobs; mobile one-liner; troubleshooting table with the
  real db-migrations re-run commands (local + swarm, idempotence live-verified). LIVE WALKTHROUGH on a
  throwaway stack (b4-smoke, A6 pattern): register page→first admin first-login admin-routes 200→smokeuser
  403 ACCOUNT_PENDING + queue + notify→approve {User} same-token 200→approve {Admin}→realm admin in next
  token→reject→403 FORBIDDEN; /auth/admin/ 302 console; Grafana config-verified. Walkthrough found TWO
  live bugs: (1) empty EMAIL_FROM unconditionally 400s the realm import → email_from now preflight-REQUIRED
  (+test row+README truth; coherence trigger keeps sender-without-SMTP legal); (2) KC_HOSTNAME=domain:port
  breaks KC start on custom https_port (deferred; D1/D2 default-port unaffected). Review pass 1: 8 patches
  (headline: force-logout path was WRONG in both places — real route is the double-path
  /api/users/admin/users/:id/force-logout, all 3 layers caught it; + User-Roles.md reconciliation note,
  case-sensitivity, rejected-user UX, knob-scope, lockout commands). User-Roles.md rewrite → C2 defer.
  Gates: test-preflight.sh 80 checks, syntax ×3, doc TBD/TODO 0. Next: B5 (last B story).
- 09-27: B5 done via bmad-build (spec-b5-vars-hygiene.md, status done) — **EPIC B COMPLETE**. The 0.85
  bug fixed at the root: vllm_gpu_util → vllm_gpu_utilization (emission+GPU-template already existed,
  waiting for the var) — vLLM now ACTUALLY runs at 0.85 (was silent compose-default 0.55); both GPU-util
  knobs homed in all.yml (0.85 + translation 0.3 value-preserving). swarm_registry_url ""×3 (DEC-9 local;
  clears the one real-vars preflight offender). FILL IN header + gitignore dup gone. deploy-gpu NVIDIA
  parity: legacy-artifact removal + upgrade/hold machinery ported — block diff = gpu-bits only. Review
  pass 1 (8 patches, both-playbook where shared): headline = env.j2 default()-never-fires-on-empty exposed
  (direct renders emitted leading-slash image refs; production saved only by set_fact ordering) → registry
  lines now emit only when non-empty (compose fallback chain owns defaults; comment documents the set_fact
  dependency); NVIDIA hardening (--check-safe probe via check_mode:false + default guards, unconditional
  idempotent Hold, LC_ALL=C, daemon.json malformed-content chain); real-vars gate ×3 envs + gpu-scope +
  encoded rename grep (implementer caught two self-match traps where its own comments would've failed the
  coordinator's grep). Gates: test-preflight.sh 87 checks, syntax ×3+gpu, compose both modes, parity diff
  recorded. Defer: NVIDIA behavioral verification (needs tasks/-extraction; D2 exercises live). Next: C1
  (delete a10 env — S-4).
- 09-28: C1 done (oneshot flow — spec-c1-delete-a10.md, status done). a10 inventory + group_vars deleted
  (S-4; history retains), references swept (real-vars loop → 2 envs, ssot-guard list, README tree, comment).
  Oneshot review: 4 patches (my README line-delete had orphaned the tree children into agrivisory/;
  ssot-guard now fails LOUDLY on a missing listed env file — env deletion was exactly its silent-pass case;
  stale comment; NEW a10-deleted resurrection pin in the B5 idiom — first version self-matched its own
  error message, excluded via --exclude). Defer: migration-plan/decision-memo still narrate A10 provisioning
  → C2 superseded-notes. Gates: test-preflight.sh 87 checks, syntax ×2+gpu, grep a10 deploy/ = 0; plan law
  line updated to the post-C1 inventory count. Next: C2 (docs consolidation → deploy-rtx6000.md).
- 09-28: C2 done via bmad-build (spec-c2-docs-consolidation.md, status done). docs/deploy-rtx6000.md
  (283L, house style) = the canonical runbook: WSL/SSH/ansible setup (deploy-key pattern, 09-28-verified),
  rtx6000 facts box (jl-vm-511428/Blackwell/letsencrypt/granite//opt/agrivisory-app), driver-triage + tag
  anatomy survivors, preflight+confirm run, verify via https://agriconnect.site, gotchas, troubleshooting
  (reboot/teardown rows). Three source docs deleted; users.md footer + README listing repointed. INHERITED
  DEFERS LANDED: DECISION-MEMO superseded-banner (A10 deleted, rtx6000 canonical); User-Roles.md → 13-line
  honest stub + 5 inbound refs repointed to users.md; three components/*/.env.example (minimal boot sets,
  verified against code) + compose-header boot steps. Review pass 1 (11 patches): headline = the doc's own
  pass-1 command aborted (confirm=yes missing — gate is tags:always); dev-boot failed on the external
  chatqna_default network + ARANGO_PASSWORD step; frontend .env note inverted A4's runtime-config
  mechanism; BEST CATCH: FRONTEND_URL (email links!) read by code, emitted by NOTHING → now domain-computed
  in all.yml→env.j2 (prod approval emails would've carried localhost links). Gates: test-preflight.sh 87,
  link-rot 0, contradictions 0. Next: C3 (placeholder env fate — last pre-D story).
- 09-28: C3 done (oneshot — spec-c3-placeholder-env.md, status done). DECIDED: placeholder agrivisory env
  DELETED (DEC-9/15 + S-4 line); agrivisory_rtx6000 = the new-env copy-source template (vars.yml only —
  vault created fresh; README quick-start/staging/GPU flows repointed + renamed to agrivisory_myenv
  underscore/prefix rules). Review pass: 12 patches — headline: my cp -r flow NESTED (mkdir+cp -r →
  group_vars/my-env/agrivisory_rtx6000/, never loaded) and copied the REAL vault.yml — both fixed; ssot-guard
  now GLOBS group_vars/*/vars.yml (self-maintaining after 2 hand-edits); NEW env-deleted resurrection pin;
  inventory.example/certificates-README/T4 stragglers swept; users.md rejected-403 restored; A6 reject defer
  marked SUPERSEDED (DEC-13); email_from D-phase reminder filed. Gates: test-preflight.sh 87, syntax ×2,
  AC grep 0. **EPIC C COMPLETE — ALL PRE-D STORIES DONE (A, B, C). D-PHASE HARD GATE: every blocking story
  green + ledger clear (DEC-1..15). Next: D1 preflight on rtx6000 (needs Adem's vault password for the full
  --check; SSH verified 09-28).**
- 09-28: D1 done — TOGETHER run (Adem's terminal for the vault, agent for verification/remediation).
  First run FAILED LOUD exactly as designed: the stale-cert trap caught a leftover cert on the box —
  which uncovered the real state: **the box was NOT fresh** (full pre-sprint stack up 4 days: backend/
  frontend/keycloak/dataprep + opea/gpu services, old checkout at /opt/agrivisory-app Sep 22-24, old .env,
  self-signed CN=151.185.34.95 cert). Per S-3/DEC-6 (fresh install, legacy discarded — Adem's explicit go):
  stack torn down profile-aware WITH volumes, stale cert deleted, box verified empty (0 containers/volumes/
  networks). Accepted cost: hf_cache model weights went with the volumes → D4 re-downloads ~30 GB once.
  RE-RUN GREEN (ok=17 failed=0): full preflight + DEPLOYMENT PLAN (the eyeball, Adem-confirmed):
  deploy_mode local (DEC-15 stage 1) · domain agriconnect.site (DEC-1) · cert_mode letsencrypt, email
  adem.mcharek@… · llm granite-4.1-8b (DEC-9) · embedding bge-m3 · reranker bge-reranker-v2-m3 ·
  translation auto · profiles opea letsencrypt gpu-models · gpu models local on-box · deploy_dir
  /opt/agrivisory-app. D1's own preflight = the parked full-vars run: DONE (vault path exercised).
  Next: D2 — the deploy itself (full playbook run in Adem's terminal, ~1 h first time with model pulls).
- 09-28: D2 done — TOGETHER (Adem's terminal ×2 runs, agent verifying/fixing). First run failed=1 at
  compose --wait: TEI×2 crash-looped ("Could not start a suitable backend" — no sm_120 kernels in pinned
  1.9.3) which aborted up before nginx/certbot/kong-config ever STARTED. FIX (Adem's go): image pins bumped
  to the old stack's Blackwell-proven pair — tei 120-1.9 + vllm v0.30.0 (both already on the box — killed
  the in-flight 32GB v0.10.0 pull) — carried through the B3 SSOT chain (all.yml → env.j2 → compose
  fallbacks → GPU template → test pins; 87-check gate re-green). Re-run: failed=0. VERIFIED FROM THE
  PUBLIC INTERNET: Let's Encrypt cert live with BOTH SANs (agriconnect.site + www — DEC-14), front door
  200, www 200, well-known 200 through kong, /api/health 200; all services healthy incl. tei×2 + vllm on
  the proven images; one-shots exited 0; certbot renewal loop running. Bootstrap-cert→LE handoff worked
  exactly as B1 designed (issuer-keyed smoke validation). Next: D3 — Adem's browser walkthrough per
  docs/users.md (register→Pending→approve→role) + both hostnames + admin console + the D3 checklist
  additions (sendVerifyEmail click-test once SMTP exists).
- 09-27: DEC-1 SETTLED — the last blocking decision. Verified live before settling: agriconnect.site
  A record → 151.185.34.95 (www too), ports 80+443 OPEN from public internet, IP stable (Adem).
  certbot_email ***REMOVED*** (placeholder-by-choice; change later = zero cost — cert
  binds to the domain). rtx6000 vars.yml: nginx_public_domain=agriconnect.site, certbot_email,
  certbot_replicas=1 (activates letsencrypt profile), browser-facing localhost hand-copies swept
  (vue_app_api_url/CSP/CORS — B3 replaces with computed vars). self_signed_certs stays true as
  bootstrap until B1's cert_mode=letsencrypt lands. LEDGER CLEAR for B1; only DEC-13 open
  (blocks nothing).
- 09-27 (late): DEC-14 SETTLED — cert covers apex + www (entrypoint `-d www.${DOMAIN}` added;
  nginx `server_name _` catch-all means no redirect work); D3 checklist gains the both-names
  smoke. Parked follow-up filed: rtx6000 SSH access from this machine (no deploy-key here, box
  rejects publickey — generate key here, authorize from the other laptop; unblocks the --check
  dry-run). Ledger: only DEC-13 open (blocks nothing).
- 09-28: SSH follow-up DONE — deploy-key on this machine authorized on the box (verified:
  `ok from jl-vm-511428`). Recon bycatch: hostname jl-vm-511428 (kills the vars.yml TODO);
  GPU live: RTX PRO 6000 Blackwell, driver 595.58.03, 96 GB. The --check dry-run is now
  SSH-unblocked; needs vault password via --vault-id rtx6000@prompt (README convention) or a
  local .vault-pass file. Ledger unchanged (DEC-13 only open item).
- 09-28: DEC-15 SETTLED (Adem): swarm + Azure is the target architecture, sequenced local-first
  — D2 deploys the rehearsed local-mode stack, swarm lands post-D as epic-e (ACR, image
  build+push — stack deploy cannot build, deploy.yml `/-/raw/` Azure rework, planned stack
  re-deploy). Repo swap later = repo_url/repo_branch + vault token only. DEC-13 SETTLED (answer
  was sitting in OPEN): reject not terminal → flip-back follow-up filed. LEDGER CLEAR — zero
  OPEN DECIDEs. --check rehearsal status: preflight/plan/confirm-gate all green; email_from
  fixed; blocked on local rsync install (controller), next run continues from project-sync.
- 09-28: D3 done* — the FULL A6 lifecycle proven on the production domain, live-verified from both wire
  ends. First-admin: rename to AdminAdem exposed a real gap (new username = NEW JIT identity → Pending;
  hand-flipped Active via the users.md §10 interim; orphaned bootstrap doc removed; docs follow-up filed).
  App login ✓ (AdminAdem instant-admin after flip); admin console = master-realm creds (vault
  keycloak_admin_password, username 'admin'); both hostnames ✓ (LE cert, DEC-14). SMTP: DEC-16 — Gmail
  relay interim (personal Gmail, address redacted 10-19 per Adem; DEC-16-R follow-up = sending service + SPF/DKIM). MORTAL LIFECYCLE
  ✓: adem1 registered → Gmail verify link → first login → Pending (queue row + gate) → admin approve POST
  200 (approval email sent) → Active/User → logged in and working. *Carried: silent-renew idle check
  (passive, DEC-4); pending-screen "little bug" — follow-up filed, Adem to describe; resend-verification
  click (possible now, optional). Next: D4 real-model chat round-trip.
- 09-28/29 (overnight, Adem asleep → "keep hunting + do code changes" mid-night): **D4 night
  audit + Epic F wave 1.** Read-only audit first (3 explorers + 33-agent round-1 workflow +
  9-agent round 2; 13 confirmed / 8 partial / 0 refuted + ~130 sweep findings — full record:
  `_bmad-output/test-artifacts/d4-night-audit.md`). Both reported symptoms root-caused:
  weird responses = chatqna's Python bytes-repr token stream half-stripped by the backend
  (literal \n text, b"…" wrappers, mojibake, dropped digits); "model not connected" = backend
  container missing every model env var the admin code reads + fabricated placeholder rows +
  dishonest probes + NavBar admin call for non-admins. Headline: the d4-fix itself was never
  deployed (restarts predate the commit; gemma absent) → F1 coordinated recreate (DEC-17).
  Wave-1 LANDED (working tree, uncommitted, house law): bytes-repr decoder + SSE heartbeat +
  done-before-persist; 21-route IDOR guard set (owner-or-admin, 404-no-oracle, 17-test
  suite); backend env contract (8 model vars); dashboard honesty (neutral placeholders,
  /health probe, 4xx semantics, locale keys); NavBar admin gating; streamingService error
  surfacing + EOF-truncation + abort + watchdog; double-submit guard; CORS deny≠500; query
  escaper removed; Arango 8529 loopback bind; www→apex 301 (www login was live-broken);
  /healthz static; /grafana honest 404; Kong retries 0 + dead route gone; Mailjet README
  scrub; doc-repo NODE_ENV=production; cert-reload race slack; approve emailNotification.
  Gates: backend 16/207, frontend 13/231, kong 34, compose OK. Permission-blocked (left for
  Adem): production-box log/inspect reads, check-email deletion (→ DEC-20). DEC-17..23
  opened. No commits made (S-11). Next: Adem reviews epic-f + audit report, answers DECIDEs,
  green-lights F1.
- 09-29: D4 closed — chat pipeline VERIFIED LIVE end-to-end on agriconnect.site: vLLM logged
  `POST /v1/chat/completions 200` (granite-4.1-8b served it), backend streamed 200 (5.5s), Arango row
  `answered:true` + full response + metadata (is_grounded:false, 0 docs — the honest empty-corpus state;
  answers in Sesotho w/ repetition = ungrounded generation + translation leg active — D5's to fix).
  D4 saga (3 bugs): chatqna model-id mismatch (LLM_MODEL env) → silent-empty SSE (guard+timeout added);
  frontend $set-in-Vue3 TypeError (parallel session's edit — post-success block exploded → double-message);
  then the 09-29 outage: worker model-download died at 30s w/ NO respawn → HTTP never bound; kong held
  the recreated backend's STALE IP (502s); smoke 90s budget vs 9-18min cold start. D4b filed+DONE
  (oneshot): respawn w/ backoff+cap+zombie-kill+queue-reject, dedicated model-cache volume (was
  memory-only!), kong-restart-after-recreate task, smoke 40×15s, TranslationService optional:true (HTTP
  always binds — the root fix). Review: 13 findings all patched. Gates: backend 215, preflight 87.
  NEXT: D5 re-ingestion (makes answers grounded — the "not great" closes there).
- 09-29: PLAN RECONCILIATION (coordinator, per Adem) — both sessions verified on ONE plan; tree green
  with both streams merged (backend 215 / frontend 230 / kong 34). F1's "d4-fix never deployed" premise
  corrected: d4-fix IS live (verified 09-29 — chat round-trip, vLLM completions logged, Adem-tested);
  what awaits the recreate is wave-1 + D4b + F6-bind. No commit-sweep damage: F2 decoder confirmed
  UNCOMMITTED alongside committed d4-fix work (zero overlap in 5e5b5265). NEW §Critical path above =
  the canonical order + who/what holds each step. EVERYTHING currently waits on DEC-17 (recreate window),
  then DEC-21 (rotation, urgent), then DEC-18 (unblocks F3→F10→D5).
- 09-29: DEC-17..DEC-23 answered with Adem — ALL SETTLED, ledger clear. Recreate window
  approved (DEC-21's Arango rotation rides it; one outage) · dataprep gets its own service
  account (F3 wires the existing realm slot) · Sesotho primary with interim honest notice,
  better-model reminder filed as DEC-19-R · email-check oracle goes blind (not deleted) +
  AI-Engineer tabs hidden · Backup = arangodump in backend image (post-F6) · clean GRAPH flip
  before D5, pilot data disposable. F1 ungated — next action: Adem runs the two vintage
  one-liners, then the coordinated recreate from his terminal (vault in hand).
- 09-29: F1 vintage one-liners run by Adem on the box (gate evidence): (1) chatqna
  `LLM_MODEL=ibm-granite/granite-4.1-8b` — model env ALREADY correct (d4 env side is live);
  (2) `agrivisory-app-vllm-translation-guardrail-1` (vllm/vllm-openai:v0.30.0) `Exited (1) 8h ago`
  — guardrail crash-dead as audited. DEC-17 window confirmed GO: recreate covers backend/frontend
  (wave-1 code) + compose changes + guardrail; Arango rotation (DEC-21) rides the window.
  GRAPH flip (DEC-23) deliberately NOT in this window — rides the F3 window instead (pre-D5),
  else post-recreate chat runs on an empty graph until D5 ingests.
- 09-29: F1 IN PROGRESS (step-by-step per Adem; ledger clear — DEC-17..23 all answered same day).
  Vintage one-liners run: chatqna LLM_MODEL=granite-4.1-8b LIVE (d4-fix confirmed deployed; F1's stale
  premise corrected in-log); Arango bind already loopback (wave-1 compose partially live via an 11:37
  deploy); guardrail had died at 0.12 (7.96 GiB free < 11.4 wanted — live-proving the D4b-review
  "headroom fiction"). DEC-19 consequence landed BEFORE the recreate: **GPU rebalance — granite 0.85→0.75,
  guardrail 0.12→0.10** (gemma-3-4b must coexist; 0.75×94.97=71.2 + TEI×2 ~14.5 + 0.10×94.97=9.5 ≈ 95;
  rtx6000's per-env 0.85 override DELETED so all.yml SSOT wins; compose fallbacks 0.55/0.12→0.75/0.10
  aligned; test pins updated; gates 87+215+230 green). DEC-21 rotation: new arango_password vaulted.
  First recreate run: builds green, vllm recreated healthy @0.75, GUARDRAIL ALIVE @0.10 (first time);
  BUT Arango went unhealthy — password rotation can't apply to an existing volume (Arango sets root
  password only at first init) → dependents stayed Created. OLD PASSWORD LOST → per DEC-23 (pilot
  disposable) + the B3 seed (AdminAdem auto-repromoted on fresh DB — no hand-flip this time): full
  stack down WITH volumes + fresh redeploy running. This also completes the "one coordinated recreate"
  in the cleanest possible form: nothing stale survives.
- 09-29/30: F3 DONE (oneshot — spec-f3-unblock-ingestion.md, code-only per the download-window plan).
  Recon verdict: DEC-18's realm/env plumbing was ALREADY complete live (token minted, dataprep-service role
  present) — the 403 was 4 doc-repo callback routes still demanding ['Admin'] post-A5. Fixes: route grants
  (+ test), the EMBEDDING DIMENSION BOMB defused (dataprep subclass override + retriever gate drop — TEI
  endpoint now wins without an HF token; source-pinned so an OPEA bump can't reinstate it), GRAPH flip
  (DEC-23), ClamAV actually reaches the clamav service (host into clamdscan sub-object — review caught the
  top-level no-op — + compose default). Review: 9 findings, headline = the no-op host + the remote-GPU
  401 caveat (local rtx6000 unaffected; vllm_api_key vault line = remote-GPU prerequisite, Adem's call).
  Gates: doc-repo 93 (86+7), overlay 650 (648+2), preflight 87, compose OK. Live ingest proof = D5's gate.
  D5 now unblocked (pending F10 graph-protection checks + F1's granite download completing).
- 09-30: F-wave1 committed (6aebb6e0 — the night session's hardening: 35 files, +6182; both sessions'
  work now on-branch). F4 DONE (spec-f4-translation.md, dispatch): chatqna finally has the translation
  env (was backend-only wiring); streaming path translates the SETTLED answer after the last token
  (TTFT untouched) via _translate_with_chunking(raise_on_error=true — the chunk translator previously
  swallowed failures and would have passed English off as translated); emits translated_answer /
  translation_unavailable SSE events; backend forwards + persists the user-facing text; frontend
  replaces the English preview (or appends a muted st-locale notice). EN short-circuit mirrors the
  non-streaming path exactly. Gates: overlay 654, backend 217, frontend 232, preflight 87, compose OK.
  Live Sesotho probe = post-download window (gemma starts with granite; chatqna needs up -d --build +
  env recreate). DEC-19-R live: better-translation-model pick = Adem, one-line swap when chosen.
- 09-30: F1 VERIFICATION BATTERY (granite download COMPLETE 18.9GB after 200-attempt resume loop;
  cron retired). vLLM started → healthy on 0.75 slice; TEI×2 healthy; full stack 22 containers.
  BATTERY: front door 200 (apex + www 301→apex), LE cert live, **Arango 8529 CLOSED from outside**
  (F6 bind proven), clean-text chat probe 200/64 events/real English text ("I'm sorry, but the
  knowledge base…") — no bytes-repr garbage (F2 live-confirmed), IP Blocked spam 0 (reputation
  exemption working), AdminAdem seed doc Active/Admin on the fresh DB (B3 SSOT payoff — instant
  admin on next login, no hand-flip needed this time). **ONE OPEN ITEM: the guardrail (gemma
  translation vLLM) deterministically hangs after multimodal warmup — port 9031 never binds (2/2
  runs, identical stall point; vLLM 0.30.0 + gemma-3-4b-it multimodal startup deadlock; memory
  allocated, no error).** NOT a system outage: F4's translation_unavailable notice covers exactly
  this (English + honest notice = DEC-19's sanctioned transitional state). Options for Adem:
  (a) DEC-19-R early — pick the better TEXT-ONLY translation model now (avoids the multimodal
  path entirely; one-line SSOT swap); (b) try a different vLLM version for the guardrail image;
  (c) ship with English+notice until the model pick. F1 closes on Adem's chat click.
- 09-30: F14(a) AfriSLM swap — code done (model/pins/flag fixes committed), but EMPIRICAL
  VERDICT: vLLM 0.30.0 (= registry latest) deterministically hangs after multimodal warmup on
  this box — port never binds. Affects gemma-3 AND AfriSLM (Qwen3.5-VL base; got further:
  chunked-prefill assertion fixed, warmup completes, then the same hang). --enforce-eager
  doesn't help. Text-only granite runs perfectly on the same vLLM/GPU → the mm startup path
  is the bug. F4's translation_unavailable notice keeps the system honest meanwhile (English+
  notice = DEC-19's transitional state, live NOW). OPEN with Adem: (1) text-only translation
  model, (2) CPU-NLLB for the streaming path (already works), (3) wait for a vLLM fix.
  F14(b) pending-screen fix DONE+committed (2d7cc27a) — logs out first; rides next frontend
  deploy.
- 09-30 (cont): EMAIL LEG SPLIT CONFIRMED — backend→Dreamhost fully working (approval+notify logs
  prove sends; the "missing" approval email was in GMAIL SPAM — deliverability, not breakage).
  KC verify-email re-enabled by Adem → Java(angus-mail) 587+STARTTLS still failing → running the
  parked 465/SSL test (GUI Email tab: port 465, SSL on, StartTLS off, Test connection button).
  NOTE: two sessions worked this issue in parallel (this + Adem's other window — vault edit,
  YAML-type preflight catch, redeploy); no conflicts found in the tree.
- 10-01: F15/F6 LANDED + COMMITTED (4bc33ac8) — facebook/nllb-200-3.3B on the dedicated
  `nllb-translate` GPU sidecar (FastAPI+transformers bf16, FLORES codes; DEC-25 resolves
  DEC-19-R, supersedes DEC-24). Full BMAD run: spec → implement → 3-reviewer pass (11 patches,
  3 deferrals) → gates green (pytest 659 / jest 223 / compose / preflight 87 w/ DEC-25 pins).
  Deploy window OPEN — it carries everything pending (wave-1, F4, f14b, DEC-16-R email, F6).
  INCIDENT mid-deploy: arango-vector-db healthcheck 401 — the VOLUME's root password predates
  every vault in git (pilot era); compose aborts on the unhealthy dependency. Recovery in
  flight: auth-off reset (docker run -e ARANGO_NO_AUTH=1 + --experimental-vector-index=true —
  the VectorIndex column family REQUIRES the flag, crash without it; arangosh users.update to
  the current .env value; then compose start + healthcheck verifies). NEXT SESSION:
  (1) confirm arango (healthy) + reset outcome, (2) re-run --tags deploy playbook to finish
  the stack (nllb-translate first boot: image build ~10min + 6.6GB model download + "Model
  ready"), (3) F6 live probes per deploy-rtx6000.md §8.1 (sidecar /health + eng_Latn→sot_Latn
  round-trip; adem1 st chat → Sesotho bubble + Arango persistence; English byte-identical),
  (4) orphan guardrail was docker rm -f'd manually — playbook lacks --remove-orphans (logged),
  (5) DEC-16-R close-out: confirm DreamHost email legs on the redeployed stack.

- 10-01 (cont.): **RE-PRIORITY (Adem): Epic G created — answer parity (DEC-26).** Trigger:
  live ST transcript looped ("go tloga"×300) while the paired EN question returned the clean
  empty-KB refusal — Adem's ruling: ST sessions follow the same rules as EN (DEC-26 settled);
  ST = translation of the EN answer; sidecar down = EN + notice; interim refusal accepted
  until corpus. Full BMAD run (epics skill): `_bmad-output/planning-artifacts/epics.md` —
  Epic G (G1-G5, DoD = ST message returns the Sesotho translation of the EN refusal) +
  Epic H (H1-H4, ingestion, WAITS for G). Code trace root causes: no English-response
  instruction for non-EN sessions + silent raw-passthrough on failed history translation +
  repetition_penalty computed (1.03) then DROPPED at the LLM align_inputs key-pick +
  no degeneration guard. H2 blocked on Adem naming the corpus. G1 = the resumed deploy
  window (unchanged steps below); spec-g next for G2-G4.

- 10-01 (cont. 2): **G1 DONE + ROOT CAUSE OF THE ST NONSENSE FOUND (live triage with
  Adem's terminal).** Full record: test-artifacts/g-live-triage-2026-10-01.md. Box legs:
  arango AUTH-OK; compose on box was DAY-OLD (--tags deploy alone never syncs — sync is
  prepare-tagged; corrected run = --tags prepare,deploy; runbook gap filed to F13);
  nllb-translate built + booted (~22GB fp32 shards, ~35min uninterrupted — a 10-min
  restart loop PREVENTED completion until killed; tqdm bars are lies in docker logs, du
  is truth) → healthy "Model ready"; probes 200+clean Sesotho from backend AND inside
  chatqna; EC8 verified (backend booted post-sidecar → GPU path). ROOT CAUSE (F-G3,
  keystone): **UI locale never reaches chatqna** — frontend default-mode payload has no
  language (ChatBotComponent.vue:1007), backend single-message buildOpeaPayload strips
  it (query-service.js:228-230), langdetect has no Sesotho ('sk'/'fi' live
  misdetections) → EN fallback → all translation legs bypassed → raw ST into granite →
  mirror+loop. EN mode works perfectly (Adem's paired transcripts = the proof).
  Also code-traced: EN-only English-injection (F-G4), repetition_penalty computed-then-
  dropped at align_inputs key-pick (F-G5), no degeneration guard (F-G6). epics.md
  amended (FR13). spec-g-answer-parity.md updated (G.2a keystone first). Riders open:
  translation_cache_password rotation (F-G8), --remove-orphans rides the G build.
  NEXT: Adem approves spec-g → bmad-build G.2a-G.4 → one --tags prepare,deploy window →
  G.5 paired-transcript DoD probe.

- 10-01 (cont. 3): **G2-G4 BUILT via full BMAD run (spec-g done).** Spec → subagent
  implement → 3-layer review (blind 13 / edge 11 / verif-gap 2 = 26 findings) → triage
  (9 patched incl. frontend test pin for the G.2a half that had zero coverage, env
  crash-loop guard, iterator close; 3 deferred with evidence: classic-path guard, O(n²)
  scan ceiling, truncation label; 14 refuted with written evidence) → coordinator-verified
  gates: overlay 686, backend 228, frontend 235/235 (the 4 earlier failures were
  mock-flake), preflight PASS. KEYSTONE fix = locale propagation (frontend default-mode
  payload + backend single-message buildOpeaPayload forwarding — FR13). Rider landed:
  deploy.yml --remove-orphans. PENDING ADEM: commit go (path-scoped proposal ready),
  then ONE --tags prepare,deploy window, then G5 paired-transcript DoD probe. Adem's
  pre-session vars/vault edits left OUT of the story commit (his call when to land).

- 10-01 (cont. 4): **G.5 PROBE #1 → F-G9 found+fixed (live-gate BMAD loop).** Probe #1
  result: English clean, no loop (G.2a+G.2b LIVE-CONFIRMED) but notice persisted — root
  cause: `_translate_text_chunk` stamped `Authorization: Bearer {OPENAI_API_KEY}`
  unconditionally (vLLM-era relic); key unset → httpx LocalProtocolError `b'Bearer '` →
  both translation legs died before leaving chatqna (probe-vs-prod divergence explained:
  probe sent no header). Fix (spec-g reopened→done): `_translation_auth_headers()` —
  header only when key non-empty, applied at BOTH translation POST sites (root-cause
  class); 3 regression pins (no-auth-when-empty ×2 shapes, well-formed-when-set).
  Coordinator gates: overlay 689, backend 228. PENDING: Adem redeploy (chatqna image
  only) → G.5 probe #2 (ST question → Sesotho refusal) → commit go.

- 10-01 (cont. 5): **EPIC G COMPLETE — G.5 PROBE #2 LIVE-VERIFIED WITH ADEM.** After the
  F-G9 redeploy, the ST question returns the Sesotho translation of the EN refusal in
  the bubble, no notice, no loop. DEC-26 delivered end-to-end. Commit executed with
  Adem's go (path-scoped, story+bookkeeping; his pre-session vars/vault + report files
  deliberately excluded). NEXT: Epic H (ingestion) — H1 graph protection first; H2
  blocked on Adem naming the corpus; F5-residuals implementation still pending from
  09-30; commit/push moments remain Adem's.

- 10-02: **H1 DONE (graph protection / F10 execution — spec-h approved by Adem, full
  build + 3-layer review).** KEY CORRECTION to the audit premise: chunk keys ARE
  content-addressed in the pinned langchain-arangodb 1.2.0 (farmhash(page_content) +
  overwrite=True — verified in the library source, both chunk SOURCE and entity/edge
  keys deterministic). What was missing is the OVERLAY guard, now landed:
  (1) dedup guard in ingest_file_with_guardrail — raw-text fingerprint vs stored
  `chunk_text??text`; unchanged file → skip ALL LLM work (status Ingested restated,
  zero new chunks); changed → cascade-replace via retract_file BEFORE re-extraction.
  (2) honest batch status — `_process_batch` returns per-batch accounting (`lost`
  counts chunks neither batch nor retry saved; fully-recovered batch = success);
  any lost chunks → 'Ingestion Error' + ERROR log with counts (NEVER 'Ingested';
  'Failed' is not in the doc-repo status schema and would 400 → stuck-Ingesting);
  hard-failure path now writes 'Ingestion Error' AFTER retract_file (was being
  overwritten to 'Retracted' — pre-existing, fixed).
  (3) retraction-stops-retrieval — retriever's per-chunk SOURCE existence check now
  the retraction filter: confirmed-empty lookup → chunk dropped (closes the BM25
  view's eventual-consistency window; runs post-RRF so both channels covered);
  fail-open on DB error (never false-drop), unkeyed results dropped. PLUS the
  retract_file LINKS_TO fix (audit finding): STEP 4.5 matched a file_id field
  langchain NEVER writes on edges (0 deletions every time — retracted relationships
  surfaced as traversal RELATED INFORMATION); now deletes by `edge.source_id IN
  chunk_keys` (the producing chunk). (4) label-comma contract — encode_filter_labels
  raises on a comma label (would silently decode as two wrong labels).
  REVIEW (blind 5 / edge 7 / verif-gap 5): headline patch = the fingerprint was
  first built on contextualized text — under the default CONTEXTUAL_RETRIEVAL_ENABLED
  =true it would NEVER match (LLM prose varies per run) and every re-ingest would
  take the destructive replace path; moved to raw text + guard moved pre-LLM. 3
  findings refuted with evidence (shared-chunk cross-file deletion, wrong-skip for
  identical second file, set-order sensitivity). Residuals documented in spec
  (upstream content-keying costs: ownership flip, shared-edge delete, label-refresh
  needs retract+re-ingest). Gates: overlay 716 (689+27, all green), ruff clean,
  compose/env untouched. NEXT: H2 — BLOCKED on Adem naming the corpus. H3/H4 queue
  behind it. F5-residuals impl still pending from 09-30. Commit proposal ready
  (path-scoped: genie-ai-overlay/ + _bmad-output spec + sprint bookkeeping) —
  awaiting Adem's go per S-11.

- 10-03: **H1 IS LIVE ON THE BOX + first UI ingest test attempted (blocked at the
  button, not the pipeline).** A prepare,deploy ran ~8h earlier (box dataprep
  verified carrying H1's `_existing_chunk_texts`; not run "just now" — other
  window or earlier command). VERIFIED LIVE: upload pipeline healthy
  (POST /api/files/upload → 201 from Adem's IP, incl. 03:18 10-03); hierarchy
  endpoint 200 but **TAXONOMY HAS ONLY 1 CATEGORY** (fresh 10-01 DB — corpus and
  full taxonomy not seeded; H2 territory). INGEST-BUTTON BLOCKER (UNRESOLVED —
  next session picks up here): FileDetailsDialog `mainAction` disables Ingest
  when `isSaveDisabled` (editable + file_name + **author required** +
  hierarchy non-empty) OR `!hasLabels` (**≥1 service label ticked**) OR
  crawlPending OR ingesting — "green but unclickable" = one of these; likeliest
  author empty and/or no label ticked. OPEN QUESTION: does the single category
  have child SERVICES to tick (labels = services via categoryServices links)?
  First read-only Arango query failed (arangosh "not connected" — needs
  `--server.endpoint tcp://localhost:8529`); NEXT: query serviceCategories/
  services/categoryServices counts → seed the taxonomy if empty (source: the
  pre-rotation DB had the Lesotho tree; seed data owner TBD) → then run the
  H1 UI test plan (unchanged re-ingest skip / changed replace / batch-failure
  honesty / retract-stops-retrieval / comma-label) delivered in-session 10-03.
  SIDE FINDING (file for triage): backend logs `[DB_TEST] Connection test
  failed for default: not authorized` HOURLY (318 in 24h) — a backend Arango
  handle still carries pre-rotation (DEC-21) creds; doc-repo's own test PASSES
  and reads return 200, but flag before H2 relies on backend writes. H1 commit
  STILL awaiting Adem's go.

- 10-03 (cont.): **FIRST LIVE INGEST → TWO FINDINGS TRIAGED (h-live-triage-2026-10-03.md).**
  Adem filled the hierarchy (grey-button cause confirmed) → Ingest clickable → "Ingestion
  Error". H1's honesty machinery WORKED live (true status, stage lines, correct fresh-graph
  retract no-op). F-HA (fatal, patched): vendored base builds ChatOpenAI with no api_key +
  dataprep container never receives OPENAI_API_KEY → every ingest died at init; latent
  forever (first ingest ever on this stack). Fix: subclass _initialize_llm setdefault
  OPENAI_API_KEY←VLLM_API_KEY/EMPTY (coordinator-applied, 3 pins; overlay 719). F-HB
  (separate): dataprep service account JIT doc is PENDING → backend gate 403s label fetch —
  not a repo bug; immediate fix = Adem approves it in the admin UI Pending queue; auto-Active
  for machine identities filed in deferred-work. NEXT: Adem approves the service account +
  one --tags prepare,deploy (dataprep image) + re-ingest → then the H1 UI test plan.

- 10-04 (cont. 6): **I.4 LIVE-VERIFIED + COMMITTED — EPIC I COMPLETE (I.1-I.4 all
  done+live).** Adem's verdict: "great it worked". Sidebar populates with labeled
  docs, confidence shows a real %. Commit + push per his go. plan_10_03.md merge +
  delete = Adem's call (his tracker file).


- 10-04 (cont. 8): **EPIC J OPENED (3 new items; tracker plan_10_04.md — work
  continues in ANOTHER chat session).** J.1 ST-mode answers diverge badly from EN
  with the real corpus (DEC-26 must hold grounded; starting suspicion = retrieval
  on untranslated ST question — UNVERIFIED; Adem brings paired transcripts at
  kickoff). J.2 landing-page button conversations always "no info" (investigate
  button-vs-typed payload/locale/stream-vs-classic; use I.4 sidebar+confidence as
  diagnostics; verify with a KNOWN-answerable question first). J.3 model prompts
  editable from a role-gated UI (Adem provides main-branch reference commits;
  port + attribute). Suggested order J2→J1→J3. Folded correction: the I4
  §Status row had silently stayed "doing" (replace no-op) — now done/d84e62d4.

- 10-04 (cont. 7): **plan_10_03.md MERGED + DELETED (Adem's go) — Epic I tracker
  closed.** Durable outcomes live in the four specs (spec-i1..i4) + the log entries
  above. Essentials carried forward: (1) stuck-Ingesting docs self-heal at doc-repo
  boot or any Kill click; (2) label contract = ticked labels as chunk DEFAULT +
  same-crop extras (INTERIM until H.2 — NO BACKFILL: old chunks need retract +
  re-ingest; taxonomy warts 'maize' lowercase + trailing-space entry still worth a
  UI cleanup); (3) chunking = ONE knob `dataprep_chunk_size` (3000/300; per-ext
  overrides available) + deterministic per-chunk Category/Services header (embed/
  graph text only); (4) sidebar/confidence = forwarded Bearer (root cause) +
  categoryLabel singular + sigmoid calibration; mobile tokens pre-allowlisted for
  the future flutter_appauth migration. Chunk-size dynamic splitting stays PARKED
  pending real-corpus verdict (H.2).

- 10-04 (cont. 5): **I.4 BUILT + ACTIVATION-HARDENED (spec-i4; extra rigor per
  Adem — "technically 2 problems").** Diagnosis via 7-agent workflow: BOTH defects
  (empty related-docs sidebar + 0% confidence) share ONE root cause — gov-chat-
  backend drops the caller's Authorization on both chatqna paths → chatqna's
  doc-repo metadata fetch fails per-source → source_documents [] and scores [] →
  confidence born 0.0. Both adversarial verifiers CONFIRMED with file:line chains.
  Fixes: token forwarded (stream + worker-thread paths, 5 pins); chatqna emits
  singular categoryLabel (4 consumers read it, none read plural); sigmoid
  calibration (TEI unnormalized logits → sane %); labels .get hardening. Review
  found the diff ACTIVATES three dormant mechanisms — all patched: azp allowlist
  (web+mobile), real-401 on validator rejection (was invisible 200), per-request
  token ContextVar (no cross-user profile bleed), JWKS kid-miss refresh (rotation
  window). Issuer-mismatch deploy risk RESOLVED by evidence. Gates: overlay **754**
  (+10), backend **233** (+5), frontend 239, preflight PASS. Deploy + live test =
  the grounded-chat sidebar/confidence verdict.

- 10-04 (cont. 4): **I.3 LIVE-VERIFIED (Adem: deployed + "I3 worked"). I.4 STARTED
  with extra rigor per Adem ("technically 2 problems"): diagnostic workflow running —
  4 parallel tracers (retriever output shape → chatqna SSE/metadata emissions →
  backend forwarding/persistence → frontend consumption of metadata.source_documents
  + score→confidence) → synthesis mapping both failure chains hop-by-hop → 2
  adversarial verifiers (one per defect). Spec follows the confirmed break points.

- 10-04 (cont. 3): **I.3 BUILT + REVIEWED (spec-i3; Adem's amendments: 3000/300 not
  2000/200, plus a deterministic per-chunk file header).** Vars: all 7 extension
  sizes → 3000 + NEW overlap wiring (DATAPREP_CHUNK_OVERLAP=300 — the 50 default was
  never configurable before); SSOT chain all.yml→env.j2→compose. Code:
  _build_file_context_prefix — "[Source file context] / Category: <crops> /
  Services: <tick labels>" prepended to embed/graph text only (labeling input raw,
  chunk_text display-field raw, dedup fingerprint raw). Review: 1 MAJOR patched
  (flag-off+labels dedup read-back would have destructive-replaced every re-ingest —
  chunk_text now written whenever page_content ≠ raw) + header-dupe dedupe + comment
  honesty. Gates: overlay **744**, preflight PASS, compose OK, ruff clean. Dynamic
  chunking parked pending the 3000 verdict. Deploy + one re-ingest = the test.

- 10-04 (cont. 2): **I.2 LIVE-VERIFIED + COMMITTED (Adem: "perfect").** The crop-rule
  deploy passed his re-ingest test — default labels on every chunk, same-crop extras
  kept. Commit + push per his go.

- 10-04 (cont.): **I.2 SECOND AMENDMENT — Adem's crop rule replaces scope-drop.**
  After his DEPLOYED retest still showed drops, Adem clarified the taxonomy: categories
  ARE crops (Maize, Beans…), services repeat across crops. New contract: ticked labels
  = unconditional DEFAULT on every chunk (no string-match dependency); labeler extras
  KEPT when services of the same crop (label→SET of categories, any overlap); other-
  crop labels dropped ("Dropped (other crop/category)"); fail-open without a map.
  _fetch_taxonomy returns the label→categories map (one fetch), threaded through all
  strategies. Scope-drop + its exact-string comparison deleted. Tests: crop-rule
  rewrite + shared-service/fail-open/embedding-filter pins; fetch mocks repointed.
  Gates: overlay **738**, ruff clean. Awaiting deploy + live verdict.

- 10-04: **I.2 REOPENED + AMENDED after Adem's live test** (re-ingest still showed
  'Final labels (0)' AND the file's own 'Crop protection' in the dropped list):
  root causes = exact-string scope drop of the doc's own label (case/space variant
  between payload and taxonomy form) + the log line reporting pre-floor labels.
  Amendment: document labels are the SEED before chunk content is read —
  _resolve_taxonomy_label (case/plural/whitespace fuzzy match, kills the trailing-
  space taxonomy wart class) canonicalizes file_labels pre-dispatch; floor moved
  inside _finalize_chunk_labels BEFORE the log write (log = stored truth); embedding/
  BM25 post-pass retained. Live repro + log-truth + whitespace pins added. Gates:
  overlay **735**, ruff check clean. Commit blocked on Adem's live re-ingest verdict
  (test-before-commit per his 10-03 instruction).

- 10-03 (cont. 5): **I.2 DONE (spec-i2, full loop incl. adversarial review).** INTERIM
  label floor per Adem: every chunk carries the document's selected labels — union
  post-pass in `_apply_labels` (the one point all three labeling strategies route
  through; embedding/BM25 previously ignored file_labels entirely, LLM could return
  []). Strategy labels add, never subtract. Review: no fatal/major; composition pin
  (fallback→finalize-drop→floor-restore) + in-request dupe dedupe patched; case-variant
  canonicalization + WARN reword deferred to H.2. Gates: overlay **732**, ruff check
  clean. **NO BACKFILL: pre-deploy chunks keep old labels — Retract + re-Ingest to
  gain the floor.** Commit awaiting Adem.

- 10-03 (cont. 4): **I.1 DONE (spec-i1, full loop incl. adversarial review).** Three
  defects fixed: dataprep kill endpoint raises real 404 for orphaned ids (was
  200-with-false-body → lying "kill sent" toast); doc-repo forwards it AND on 404
  flips the row to 'Ingestion Error' (+System log) — closes both orphan classes
  (dataprep-only restart + doc-repo boot, the latter via reconcileStuckIngesting with
  retry-backoff, null-vs-0 signal, Swarm-aware); frontend Delete unlocked while
  ingesting (isFileLocked) + confirmDelete = best-effort kill → delete. Review: 5
  findings (1 major boot-retry gap → patched; kill-404 reconcile → implemented; 2
  verified-harmless documented; gitignore). Gates: overlay **725**, doc-repo **100**,
  frontend **239**, ruff clean. Commit awaiting Adem's go; live after deploy.

- 10-03 (cont. 3): **INGEST #4 SUCCEEDED (Adem's UI test) — first-ever full ingest on
  this stack; grounding live (chat cites the docs).** Four new issues filed by Adem →
  **Epic I created** (planning-artifacts/epics.md: I.1 kill/delete stuck-Ingesting +
  boot reconciliation · I.2 chunks inherit document label INTERIM · I.3 chunk size
  2000/200, dynamic chunking parked until static-bump verdict — research done: 512–1024
  tokens is the sweet spot, bge-m3 8k ctx not the constraint · I.4 related-docs sidebar
  + confidence render, suspect SSE/metadata wiring not data). Adem's temporary tracker:
  [plan_10_03.md](plan_10_03.md) (merges here + deleted when Epic I closes). Execution
  order I.1→I.4, interleaves with H2-H4. H1 UI test plan still queued.

- 10-03 (cont. 2): **F-HC RESOLVED — the "stuck ingest" saga closed (full record:
  h-live-triage-2026-10-03.md).** Symptom: ingest "stuck in extractions" 2h, then two
  more ingests failed instantly; kill switch couldn't interrupt; 3 restarts no effect.
  Diagnostic-logging patch ([LLM-CLIENT]/[LLM-FAIL] cause-chain logs) named it in one
  run: APIConnectionError ← LocalProtocolError `b'Bearer '` — **F-G9's class, dataprep
  instance, empty-string twist**: compose environment: SETS VLLM_API_KEY="" (unset ≠
  empty-set; getenv default never fires) → AsyncOpenAI(api_key="") → illegal Bearer
  header → every LLM call died locally; zero requests ever reached vLLM (probes passed —
  they hardcoded the key). Fixed: `or "EMPTY"` at both key-resolution sites + 4 pins.
  Honest note: the diagnostic patch's first cut split _build_vllm_client (helper
  inserted mid-function, return orphaned → 21 test fails) — bisected via stash, fixed;
  same failure class as the one under investigation. Gates: overlay 723. NEXT: Adem
  deploy → ingest #4 (expect SLOW-correct: tens of min for ~120 chunks of real LLM
  work; progress = batch lines in the log tab) → Ingested unblocks H1 UI test plan +
  H3 grounded-chat probe. Commit queue grows: H1 + F-HA + F-HC (+ G's 24197e52 already
  pushed). F-HB (service-account approval) = Adem's admin-UI click, still unconfirmed.
