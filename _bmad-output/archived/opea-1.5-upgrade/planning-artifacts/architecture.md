---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - prds/prd-genie-ai-2026-08-07/prd.md
  - prds/prd-genie-ai-2026-08-07/addendum.md
  - prds/prd-genie-ai-2026-08-07/.decision-log.md
  - research/opear15-upgrade-verification-review-2026-08-07.md
  - research/deep-research-labeling-retrieval-report.md
  - research/contextual-retrieval-evaluation-report.md
workflowType: 'architecture'
project_name: 'genie-ai'
user_name: 'Jerome'
date: '2026-08-07'
lastStep: 8
status: 'complete'
completedAt: '2026-08-07'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Input basis

- **PRD:** OPEA 1.3 → 1.5 Upgrade (`prds/prd-genie-ai-2026-08-07/prd.md`, `status: final`, 19 FRs)
- **Scope note:** behavior-neutral framework-version upgrade (overlay rebase) — architecture is **lean**, focused on the per-module re-graft design, coupling-surface verification, and migration/rollback sequencing that downstream epics/stories need. Not a greenfield system design.

## Project Context Analysis

*(Step 2 — accepted after party-mode roundtable (Winston/Amelia/Murat) + user directive.)*

### Requirements Overview
**Functional Requirements:** 19 FRs in 5 features — (1) overlay rebase to OPEA v1.5 (FR-1/2), (2) dependency + Python 3.11 migration (FR-3/4/5), (3) coupling-surface verification (FR-6/7/8/9), (4) quality gates — contract tests, RAG parity, CVE evidence, suites (FR-10..13, 19), (5) operational readiness — latent bug fixes, image pins, canary, rollback, docs (FR-14..18).

**Non-Functional Requirements:** NFR-S supply chain/CVE; NFR-R parity + rollback; NFR-M maintainability (dead divergence, surface size); NFR-P performance parity (needs a verifying assertion, not just declaration); NFR-C deployment compat (behavior-neutral); NFR-T telemetry parity (assertions derived from `configs/grafana/provisioning/`).

### Scale & Complexity
- **MEDIUM code delta, HIGH assurance-engineering effort.** The change surface is small (4 Dockerfiles, overlay files, build patches), but the architecture's deliverable is *proof of behavior parity* — proving a negative is harder than building a feature, and ~70% of the work is verification. Complexity is justified by the **detection cost of silent failures**, not diff size.
- Primary domain: Python/OPEA microservices + Docker build tooling + infra.
- Verification scaffolding is the largest net-new architectural element this PRD introduces.

### Architectural Components (grouped by touch-type)
- **Code-touching:** chatqna (last, highest coupling — `schedule()` kwargs contract, `align_*` monkeypatch, TRANSLATOR branch), dataprep (docling 2.44.2, compiled `requirements-cpu.txt`, `_parent_mod` monkeypatch), retriever (`langchain-arangodb` bump — the silent-retrieval-risk), reranker (`fix_dependencies.sh` REQ_PATH), core overlay layer (`constants.py`, `genieai_api_protocol.py`, `label_contract.py`, `model_cache.py`).
- **Image-touching:** the 4 OPEA-clone images + embedding/textgen wrapper bases (retag, not rebase) + vLLM base — **one canonical image change-set** for rollout/rollback (FR-15 split-brain: every image whose base/clone carries OPEA_VERSION moves together).
- **Config-touching:** docker-compose pins, env, CI jobs (smoke stage, cache-busting).
- **Verification scaffolding (its own component):** contract tests against real `comps` inside the built image, RAG-parity harness, CVE baseline-diff, image-content assertions.

### Technical Constraints (load-bearing)
- **Live-corpus vector-space contract.** Parity must validate against existing stored embeddings + graph data, not re-ingested docs; the `langchain-arangodb` bump can silently degrade deployed retrieval.
- **Rollback backward-read.** v1.3 images must read v1.5-written ArangoDB data (forward is cheap, backward is the constraint); "no schema/vector-payload change" is a diffed check, not an assumption.
- **Overlay-override audit (user directive).** Every override — file overwrites, monkeypatches, injected subclasses, build patches — is challenged on 1.5: **still-needed / re-graft-to-new-API / obsolete-remove**. Re-graft is never blind.
- **`constants.py` fork = permanent maintenance debt.** Regenerated from v1.5's enum each bump; `TRANSLATOR` re-appended at the end (v1.5 moved slot 24 to `LANGUAGE_DETECTION`); name→int mapping asserted (values may serialize into traces/messages).
- **Inverted compat direction.** comps@1.5 vs the already-ahead runtime (vLLM v0.10.x, TEI 1.9.3) is an upstream-unverified pairing → **shadow comparison is non-optional**, not preferred-where-infra-allows.
- **`schedule()` spike needs named fallbacks.** If v1.5 `execute()` drops the custom kwargs: (a) subclass orchestrator to inject kwargs, (b) side-channel via a request context object, (c) overlay-pin v1.3 orchestrator files. Spike outcome maps to an action.
- **Assert-on-patch convention.** Every `sed`/`mv`/`fix_dependencies.sh` patch ends with `grep -q <marker> || exit 1`; the docarray `mv` is followed by an import check — stale patches **break the build**, not ship silently.
- **Clean-build guarantee.** `OPEA_VERSION` as a cache-busting ARG; upgrade CI runs clean builds (no layer-cache reuse across the bump).
- **Mock-reality parity.** `conftest.py` `comps` stubs re-baselined to real v1.5 signatures — otherwise "full suites green" is green against a stale mock and hides the exact break the bump causes.
- **Pin-direction annotation.** docling-core 2.82.0→2.44.2 is a **downgrade** with chunking behavior-surface impact (covered by the FR-10 ingest smoke, which must run with **production config**: `CONTEXTUAL_RETRIEVAL_ENABLED` on, real `RERANKING_STRATEGY`).

## Implementation Patterns & Consistency Rules

*(Step 5 — accepted after roundtable (Amelia/Murat/Mary). Generic codebase conventions already governed by project-context.md/CLAUDE.md; these are the upgrade-specific rules agents must not diverge on.)*

1. **Override-audit (machine-checkable).** Every overlay override carries a disposition (`still-needed` / `re-graft-to-new-API` / `obsolete-remove`) in a committed YAML manifest (`override → disposition → owner → ticket`); record template `# OVERRIDE <module>.<name> | disposition: … | reason: … | test: …`. CI lint: an override in the v1.5 diff with no entry fails; `obsolete-remove` while the string is still present fails. Per-override test consequence: `still-needed` → existing test passes unmodified; `re-graft` → new contract test in the same commit; `obsolete-remove` → symbol-gone assertion (import raises) or zero-references grep artifact.
2. **Assert-on-patch (behavioral).** Guards assert the **old API surface is gone** and the new present (not a self-authored marker); patches idempotent or fail-fast (re-run must not double-append); the docarray import check runs inside the built image; the CI stage runs the scripts `allow_failure: false` and blocks.
3. **Contract-test (sensitivity + evidence).** Exact invocation: `docker run <image> pytest /contracts/test_contract_<module>_<name>.py -p no:cacheprovider`; self-contained (no mocked-conftest fixtures); exit-code contract; JUnit artifact. Each test asserts a **v1.5-specific shape** (green-on-green = not testing the upgrade). Red run recorded as a CI artifact. Plus **one end-to-end cross-service pipeline contract test** (retriever→reranker metadata carry, label-filter data contract, confidence distribution, streaming, abstention) — the test that proves "behavior-neutral" at the observable surface.
4. **Per-module migration (core first).** Order: **core → retriever → reranker → dataprep → chatqna**; one commit per module (`overlay(<module>): re-graft <module> to OPEA 1.5`); no module commit assumes an uncommitted core version. Diff source-of-truth pinned (`v1.5` tag + exact command). **Delta philosophy: re-grafted files byte-identical to upstream v1.5 except the lines carrying an override record.** A contract test revealing a 1.4→1.5 behavior change in a shared core symbol halts the migration → spike with evidence; **no shim/compat wrapper outside the spike gate**.
5. **Image coherence (manifest).** A `versions.env` (or CI build matrix) is the authoritative manifest of every `OPEA_VERSION`-bearing image; a coherence lint hard-fails on mixed versions; the retag is the same commit unit.
6. **Verification-artifact (locked + seeded + regression-set).** v1.3 CVE/SBOM baseline captured **before** migration (to prove remediation). Baseline locked as a **run-triple** (N runs, min/median/max) with `temperature=0`/seed/deterministic ordering; parity = within the variance band. Artifact records the exact env/config tested. Regression set includes **label-filter correctness, RAG confidence, abstention** — not just generic parity. `comps.__version__=="1.5"` is necessary but not sufficient → paired with a behavioral image-content assertion + a defined parity oracle (chunk counts, response schema, embedding dim).
7. **Rollback (whole-set + thresholded).** The coherent v1.3 image set is the revert unit (mixed old/new fleet = a new bug); retention pins all `OPEA_VERSION` tags together; backward-read has a defined scenario (deploy v1.3, run one canonical query, assert OK); CVE fail-rule explicit (decided, not agent-chosen).
8. **Clean-build.** `OPEA_VERSION` cache-busting ARG; no layer-cache reuse across the bump.
9. **Docs/upgrade-matrix link.** The same MR that moves `OPEA_VERSION` updates the upgrade matrix, `CHANGELOG`, and user-facing config notes; CI asserts no `NEXT` placeholder remains.
10. **Config-parity.** Resolved `env`/`docker-compose` defaults snapshotted with the locked image; a drift check fails if deployed config differs from the verified one. `RERANKER_TOP_N`'s three homes (code, compose, env template) pinned to one verified value.
11. **Canary-exit-criteria.** Explicit gates before promote: parity within tolerance vs the locked artifact, CVE ≤ baseline, backward-read OK, no observable-behavior regression on the deployed stack (E2E, not in-image) — then explicit sign-off.
12. **Evidence-ledger.** A committed audit trail (override dispositions + rationale, CVE baseline-diff, verification-artifact pointers) retained with the change-set; referenced by rollback retention and the sign-off gate.

### Enforcement (mandatory)
A `verify:evidence` CI stage (`allow_failure: false`) fails if any artifact — override manifest, parity report, red-run log, contract matrix, coherence check, backward-read output — is missing, stale, or empty; plus a **mutation probe** (deliberately break a contract / bump a version constant → pipeline must go red → revert) proving the gates are not theater.

## Project Structure & Boundaries

*(Step 6 — brownfield: the tree exists; annotated with upgrade changes + new architecture artifacts.)*

```text
genie-ai-overlay/
├── core/                        # FR-7 — constants.py regenerated from v1.5 + TRANSLATOR re-appended
│   ├── constants.py             #   genieai_api_protocol.py (Pydantic, FR-6 surface 5)
│   ├── model_cache.py / label_contract.py   #   unchanged unless 1.5 forces it
├── chatqna/                     # FR-1/2/6 — highest coupling, migrated LAST
│   ├── genieai_chatqna.py       #   align_* monkeypatch + schedule() 8-kwargs
│   ├── entrypoint.sh + keycloak_token_validator.py + metrics.py
│   └── Dockerfile-chatqna_genie-ai        # OPEA_VERSION bump + 2 clones
├── dataprep/                    # FR-3/4/9 — docling, compiled lock, _parent_mod
│   ├── genieai_dataprep_arangodb.py       #   _parent_mod → subclass (pre-rebase cleanup)
│   ├── genieai_dataprep_microservice.py   #   retract genie_graph (FR-14)
│   ├── requirements.in/.lock + scripts/   #   retired → v1.5 compiled lock (FR-4, D7)
│   └── Dockerfile-dataprep_genie-ai       #   REQ_PATH rewrite + sed audit (FR-9)
├── retriever/                   # FR-5 — langchain-arangodb bump
│   └── genieai_retriever_arangodb.py + genieai_retriever_microservice.py + Dockerfile
├── reranker/                    # FR-9 — fix_dependencies REQ_PATH
│   └── genieai_reranking_microservice.py + genieai_tei_reranker.py + Dockerfile
├── embedding/ textgen/          # FR-15 — retag to 1.5-based bases (NOT rebase)
├── build-patches/fix_dependencies.sh      # FR-9 — re-pointed + assert-guards (D4)
├── OVERRIDES.yaml               # NEW — override-audit manifest (pattern 1)
├── contracts/                   # NEW — contract tests vs real comps, run in-image (pattern 3)
└── tests/conftest.py            # re-baselined to real v1.5 signatures (mock-reality parity)
versions.env                     # NEW — authoritative OPEA_VERSION image manifest (pattern 5)
docker-compose.yaml              # FR-15 — vLLM pin; tags from versions.env
env                              # FR-18 — RETRIEVER_ARANGO_GRAPH_NAME, RERANKER_TOP_N pinned
.gitlab-ci.yml                   # NEW stages: contract-in-image · verify:evidence · coherence lint · clean-build
_bmad-output/implementation-artifacts/    # baseline, parity, red-run logs, evidence ledger
```

### Architectural Boundaries
- **Service boundaries:** each overlay module ↔ `comps` (the coupling surfaces, FR-6); behavior-neutral REST unchanged.
- **Build boundaries:** 4 clones at `OPEA_VERSION` + embedding/textgen retag (different mechanic); `versions.env` is the coherence source of truth (pattern 5).
- **Data boundary:** ArangoDB unchanged; vector-space compat is the binding constraint.
- **Verification boundary:** contract tests run inside the built image (isolated from mocked conftest); the mocked suite is re-baselined to real v1.5 signatures.

### Requirements → Structure Mapping
- FR-1/2 → Dockerfiles + overlay re-graft files · FR-3/4 → dataprep (Python 3.11, compiled lock) · FR-5 → retriever · FR-6 → all modules + `contracts/` · FR-7 → `core/constants.py` · FR-9 → build-patches + Dockerfile sed · FR-10 → `contracts/` · FR-11/12 → verification artifacts · FR-15 → `versions.env` + compose · FR-16/17 → deploy/canary/rollback · FR-18 → `env`/docs · FR-19 → changelog enumeration.

### Integration Points / File Organization
- **Config:** `env` + `docker-compose.yaml` + `versions.env` (single source for image versions).
- **Source:** overlay modules as-is; re-grafted files byte-identical to upstream v1.5 except override-record lines (pattern 4).
- **Tests:** `contracts/` (new, in-image) + existing suite (re-baselined).
- **Evidence:** `_bmad-output/implementation-artifacts/` (baseline, parity, red-runs, ledger).

## Artifact Lifecycle (post-upgrade cleanup policy)

*(User directive: what to keep vs clean after the upgrade.)*

- **KEEP (permanent verification infrastructure):** `contracts/` (becomes the standing regression suite vs real `comps`, run on every build — deleting re-introduces mocked-suite blindness), `OVERRIDES.yaml` (the living divergence ledger — maintained + extended on every rebase, never deleted), `versions.env` (authoritative image manifest), the CI stages (contract-in-image, coherence lint, `verify:evidence`, clean-build), and the assert-guards in the Dockerfiles.
- **RETAIN but not as source (evidence trail):** red-run logs, one-off parity dumps, baseline runs → CI artifacts / the evidence ledger (pattern 12), retained with the change-set/release for audit. The v1.3 baseline is versioned + retained as the reference for the next upgrade's parity.
- **CLEAN (transient only):** genuinely one-time outputs — and their result is recorded in the ledger before removal. If an artifact proves reusable (e.g. for OPEA 1.6), it is infrastructure, not ephemera.
- Net: cleanup = **no** for verification/audit infrastructure; **yes** only for transient one-off files, ledgered first.

## Architecture Validation Results

*(Step 7 — user-confirmed.)*

- **Coherence ✅** — D1–D8 + 12 patterns + structure internally consistent; cross-doc deltas = PRD refinements (D3/D5/D7/D8 → FR-10/16/4, OQ-9/10), tracked for reconciliation.
- **Requirements coverage ✅** — all 19 FRs mapped to structure; NFRs addressed: S (supply chain + CVE baseline-diff), R (parity + rollback backward-read), M (dead-divergence removal + surface size), P (verified via D6 assertions), C (behavior-neutral + config-parity), T (telemetry-from-dashboards assertion).
- **Implementation readiness ✅** — decisions versioned; patterns enforceable (assert-guards, `verify:evidence`, coherence lint, mutation probe); structure complete + specific.
- **Gap analysis:** no Critical gaps. **Important:** PRD reconciliation (architecture refines FR-4/10/16, resolves OQ-9/10) — address before epics. Nice-to-have: exact `langchain-arangodb` version, canary thresholds, FR-19 enumeration (execution-time).
- **Completeness checklist: 16/16.** Generic naming/communication/process conventions validated as governed by `project-context.md` + CLAUDE.md (not duplicated).
- **Overall status: READY FOR IMPLEMENTATION** (PRD-reconciliation is the pre-epics action). **Confidence: high** (verified against branch code + OPEA v1.5 upstream).
- **First implementation priority:** pre-rebase milestones — baseline capture → `schedule()` kwargs spike → cleanup-as-own-commit → contract tests green on v1.3.

## Core Architectural Decisions

*(Step 4 — decision principle per user directive: **cleanest architecture, not the easiest**.)*

### Decision Priority Analysis
- **Critical (block implementation):** D1 kwargs contingency, D2 override-audit removal, D3 contract-test isolation, D4 assert-on-patch, D5 shadow comparison.
- **Important (shape architecture):** D6 NFR-P assertions, D7 compiled-lock extension, D8 whisper-follow-upstream.
- **Deferred:** canary threshold values, FR-19 fix enumeration, `langchain-arangodb` exact version (PRD open questions — resolved during execution).

### Decisions
- **D1 — `schedule()` kwargs contingency.** If the pre-rebase spike fails, **subclass the orchestrator** to inject the 6 custom kwargs. Rationale: the proper OO override mechanism — explicit contract, no hidden state (side-channel via request context = hidden coupling), no vendored stale upstream files (file-pinning = dead divergence).
- **D2 — Override audit outcome.** "Obsolete-remove" is a real disposition: overrides upstream fixed in 1.5 are **deleted**, not carried. Every override carries a challenged disposition (still-needed / re-graft-to-new-API / obsolete-remove).
- **D3 — Contract-test isolation.** Contract tests against real `comps` run **inside the built image** as a **required CI stage per module** (`docker run <image> pytest <contract-suite>`) — also exercising the docarray rename hack, the compiled lock, and Python 3.11 `sitecustomize`. Not a dev-venv preference.
- **D4 — Assert-on-patch.** Every build-time patch ends with a guard (`grep -q <marker> || exit 1`; the docarray `mv` is followed by an import check) — a stale patch **fails the build**, never ships silently.
- **D5 — Shadow comparison: required.** comps@1.5 vs the already-ahead runtime (vLLM v0.10.x, TEI 1.9.3) is an upstream-unverified pairing; real-traffic side-by-side is the only honest validation (refines PRD FR-16's "where infra allows").
- **D6 — NFR-P verification.** Coarse latency + ingest-throughput assertions added to the contract layer (wire-test latency budget; one-doc ingest wall-clock budget) — an NFR without a verifying assertion is declared, not enforced.
- **D7 — Compiled-lock adoption extended.** The v1.4+ compiled-lock pattern applies to **retriever and reranker**, not just dataprep — deterministic, SBOM-able builds fleet-wide. Deferring leaves the fleet half-migrated and contradicts NFR-M1 (refines PRD FR-4/SM-6 + OQ-10).
- **D8 — Follow upstream's compiled lock.** `openai-whisper` restored if v1.5 pins it and it builds on the displayless image; any divergence from upstream's lock carries a documented reason (refines PRD OQ-9).

### Data Architecture
ArangoDB unchanged. The binding constraint is **vector-space compatibility with the live corpus**: no schema or vector-payload change; backward-read (v1.3 reads v1.5-written data) verified as a diffed check.

### Authentication & Security
Keycloak/Kong unchanged. Supply-chain gates as decided (SBOM, signed images, CVE baseline-diff, blocking scan).

### API & Communication
REST unchanged; behavior-neutral contract. No API surface change.

### Frontend Architecture
N/A — no frontend change in this PRD.

### Infrastructure & Deployment
Docker Swarm unchanged. One canonical image change-set (4 OPEA-clone images + embedding/textgen wrapper bases + vLLM tag) for rollout/rollback; assert-on-patch in Dockerfiles; `OPEA_VERSION` as a cache-busting ARG with clean-build CI; canary + required shadow comparison + rehearsed rollback (backward-read).

### Decision Impact Analysis
**Implementation sequence:** pre-rebase milestones (baseline capture → kwargs spike → cleanup-as-separate-commit → contract tests green on v1.3) → per-module bump (retriever → reranker → dataprep → chatqna last) → parity + CVE evidence → canary with shadow → `main`.
**Cross-component dependencies:** the core overlay layer (`constants.py`, `genieai_api_protocol.py`, `label_contract.py`, `model_cache.py`) touches every module; the verification scaffolding gates every module; the image change-set must move together (no split-brain).

### PRD deltas to reconcile (when architecture lands)
- FR-4/SM-6: extend compiled-lock retirement to retriever/reranker (D7).
- FR-10: contract tests inside the built image = required (D3); add NFR-P coarse budgets (D6).
- FR-16: shadow comparison required (D5).
- OQ-9/OQ-10: resolved per D8/D7.

## Starter Template Evaluation — N/A

*(Step 3 — not applicable.)* This step assumes a greenfield scaffold (Next.js/Vite/Flutter starter evaluation). This initiative is a **brownfield framework-version upgrade** of an existing stack (Node/Express + Vue 3 + OPEA + ArangoDB + Docker Swarm); no starter template applies and web-searching scaffolds would be theater. The "foundation" is the existing system being upgraded. Proceed to architectural decisions.

### Cross-Cutting Concerns
- Overlay ↔ `comps` coupling surfaces (span all 4 Python modules).
- **Silent no-ops** — build-time (`sed`/`mv`/`REQ_PATH` matching nothing) and runtime (monkeypatches that don't bind) — the failure class that green CI cannot see.
- **Verification-as-the-product** — mocked-suite blindness justifies contract tests against real `comps` running inside the built image as a *principle*, not an option.
- Observability/tracing parity (NFR-T1; telemetry assertions derived from the Grafana dashboard provisioning).
- No split-brain OPEA generations across the six AI-stack images.
- Supply chain + canary + rollback (image retention; shadow comparison; backward-read rehearsal).
- NFR-P verification (latency/ingest-throughput assertion in the contract layer, or explicit documented deferral).
