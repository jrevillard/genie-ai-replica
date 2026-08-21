# Epic 2 Context: OPEA 1.5 overlay rebase (behavior-preserving)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Rebase the GENIE.AI overlay from OPEA v1.3 to v1.5 without changing user-visible behavior: all four module Dockerfiles (and the chatqna GenAIExamples/GenAIComps clones) move to `OPEA_VERSION="v1.5"`, the overlay overrides are re-applied onto the 1.3→1.5 diff (re-grafted, not rewritten), v1.5's dependency pins plus Python 3.11 are adopted fleet-wide, and every coupling surface with OPEA's `comps` library is verified so retrieval, labeling, reranking, and chat continue to work exactly as before. This keeps GENIE current with upstream so the accumulated library-level CVEs are closed and the platform becomes a stable, verified base for downstream initiatives.

## Stories

- Story 2.1: Re-graft the core overlay layer
- Story 2.2: Migrate dependencies + Python 3.11
- Story 2.3: Re-graft the retriever + bump `langchain-arangodb`
- Story 2.4: Re-graft the reranker
- Story 2.5: Re-graft the dataprep
- Story 2.6: Re-graft the chatqna (highest coupling, last)
- Story 2.7: Re-audit build patches + add enforcement
- Story 2.8: Sweep import-time breaks + re-baseline the mocked suite

## Requirements & Constraints

- **Behavior-neutral upgrade.** Genie-owned RAG module internals (dense COSINE + BM25 + RRF fusion, label filtering, contextual retrieval, graph traversal) are preserved in intent; only the thin adapter contracts to `comps` track 1.5. No breaking env-var, API, or schema change for deployments. RAG behavior may improve where the `langchain-arangodb` bump fixes a known defect, but must not regress.
- **Re-graft, not rewrite.** All overlay override vectors — file overwrites (`constants.py`, `genieai_api_protocol.py`, `genieai_chatqna.py`, `entrypoint.sh`, `tracing.py`, `model_cache.py`, `label_contract.py`), injected `genieai_*` integration subclasses, monkeypatches, and build-time `sed`/`mv` patches — are re-applied onto the v1.5 diff.
- **Python 3.11 fleet-wide.** All overlay images run Python 3.11 (matching v1.5 bases); compiled/C-extension pins are rebuilt. The `sitecustomize` SSL-bypass path must be Python-version-stable (a `.pth` entry or build-time-derived `site-packages` path), not a hardcoded `python3.10` path; the dataprep `update-alternatives` machinery is removed.
- **v1.5 dependency pins + compiled locks.** Adopt langchain 0.3.27, langgraph 1.0.1, mcp 1.24.0, docling-core 2.44.2 and the v1.4+ `requirements-cpu.txt`/`requirements-gpu.txt` compiled layout (`--require-hashes` semantics retained). The compiled-lock pattern applies to dataprep, retriever, and reranker (no half-migrated fleet); the dataprep local lock machinery and the `docling-core==2.82.0` pin are retired. Note the docling downgrade changes chunking behavior and must be exercised by the ingest smoke with production config.
- **`langchain-arangodb` bump.** Moved to a version compatible with v1.5's `langchain-core`; the `ArangoVector` path is re-validated, and label-filter + RRF fusion behavior is covered by a contract test (this targets a known 0.0.4 label-filter defect).
- **Coupling-surface verification.** Each contract with `comps` is diffed and verified, and every monkeypatch gets a behavioral assertion (e.g. the dataprep `_parent_mod` patch binds the right attribute) — a silently no-op patch is the failure class to catch. `constants.py` is regenerated from v1.5's enum with `TRANSLATOR` re-appended (v1.5 moved slot 24 to `LANGUAGE_DETECTION`); name→int mapping asserted.
- **No hidden import-time break.** Every image's imports are swept for langgraph 1.0.1 and new `comps` members (e.g. `ServiceType.PROMPT_REGISTRY`); broken paths are fixed, not documented away.
- **Per-module contract tests in-image.** Each module's contract test runs against real `comps` inside the built image (which also exercises the docarray rename, the compiled lock, and the Python 3.11 `sitecustomize` path) and asserts a v1.5-specific shape.
- **No dead divergence.** Dead divergence is removed (v1.3-era lock machinery), not carried. The overlay remains a single-source override set: the rebase must not fork more OPEA files or grow the coupling surface than v1.3 did.
- **Supply-chain.** No new secrets; non-root containers preserved; no net-new high/critical CVE introduced by the dependency surface.

## Technical Decisions

- **Per-module migration order:** core → retriever → reranker → dataprep → chatqna; one commit per module (`overlay(<module>): re-graft <module> to OPEA 1.5`); no module commit assumes an uncommitted core version.
- **Byte-identical delta philosophy.** Re-grafted files are byte-identical to upstream v1.5 except the lines carrying an override record; the diff source of truth is the pinned `v1.5` tag + exact command. No shim/compat wrapper outside the spike gate.
- **Override-audit manifest (`OVERRIDES.yaml`).** Every override carries a machine-checkable disposition (`still-needed` / `re-graft-to-new-API` / `obsolete-remove`) with owner, reason, and test; a CI lint fails on any override in the v1.5 diff with no entry. `obsolete-remove` is a real disposition — overrides upstream fixed in 1.5 are deleted, not carried.
- **Assert-on-patch guards.** Every build-time patch (`fix_dependencies.sh` REQ_PATH, dataprep sed rewrite, docarray rename) ends with `grep -q <marker> || exit 1` (the docarray `mv` followed by an import check), so a stale patch fails the build rather than shipping silently.
- **Docarray rename → `sys.modules` alias shim.** The `mv`+`sed` source rename is replaced with a `sys.modules` alias shim — no vendored-source mutation; survives any vendor layout.
- **Chatqna `schedule()` kwargs contract.** The six custom kwargs (`retriever_parameters`, `reranker_parameters`, `full_chat_history_string`, `retrieval_context`, `original_language`, `user_details`) are forwarded to handlers bundled as a single `genie_params` dict (one forwarding argument instead of six). If the pre-rebase spike proves v1.5 drops kwargs, subclass the orchestrator — no shim outside the spike gate.
- **Contract-test isolation (required).** Contract tests run inside the built image against real `comps`, isolated from the mocked `conftest.py`; each asserts a v1.5-specific shape (green-on-green is not testing the upgrade).
- **Mock-reality parity.** `conftest.py`'s `comps` stubs are re-baselined to real v1.5 signatures so "full suites green" is green against reality, not a stale mock.
- **Clean, reproducible builds.** `OPEA_VERSION` is a cache-busting ARG; no layer-cache reuse across the bump.
- **`versions.env` + coherence lint.** The authoritative image manifest; a lint hard-fails on mixed OPEA versions across the image set.
- **`openai-whisper` follows upstream.** Restore it if v1.5 pins it and it builds on the displayless image; any divergence from upstream's compiled lock carries a documented reason.

## Cross-Story Dependencies

- Story 2.1 (core overlay) precedes all module re-grafts (2.3–2.6): no module commit may assume an uncommitted core version.
- Story 2.6 (chatqna) depends on the `schedule()` kwargs-forwarding spike from Epic 1 (story 1.3) and on Epic 1's contract tests being proven red on a bare v1.5 bump before re-grafting.
- Story 2.2 (pins + Python 3.11) underpins every module Dockerfile rebase; stories 2.7 (patch guards + versions manifest) and 2.8 (import sweep + conftest re-baseline) are cross-cutting and gate green CI for all modules.
- Story 2.3's `langchain-arangodb` bump feeds Epic 3's parity/regression set (label-filter, confidence, abstention); Epic 2's per-module in-image contract tests feed Epic 3's full-suite green gate.
- Migration order is a hard dependency chain — chatqna is last because it has the highest coupling surface.
