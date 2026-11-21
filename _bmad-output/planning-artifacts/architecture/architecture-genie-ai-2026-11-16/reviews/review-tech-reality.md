# Review — Tech Reality Lens (finalize gate)

- **Lens:** verify every committed decision was web-researched or reality-checked rather than asserted from training data; current versions, named-technology fitness, repo-grounded claims.
- **Target:** `_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md`
- **Reviewer:** finalize-reviewer (tech-reality lens), 2026-11-16
- **Ground truth:** the repo worktree (branch `fix/1729`) and the research extract + research.md (amended 2026-11-16). No web browsing, per gate instructions.

## Verdict

**PASS with revisions.** The spine is overwhelmingly faithful to both ground truths: ~20 load-bearing repo claims spot-checked, and the Stack / AD-5 / AD-7 statements track the research's actual verdicts and confidence qualifiers (including the AM-1..AM-6 amendments) rather than flattening them. Three findings need fixes before acceptance — one false repo claim inside a binding rule (F1), and two staleness-gate wording defects (F2, F3). None overturns an architectural premise.

## Methodology

Every load-bearing claim named in the gate charter was checked against the named file. Confirmed-accurate claims are listed in the appendix with locations; only misstates/ambiguities became findings.

## Tier 1 — must fix before acceptance

### F1 — AD-9 misstates the non-stream routing seam (repo-reality)

**Claim (spine, AD-9):** "switches BFF routing at the `initStreamQuery` seam for BOTH `POST /api/queries/stream` and non-stream `POST /api/queries`."

**Reality:** there is no single seam. The stream route calls `queryService.initStreamQuery` (`components/gov-chat-backend/routes/query-routes.js:346`); the non-stream `POST /api/queries` handler calls a **different** service method, `queryService.createQuery` (`routes/query-routes.js:897`, method at `components/gov-chat-backend/services/query-service.js:921`), which does its own validation and its own chatqna call (it references initStreamQuery only in a comment comparison, `query-service.js:1075`). An implementer following AD-9 literally would gate only the stream path and ship exactly the half-activated deployment AD-9 exists to prevent.

**Fix:** reword AD-9 to "switches BFF routing at both query-service entry points (`initStreamQuery` for the stream route, `createQuery` for the non-stream route)" — or first introduce/name a shared routing seam inside `query-service` that both handlers funnel through, and point AD-9 at that.

### F2 — Stack table carries a compat-class version claim without its research freshness gate (staleness)

**Claim (spine, Stack):** "pydantic-ai 2.68.0 (fallback, web-verified 2026-11-16)". AD-5 adds "pydantic-ai stays the designated fallback with a ≤1-day swap-in exit test" — durable phrasing.

**Reality (research):** pydantic-ai 2.68.0 is explicitly in the **compat/version claim class whose re-check date is 2026-12-01** ("every one of these moves within weeks and directly gates REC-1/REC-2/REC-6" — research.md § Staleness map, line 185; reaffirmed AM-6). The research's own ledger tallies 2 verified / 22 unverified / 1 overturned, and pydantic-ai's licence is only repo-verified ("PyPI licence field empty"). The vLLM row in the same Stack table handles this correctly by binding its version-scoped claim to V06; the pydantic-ai row carries no such gate, and "web-verified" invites reading it as ledger-verified.

**Fix:** change the Stack row to carry the gate, e.g. "pydantic-ai 2.68.0 (fallback; research-sourced 2026-11-16, compat-class, re-check 2026-12-01 — refresh before relying on it at S4)" and add one clause to AD-5's fallback sentence: the swap-in exit test re-runs against the refreshed version, not the recorded one.

### F3 — AD-5 / Deferred staleness rule, as written, forbids the current research (staleness + wording)

**Claim (spine, AD-5 and Deferred D03):** "must not close on research evidence older than the 2026-12-01 re-check."

**Reality (research):** the 2026-12-01 re-check is **scheduled, not performed** (research completed 2026-11-16; the date is the earliest re-check in the staleness map). The current research is fresh **until** 2026-12-01. Read literally, the spine's wording rejects all evidence dated before 2026-12-01 — i.e. the only research that exists — which would make D03 unclosable before that date for no research-stated reason.

**Fix:** reword to the research's actual rule: "must not close on compat/version evidence that has passed its re-check date (2026-12-01) without a `bmad-deep-recon` refresh of the research folder."

## Tier 2 — should fix

### F4 — AD-11's "tracing.py pattern (OTel SDK, no `comps` dependency)" is wrong at source level, and collides with AD-1's own gate (repo-reality)

**Reality:** `genie-ai-overlay/tracing.py` **does** contain `comps` imports — `from comps import MicroService` (line 459) and `from comps.cores.mega.http_service import HTTPService` (line 521) — guarding the uvicorn access-log middleware install. They are try/except-guarded and no-op without comps, and the core OTel init (TracerProvider/OTLP exporters) is genuinely comps-independent, so "pattern" is defensible at runtime. But (a) the parenthetical reads as a factual claim about the file, which is false at source level, and (b) AD-1's CI gate "fails the pipeline on `comps`/OPEA imports … in agent-path packages" would flag a faithfully ported `tracing.py`. The two rules interact; the spine doesn't say which yields.

**Fix:** state it explicitly: "port the tracing.py pattern **minus its optional comps hooks** (the access-log middleware install at lines ~450–530); the copied file must be comps-free at source level so the AD-1 gate passes."

### F5 — AD-10 pins three env-tunable defaults as if they were constants (repo-reality, nuance)

**Reality:** of the recorded semantics AD-10 says the port "preserves deliberately", RRF k=60 is the default of `RETRIEVER_HYBRID_RRF_K` (`genie-ai-overlay/retriever/config.py:112`), BM25 analyzer `text_en` is the default of `RETRIEVER_HYBRID_BM25_ANALYZER` (`config.py:123`), and label-filter OR is the default of `RETRIEVER_ARANGO_FILTER_STRATEGY` (`config.py:83`). A deployment can override all three. V02 must record the **deployed** values, and the port must preserve the semantics *as deployed*, not the default literals.

**Fix:** one clause in AD-10: "values as deployed (defaults: RRF k=60, analyzer `text_en`, filter OR) — V02 records the deployed values, not the defaults."

## Tier 3 — notes (fix opportunistically)

### F6 — AD-1's "four existing grep-the-tree gates" count is loose

`tests/config-validator/__tests__/` has more than four tree-walking gates (`js-files`, `stray-copy-artifacts`, `ci-shell-gates`, `compose-non-root`, plus the `e2e-*` gates); exactly four files use the shared `withTree` helper, one of which (`temp-tree.test.js`) is the helper's own unit test, not a gate. The pattern the spine wants clearly exists; the count doesn't survive scrutiny. Fix: name two exemplars (e.g. `e2e-handle-locators`, `stray-copy-artifacts`) instead of counting.

### F7 — no image-count claim to verify

The gate charter listed "18 images" among claims to check; the spine makes no image-count claim anywhere. For the record, repo truth is **18** CI-built images (authoritative: `deploy/ansible/tasks/deploy-shared-facts.yml:16`; the `docs/RELEASE.md`/CVE-playbook "15" figure is stale — correction 2026-11-17, post-review) and 41 `image:` references in `docker-compose.yaml` (profile duplicates included). Nothing to flag in the spine.

## Appendix — claims verified accurate (spot-check evidence)

| Spine claim | Evidence |
|---|---|
| `pii-service` = non-overlay Python/FastAPI precedent, Python 3.11, internal-only | `components/pii-service/app.py` (FastAPI + Presidio; docstring "INTERNAL service, not publicly routed"), Dockerfile `FROM python:3.11-slim` |
| SSE five event types `chunk`/`metadata`/`translation`/`done`/`error`, terminal order chunks → metadata → [translation] → done | `routes/query-routes.js:461,500,510,695,721,746,773` |
| Dead `req.on('close')` client-disconnect path | `routes/query-routes.js:648–653` — explicit comment "this listener does not fire" (express.json() consumes body); spine's "replacing" is exactly right |
| okf-server stays authority: `servingReads` family + scope-authz/access-control/authz-resolver | `components/okf-server/routes/okf-routes.js:29–43`; `services/scope-authz-service.js`, `access-control-service.js`, `authz-resolver-service.js` |
| Retrieval semantics: dense cosine (`COSINE_SIMILARITY`), BM25 ArangoSearch view (`text_en`), RRF k=60, label filter default OR + Python defense-in-depth post-filter, `file_id` enrichment | `genieai_retriever_arangodb.py:1005–1006, 862, 903, 592`; `config.py:83,112,123`; `_chunk_passes_label_filter` :302; `file_id` :1222, :1257, :1930 |
| Query-instruction prefix mandatory, and already triplicated in repo | shared module `core/embedding_query_prefix.py` (chatqna :25, :2501 + retriever :108, :1711) **plus** a third Node reimplementation `okf-server/services/head-test-service.js:61,74` ("Mirrors … embedding_query_prefix.py") |
| CAP-1 identity join tolerated-absent (legacy graphs naturally have no meta row) | `genieai_retriever_arangodb.py:195–201` |
| `OKF_ENABLED` = compose replicas + BFF routing flag pattern | `docker-compose.yaml:322,615,870,1240,1284,1382`; `retrieval-config-client.js:113,450,571` |
| Compose has no `env_file`, no resource limits | no `env_file:` anywhere (explicit comment `docker-compose.yaml:1190`); zero `resources:` blocks |
| vLLM v0.29.0 compose-pinned | `docker-compose.yaml:1763,1846` |
| openai SDK `AsyncOpenAI` dataprep precedent, `VLLM_ENDPOINT` | `genieai_dataprep_arangodb.py:261,836–845` |
| TEI plain-HTTP client, okf-server Node precedent | `head-test-service.js` `teiEmbed` + credential-chain comment :54 |
| e2e SSE envelope single-sourced | `tests/e2e/helpers/stream-route.js` exists (2.9K) |
| `OTEL_SERVICE_NAME` compose↔source pair convention | `docker-compose.yaml:899–904, 1551–1553` |
| Agentic path mints `queries` doc; `conversations`/`messages`/`conversationFiles`/`queryMessages` shapes exist | `query-service.js:559,921`; `services/chat-history-service.js` |
| Research lane: candidates and their qualifiers (custom loop provisional per AM-2; pydantic-ai runner-up/fallback with ≤1-day swap-in; DSH corrected to "SDK subprocess, assessment outstanding" per AM-1) match research verdicts — no overclaim found | research extract §1; research.md Amendments AM-1/AM-2; spine AD-2, AD-5, Stack |
| AD-7 "prompt-only citation enforcement measured to make invention worse" | research extract §2 ([9]) |
| AD-4 intersection/impersonation model | research extract §2 ("claim verified", two independent sources) |
| AD-6 "no framework documents disconnect→loop→vLLM" | research extract §4 (OQ-7) |
| AD-8 AG-UI "pattern, not dependency", taxonomy wording | research extract §2 + REC-7 pattern-level caveat — spine does not claim adoption (OQ-4 respected) |
