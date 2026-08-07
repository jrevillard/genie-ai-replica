# Addendum — OPEA 1.3 → 1.5 Upgrade (rejected alternatives & mechanism context)

Preserves decision context that belongs downstream (architecture/solution) rather than in the PRD narrative. Audit info lives in `.decision-log.md`, not here.

## 1. Rejected alternatives

- **"Wait for OPEA v1.6 before upgrading."** Rejected. Verified: no v1.6/v1.7 exists as of 2026-08-07; v1.5 has been the latest release since 2025-12-22 (7.5 months). The briefing's "quarterly cadence, v1.6 due Q1 2026" extrapolation did not hold. Waiting is unbounded and accrues more drift/CVEs.
- **"Adopt OPEA 1.5's native agent / MCP as part of this PRD."** Rejected by directive. Agentic enablement is its own initiative (`#603`, `feat/agentic-enablement`). This PRD only lands the upgraded foundation.
- **"Refactor the chatqna monolith during the rebase" (#604).** Rejected as a combined step. The 5 near-duplicate `add_remote_service*` variants stay as-is for this rebase (except the pre-rebase cleanup item). Rebase ≠ refactor; the #604 modularization lands after 1.5, on the current foundation.
- **"Migrate the overlay from clone+patch to pip-install."** Rejected. The build-time clone + overlay pattern is what enables GENIE's heavy customization (file overwrites, injected `genieai_*` subclasses, monkeypatches). pip-install would not support it. The rebase keeps the mechanism.

## 2. Mechanism context (for architecture/solution design)

- **Overlay rebase vector map:** 4 vectors — (1) file overwrite (`constants.py`, `genieai_api_protocol.py`, `genieai_chatqna.py`, `entrypoint.sh`, `tracing.py`, `model_cache.py`, `label_contract.py`); (2) injected `genieai_*` subclasses into `comps` `integrations/`; (3) monkeypatches (`ServiceOrchestrator.align_*`, `_parent_mod.ARANGO_DB_NAME`); (4) build-time `sed`/`mv` patches (docarray rename, `fix_dependencies.sh`).
- **Key verified 1.5 facts the architecture must respect:**
  - Python **3.11** base images (not 3.10); dataprep compiled requirements target 3.11.
  - Dataprep requirements layout: `requirements.in` / `requirements-cpu.txt` / `requirements-gpu.txt` (no `requirements.txt`).
  - Pins: langchain 0.3.27, langgraph 1.0.1, mcp 1.24.0, docling-core 2.44.2.
  - `ServiceType` enum in v1.5 has no `TRANSLATOR` (slot 24 = `LANGUAGE_DETECTION`) → the fork must re-append `TRANSLATOR`.
  - `ServiceOrchestrator.align_*` base signatures became `*args`/`**kwargs`-style; GENIE's positional override remains compatible; `schedule(initial_inputs, llm_parameters, **kwargs)` carries the 6 custom kwargs only if `execute()` forwards them.
  - `comps.cores.telemetry.opea_telemetry` unchanged path (v1.0→v1.5).
  - Deployment already runs vLLM v0.10.0 + TEI 1.9.3 (beyond 1.5's validated vLLM v0.10.1 / TEI cpu-1.7) — the vLLM/TEI "bump" is not gated on this PRD; only the unpinned `vllm:latest` chat image needs pinning.
- Full evidence: `_bmad-output/planning-artifacts/research/opear15-upgrade-verification-review-2026-08-07.md`.
