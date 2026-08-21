---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - prds/prd-genie-ai-2026-08-07/prd.md
  - prds/prd-genie-ai-2026-08-07/addendum.md
  - prds/prd-genie-ai-2026-08-07/.decision-log.md
  - architecture.md
  - epics.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-10
**Project:** genie-ai

## Step 1: Document Discovery

### PRD Documents

**Whole:**
- `prd.md` (260B, 2026-08-10) — explicit BMAD `prd_key` marker/pointer; no PRD content by design

**Sharded (canonical PRD, `status: final`):**
- Folder: `prds/prd-genie-ai-2026-08-07/`
  - `prd.md` (37.1KB, 2026-08-07)
  - `addendum.md` (3KB, 2026-08-07)
  - `.decision-log.md` (5.8KB, 2026-08-10)
  - `reconcile-inputs.md` (14KB, 2026-08-07)
  - `review-rubric.md` (14.2KB, 2026-08-07)
  - `polish-prose.md` (3KB, 2026-08-07)
  - `polish-structure.md` (5.2KB, 2026-08-07)

### Architecture Documents

**Whole:**
- `architecture.md` (23.3KB, 2026-08-07)

### Epics & Stories Documents

**Whole:**
- `epics.md` (22KB, 2026-08-10)

### UX Design Documents

⚠️ **WARNING: None found.** No `*ux*.md` or UX sharded folder exists. Assessment covers PRD, Architecture, Epics only; UX gaps flagged throughout.

### Issues Found

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | — | Root `prd.md` was a 34B stub | ✅ Resolved 2026-08-10 — now explicit marker pointing to canonical sharded PRD |
| 2 | ⚠️ WARNING | UX design document absent | Open — no UX spec to validate against |

## PRD Analysis

### Functional Requirements

**FR-1: Rebase the overlay onto OPEA v1.5** — Build pipeline clones OPEA at `v1.5` (GenAIComps in all 4 modules; GenAIExamples `ChatQnA@v1.5` in chatqna) and re-applies every overlay override (`core/constants.py`, `core/genieai_api_protocol.py`, `genieai_chatqna.py`, `entrypoint.sh`, `tracing.py`, `core/model_cache.py`, `core/label_contract.py`, `genieai_*` integration subclasses, build-time patches). Realizes UJ-1.

**FR-2: Preserve the Genie-owned RAG modules unchanged in intent** — Retriever, reranker, dataprep internals (dense COSINE + BM25 + RRF fusion, label filtering, contextual retrieval, graph traversal) keep behavior on 1.5. Only adapter contracts update. RAG behavior identical *within tolerance*; may improve where `langchain-arangodb` bump addresses known label-filter defect.

**FR-3: Migrate to Python 3.11** — All overlay images run Python 3.11 (matching v1.5 `python:3.11-slim` bases). `sitecustomize.py` SSL-bypass patch paths move from `python3.10` to `python3.11`; dataprep `update-alternatives` python3.10 machinery removed. Realizes UJ-1.

**FR-4: Adopt v1.5 dependency pins and compiled requirements** — Consume v1.5 pinned versions (langchain 0.3.27, langgraph 1.0.1, mcp 1.24.0, docling-core 2.44.2, v1.4+ `requirements-cpu.txt`/`requirements-gpu.txt` layout). Retire dataprep local lock machinery in favor of OPEA compiled lock, keeping `--require-hashes`. Per D7, compiled-lock extends to retriever and reranker. Realizes UJ-1, UJ-2.

**FR-5: Bump `langchain-arangodb`** — Move from `0.0.4` to latest compatible with v1.5 `langchain-core`; re-validate `ArangoVector` path. Known label-filter defect re-tested under new version. Realizes UJ-1.

**FR-6: Verify the coupling surfaces against v1.5** — Diff coupling surfaces v1.3→v1.5. **Blocking pre-rebase spike** proves `schedule()` kwargs-forwarding (6 custom kwargs: `retriever_parameters`, `reranker_parameters`, `full_chat_history_string`, `retrieval_context`, `original_language`, `user_details`) on bare v1.5 clone. Surfaces: `ServiceOrchestrator.align_inputs/outputs/align_generator` monkeypatch (chatqna:1240), `OpeaComponent`/`OpeaComponentLoader` lifecycle, `@register_microservice` + `opea_microservices` keys + kwargs 2nd hop, `api_protocol.py` Pydantic semantics, `comps.cores.proto.docarray.py` rename hack, `comps.cores.telemetry.opea_telemetry` (NOT renamed), dataprep `_parent_mod.ARANGO_DB_NAME` monkeypatch target, `MegaServiceOrchestrator` ctor/healthcheck/abstract surface, integration auto-discovery, override-audit manifest (`OVERRIDES.yaml`). Every monkeypatch gets behavioral assertion. Realizes UJ-1.

**FR-7: Regenerate the `constants.py` fork from v1.5** — Regenerate from v1.5 enum (no `TRANSLATOR`; slot 24 = `LANGUAGE_DETECTION`), re-append `TRANSLATOR` at end. All v1.5 `ServiceType` members preserved. Realizes UJ-1.

**FR-8: Sweep for import-time breaks (langgraph, comps modules)** — Check each overlay image for modules reaching langgraph 1.0.1 or new `comps` members (e.g. `ServiceType.PROMPT_REGISTRY`) at import time; fix or document. Realizes UJ-1.

**FR-9: Re-audit the build-time patches** — `fix_dependencies.sh` (retriever+reranker) `REQ_PATH` re-pointed to compiled lock; `docarray.py`→`opea_docarray.py` rename re-verified; dataprep Dockerfile `REQ_PATH` rewritten to `requirements-cpu.txt`; version-specific `sed` adjustments re-audited; `opencv-python-headless` re-confirmed. Realizes UJ-1.

**FR-10: Contract tests against real `comps` (not just imports)** — Import smokes for retriever/reranker/chatqna PLUS tests against real `comps@v1.5` with model/DB endpoints HTTP-mocked (no GPU), in-image (D3, isolated from mocked `conftest.py`). Components: orchestrator wire test (highest ROI — `align_inputs → schedule → align_generator`, six kwargs land), one-doc ingest smoke (docling 2.44.2), focused label-filter test, telemetry assertion (derived from Grafana provisioning), end-to-end cross-service pipeline contract test, NFR-P coarse budgets (D6). Red-green validated (green on v1.3 → red on bare v1.5). Realizes UJ-1.

**FR-11: Prove RAG parity (no regression)** — Compare RAG quality vs v1.3 baseline on `tests/rag-benchmarks` harness. v1.3 baseline captured as pre-rebase milestone (step 0): pinned corpus/queries/labels/model. Tolerance derived from baseline run-to-run variance, not guessed. Generation behavior uses defined rubric. Parity validated against **existing stored embeddings and existing graph data**. Realizes UJ-1.

**FR-12: Evidence the CVE posture in the container scan** — CVE gate is a diff against v1.3 baseline advisory (same scanner, same taxonomy, accept-list). Gate: **no net-new high/critical introduced by the bump**. CVE closures recorded as positive outcome. Realizes UJ-1.

**FR-13: Run the full test suites green** — Full backend/frontend/OPEA/component suites pass on upgraded overlay (pytest + affected Jest). Realizes UJ-1.

**FR-14: Fix the two latent dataprep/retriever bugs** — (1) dataprep retract default mismatch (`genie_graph` vs `GRAPH`) unified; (2) stale `RETRIEVER_ARANGO_GRAPH_NAME` env hint corrected to `ARANGO_GRAPH_NAME`. Realizes UJ-2.

**FR-15: Pin the AI-stack image tags (no `:latest`, no split-brain)** — vllm chat service → pinned `v0.10.x` tag; embedding/textgen wrapper bases pinned to 1.5-based upstream images (avoids split-brain). Translation in scope explicitly: `TRANSLATOR` branch rides chatqna rebase; `vllm-translation-guardrail` already pinned (v0.10.0). Lands as own commit. Realizes UJ-2.

**FR-16: Canary on `release/el-salvador` before `main`** — Validate on deployed El Salvador stack with explicit exit criteria (observation window, error-rate/latency thresholds, RAG-quality spot-check, no ingest anomalies). **Side-by-side shadow comparison** (v1.3 vs v1.5 images) required (D5). Realizes UJ-1, UJ-2.

**FR-17: Keep rollback to v1.3 one step away — proven, not asserted** — v1.3 digests retained by explicit registry retention rule. Rollback rehearsed in staging: deploy 1.5, run parity, redeploy v1.3, prove v1.3 reads data written by v1.5 (backward-read check, no schema/vector-payload change). If backward-read fails, canary runs on throwaway data. Realizes UJ-2.

**FR-18: Update docs, env, and the upgrade matrix** — CLAUDE.md/env references updated (e.g. `RERANKER_TOP_N` default drift, dependency pins, Python version). Upgrade matrix gains v1.3→v1.5 entry. Upgrade matrix/`CHANGELOG` bound to same MR moving `OPEA_VERSION` (pattern 9); CI asserts no `NEXT` placeholder. Realizes UJ-1, UJ-2.

**FR-19: Confirm the targeted upstream improvements land** — Enumerate concrete improvements/bug fixes from v1.4/v1.5 changelogs (docling/langchain/chunking fixes, dataprep/retriever upstream fixes, CVE closures), verify named ones present in deployed images. Realizes UJ-1.

**Total FRs: 19**

### Non-Functional Requirements

**NFR-S1 (Security):** Supply-chain integrity — CycloneDX SBOM and signed images for upgraded images (per ADR-0001); scan stage remains blocking gate. (FR-12)
**NFR-S2 (Security):** CVE posture — bump must not introduce net-new high/critical CVE. (FR-12)
**NFR-S3 (Security):** No new secrets/credentials in images; non-root containers preserved.
**NFR-R1 (Reliability):** RAG reliability parity — retrieval/ingest must not regress under load. (FR-11)
**NFR-R2 (Reliability):** Rollback — previous image tags deployable with zero config change. (FR-17)
**NFR-R3 (Reliability):** Graceful degradation — failed upgrade never leaves deployment half-migrated. (FR-16, FR-17)
**NFR-M1 (Maintainability):** Remove dead divergence (v1.3-era lock machinery) rather than carry it. (FR-4)
**NFR-M2 (Maintainability):** Overlay remains single-source override set; no more OPEA files forked than v1.3. 
**NFR-P1 (Performance):** No latency regression on RAG pipeline vs v1.3 (within documented tolerance). (FR-11)
**NFR-P2 (Performance):** No ingestion-throughput regression (dataprep). (FR-11)
**NFR-C1 (Compatibility):** No breaking env-var/API/schema change for deployments (behavior-neutral). (FR-16, FR-17)
**NFR-C2 (Compatibility):** Image tags pinned; no `:latest` in AI stack after this PRD. (FR-15)
**NFR-C3 (Compatibility):** `docker-compose.yaml` changes limited to pins and `okf-server`-irrelevant surface. (FR-15)
**NFR-T1 (Observability):** OTel tracing parity across pipeline — spans propagate as before on 1.5. (FR-6)

**Total NFRs: 14** (4 security, 3 reliability, 2 maintainability, 2 performance, 3 compatibility, 1 observability)

### Additional Requirements

**User Journeys:** UJ-1 (Jerome runs upgrade, proves parity), UJ-2 (deployer rolls out new images).

**Success Metrics:** SM-1..SM-7 (primary: build+contract tests, RAG parity, CVE posture, zero silent breaks; secondary: canary, dead-divergence removal, upstream improvements). Counter-metrics SM-C1..C4 (no newest-dep chase, no tests-count-for-parity, no CVE gaming, coupling surface ≤ v1.3).

**Non-Goals:** No agentic-enablement; no OKF/SST; no v1.6+; no RAG-module rewrite; no K8s migration; no per-CVE acceptance list.

**Pre-rebase milestones (§6.1):** (a) baseline capture, (b) `schedule()` spike — blocking gate, (c) pre-rebase cleanup as separate v1.3 commit, (d) contract+smoke tests green on v1.3. Rebase per-module incremental: retriever → reranker → dataprep → chatqna last.

**Assumptions (3, §11):** compiled-lock hashes verified during FR-4; `langchain-arangodb` compatible release exists; no sprint collision in `genieai_chatqna.py`.

**Open Questions (10, §10):** spike outcome (OQ-1), langchain-arangodb version (OQ-2), baseline specifics (OQ-3), canary thresholds (OQ-4), ownership/timeline (OQ-5), `RERANKER_TOP_N` drift (OQ-6), compiled-lock hashes (OQ-7), upstream improvements list (OQ-8), whisper restore/drop — resolved D8 (OQ-9), retriever/reranker compiled-lock — resolved D7 (OQ-10).

### PRD Completeness Assessment

- PRD is `status: final`, capability-level, with globally numbered stable FR IDs (19 FRs, 14 NFRs).
- Every FR maps to UJ-1 or UJ-2 (or both); every FR has explicit **Consequences**.
- Assumptions inline-tagged `[ASSUMPTION: …]` and indexed in §11 — consistent.
- Open questions segregated: 2 resolved by architecture (OQ-9 D8, OQ-10 D7), 7 genuinely open and sequenced into execution, 1 (OQ-6 `RERANKER_TOP_N`) scoped as docs/parity-baseline, not behavior change.
- Security-relevant note: reviewer found 10/19 FRs lack a validating SM — deferred (non-blocker) at launch approval.
- UX design document absent — no user-facing UI change expected from this upgrade (behavior-neutral mandate), which mitigates but does not eliminate the gap.
- **Strong, traceable PRD.**

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement (summary) | Epic Coverage | Story | Status |
|----|--------------------------|---------------|-------|--------|
| FR-1 | Rebase overlay onto v1.5 (4 Dockerfiles + clones) | Epic 2 | 2.1, 2.3–2.6 | ✓ Covered |
| FR-2 | Preserve Genie-owned RAG modules | Epic 2 | 2.3–2.6 | ✓ Covered |
| FR-3 | Python 3.11 migration | Epic 2 | 2.2 | ✓ Covered |
| FR-4 | v1.5 pins + compiled locks (D7) | Epic 2 | 2.2 | ✓ Covered |
| FR-5 | `langchain-arangodb` bump | Epic 2 | 2.3 | ✓ Covered |
| FR-6 | Coupling-surface verification + kwargs spike | Epic 1 + Epic 2 | 1.3, 2.1, 2.3–2.6 | ✓ Covered |
| FR-7 | `constants.py` regen + TRANSLATOR | Epic 2 | 2.1 | ✓ Covered |
| FR-8 | Import-time break sweep | Epic 2 | 2.8 | ✓ Covered |
| FR-9 | Build-time patch re-audit | Epic 2 | 2.4, 2.5, 2.7 | ✓ Covered |
| FR-10 | Contract tests against real comps (in-image, D3) | Epic 1 + Epic 2 | 1.5, 2.3–2.6 | ✓ Covered |
| FR-11 | RAG parity vs locked baseline | Epic 1 + Epic 3 | 1.1, 3.1 | ✓ Covered |
| FR-12 | CVE posture baseline-diff | Epic 1 + Epic 3 | 1.2, 3.2 | ✓ Covered |
| FR-13 | Full test suites green | Epic 2 + Epic 3 | 2.8, 3.3 | ✓ Covered |
| FR-14 | Latent dataprep/retriever bugs | Epic 4 | 4.1 | ✓ Covered |
| FR-15 | Pin AI-stack image tags | Epic 4 | 4.2 | ✓ Covered |
| FR-16 | Canary el-salvador + shadow (D5) | Epic 4 | 4.3 | ✓ Covered |
| FR-17 | Rollback rehearsed + backward-read | Epic 4 | 4.4 | ✓ Covered |
| FR-18 | Docs/env/upgrade matrix | Epic 4 | 4.5 | ✓ Covered |
| FR-19 | Upstream improvements land | Epic 3 | 3.4 | ✓ Covered |

### Missing Requirements

**None.** All 19 PRD FRs have a traceable implementation path in the epics.

### Coverage Statistics

- Total PRD FRs: **19**
- FRs covered in epics: **19**
- Coverage percentage: **100%**
- FRs in epics not in PRD: 0
- NFR coverage: 14/14 NFRs (all 4 S, 3 R, 2 M, 2 P, 3 C, 1 T groups present; NFR-P1/P2 combined in epics inventory)
- UX NFRs: N/A — no UI change (epics §UX Design Requirements confirms)

### Coverage Notes

- Architecture-driven requirements (pre-rebase milestones a–d, per-module order, OVERRIDES.yaml lint, assert-on-patch, versions.env, verify:evidence, shadow comparison, config-parity, evidence ledger) are carried as Additional Requirements in epics and realized by Stories 1.1–1.5, 2.1, 2.7, 3.5, 4.3.
- Multi-epic FRs correctly split baseline/evidence work (Epic 1) from execution (Epic 2/3).
- Story 3.5 (evidence ledger + verify:evidence gate) has no single FR anchor but enforces FR-10/FR-11/FR-12 artifact completeness — legitimate cross-cutting enforcer.

## UX Alignment Assessment

### UX Document Status

**Not Found.** No `*ux*.md` or sharded UX folder in planning-artifacts (verified step 1).

### Implied-UX Assessment

- PRD §1 defines the upgrade as "**invisible to end users**" — behavior-neutral by contract; no UI surface changes.
- PRD §2 user journeys (UJ-1 Jerome/upgrade + parity, UJ-2 deployer rollout) are **platform-engineer/deployment workflows**, not end-user UI flows — they describe CLI/CI/registry operations, not screens.
- Epics §UX Design Requirements: "N/A — no UI change in this upgrade (backend/infra-only)."
- All 4 epics touch backend/infra surfaces only (overlay Dockerfiles, comps contracts, CI, images, deployment). No web/mobile component implied.
- No new user-facing feature or interaction pattern introduced; therefore **no UX spec is required** for this PRD.

### Alignment Issues

None. No UX requirements exist to align against PRD or Architecture.

### Warnings

- ⚠️ Low-severity: no UX document exists. Acceptable here (backend/infra-only, behavior-neutral mandate) but noted for completeness — if the OPEA 1.5 rebase surfaces any incidental UI-facing behavior change during canary (FR-16 RAG-quality spot-check), a UX note should be captured then.
- No architectural gap: PRD NFR-P1 (latency), NFR-T1 (tracing) that a UI would observe are covered by contract tests (FR-10, D6) and canary exit criteria (FR-16).

## Epic Quality Review

### Epic Structure Validation

#### A. User Value Focus

| Epic | Title | User outcome framing | Verdict |
|------|-------|----------------------|---------|
| 1 | Upgrade foundation — provable-parity groundwork | "The upgrade can be proven before it touches a Dockerfile" — enables safe, provable upgrade (platform-engineer JTBD) | 🟡 Foundation, no user-visible value alone; acceptable for infra upgrade, JTBD-anchored |
| 2 | OPEA 1.5 overlay rebase (behavior-preserving) | "The overlay runs on OPEA 1.5 with preserved behavior" — the actual upgrade lands | ✅ |
| 3 | Verification & parity proof | "proven behavior-neutral and secure" — trust/evidence outcome | ✅ |
| 4 | Operational readiness & rollout | "ships safely, is reversible, and is documented" — deployer outcome | ✅ |

**Assessment:** This is a brownfield infrastructure upgrade; the "user" is the platform engineer/deployer (PRD §2.1 JTBD). No epic is a bare technical milestone in the forbidden sense (Setup Database / Create Models) — each names an outcome. Epic 1 is the only foundation-heavy epic and its framing ties to the safety JTBD. Not a violation; noted.

#### B. Epic Independence

- Epic 1 stands alone (baseline, spike, cleanup, red-green contract tests on v1.3). ✅
- Epic 2 uses only Epic 1 outputs (contract-test suite 1.5, spike outcome 1.3, cleanup commit 1.4, baseline 1.1). ✅
- Epic 3 uses Epics 1+2 outputs (baseline 1.1, CVE baseline 1.2, v1.5 stack from Epic 2). ✅
- Epic 4 uses Epics 1–3 outputs (v1.5 images from Epic 2, parity evidence from Epic 3 for shadow 4.3). ✅
- **No forward dependencies** (no epic requires a later-numbered epic). ✅
- No circular dependencies. ✅

**Note (non-violation):** Epic 4 stories 4.1 (latent bugs) and 4.2 (image pinning) are independent of Epics 2/3 — PRD FR-15 explicitly requires 4.2 to land as its own commit. They *could* be scheduled in parallel with Epic 2. Scheduling flexibility, not a defect.

### Story Quality Assessment

#### A. Story Sizing

- 23 stories across 4 epics; each story is one completable unit with a user-voice `As a … / I want … / So that …`. ✅
- 🟡 **Story 2.2** bundles dependency pins + compiled locks + Python 3.11 migration + `sitecustomize`/`update-alternatives` — broad but cohesive (one deterministic-build outcome). Defensible; flag only.
- 🟡 **Story 2.7** bundles assert-on-patch guards + `versions.env` + coherence lint + `verify:evidence`/mutation-probe scaffolding — three enforcement mechanisms in one story. Borderline; recommend splitting if effort overruns.
- 🟡 **Story 2.8** bundles import-time sweep + conftest re-baseline. Two distinct validation concerns; borderline.

#### B. Acceptance Criteria Review

- **Format:** Every story uses proper **Given/When/Then** BDD. ✅
- **Testable:** Each AC names a concrete observable (artifact committed, image builds, test passes in-image, no `:latest` remains, criteria pass + sign-off). ✅
- **Error paths covered:** Story 1.3 covers the "kwargs drops" branch (D1 contingency); 3.2 covers net-new high/critical blocking; 4.3 covers canary failure → revert; 2.7 covers stale patch / mixed-version → CI fail; 3.5 covers mutation probe re-run. ✅
- **Specific outcomes:** numeric where needed (N runs, min/median/max, v0.10.x tag, 6 custom kwargs, no `:latest`). ✅

### Dependency Analysis

#### A. Within-Epic Dependencies

- **Epic 1:** 1.1/1.2/1.3 mutually independent (parallelizable); 1.4 independent; 1.5 uses none of 1.1–1.4 as hard inputs (owns its own bare v1.5 clone). No forward refs. ✅
- **Epic 2:** ordered core (2.1) → deps (2.2) → retriever (2.3) → reranker (2.4) → dataprep (2.5) → chatqna last (2.6) → patches (2.7) → sweep (2.8). Story 2.1 asserts "no module rebase assumes an uncommitted core version" — correct ordering. Story 2.6 references the wire test suite from 1.5 — prior-art, not forward. ✅
- **Epic 3:** 3.1 (baseline from 1.1) → 3.2 (CVE baseline from 1.2) independent; 3.3 needs 2.8's re-baselined conftest; 3.4 needs FR-19 enumeration (deferred OQ-8); 3.5 aggregates 1–3 artifacts. ✅
- **Epic 4:** 4.1/4.2 independent of each other and of 3.x; 4.3 needs Epic 2 images + parity (Epic 3); 4.4 needs Epic 2 images; 4.5 needs the `OPEA_VERSION` MR (Epic 2). ✅
- **No story references a not-yet-implemented feature.** ✅

#### B. Database/Entity Creation Timing

- **N/A — no schema changes** in this initiative (FR-17 explicitly asserts backward-read compatibility; no new collections). No violation.

### Special Implementation Checks

- **Starter template:** N/A — brownfield project. ✅
- **Brownfield indicators:** present — integration points (OPEA comps contracts), compatibility (NFR-C1), migration (dependency/Python 3.11), rollback (FR-17). ✅
- **Pre-rebase milestones** (PRD §6.1 a–d) correctly landed as Epic 1 stories in dependency order. ✅

### Best Practices Compliance Checklist

- [x] Epics deliver user value (JTBD-framed outcomes; Epic 1 foundation acceptable for infra upgrade)
- [x] Epics function independently (no forward deps; Epic 4.1/4.2 parallelizable bonus)
- [x] Stories appropriately sized (2.2/2.7/2.8 borderline — flagged)
- [x] No forward dependencies
- [x] Database tables created when needed (N/A — no schema change)
- [x] Clear acceptance criteria (BDD, testable, error paths)
- [x] Traceability to FRs maintained (FR coverage map + 100% matrix, step 3)

### Quality Findings Summary

**🔴 Critical:** none.

**🟠 Major:** none.

**🟡 Minor:**
1. **Terminology drift — "8-kwargs" vs "6 custom kwargs"** (Story 2.6). PRD FR-6 consistently says 6 custom kwargs (`schedule()` signature has 8 total = 2 base + 6 custom). Epics Story 2.6 says "`schedule()` 8-kwargs" without clarifying base-vs-custom. Already flagged as deferred in decision-log review #6. **Fix:** add "(`schedule(initial_inputs, llm_parameters, **kwargs)`; 6 custom) to Story 2.6.
2. **No explicit story→story dependency list.** Dependencies are implied by ordering only. **Fix (optional):** add a `Dependencies:` field per story for machine-checkability.
3. **Epic 1 framing** could misread as a technical milestone; description is adequate but adding an explicit "Value: upgrade is provable" line strengthens JTBD anchoring.
4. **Story 2.7/2.8 bundling** — three enforcement mechanisms (2.7) and two validation concerns (2.8) in single stories. **Fix (if effort overruns):** split 2.7 into (a) patch guards + versions.env + lint, (b) verify:evidence scaffolding; split 2.8 into (a) import sweep, (b) conftest re-baseline.

### Recommendations

1. Adopt Minor #1 (terminology) before implementation to avoid a reviewer/implementer misreading the kwargs contract.
2. Keep 2.7/2.8 as-is unless they exceed sprint capacity; splitting is low-risk if needed.
3. Optionally annotate stories 4.1/4.2 as "independent — may parallelize with Epic 2" for sprint planning.

## Summary and Recommendations

### Overall Readiness Status

**READY — with minor polish recommended before implementation.**

The PRD (`status: final`), Architecture (READY FOR IMPLEMENTATION), and Epics (validated, 100% FR coverage) form a complete, aligned, traceable set for the OPEA 1.3→1.5 upgrade. No critical or major blockers exist. Four minor, non-blocking polish items are noted.

### Critical Issues Requiring Immediate Action

**None.** No 🔴 critical or 🟠 major issues found across any assessment dimension:
- Document discovery: no unresolved duplicates (root `prd.md` is an explicit marker pointing to canonical sharded PRD).
- PRD analysis: 19 FRs + 14 NFRs extracted, all with stable IDs, consequences, and UJ traceability.
- Epic coverage: 19/19 FRs covered (100%); no orphan FRs; architecture requirements carried into stories.
- UX alignment: no UX doc needed (backend/infra-only, behavior-neutral mandate) — low-severity warning only.
- Epic quality: no structural violations; independence, BDD ACs, error paths, and traceability all verified.

### Recommended Next Steps

1. **Fix terminology drift before coding:** Story 2.6 "`schedule()` 8-kwargs" → clarify "`schedule(initial_inputs, llm_parameters, **kwargs)`; 6 custom kwargs (`retriever_parameters`, `reranker_parameters`, `full_chat_history_string`, `retrieval_context`, `original_language`, `user_details`)" — matches PRD FR-6 and avoids misreading the kwargs contract.
2. **(Optional) Annotate parallelizable stories:** mark Epic 4 Stories 4.1/4.2 as independent of Epics 2/3 for sprint-planning flexibility (FR-15 requires 4.2 as its own commit anyway).
3. **(Optional) Add `Dependencies:` fields to stories** for machine-checkable dependency ordering (currently implied by sequencing).
4. **(Optional) Keep an eye on Story 2.7/2.8 sizing** — split if they exceed sprint capacity (three enforcement mechanisms / two validation concerns respectively).
5. **Begin Phase 4 execution** in the PRD-specified order: pre-rebase milestones (baseline capture → `schedule()` spike → cleanup commit → contract tests green/red) before any Dockerfile change; per-module rebase retriever → reranker → dataprep → chatqna last.

### Final Note

This assessment identified **0 critical, 0 major, and 6 minor observations** across 5 categories (documentation completeness, FR/NFR extraction, epic coverage, UX, epic quality). No issue blocks implementation. The planning artifacts are implementation-ready; the minor polish items (chiefly the Story 2.6 kwargs terminology) are recommended before Phase 4 to prevent an implementer or reviewer from misreading the single highest-severity risk surface (silent kwargs-drop → ungrounded chat).

---

*Assessed 2026-08-10 — Expert Product Manager, requirements-traceability review.*
*PRD: `prds/prd-genie-ai-2026-08-07/prd.md` (final) · Architecture: `architecture.md` · Epics: `epics.md` · UX: none (N/A).*
