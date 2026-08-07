---
title: PRD — OPEA 1.3 → 1.5 Upgrade
status: final
created: 2026-08-07
updated: 2026-08-07
prd_key: opea-1.5-upgrade
initiative: opea-1.5-upgrade
branch: feat/opea-1.5-upgrade/prd
---

# PRD: OPEA 1.3 → 1.5 Upgrade

## 0. Document Purpose

This PRD defines the **OPEA 1.3 → 1.5 upgrade** for product management, GENIE.AI platform stakeholders, and downstream BMAD workflow owners (architecture, epics/stories, QA). The goal is to **stay current with the OPEA upstream**: absorb v1.5's improvements and bug fixes and remediate the library-level CVEs that come with seven months of version drift. It builds on — and does not duplicate — the verification research that preceded it (listed below). The PRD is capability-level; implementation detail lives in the referenced research and downstream architecture. Features carry globally numbered stable FR IDs; assumptions are tagged inline (`[ASSUMPTION: …]`) and indexed in §11.

**Key inputs (already in this initiative's research folder):**
- `opear15-upgrade-verification-review-2026-08-07.md` — verification of the OPEA 1.3→1.5 plan (upstream facts + code-verified current state + corrections).
- `deferred-work.md` (on `main`) — the v1.3→v1.4+ dependency-retirement checklist this PRD executes.
- `team-briefing-agentic-enablement.md` (on `feat/agentic-enablement`) — Pillar 1 context; its agentic framing is **out of scope here** (see §5).

## 1. Vision

GENIE.AI is a sovereign, DPG-compliant RAG framework for the public sector, deployed on public infrastructure (e.g. El Salvador). Its AI layer is built on **OPEA**, but not by pip-installing it: GENIE **clones OPEA at build time and overlays its own code** (four Dockerfiles pin `OPEA_VERSION="v1.3"`, a tag from 2025-05-14). That pin lags two OPEA releases behind the latest stable, **v1.5** (2025-12-22) — which has been the newest release for 7.5 months as of 2026-08-07. Staying pinned is not free: the overlay misses upstream bug fixes, accumulates dependency CVEs, and the cost of the eventual rebase grows every quarter.

This PRD upgrades the overlay from OPEA **v1.3 to v1.5** — rebasing GENIE's customizations onto the 1.3→1.5 diff rather than rewriting them. The Genie-owned RAG investment (retriever, reranker, dataprep internals, the ~2,560-line chatqna orchestrator) is preserved; only their **adapter contracts** to OPEA's `comps` library track 1.5. In exchange, GENIE gets the upstream bug fixes, the dependency bumps that close the CVEs, and a platform current enough to be the base for everything the agentic roadmap builds next.

The upgrade must be **invisible to end users**: identical RAG quality, no API/env-var breakage for deployments, and a clean rollback if parity is not proven. That is the definition of done — not "new features," but "same GENIE, current foundation." Two pre-existing latent dataprep bugs are fixed as the upgrade's **only sanctioned behavior deltas** (FR-14); everything else is behavior-neutral by contract.

## 2. Target User

### 2.1 Jobs To Be Done

- **(Platform engineer / overlay owner)** "Rebase our OPEA overlay to 1.5 without breaking the RAG pipeline, so we stop accumulating upstream drift and its CVEs."
- **(Security / compliance)** "Close the library-level CVEs that version lag has accrued, with evidence (scan → advisory) that the posture improved."
- **(Deployer / ops)** "Upgrade without a redeploy risk: same behavior, same env vars, same image contract; roll back if anything regresses."
- **(Downstream initiatives)** "Land a current, verified OPEA foundation that the agentic/OKF/SST roadmap can build on."

### 2.2 Key User Journeys

- **UJ-1. Jerome runs the upgrade and proves parity.**
  - **Persona + context:** platform engineer owning `genie-ai-overlay/`.
  - **Entry state:** on `feat/opea-1.5-upgrade`, working tree from this PRD.
  - **Path:** (1) pre-rebase cleanup (consolidate the 5 near-duplicate `add_remote_service*` variants; replace the dataprep `_parent_mod.ARANGO_DB_NAME` module monkeypatch); (2) bump `OPEA_VERSION` to `v1.5` in the 4 Dockerfiles; (3) re-graft the overlay overrides and verify the coupling surfaces; (4) migrate to Python 3.11 + 1.5's compiled requirements; (5) add import-only smoke tests for retriever/reranker/chatqna; (6) run the full test suites and the RAG-parity evaluation.
  - **Climax:** all four modules build, smoke tests pass, full suites are green, and the RAG-parity evaluation shows no regression against the v1.3 baseline.
  - **Resolution:** the upgrade lands on `release/el-salvador` as a canary, then `main`; the Trivy advisory shows the expected CVE reduction; if parity fails, `git revert`/image retag returns the fleet to v1.3.

- **UJ-2. A deployer rolls out the new images.**
  - **Persona + context:** deployment engineer on a Swarm stack.
  - **Entry state:** new image tags for chatqna/dataprep/retriever/reranker/embedding/textgen.
  - **Path:** `docker compose` service update with pinned tags; watch health/readiness; spot-check a chat query + an ingest.
  - **Climax:** same behavior as before — no env-var, API, or schema changes required of the deployment.
  - **Resolution:** fleet on v1.5 images; rollback = redeploy the previous (v1.3-based) tags.

## 3. Glossary

- **OPEA** — Open Platform for Enterprise AI; the upstream framework GENIE's AI layer builds on.
- **Overlay** — GENIE's build-time customizations applied on top of a cloned OPEA tag (file overwrites, injected `genieai_*` subclasses, monkeypatches, build-time `sed`/`mv` patches). See `genie-ai-overlay/`.
- **OPEA_VERSION** — the single pin (currently `"v1.3"`) in 4 Dockerfiles controlling the cloned OPEA tag.
- **`comps`** — the OPEA component library (`GenAIComps`) that overlay modules subclass/import from.
- **GenAIExamples** — the OPEA examples repo; the chatqna Dockerfile clones `ChatQnA@v1.3` from it.
- **Coupling surface** — a contract point between the overlay and `comps` that must be verified after the rebase (see §4.3).
- **Adapter contract** — the thin interface between a Genie-owned module and `comps` (base-class, import, or registration surface).
- **Smoke test** — here: import-only test that a module loads its `comps` imports on the new version without an `ImportError`.
- **RAG parity** — retrieval/generation quality equal to the v1.3 baseline (no regression) measured on the RAG-benchmarks harness.
- **Canary** — first deployment target (`release/el-salvador`) used to validate the upgrade before `main`.
- **CVE** — Common Vulnerabilities and Exposures; library-level vulnerabilities addressed by dependency bumps.
- **Trivy advisory** — the container-scan advisory produced by the CI scan stage, used to evidence CVE reduction.

## 4. Features

### 4.1 Overlay rebase to OPEA 1.5

**Description:** The overlay is rebased from OPEA v1.3 to v1.5. This is a re-graft, not a rewrite: GENIE's RAG modules stay Genie-owned; only their adapter contracts track 1.5. The four Dockerfiles (`dataprep`, `retriever`, `reranker`, `chatqna`) move to `OPEA_VERSION="v1.5"`; the chatqna Dockerfile's second clone (GenAIComps) and its `pip install -e .` follow the same tag. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Rebase the overlay onto OPEA v1.5
The build pipeline clones OPEA at `v1.5` (GenAIComps in all 4 modules; GenAIExamples `ChatQnA@v1.5` in chatqna) and re-applies every overlay override — `core/constants.py` → `comps/cores/mega/constants.py`, `core/genieai_api_protocol.py` → `comps/cores/proto/`, `genieai_chatqna.py`, `entrypoint.sh`, `tracing.py`, `core/model_cache.py`, `core/label_contract.py`, the `genieai_*` integration subclasses, and the build-time patches. Realizes UJ-1.
**Consequences:**
- All 4 module images build from `OPEA_VERSION="v1.5"`.
- `pip install -e .` in the chatqna builder resolves 1.5 dependencies.

#### FR-2: Preserve the Genie-owned RAG modules unchanged in intent
Retriever, reranker, and dataprep internals (dense COSINE + BM25 + RRF fusion, label filtering, contextual retrieval, graph traversal) keep their behavior on 1.5. Only their adapter contracts (imports, base classes, registration) are updated. Realizes UJ-1.
**Consequences:**
- No rewrite of the retrieval/labeling logic as part of this PRD (changes only where 1.5 broke a contract).
- RAG behavior is identical *within tolerance* where 1.5 does not force a change — and may **improve** where the `langchain-arangodb` bump addresses the known label-filter defect (FR-5, FR-11). The parity harness must be able to distinguish improvement from regression; "bit-identical" is not the contract.

### 4.2 Dependency & runtime migration

**Description:** v1.5 ships different dependency pins than v1.3 (verified upstream). The overlay moves to 1.5's compiled requirements and to Python 3.11, and closes the retriever's known `langchain-arangodb` weakness as part of the bump. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-3: Migrate to Python 3.11
All overlay images run Python 3.11 (matching v1.5's `python:3.11-slim` bases). The `sitecustomize.py` SSL-bypass patch paths in the chatqna and dataprep Dockerfiles move from `python3.10` to `python3.11`; the dataprep `update-alternatives` python3.10 machinery is removed. Realizes UJ-1.
**Consequences:**
- No overlay image imports or the SSL patch run on `python3.10` paths after the bump.
- Compiled/C-extension pins are rebuilt for 3.11.

#### FR-4: Adopt v1.5 dependency pins and compiled requirements
The overlay consumes v1.5's pinned versions: langchain 0.3.27, langgraph 1.0.1, mcp 1.24.0, docling-core 2.44.2, and the v1.4+ `requirements-cpu.txt`/`requirements-gpu.txt` layout (no more v1.3-style unpinned `requirements.txt`). The dataprep local lock machinery (`requirements.in`, `requirements.lock`, `generate-requirements-in.sh`, the `docling-core==2.82.0` pin, the `--no-deps --require-hashes` block) is retired in favor of OPEA's compiled lock, keeping `--require-hashes` semantics. **Per architecture decision D7, the compiled-lock pattern extends to retriever and reranker** (they adopt OPEA's compiled requirements too — deterministic, SBOM-able builds fleet-wide; a half-migrated fleet would contradict NFR-M1). Realizes UJ-1, UJ-2. (Source: `deferred-work.md` L395-411, the v1.3→v1.4+ retirement checklist.)
**Consequences:**
- Dataprep builds deterministically from a compiled lock (`--require-hashes` retained; `[ASSUMPTION: v1.5's compiled lock carries hashes or is compiled with them — verified during FR-4; if not, hashes are generated before adoption]`).
- No dead divergence carried (`verify:dataprep-lock` job **re-pointed** to OPEA's lock, with the re-pointing decision recorded in `.decision-log.md` — closing the earlier "re-pointed or removed" ambiguity).
- langgraph 1.0.1 is installed (it is a dependency of the 1.5 tree) — verified not to break any overlay import path (§4.3).
- `Makefile` targets `lock-dataprep` / `requirements-in-dataprep` are re-pointed to OPEA's compiled lock or removed (deferred-work L404).

> Source: `deferred-work.md` (repo root `_bmad-output/implementation-artifacts/deferred-work.md`, "OPEA bump v1.3 -> v1.4+ retires most of the issue-834 machinery").

#### FR-5: Bump `langchain-arangodb`
`langchain-arangodb` moves from `0.0.4` to the latest version compatible with v1.5's `langchain-core`; the retriever's `ArangoVector` path is re-validated on the new version. Realizes UJ-1.
**Consequences:**
- The retriever's vector path works against 1.5's `langchain-core` (0.3.x).
- The known `langchain-arangodb` 0.0.4 label-filter defect is re-tested under the new version.

### 4.3 Coupling-surface verification

**Description:** The rebase's real risk is the overlay's contracts with `comps`. Each surface below is verified against the 1.3→1.5 diff; a stable surface means a mechanical bump, a changed one is fixed before runtime. The mocked test suite cannot catch these (it stubs `comps` at `sys.modules` level), so verification is explicit. Realizes UJ-1.

**Functional Requirements:**

#### FR-6: Verify the coupling surfaces against v1.5
The coupling surfaces are diffed v1.3→v1.5 and verified. The **`schedule()` kwargs-forwarding contract is proven first, as a blocking pre-rebase spike on a bare v1.5 clone with no overlay** — a zero-cost check that v1.5's `execute()` forwards the 6 custom kwargs (`retriever_parameters`, `reranker_parameters`, `full_chat_history_string`, `retrieval_context`, `original_language`, `user_details`) before any Dockerfile is touched; if it fails, the chatqna rebase approach is re-planned. The remaining surfaces:

- **`ServiceOrchestrator.align_inputs/outputs/align_generator` monkeypatch (chatqna:1240)** — v1.5 base signatures are `(self, inputs, *args, **kwargs)`-style, compatible with GENIE's positional override, but the override must be *behaviorally* verified, not just imported.
- **`OpeaComponent`/`OpeaComponentLoader` lifecycle** — subclass + loader contract.
- **`@register_microservice` + `opea_microservices["opea_service@*"]` keys** (present in v1.5) — plus the **kwargs second hop**: the retriever/reranker microservice handlers must accept the forwarded custom kwargs.
- **`api_protocol.py` Pydantic fields and validator/`model_config` semantics** — v1.5's Pydantic version can change serialization silently.
- **`comps.cores.proto.docarray.py` rename hack** — re-verified against 1.5's layout.
- **`comps.cores.telemetry.opea_telemetry`** — verified NOT renamed (same path since v1.0).
- **dataprep `_parent_mod.ARANGO_DB_NAME` monkeypatch target** — if v1.5 moved where the constant lives, the patch **silently no-ops**.
- **`MegaServiceOrchestrator` constructor/healthcheck/abstract-method surface** — beyond `align_*`.
- **Integration auto-discovery** — the injected `genieai_*` subclasses in `comps/integrations/` only register if v1.5 loads integrations the same way.
- **Override-audit manifest (`OVERRIDES.yaml`)** — every override carries a machine-checkable disposition (`still-needed` / `re-graft-to-new-API` / `obsolete-remove`) enforced by a CI lint (architecture pattern 1).

Realizes UJ-1.
**Consequences:**
- Every runtime monkeypatch gets a **behavioral assertion** (e.g. "`align_generator` is actually GENIE's version", "the dataprep patch bound to the right module attribute"), not just an import check — silent no-op patches are the failure class to catch.
- The 8-kwargs `schedule()` contract delivers all six custom kwargs to the retriever/reranker/translator alignment (proven by the FR-6 spike + the FR-10 wire test).
- Any surface that changed in 1.5 is fixed with an overlay adjustment, not a workaround.

#### FR-7: Regenerate the `constants.py` fork from v1.5
The overlay's hand-forked `comps/cores/mega/constants.py` is regenerated from v1.5's enum (which has **no** `TRANSLATOR`; slot 24 is now `LANGUAGE_DETECTION`), with `TRANSLATOR` re-appended at the end of the enum. All v1.5 `ServiceType` members are preserved so no 1.5 core module hits an `AttributeError`. Realizes UJ-1.
**Consequences:**
- GENIE's `ServiceType.TRANSLATOR` exists and all v1.5 members resolve.
- No drift between the fork and v1.5's enum values.

#### FR-8: Sweep for import-time breaks (langgraph, comps modules)
Each overlay image is checked for modules that reach langgraph 1.0.1 or new `comps` members (e.g. `ServiceType.PROMPT_REGISTRY`) at import time; any such path is fixed or documented. Realizes UJ-1.
**Consequences:**
- langgraph 1.0.1 being installed does not break any overlay import.
- No `AttributeError` on 1.5 enum members.

#### FR-9: Re-audit the build-time patches
`fix_dependencies.sh` (shared by retriever + reranker) and its `REQ_PATH` target (currently `…/retrievers/src/requirements.txt`, which no longer exists in 1.4+) are re-pointed to the compiled lock and re-validated; the `docarray.py` → `opea_docarray.py` rename hack is re-verified against 1.5's layout. The **dataprep Dockerfile** `REQ_PATH` (currently `/app/comps/dataprep/src/requirements.txt`) is rewritten to the compiled `requirements-cpu.txt`, and its version-specific `sed` adjustments (dead `pathway` line, `pyspark==4.0.0`, `unstructured[all-docs]` no-op) are re-audited against v1.5's pins; `opencv-python-headless` is re-confirmed for the displayless image. (deferred-work L403-411.) Realizes UJ-1.
**Consequences:**
- No silent no-op in `fix_dependencies.sh` or the dataprep `sed` blocks (version-specific targets re-checked against 1.5 pins).
- The dataprep image builds against the compiled lock, not the removed v1.3 `requirements.txt`.
- The docarray rename hack still resolves imports on 1.5.

### 4.4 Quality gates

**Description:** The upgrade is only "done" when it is proven safe: tests, RAG parity, and security posture. These gates must pass before the merge to `main`. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-10: Contract tests against real `comps` (not just imports)
Import smoke tests exist for retriever, reranker, and chatqna (dataprep already has `smoke:dataprep-arango`), **and** — because import tests cannot catch runtime contract breaks — the following run against **real `comps@v1.5` with model/DB endpoints HTTP-mocked (no GPU)**, in a context where `comps` is **not** mocked (the existing `conftest.py` stubs `comps` at `sys.modules`; the new tests run as an isolated target **inside the built image** — required, per architecture decision D3 — which also exercises the FR-9 docarray rename hack, the compiled lock, and the Python 3.11 `sitecustomize` path):
- **Orchestrator wire test (highest ROI):** build the ServiceOrchestrator graph on v1.5, feed one canned input through `align_inputs → schedule → align_generator`, and assert all six custom kwargs land on the retriever/reranker handlers and that each service registered. This is the single cheapest test for the single highest-severity risk (silent kwargs-drop → ungrounded chat).
- **One-doc ingest smoke:** one representative document through the real v1.5 chunker (docling 2.44.2) + labeler; assert structured chunks + a round-trip retrieve.
- **Focused label-filter test:** wrong-category documents are excluded on the bumped `ArangoVector` path.
- **Telemetry assertion:** one traced request; expected span names/attributes present, **derived from the Grafana dashboard provisioning** (`configs/grafana/provisioning/`) so a v1.5 telemetry rename cannot silently empty a dashboard (NFR-T1 enforced by a test, not just a statement).
- **End-to-end cross-service pipeline contract test:** one full RAG query through retriever→reranker→chatqna asserting the observable surface (response schema, streaming, confidence distribution, abstention) — proves "behavior-neutral" across service handoffs (architecture pattern 3).
- **NFR-P coarse budgets:** wire-test latency + one-doc ingest wall-clock budgets (architecture decision D6) — so a latency/throughput regression fails a gate instead of sailing through.
The smoke tests are **red-green validated**: written green against v1.3, then re-run against a bare v1.5 bump *before* re-grafting to prove they go red on the real break. Realizes UJ-1.
**Consequences:**
- A 1.5 runtime contract break (kwargs-drop, non-registration, filter leak, telemetry drift) is caught in CI, not at deploy time.
- The mocked unit suite's blindness to `comps` API changes is compensated at the contract level.

#### FR-11: Prove RAG parity (no regression)
RAG quality is compared against the v1.3 baseline using the `tests/rag-benchmarks` harness (or a documented equivalent reference eval) before the upgrade is allowed to ship. **The v1.3 baseline is captured as a pre-rebase milestone** (step 0, before any overlay change): pinned corpus, pinned queries, pinned expected labels, pinned embedding/rerank model. Tolerance is **derived from the baseline's own run-to-run variance** (multi-run, seed-controlled), not a guess — one-run-vs-one-run chases noise. Generation behavior (non-deterministic LLM output) uses a defined rubric (sampled + judged, or answer-similarity with a documented threshold). Parity is validated **against existing stored embeddings and existing graph data**, not only re-ingested documents — v1.5 vector/embedding compatibility with the live corpus is the load-bearing check (see FR-11 consequence). Realizes UJ-1.
**Consequences:**
- No silent RAG regression ships with the upgrade — and no vector-space incompatibility silently degrades retrieval on already-deployed data.
- Any regression is fixed or the upgrade is held.
- The ingest side (docling 2.44.2 chunking on *new* ingests) is covered by FR-10's one-doc ingest smoke, since FR-11 alone is blind to it.

#### FR-12: Evidence the CVE posture in the container scan
The CVE gate is a **diff against the v1.3 baseline advisory** — same scanner version, same severity taxonomy, with an accept-list for known-benign entries — not a raw count. The gate: **no net-new high/critical introduced by the bump** (the new dependency surface — langgraph 1.0.1, mcp 1.24.0, compiled `requirements-cpu/gpu.txt` — can introduce net-new highs in *different* packages; that is tested, not assumed). CVE closures from the library bumps are recorded as the positive security outcome; the advisory/dashboard is updated. Realizes UJ-1 (security JTBD).
**Consequences:**
- The security posture change is evidenced as a baseline diff, localizing what the bump fixed and what it introduced.
- A net-new high/critical introduced by the bump blocks the upgrade (hold, or accept-with-documented-risk decided explicitly).

#### FR-13: Run the full test suites green
The full backend/frontend/OPEA/component suites pass on the upgraded overlay (pytest for `genie-ai-overlay`, plus affected Jest suites). Realizes UJ-1.
**Consequences:**
- CI is green on the upgrade branch before merge.

### 4.5 Operational readiness

**Description:** Fixing the latent issues the rebase surfaces, pinning the loose end in the deployment, and making the rollout reversible. Realizes UJ-2.

**Functional Requirements:**

#### FR-14: Fix the two latent dataprep/retriever bugs
(1) dataprep retract default mismatch — the wrapper (`genieai_dataprep_microservice.py:292`) defaults to `genie_graph` while the component (`genieai_dataprep_arangodb.py:1287`) defaults to `GRAPH` — is unified; (2) the stale `RETRIEVER_ARANGO_GRAPH_NAME` env hint in `env` is corrected to `ARANGO_GRAPH_NAME`. Realizes UJ-2.
**Consequences:**
- Retract and ingest agree on the graph name.
- No deployer reads a stale env hint.

#### FR-15: Pin the AI-stack image tags (no `:latest`, no split-brain)
The chat `vllm` service in `docker-compose.yaml` moves from `vllm/vllm-openai:latest` to a pinned `v0.10.x` tag, and the embedding/textgen wrapper bases (currently `opea/embedding:latest` / `opea/textgen:latest`) are pinned to the **1.5-based** upstream images — otherwise those two wrappers stay on an unbounded OPEA generation while the other four move to 1.5, producing **split-brain OPEA versions in one fleet**. Realizes UJ-2.
**Consequences:**
- No unbounded `:latest` image in the AI stack; reproducible GPU + wrapper bases.
- No mixed OPEA generations across the six overlay services.
- **Translation is in scope, explicitly:** the chatqna `TRANSLATOR` branch (the `ServiceType.TRANSLATOR` node that calls the translation LLM) rides the chatqna rebase (FR-1/FR-6); the `vllm-translation-guardrail` image it targets is **already pinned** (`vllm/vllm-openai:v0.10.0`) and stays part of the pinned AI stack. Translation is not a separate overlay module.
- This work is independent of the OPEA bump and lands as its **own commit** so a deployment issue is not confounded with the upgrade.

#### FR-16: Canary on `release/el-salvador` before `main`
The upgrade is validated on the deployed El Salvador stack (or the equivalent canary target) with **explicit exit criteria** — observation window, error-rate/latency thresholds, a RAG-quality spot-check, and no ingest anomalies — before promotion to `main`. A **side-by-side shadow comparison** (v1.3 images vs v1.5 images) is **required** (architecture decision D5): comps@1.5 against the already-ahead runtime (vLLM v0.10.x, TEI 1.9.3) is an upstream-unverified pairing, so real traffic is never the first test of the new stack. Realizes UJ-1, UJ-2.
**Consequences:**
- The upgrade never reaches `main` without a deployed-environment validation on defined criteria, not vibes.
- Matches the project's validate-before-promote rule.

#### FR-17: Keep rollback to v1.3 one step away — proven, not asserted
Rollback = redeploying the v1.3 image tags. The v1.3 digests are **retained by an explicit registry retention rule** (the promote/cleanup policy must keep them). Rollback is **rehearsed in staging**: deploy 1.5, run parity, redeploy v1.3, and prove the v1.3 images come up and serve queries against the **same ArangoDB** — i.e. **data written by v1.5 must be backward-readable by v1.3** (no schema/vector-payload change that strands a rollback as a re-ingest or migration). If that backward-read check fails, the canary runs on throwaway data instead. If parity or stability fails during FR-16, the fleet reverts to v1.3 and the upgrade is held. Realizes UJ-2.
**Consequences:**
- A failed upgrade does not strand a deployment on 1.5.
- Rollback is a drilled operation, not a marketing claim; image-retention makes it possible.
- The "no DB schema change" assertion is a verified check, not an assumption.

#### FR-18: Update docs, env, and the upgrade matrix
CLAUDE.md/env references affected by the bump are updated (e.g. `RERANKER_TOP_N` default drift noted, dependency pins, Python version), and the docs upgrade matrix gains the v1.3→v1.5 entry. Realizes UJ-1, UJ-2.
**Consequences:**
- Deployers and agents read correct version/dependency facts after the upgrade.
- The upgrade matrix / `CHANGELOG` are bound to the **same MR** that moves `OPEA_VERSION` (architecture pattern 9); CI asserts no `NEXT` placeholder remains.

#### FR-19: Confirm the targeted upstream improvements land
From the v1.4/v1.5 upstream changelogs, the concrete improvements and bug fixes this deployment benefits from are **enumerated** (docling/langchain/chunking fixes, dataprep/retriever upstream fixes, the CVE closures) and the named ones are **verified present in the deployed images** — so the "improvements + bug fixes" goal has a positive check, not just negative-space metrics (no regression, no break, fewer CVEs). Realizes UJ-1; closes the goal→metric gap.
**Consequences:**
- The value of the upgrade is evidenced, not assumed: a named fix is confirmed shipped.
- If a targeted fix is absent, it is explicitly recorded (present in upstream but not exercised, or not applied) rather than silently claimed.

## 5. Non-Goals (Explicit)

- **Not an agentic-enablement PRD.** Adopting OPEA 1.5's native agent, `OpeaMCPToolsManager`, or MCP surfaces is **out of scope**; it belongs to the agentic initiatives (`#603`, `feat/agentic-enablement`). 1.5's agent capabilities are noted only as downstream context.
- **Not building OKF or SST.** The OKF server and Server-Side Tools are separate initiatives.
- **Not moving to OPEA v1.6+.** v1.6 does not exist (verified: v1.5 is still the latest release as of 2026-08-07). This PRD pins 1.5.
- **Not rewriting the Genie-owned RAG modules.** Retriever/reranker/dataprep internals are preserved; only adapter contracts change.
- **Not a K8s migration** and **not a feature backport** from OPEA beyond 1.5.
- **Not an enumerated CVE list.** CVEs are fixed as a consequence of the library bumps; no per-CVE acceptance is tracked.

## 6. MVP Scope

### 6.1 In Scope
**Pre-rebase milestones (before FR-1, in order):**
- **(a) Baseline capture** for RAG parity (FR-11) — pinned corpus, queries, labels, model; multi-run variance-derived tolerance.
- **(b) `schedule()` kwargs-forwarding spike** on a bare v1.5 clone (FR-6) — a blocking gate: the chatqna rebase approach depends on its outcome.
- **(c) Pre-rebase cleanup** as a **separate, independently-tested v1.3 commit** (consolidate the 5 near-duplicate `add_remote_service*` variants; replace the `_parent_mod.ARANGO_DB_NAME` monkeypatch with a subclass override) — so a post-rebase regression has one variable, not two.
- **(d) Contract + smoke tests written green on v1.3** (FR-10) — then proven red on a bare v1.5 bump before re-grafting.

**Rebase (per-module, incremental — retriever → reranker → dataprep → chatqna last, not an atomic 4-way bump):**
- Overlay rebase to `OPEA_VERSION="v1.5"` (all 4 module Dockerfiles + chatqna's GenAIExamples/GenAIComps clones). (FR-1, FR-2)
- Python 3.11 migration + v1.5 dependency pins + compiled-requirements adoption (retiring the local lock machinery). (FR-3, FR-4)
- `langchain-arangodb` bump. (FR-5)
- Coupling-surface verification (FR-6) + `constants.py` regen (FR-7) + import-time sweep (FR-8) + build-patch audit (FR-9).
- Contract tests against real `comps` (orchestrator wire test, one-doc ingest, label filter, telemetry). (FR-10)
- RAG parity eval (incl. vector-space compat with existing corpus), CVE baseline-diff, full suites. (FR-11..FR-13)
- Upstream-improvement confirmation. (FR-19)
- Latent bug fixes, AI-stack image pins, el-salvador canary with exit criteria, rollback rehearsal + retention, docs. (FR-14..FR-18)

### 6.2 Out of Scope for MVP
- Agentic adoption, OKF, SST — separate initiatives (§5).
- OPEA 1.6+ — does not exist; re-check before starting the rebase (FR-1 gate).
- Any RAG-module rewrite beyond what a broken 1.5 contract forces.

## 7. Success Metrics

**Primary**
- **SM-1**: All 4 modules build on `OPEA_VERSION="v1.5"` and the contract tests (orchestrator wire, ingest, label filter, telemetry) + import smokes pass in CI. Validates FR-1, FR-10.
- **SM-2**: RAG parity — no regression vs the v1.3 baseline on the RAG-benchmarks reference eval (tolerance derived from baseline run-to-run variance), **including vector-space compatibility with the existing deployed corpus**. Validates FR-11.
- **SM-3**: CVE posture — **no net-new high/critical introduced by the bump**, evidenced by a baseline-diffed advisory; CVE closures recorded as the positive outcome. Validates FR-12.
- **SM-4**: Zero silent breaks — the coupling surfaces are verified, `schedule()` delivers all custom kwargs (proven by the spike + wire test), every monkeypatch has a behavioral assertion, and no runtime configuration is dropped. Validates FR-6.

**Secondary**
- **SM-5**: El Salvador canary green on defined exit criteria (FR-16) before `main`; rollback **rehearsed in staging** against the same ArangoDB (FR-17). Validates FR-16, FR-17.
- **SM-6**: Dead divergence removed — dataprep `.in`/`.lock`/generator/docling pin retired, and the compiled-lock pattern extended to retriever/reranker (D7); `verify:dataprep-lock` re-pointed. Validates FR-4.
- **SM-7**: The enumerated upstream improvements (FR-19) are confirmed present in the deployed images — the positive "what did we actually get" check. Validates FR-19.

**Counter-metrics (do not optimize)**
- **SM-C1**: "Newest dependency" — do not drift beyond v1.5's pins chasing novelty; the target is 1.5, not latest-everything.
- **SM-C2**: "Tests passing count" — contract tests + green suites are not a substitute for RAG parity (SM-2); do not trade quality proof for green CI.
- **SM-C3**: "CVE count" — do not remove packages to game the scanner; the posture change must come from the legitimate bump (SM-3).
- **SM-C4**: "Coupling-surface size" — the override surface must stay at or below v1.3's, so the *next* upgrade is cheaper, not harder; do not grow the overlay while rebasing (NFR-M2).

## 8. Cross-Cutting NFRs

**Security (NFR-S)**
- **NFR-S1**: Supply-chain integrity — CycloneDX SBOM and signed images for the upgraded images (per ADR-0001); the scan stage remains a blocking gate. (FR-12)
- **NFR-S2**: CVE posture — the bump must not introduce a net-new high/critical CVE. (FR-12)
- **NFR-S3**: No new secrets or credentials in images; non-root containers preserved.

**Reliability (NFR-R)**
- **NFR-R1**: RAG reliability parity — retrieval/ingest must not regress under load. (FR-11)
- **NFR-R2**: Rollback — previous image tags remain deployable with zero config change. (FR-17)
- **NFR-R3**: Graceful degradation — a failed upgrade path never leaves a deployment half-migrated. (FR-16, FR-17)

**Maintainability (NFR-M)**
- **NFR-M1**: Remove dead divergence (the v1.3-era lock machinery) rather than carry it. (FR-4)
- **NFR-M2**: The overlay remains a single-source override set; the rebase does not fork more OPEA files than v1.3 did.

**Performance (NFR-P)**
- **NFR-P1**: No latency regression on the RAG pipeline vs v1.3 (within documented tolerance). (FR-11)
- **NFR-P2**: No ingestion-throughput regression (dataprep). (FR-11)

**Compatibility (NFR-C)**
- **NFR-C1**: No breaking env-var/API/schema change for deployments (the upgrade is behavior-neutral). (FR-16, FR-17)
- **NFR-C2**: Image tags pinned; no `:latest` in the AI stack after this PRD. (FR-15)
- **NFR-C3**: `docker-compose.yaml` changes limited to pins and the `okf-server`-irrelevant surface. (FR-15)

**Observability (NFR-T)**
- **NFR-T1**: OTel tracing parity across the pipeline — spans propagate as before on 1.5 (the overlay's `tracing.py` and `@opea_telemetry` behavior unchanged). (FR-6)

## 9. Integration and Dependencies

- **OPEA upstream (`GenAIComps`, `GenAIExamples`)** — the cloned tags; the upgrade's object. (FR-1)
- **`genie-ai-overlay/` modules** — chatqna, dataprep, retriever, reranker, core, build-patches — the rebase surface. (FR-1..FR-9)
- **`tests/rag-benchmarks`** — the RAG-parity reference eval. (FR-11)
- **CI (`verify:dataprep-lock`, smoke jobs, scan stage)** — gates re-pointed/added. (FR-4, FR-10, FR-12)
- **Deployment (El Salvador / `release/el-salvador`)** — canary target; its `release/el-salvador` deployment is the validation environment. (FR-16)
- **`docker-compose.yaml`** — vLLM pin + image tags. (FR-15)
- **Translation** — not a separate overlay module: the chatqna `TRANSLATOR` branch rides the chatqna rebase (FR-1/FR-6); the `vllm-translation-guardrail` image is already pinned (v0.10.0, FR-15).
- **Downstream initiatives** — agentic/OKF/SST consume the upgraded foundation after this PRD (context only, out of scope).

## 10. Open Questions

1. **`schedule()` kwargs-forwarding outcome** — resolved by the pre-rebase spike (FR-6/§6.1-b); the open follow-up is *which* chatqna re-planned approach, if the spike fails.
2. **`langchain-arangodb` target version** — latest compatible with v1.5's `langchain-core`; exact version selected during FR-5. ([ASSUMPTION: a compatible release exists; if 0.0.4 is the newest that works with the pinned `langchain-core`, the bump is scoped to what 1.5 requires.])
3. **RAG-benchmarks baseline specifics** — baseline capture is now a pre-rebase milestone (§6.1-a); the open question is the concrete pinned corpus/query set and the measured run-to-run variance that fixes the tolerance.
4. **Canary exit criteria values** — the criteria shape is fixed (FR-16); the specific window/thresholds are set when the canary target is scheduled.
5. **Ownership/timeline** — the rebase touches the Python surface (dataprep/retriever/reranker/chatqna); ownership and sprint allocation to be confirmed with the current RAG-quality workstream to avoid collisions in `genieai_chatqna.py`. ([ASSUMPTION: the OPEA-rebase and RAG-quality work do not collide in `genieai_chatqna.py` during the same sprint — sequencing confirmed before start.])
6. **`RERANKER_TOP_N` default drift** — docs say 3; code says 2 (chatqna) / 1 (reranker). It doubles as a parity-baseline ambiguity (deployed vs documented v1.3 behavior) and is resolved as part of FR-11/FR-18; not a behavior change of this PRD.
7. **Compiled-lock hashes** — whether v1.5's `requirements-cpu.txt`/`-gpu.txt` carry hashes; if not, they are generated before adoption (FR-4).
8. **Concrete upstream improvements list** — the FR-19 enumeration is drawn from the v1.4/v1.5 changelogs during discovery of this PRD's execution; the named fixes to verify are finalized there.
9. **`openai-whisper` restore vs drop** — **resolved (architecture D8): follow upstream's compiled lock** — restore whisper if v1.5 pins it and it builds on the displayless image; any divergence carries a documented reason.
10. **Retriever/reranker compiled-lock adoption** — **resolved (architecture D7): extend now** — FR-4 covers all three modules.

## 11. Assumptions Index

- `[ASSUMPTION: v1.5's compiled lock carries hashes or is compiled with them — verified during FR-4]` (§4.2)
- `[ASSUMPTION: a `langchain-arangodb` release compatible with 1.5's `langchain-core` exists — if not, bump is scoped to 1.5's requirement]` (§10)
- `[ASSUMPTION: OPEA-rebase and RAG-quality work do not collide in `genieai_chatqna.py` during the same sprint]` (§10)
