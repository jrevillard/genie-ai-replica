---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - prds/prd-genie-ai-2026-08-07/prd.md
  - architecture.md
---

# genie-ai - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for genie-ai, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR-1: Rebase the overlay onto OPEA v1.5 (all 4 module Dockerfiles + chatqna's GenAIExamples/GenAIComps clones at `OPEA_VERSION="v1.5"`; re-apply every overlay override).
- FR-2: Preserve the Genie-owned RAG modules unchanged in intent; only adapter contracts track 1.5.
- FR-3: Migrate all overlay images to Python 3.11 (`sitecustomize` paths, `update-alternatives` removal, recompiled pins).
- FR-4: Adopt v1.5 dependency pins + compiled `requirements-cpu/gpu.txt`; retire dataprep lock machinery; **extend compiled-lock pattern to retriever/reranker (D7)**.
- FR-5: Bump `langchain-arangodb` and re-validate the retriever `ArangoVector` path.
- FR-6: Verify the coupling surfaces against v1.5 (schedule() kwargs spike first; align_*, OpeaComponent lifecycle, registration keys + kwargs 2nd hop, Pydantic fields/semantics, docarray rename, opea_telemetry, `_parent_mod` target, orchestrator ctor, integration auto-discovery; **override-audit manifest (OVERRIDES.yaml) + lint**).
- FR-7: Regenerate the `constants.py` fork from v1.5's enum with `TRANSLATOR` re-appended (name→int mapping asserted).
- FR-8: Sweep for import-time breaks (langgraph 1.0.1, new comps members).
- FR-9: Re-audit the build-time patches (`fix_dependencies.sh` REQ_PATH, dataprep sed rewrite, docarray rename, **assert-on-patch guards**).
- FR-10: Contract tests against real `comps` **inside the built image** (required, D3): orchestrator wire test, one-doc ingest (production config), label-filter test, telemetry (dashboard-derived), **E2E cross-service pipeline test**, **NFR-P coarse budgets (D6)**; red-green validated.
- FR-11: Prove RAG parity vs the locked v1.3 baseline (run-triple, seeded, vector-space compat with live corpus, label-filter/confidence/abstention regression set).
- FR-12: Evidence CVE posture (baseline-diff vs pre-upgrade v1.3 advisory; no net-new high/critical).
- FR-13: Run the full test suites green (conftest re-baselined to real v1.5 signatures — mock-reality parity).
- FR-14: Fix the two latent dataprep/retriever bugs (retract `genie_graph` default; stale `RETRIEVER_ARANGO_GRAPH_NAME` env).
- FR-15: Pin the AI-stack image tags (vLLM chat `:latest` → pinned; embedding/textgen wrapper bases → 1.5-based; `versions.env` manifest + coherence lint).
- FR-16: Canary on `release/el-salvador` before `main` with explicit exit criteria + **required shadow comparison (D5)**.
- FR-17: Keep rollback to v1.3 one step away — rehearsed, whole-image-set, backward-read verified, v1.3 retention.
- FR-18: Update docs, env, and the upgrade matrix (bound to the `OPEA_VERSION` MR; CI asserts no `NEXT` placeholder).
- FR-19: Confirm the targeted upstream improvements land (enumerate + verify present in deployed images).

### NonFunctional Requirements

- NFR-S1: Supply-chain integrity — CycloneDX SBOM, signed images, blocking scan.
- NFR-S2: No net-new high/critical CVE introduced by the bump.
- NFR-S3: Non-root containers; no new secrets.
- NFR-R1: RAG reliability parity (no regression under load).
- NFR-R2: Rollback — previous image set deployable with zero config change.
- NFR-R3: Graceful degradation — a failed upgrade never strands a deployment half-migrated.
- NFR-M1: Remove dead divergence (no half-migrated compiled-lock adoption).
- NFR-M2: Overlay remains a single-source override set (coupling-surface size not grown).
- NFR-P1/P2: No latency / ingestion-throughput regression (verified via coarse budgets, D6).
- NFR-C1: Behavior-neutral — no breaking env-var/API/schema change.
- NFR-C2: Image tags pinned; no `:latest` in the AI stack.
- NFR-C3: `docker-compose.yaml` changes limited to pins.
- NFR-T1: OTel tracing parity (telemetry assertions derived from Grafana dashboards).

### Additional Requirements (Architecture)

- **Pre-rebase milestones:** (a) locked v1.3 baseline capture, (b) `schedule()` kwargs-forwarding spike on a bare v1.5 clone, (c) pre-rebase cleanup as its own v1.3 commit, (d) contract tests green on v1.3 → proven red on bare v1.5.
- **Per-module migration order:** core → retriever → reranker → dataprep → chatqna; one commit per module; byte-identical-to-upstream delta philosophy.
- **`schedule()` contingency:** subclass the orchestrator if kwargs drop; no shim outside the spike gate.
- **Override-audit manifest (`OVERRIDES.yaml`)** + CI lint (pattern 1).
- **Assert-on-patch guards** in every build patch (pattern 2).
- **`versions.env`** authoritative image manifest + coherence lint (pattern 5).
- **`verify:evidence` CI stage** (`allow_failure: false`) + mutation probe (enforcement).
- **Shadow comparison required** (D5); **config-parity** snapshot (pattern 10); **evidence-ledger** (pattern 12).
- **Artifact lifecycle:** keep verification/audit infrastructure; ledger transient outputs.
- **Clean-build:** `OPEA_VERSION` cache-busting ARG; no layer-cache reuse.

### UX Design Requirements

_N/A — no UI change in this upgrade (backend/infra-only)._

### FR Coverage Map

- FR-1, FR-2, FR-3, FR-4, FR-5, FR-7, FR-8, FR-9 → **Epic 2** (overlay rebase)
- FR-6 → **Epic 1** (kwargs spike) + **Epic 2** (surface verification during rebase)
- FR-10 → **Epic 1** (contract tests green on v1.3 → red on bare v1.5) + **Epic 2** (in-image, per module)
- FR-11 → **Epic 1** (baseline capture) + **Epic 3** (parity proof)
- FR-12 → **Epic 3**
- FR-13 → **Epic 2** (per-module) + **Epic 3** (full suites)
- FR-14 → **Epic 4** (latent dataprep/retriever bugs)
- FR-15, FR-16, FR-17, FR-18 → **Epic 4**
- FR-19 → **Epic 3**

## Epic List

### Epic 1: Upgrade foundation — provable-parity groundwork
The upgrade can be proven before it touches a Dockerfile: the locked v1.3 baseline exists, the `schedule()` kwargs-forwarding spike is resolved, the pre-rebase cleanup is landed as its own commit, and contract tests are green on v1.3 / red on a bare v1.5 bump.
**FRs covered:** FR-6 (spike), FR-10 (contract tests), FR-11 (baseline) + architecture pre-rebase cleanup milestones.

### Epic 2: OPEA 1.5 overlay rebase (behavior-preserving)
The overlay runs on OPEA 1.5 with preserved behavior: core → retriever → reranker → dataprep → chatqna, one commit per module; dependency pins + Python 3.11 migration; `constants.py` regenerated; build patches re-audited; coupling surfaces verified; contract tests green in-image per module.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-7, FR-8, FR-9 (+ FR-6, FR-10, FR-13).

### Epic 3: Verification & parity proof
The upgrade is proven behavior-neutral and secure: RAG parity vs the locked baseline (vector-space compat, regression set), CVE baseline-diff evidence, full suites green, targeted upstream improvements confirmed in the deployed images.
**FRs covered:** FR-11, FR-12, FR-13, FR-19.

### Epic 4: Operational readiness & rollout
The upgrade ships safely, is reversible, and is documented: latent dataprep bugs fixed, AI-stack image tags pinned (no split-brain), canary with required shadow comparison on el-salvador, rehearsed rollback with backward-read, docs/env/upgrade-matrix updated.
**FRs covered:** FR-14, FR-15, FR-16, FR-17, FR-18.

## Epic 1: Upgrade foundation — provable-parity groundwork

### Story 1.1: Lock the v1.3 RAG-parity baseline

As a platform engineer,
I want the v1.3 retrieval baseline captured as a committed, seeded, multi-run artifact,
So that parity after the bump is provable, not asserted.

**Acceptance Criteria:**

**Given** the pre-rebase baseline milestone is started and the RAG-benchmarks harness runs on the v1.3 stack,
**When** I run the baseline capture (pinned corpus/queries/labels/model, `temperature=0`, fixed seed, N runs),
**Then** a run-triple artifact (min/median/max per metric) is committed with a variance-derived tolerance,
**And** the artifact records the exact env/config it was tested under (config-parity).

### Story 1.3: Run the `schedule()` kwargs-forwarding spike (blocking gate)

As a platform engineer,
I want the v1.5 `execute()` kwargs-forwarding contract proven on a bare v1.5 clone before any Dockerfile changes,
So that the chatqna rebase approach is decided with evidence, not guesswork.

**Acceptance Criteria:**

**Given** a bare v1.5 GenAIComps clone and a registered throwaway service,
**When** I call `execute()`/`schedule()` with the 6 custom kwargs and assert they arrive on the handler,
**Then** the outcome (forwards / drops) is recorded in the decision log,
**And** if it drops, the D1 contingency (subclass the orchestrator) is chosen before any rebase work — no shim outside the spike gate.

### Story 1.4: Land the pre-rebase cleanup as its own v1.3 commit

As a platform engineer,
I want the overlay debt consolidated on v1.3 before the bump,
So that a post-rebase regression has one variable, not two.

**Acceptance Criteria:**

**Given** the cleanup runs on the v1.3 tree in its own commit,
**When** the 5 near-duplicate `add_remote_service*` variants are consolidated to one site and the `_parent_mod.ARANGO_DB_NAME` monkeypatch is replaced with a subclass override,
**Then** the full suites stay green on v1.3 and the commit is independently reviewed/tested,
**And** behavior is unchanged (same flow_to graph).

### Story 1.5: Write contract tests green on v1.3, prove red on a bare v1.5 bump

As a platform engineer,
I want the contract-test suite written and red-green validated,
So that the safety net is proven to catch a real 1.5 break.

**Acceptance Criteria:**

**Given** the suite targets real `comps` (wire test, one-doc ingest with production config, label filter, telemetry-from-dashboards, E2E cross-service pipeline),
**When** it is green on v1.3 and re-run against a bare v1.5 bump before re-grafting,
**Then** it goes red with the failure reason committed as a CI artifact,
**And** each test asserts a v1.5-specific shape (sensitivity check; no green-on-green).

## Epic 2: OPEA 1.5 overlay rebase (behavior-preserving)

### Story 2.1: Re-graft the core overlay layer

As a platform engineer,
I want the core overlay files regenerated from v1.5,
So that the shared layer is current before modules rebase.

**Acceptance Criteria:**

**Given** the v1.5 diff for `comps/cores/mega/constants.py` and `genieai_api_protocol.py`,
**When** `constants.py` is regenerated from v1.5's enum with `TRANSLATOR` re-appended (name→int mapping asserted), `genieai_api_protocol.py` re-grafted to v1.5 Pydantic, and `OVERRIDES.yaml` created,
**Then** the core files import on v1.5 and the override manifest lints clean,
**And** no module rebase assumes an uncommitted core version,
**And** the `sitecustomize` SSL-bypass hook (verification disabled — the internal CA is not known to the deployment, so CA-trust env vars are not an option) is installed at a Python-version-stable path — a `.pth` entry or a build-time-derived `site-packages` path instead of the hardcoded `python3.10` path — keeping the bypass semantics,
**And** the docarray `mv`+`sed` source rename is replaced with a `sys.modules` alias shim (no vendored-source mutation, survives any vendor layout).

### Story 2.2: Migrate dependencies + Python 3.11

As a platform engineer,
I want v1.5 pins + compiled locks + Python 3.11 adopted fleet-wide,
So that the images build deterministically.

**Acceptance Criteria:**

**Given** v1.5's compiled `requirements-cpu/gpu.txt` and the base-image bump,
**When** dataprep/retriever/reranker adopt the compiled lock (retiring the local lock machinery + the `docling-core==2.82.0` pin), all images move to `python:3.11`, and the `sitecustomize` paths / `update-alternatives` are migrated,
**Then** all overlay images build on Python 3.11 with hashed requirements,
**And** the build is byte-reproducible (clean build, cache-busting ARG).

### Story 2.3: Re-graft the retriever + bump `langchain-arangodb`

As a platform engineer,
I want the retriever's adapter on v1.5 with the vector path re-validated,
So that retrieval does not silently change.

**Acceptance Criteria:**

**Given** the retriever's v1.3→v1.5 surface diff,
**When** `langchain-arangodb` is bumped to the version compatible with v1.5's `langchain-core`, the `ArangoVector` path and `OpeaComponent` adapter re-grafted, and the retriever contract test run in-image,
**Then** the retriever image builds and its contract test passes in-image,
**And** label-filter + RRF fusion behavior is covered by the contract test.

### Story 2.4: Re-graft the reranker

As a platform engineer,
I want the reranker's build + adapter on v1.5,
So that it consumes the compiled lock and registers correctly.

**Acceptance Criteria:**

**Given** the reranker's surface diff,
**When** `fix_dependencies.sh` REQ_PATH is re-pointed to the compiled lock, the `opea_telemetry`/registration surface verified, and the reranker contract test run in-image,
**Then** the reranker image builds and its contract test passes in-image,
**And** the assert-on-patch guard fails the build if a patch goes stale.

### Story 2.5: Re-graft the dataprep

As a platform engineer,
I want the dataprep on v1.5 with docling 2.44.2 and the compiled lock,
So that ingest is deterministic and chunking is re-validated.

**Acceptance Criteria:**

**Given** the dataprep's surface diff,
**When** the Dockerfile `REQ_PATH` is rewritten to `requirements-cpu.txt` (sed re-audit + assert-guards), docling 2.44.2 adopted, and the dataprep contract test (one-doc ingest, production config) run in-image,
**Then** the dataprep image builds and its contract test passes in-image,
**And** chunking behavior is exercised by the ingest smoke (docling downgrade surface).

### Story 2.6: Re-graft the chatqna (highest coupling, last)

As a platform engineer,
I want the chatqna orchestrator on v1.5 with the kwargs contract intact,
So that chat retrieval stays grounded and translation keeps streaming.

**Acceptance Criteria:**

**Given** the chatqna's surface diff (align_* monkeypatch, `schedule(initial_inputs, llm_parameters, **kwargs)` forwarding the 6 custom kwargs — `retriever_parameters`, `reranker_parameters`, `full_chat_history_string`, `retrieval_context`, `original_language`, `user_details` — TRANSLATOR branch, entrypoint),
**When** the orchestrator is re-grafted per the spike outcome (D1 if kwargs drop), the 6 custom kwargs are bundled into a single `genie_params` dict forwarded through `schedule()` (one forwarding argument instead of six — the kwargs-drop failure class becomes trivial to guard), both Dockerfile clones bumped to v1.5, and the wire test + E2E cross-service pipeline test run in-image,
**Then** the chatqna image builds and the wire test asserts the full `genie_params` dict lands on the handlers,
**And** streaming translation (#829) is exercised by the E2E contract test.

### Story 2.7: Re-audit build patches + add enforcement

As a platform engineer,
I want build-time patches guarded and image versions manifest-driven,
So that no silent no-op ships.

**Acceptance Criteria:**

**Given** all Dockerfile patches + the image set,
**When** assert-on-patch guards are added everywhere, `versions.env` becomes the authoritative image manifest, the coherence lint hard-fails on mixed OPEA versions, and `verify:evidence` + mutation-probe scaffolding is added to CI,
**Then** a stale patch or a mixed-version fleet fails CI,
**And** a deliberate contract break makes the pipeline go red (mutation probe proves the gates work).

### Story 2.8: Sweep import-time breaks + re-baseline the mocked suite

As a platform engineer,
I want no hidden import-time break and a truthful unit suite,
So that green CI means something real.

**Acceptance Criteria:**

**Given** the v1.5 dependency tree,
**When** every image's imports are swept for langgraph 1.0.1 / new comps members, and `conftest.py`'s `comps` stubs are re-baselined to real v1.5 signatures,
**Then** no overlay import reaches a broken path and the unit suite is green against real v1.5 shapes,
**And** a mock-reality parity check fails if the suite stubs a symbol that no longer exists in v1.5.

## Epic 3: Verification & parity proof

### Story 3.1: Run the RAG-parity evaluation vs the locked baseline

As a platform engineer,
I want the upgrade's retrieval quality compared against the locked v1.3 baseline,
So that behavior-neutrality is proven, not assumed.

**Acceptance Criteria:**

**Given** the locked baseline artifact and the v1.5 stack in the test environment,
**When** the parity run executes (same corpus/queries/labels/model, seeded) against existing stored embeddings + graph data (vector-space compat) and the regression set (label-filter, confidence, abstention),
**Then** metrics fall within the baseline variance band with no regression,
**And** any regression is fixed or the upgrade is held (gate).

### Story 3.2: Produce the CVE baseline-diff evidence

As a security engineer,
I want the CVE posture change evidenced as a baseline diff,
So that remediation is demonstrable.

**Acceptance Criteria:**

**Given** the pre-upgrade v1.3 advisory + the v1.5 images,
**When** the advisory is diffed (same scanner/taxonomy) with an accept-list for known-benign entries,
**Then** no net-new high/critical is introduced and closures are recorded,
**And** a net-new high/critical blocks the upgrade (hold, or accept-with-documented-risk decided).

### Story 3.3: Confirm the full test suites green

As a platform engineer,
I want the full suites green against real v1.5 shapes,
So that green CI means something real.

**Acceptance Criteria:**

**Given** the re-baselined conftest + all module contract tests,
**When** the full pytest/Jest suites run on the upgraded overlay,
**Then** all suites pass in CI,
**And** the `verify:evidence` stage confirms the required artifacts (parity report, red-run logs, contract matrix) are present and fresh.

### Story 3.4: Confirm the targeted upstream improvements land

As a platform engineer,
I want the enumerated upstream fixes verified present in the deployed images,
So that the "improvements + bug fixes" goal is evidenced.

**Acceptance Criteria:**

**Given** the FR-19 enumeration from the v1.4/v1.5 changelogs,
**When** each named fix is confirmed present in the deployed images,
**Then** the value of the upgrade is evidenced, not assumed,
**And** any absent fix is explicitly recorded (not exercised vs not applied).

### Story 3.5: Complete the evidence ledger + verify:evidence gate

As a platform engineer,
I want the audit trail complete,
So that the upgrade is provable after the fact.

**Acceptance Criteria:**

**Given** all verification artifacts from Epics 1–3,
**When** the evidence ledger (override dispositions + rationale, CVE baseline-diff, parity report, red-run logs, contract matrix) is committed with the change-set,
**Then** the `verify:evidence` gate passes with `allow_failure: false`,
**And** the mutation probe is re-run to confirm the pipeline still goes red on a deliberate break.

## Epic 4: Operational readiness & rollout

### Story 4.1: Fix the latent dataprep/retriever bugs

As a platform engineer,
I want the two pre-existing bugs fixed,
So that retract and env semantics agree with the code.

**Acceptance Criteria:**

**Given** the dataprep retract path (wrapper defaults `genie_graph`; component defaults `GRAPH`) and the stale `RETRIEVER_ARANGO_GRAPH_NAME` env hint,
**When** the retract default is unified and the env hint corrected to `ARANGO_GRAPH_NAME`,
**Then** ingest and retract agree on the graph name and no deployer reads a stale hint,
**And** this is the only sanctioned behavior delta from "invisible" (recorded).

### Story 4.2: Pin the AI-stack image tags (no `:latest`, no split-brain)

As a platform engineer,
I want the full AI image set pinned and manifest-driven,
So that the fleet is reproducible and version-coherent.

**Acceptance Criteria:**

**Given** the vLLM chat `:latest`, the embedding/textgen wrapper `:latest` bases, and the vLLM-translation v0.10.0 tag,
**When** all are pinned (vLLM → v0.10.x; wrappers → 1.5-based bases) with `versions.env` as the authoritative manifest and the coherence lint enabled,
**Then** no `:latest` remains in the AI stack and a mixed-version fleet fails CI,
**And** the change lands as its own commit (independent of the bump, for clean root-cause).

### Story 4.3: Canary on `release/el-salvador` with required shadow comparison

As a deployment engineer,
I want the upgrade validated on the deployed stack with defined criteria,
So that `main` is never the first real-traffic test.

**Acceptance Criteria:**

**Given** the v1.5 image set and the el-salvador canary target,
**When** a side-by-side shadow comparison (v1.3 vs v1.5) runs with explicit exit criteria (window, error-rate/latency thresholds, RAG spot-check, no ingest anomalies),
**Then** promotion to `main` happens only after the criteria pass and sign-off,
**And** any failure reverts to v1.3 per the rollback story.

### Story 4.4: Rehearse rollback — whole-set revert + backward-read + retention

As a deployment engineer,
I want rollback drilled in staging,
So that "one step away" is proven, not asserted.

**Acceptance Criteria:**

**Given** the v1.5 images deployed in staging and the v1.3 image set retained (retention rule),
**When** rollback is rehearsed (redeploy the whole v1.3 set against the same ArangoDB) and the backward-read test runs (v1.3 serves data written by v1.5),
**Then** the v1.3 set comes up and serves queries with no config change,
**And** the rehearsal output is committed to the evidence ledger.

### Story 4.5: Update docs, env, and the upgrade matrix

As a deployer,
I want the docs and config facts current,
So that no one reads stale version/behavior guidance.

**Acceptance Criteria:**

**Given** the reconciled env (`RETRIEVER_ARANGO_GRAPH_NAME`, `RERANKER_TOP_N` three-home pinning) + the upgrade matrix + `CHANGELOG`,
**When** they are updated in the same MR that moved `OPEA_VERSION`,
**Then** the matrix shows the v1.3→v1.5 entry and CI asserts no `NEXT` placeholder remains,
**And** CLAUDE.md/env reflect the post-bump facts.
