# Review — Rubric Walker (good-spine checklist)

- **Target:** `ARCHITECTURE-SPINE.md` (initiative altitude, agentic foundations / OPEA-free, iteration 1)
- **Driving spec:** `prd-genie-ai-2026-11-16/prd.md` (status: final) + `research-extract.md`
- **Reviewer:** rubric walker, BMad architecture Reviewer Gate
- **Date:** 2026-11-16
- **Verdict:** **pass-with-fixes**

## Summary

The spine is strong. Every brownfield claim I could pin to the repo pinned
(verification log below); the AD set is enforceable and mostly self-checking;
the stack table is honest about repo-pinned vs web-verified; the PRD's feature
groups map cleanly. One real divergence point is missed (translation backend
legality under the OPEA-free rule — HIGH-1), one owned dimension is silent
(NFR-6 / CI runner availability — MED-1), and the k3s-chart venue is asserted
without a mechanism (MED-2). None require structural rework; all are
one-rule or one-row fixes.

## Findings

### HIGH

#### H-1 — Translation on the agentic path: the OPEA-free rule and the translation carry-over collide, and the spine never says which translation backend is legal

- **Spine sections:** AD-1 (OPEA-free is structural), AD-8 (translation
  compatibility carries over in both modes), AD-6 (translation counted as an
  auxiliary model call), Consistency Conventions (Config row — silent on
  translation).
- **Problem:** The repo ships two translation backends selected by the BFF's
  `translation-service.js` (`TRANSLATION_BACKEND=cpu|gpu|auto`):
  - GPU: `GpuTranslateBackend` → `vllm-translation-guardrail` (vLLM — clean).
  - CPU: `CpuTranslateBackend` → the compose `translation` service, which is
    `image: opea/translation:1.3`, compose profile `opea`
    (`docker-compose.yaml:1886-1895`) — an **OPEA-built service**.
  AD-8 commits the agentic path to full translation compatibility; AD-6 makes
  translation a budget-counted auxiliary call; AD-1/FR-20 ban calls to
  OPEA-built services *anywhere in the agentic request path*. On a
  CPU-backend deployment, the carry-over as written routes agentic requests
  through `opea/translation:1.3` — a violation of the initiative's headline
  constraint, or an undeclared carve-out nobody wrote. PRD §5's positive
  definition (comps + GENIE overlay wrappers) does not name the upstream
  image, but its negative list (vLLM, TEI, ArangoDB, Redis, GENIE Node
  services) doesn't either — the ambiguity is unresolved at exactly the seam
  two builders touch: the BFF-integration story and the agent-loop story can
  each assume the other owns translation, and wire it differently.
- **Fix:** One rule (extend AD-1 or AD-8): *on the agentic path, translation
  uses the vLLM translation backend only; the CPU `opea/translation` service
  is on the banned list for agentic requests; translation executes at the BFF
  (existing `translation-service.js`), not inside agent-service.* Also state
  the shared-BFF carve-out for the CI gate: the gate must fail on OPEA calls
  introduced *for* the agentic path without banning the legacy path's existing
  CPU-backend usage in the same shared code.

### MEDIUM

#### M-1 — NFR-6 (CI / runner availability, V09) is silently uncovered

- **Spine sections:** Capability → Architecture Map (no NFR-6 row); AD-1 (the
  only CI-adjacent AD — but it binds FR-6/FR-20/FR-21/FR-22 only).
- **Problem:** NFR-1..NFR-5 and NFR-7 all appear in AD binds or the map.
  NFR-6 ("executable CI/integration coverage and runner availability
  confirmed; checks needing a separate environment are identified — V09") is
  bound to nothing and absent from the map. It is not purely a PRD process
  item: the spine itself *creates* new CI surface (the AD-1 gate, the
  stream-route envelope extensions in AD-8, the pytest suite in
  `components/agent-service/tests/`) whose runner availability is exactly
  what NFR-6/V09 asks about — and the repo's E2E stage has no CI door
  (operator decision 2026-11-10).
- **Fix:** Add a map row (NFR-6 → CI gate + pytest suite + local E2E set,
  governed by AD-1) and one line in AD-1: new checks must state their runner
  (CI job vs local run) at delivery, feeding V09.

#### M-2 — "Both venues: Swarm compose and k3s chart" is asserted with no mechanism or owner for the chart half

- **Spine sections:** Structural Seed (deployment shape).
- **Problem:** No `Chart.yaml` exists on this branch; the umbrella chart
  (`genie-ai-umbrella`) lives on `feat/k8s-migration`, which is
  **operator-read-only** for agents (charts as deployment input only, never
  commit). The spine claims the k3s venue for agent-service (including
  replicas-gated-by-activation-flag) but names no process for adding the
  service to the chart — the current rules forbid the builders from doing it
  themselves. Left as is, the chart half is an unfunded venue claim.
- **Fix:** Either scope iteration 1's structural seed to the compose venue and
  list the chart addition as a deferred item with its owner (operator chart
  change), or add one line stating chart integration is an operator-owned step
  whose checklist (service block, flag-gated replicas, healthcheck) this seed
  defines. Do not leave it implicit.

### LOW

#### L-1 — Mermaid: node/subgraph ID collision on `AS`

- **Spine sections:** Invariants & Rules diagram.
- **Problem:** `BFF -- "flag ON" --> AS[agent-service]` declares node `AS`;
  `subgraph AS [components/agent-service]` then re-uses `AS` as a subgraph id.
  Node and subgraph ids share one namespace in mermaid; at best the standalone
  node renders separately from the box (edge points at the node, not the
  subgraph), at worst it errors by version. Rest of the diagram is
  well-formed and non-empty.
- **Fix:** Rename the subgraph (`subgraph AGENTSVC [components/agent-service]`)
  and point the edge at `AGENTSVC`; re-render once to confirm.

#### L-2 — FR-19 (licensing tiers) and FR-29 (ADR discipline) have no spine anchor

- **Spine sections:** Capability → Architecture Map (NFR-2 row mentions V07a
  only); no AD binds FR-19 or FR-29.
- **Problem:** FR-19's two tiers are gating obligations on this initiative's
  own artifacts: V07a gates D03 (referenced via AD-5's D03 hand-off, but not
  as a bound), V07b gates pre-release and appears nowhere. FR-29 (structural
  decisions recorded as ADRs, traceability chain, status-checking existing
  ADRs) is unmentioned — the spine's own ADs are exactly the records FR-29
  governs. Neither omission lets two units diverge, so LOW.
- **Fix:** One map-row line each: V07b → release gate (D05 hand-off); FR-29 →
  "spine ADs are mirrored as ADRs at stage gates, status-tracked".

#### L-3 — Evaluation-harness home unratified

- **Spine sections:** Capability → Architecture Map, FG-5 row; AD-10.
- **Problem:** AD-10 pins config B's *semantics* (no-agent mode of the same
  service, same budgets, shared retrieval backend — good), but nothing says
  where the E01/E02 harness lives. The repo already has `tests/rag-benchmarks/`
  (RAG evaluation harness) that the spine never mentions; the eval-builder
  story and the service-builder story can each assume a different home.
- **Fix:** One convention line: evaluation configs A/B/C run through the
  existing `tests/rag-benchmarks/` harness (extended), or name the new home.

## Checklist walk

1. **Real divergence points for the level below** — mostly yes: host/language
   (AD-2), port placement + authz-context shape (AD-3), permission
   intersection (AD-4), runtime seam (AD-5), budgets/cancellation counting
   (AD-6), citation pipeline + release policy (AD-7), SSE dialect + additive
   versioning (AD-8), activation/rollback + queries-doc shape (AD-9),
   retrieval parity semantics (AD-10), observability identity (AD-11),
   persistence non-proliferation (AD-12). **Missed:** translation backend
   legality (H-1); harness home (L-3).
2. **Every AD enforceable, prevents its stated divergence** — yes. AD-1's CI
   gate has an in-repo pattern to copy (tree-scanning jest suites in
   `tests/config-validator/`); AD-5's seam is testable and carries the
   ≤1-day swap-in exit test; AD-7's reference-validity check is mechanical by
   construction; AD-9's flag has the `OKF_ENABLED` precedent (compose replicas
   + routing, `docker-compose.yaml:322,1240`). AD-1 needs the shared-BFF
   carve-out from H-1 to stay enforceable.
3. **Deferred items letting two units diverge** — no. Every deferral names
   the seam that holds (D03→AD-5; budget numerics→AD-6 counting semantics
   fixed, only numbers deferred; D04 SSE half bound in AD-8; workflow layer
   defers *with* named seams). The FG-5 harness home (L-3) is the only soft
   edge.
4. **Named tech verified-current** — yes. Python 3.11 / FastAPI / openai SDK
   pinned-by-precedent at S3 (pii-service `fastapi==0.141.1`; openai in
   dataprep locks); vLLM `v0.29.0` compose-pinned (`docker-compose.yaml:1763`)
   and matching the extract's REC-6 framing; pydantic-ai `2.68.0` matches the
   research extract's web-verified 2026-11-16 state (with its MIT
   repo-verified/PyPI-empty caveat carried at PRD level); DSH correctly
   "assessment outstanding". The seed-style "as pinned at S3 start" avoids
   the stale-version trap.
5. **Ratifies the brownfield codebase** — yes, remarkably tightly. See
   verification log; zero contradictions found, including the subtle ones
   (dead `req.on('close')` documented verbatim in code; "no env_file in this
   repo" true per compose's own comment at line 1190 — the repo's
   ENVIRONMENT.md is the stale one).
6. **PRD capabilities covered** — FG-1..FG-5 all mapped; FR-1..FR-16,
   FR-17..FR-18, FR-20..FR-23, FR-25, FR-28, FR-30 all bound; silently
   uncovered: **NFR-6** (M-1); weakly anchored: FR-19 V07b half, FR-29 (L-2).
   FR-24/26/27 (eval protocol content) correctly stay at PRD level.
7. **Owned dimensions decided/deferred/open** — deployment & environments ✓
   (Structural Seed, flag, no new ports/stores/providers — with M-2's chart
   caveat); infra/provider strategy ✓ (shared GPU services unchanged); operations ✓
   (AD-11 observability, AD-9 rollback records + named operator, AD-6
   admission control vs shared vLLM/TEI, lane-cap capacity convention).
   No whole dimension left silent.
8. **Diagrams valid, non-empty** — one flowchart, non-empty, meaningful
   (rules ride on it); the `AS` id collision (L-1) is the only defect.

## Verification log (repo spot-checks, 2026-11-16)

| Spine claim | Evidence | Result |
|---|---|---|
| pii-service = non-overlay Python precedent | `components/pii-service/` (app.py, `fastapi==0.141.1`, `uvicorn==0.30.6`) | ✓ |
| BFF seam `initStreamQuery` | `query-routes.js:346` → `query-service.js:559` | ✓ |
| Both `POST /api/queries/stream` + non-stream `POST /api/queries` | `query-routes.js:313, :880` | ✓ |
| 5 SSE event types (`chunk`,`metadata`,`translation`,`done`,`error`) | `chatbotService.js:195-209` | ✓ |
| Every overlay Dockerfile clones GenAIComps | 4/4 `Dockerfile-*_genie-ai` match | ✓ |
| Dead `req.on('close')` path | `query-routes.js:649-655` — code comment: "this listener does not fire… nothing in here runs today" | ✓ |
| `OKF_ENABLED` = replicas + routing pattern | `docker-compose.yaml:322, 615, 870, 1240` | ✓ |
| okf-server authorities: scope-authz / access-control / authz-resolver / servingReads | `components/okf-server/services/{scope-authz,access-control,authz-resolver}-service.js`; `routes/okf-routes.js:29` | ✓ |
| BFF already assembles per-caller authorized graph set | `retrieval-config-client.js` ("per-caller authz graph set", `GET /api/okf/authz/graphs`) | ✓ |
| `okf_concepts_meta` exact-join | referenced across okf-server services/routes | ✓ |
| BM25 `text_en` | `retriever/config.py:123` (`HYBRID_BM25_ANALYZER` default `text_en`) | ✓ |
| RRF fusion k=60 | `config.py:112` (`HYBRID_RRF_K` default `"60"`); `rrf_fuse` at `genieai_retriever_arangodb.py:592` | ✓ |
| Label filter default OR | `config.py:83` (`ARANGO_FILTER_STRATEGY` default `"OR"`) | ✓ |
| Dense cosine brute-force default | `config.py:68` (`ARANGO_USE_APPROX_SEARCH` default `false`) | ✓ |
| file_id enrichment, CAP-1 tolerated-absent | `genieai_retriever_arangodb.py:193, 1222` (`chunk ? chunk.file_id : null`), CAP-1 refs | ✓ |
| Query-instruction embedding prefix mandatory | `get_query_instruction` imported `config.py:231`, `genieai_retriever_arangodb.py:108` | ✓ |
| vLLM v0.29.0 compose-pinned | `docker-compose.yaml:1763,1846` | ✓ |
| `queries` collection minted per turn | `query-service.js:262` (`db.collection('queries')`) | ✓ |
| No `env_file` in compose | compose's own comment, `docker-compose.yaml:1190` | ✓ |
| `OTEL_SERVICE_NAME` compose↔source pair | `docker-compose.yaml:904, 1553` | ✓ |
| urllib healthcheck / cap_drop / genieai_network | `docker-compose.yaml:1275-1276, 1373-1374`; 77 hardening hits; network pinned | ✓ |
| agent-service = first non-overlay Python service with OTel traces | no otel/tracing in pii-service | ✓ |
| SSE e2e envelope single-sourced | `tests/e2e/helpers/stream-route.js` (59 lines) | ✓ |
| CI tree-gate pattern exists | `tests/config-validator/__tests__/` (tree-scanning suites incl. `js-files`, `stray-copy-artifacts`, e2e locator/venue gates) | ✓ |
| `AGENT_*` env prefix free | no hits in compose/env | ✓ |

## Required fixes before acceptance

1. **H-1** — pin the agentic-path translation backend + execution point and
   the CI-gate carve-out (one rule, AD-1 or AD-8).
2. **M-1** — bind NFR-6/V09 (map row + AD-1 line).
3. **M-2** — give the k3s-chart venue an owner or scope it out of iteration 1.
4. **L-1..L-3** — recommended with the same edit pass.
