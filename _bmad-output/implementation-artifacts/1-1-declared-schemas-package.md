---
baseline_commit: 1c18d7ac8
---

# Story 1.1: Declared schemas package (the shared contracts)

Status: review

## Story

As a client developer (Vue, Flutter, or a future tool backend),
I want the citation, degradation, and tool-result contracts as declared Pydantic models in one importable module,
so that every consumer renders from one verified shape (D10, D7, NFR21) instead of inline dict literals.

## Current State (verified on `feat/sst` 2026-09-01, post-1-5 `1c18d7ac8`)

- **Salvageable source verified**: `git show c0008225f:genie-ai-overlay/tools/schemas.py` (216 lines) — Pydantic `Citation` (D10 fields + `to_client_dict`), `Degradation` (D7 fields + optional `guidance`), `ToolResult` (normalized backend result + `to_citation()` projection with title fallback and confidence clamping), plus enums. ITU header included.
- **Destination is NOT the epic's path**: the epic says `genie-ai-overlay/tools/schemas.py`, but `tools/` was deleted (D1); live code lives in `workflows/tools/` (sprint-status 1-1 note: "recreate in workflows/tools/"). → `workflows/tools/schemas.py`.
- **ChunkSourceType already shipped elsewhere** (3-1, OQ-SST-6 resolved): `core/source_type.py` (`SourceType`: file/feed/web_search, OKF additive). The epic's ask predates that. **And the chatqna Dockerfile copies only SPECIFIC core files** (`model_cache.py`, `label_contract.py`, `genieai_api_protocol.py` — Dockerfile:86-89) — a `schemas → core.source_type` import would break the deployed chatqna image (the exact missing-module class that killed web search on 2026-08-31).
- **The dupe's `DegradationReason` conflicts with the recorded contract**: dupe has `CIRCUIT_OPEN/LOW_QUALITY/TIMEOUT/DENIED/BACKEND_ERROR`; the live 2-7/2-8 contract (plan.md entry 10) is **`LOW_QUALITY` | `SEARCH_UNAVAILABLE`** live + **`CIRCUIT_OPEN` | `EXECUTION_ERROR`** reserved (matching `governance.py:241-247,278-284` emission strings).
- **`GovernanceOutcome` must NOT be ported**: `governance.py` has a live, tested `GovernanceResult` dataclass — a second verdict type is dead code that drifts.
- **Citation model vs live emission — known divergence, documented**: the D10 `Citation` (url/title/source_type/retrieved_at/confidence) is the canonical contract; what chatqna currently emits per source_documents entry is the 2-8 declared SSE shape (document_id/document_name/url/source_type/categoryLabels/serviceLabels/score). Reconciling emission to D10 is **2-9+ scope** (rendering); this story lands the declared models + tests, it does NOT rewire chatqna.
- Pydantic 2.13.4 available in the overlay venv; FastAPI ships it in every service image.

## Acceptance Criteria

1. `workflows/tools/schemas.py` exists with ITU header and declares: `CitationSourceType` (`document|web_search|feed` — matching the strings 2-8 already emits), `DegradationReason` (`LOW_QUALITY|SEARCH_UNAVAILABLE` live + `CIRCUIT_OPEN|EXECUTION_ERROR` reserved — the recorded contract, dupe's TIMEOUT/DENIED/BACKEND_ERROR dropped), `Citation` (D10 fields exactly: url, title, source_type, retrieved_at, confidence 0..1, `to_client_dict()` flattening enum + ISO-8601 datetime), `Degradation` (D7 fields exactly: tool_id, reason, fallback_applied, message, optional guidance, `to_client_dict()`), `ToolResult` (+ `to_citation()` with title-fallback and confidence clamping).
2. **No import of `core.*`** in schemas.py (deployment safety — the chatqna image does not ship core/source_type.py) and no other new imports beyond pydantic/stdlib. ChunkSourceType stays in `core/source_type.py` (3-1, OQ-SST-6); schemas documents the pointer.
3. `GovernanceOutcome` NOT ported (live `GovernanceResult` in governance.py is the verdict type).
4. New `tests/test_schemas.py`: D10/D7 JSON shape assertions (the one-contract check Vue/Flutter verify against), `to_client_dict` flattening, `to_citation` projection (empty-title fallback → URL; score clamp to [0,1]), pydantic validation rejects out-of-range confidence, enum value sets exactly match the recorded contract, module imports standalone (no core, no circular).
5. Overlay suite green; ruff clean. No changes to any other module (chatqna emission untouched).

## Tasks / Subtasks

- [x] Task 1 — Port + reconcile the module (AC: 1, 2, 3)
  - [x] Start from `git show c0008225f:genie-ai-overlay/tools/schemas.py`; drop `ChunkSourceType` (pointer comment to core/source_type.py instead), drop `GovernanceOutcome`/`GovernanceStatus`, replace the `DegradationReason` enum with the recorded four-value contract, keep `CitationSourceType`, `Citation`, `Degradation`, `ToolResult` with docstrings (they carry the D10/D7 rationale — trim references to the dead dupe paths)
- [x] Task 2 — `tests/test_schemas.py` (AC: 4)
- [x] Task 3 — Suite + ruff; trackers (sprint-status 1-1 → review, plan.md session log)

## Dev Notes

- The module is deliberately self-contained: pydantic + stdlib only. The image-safety constraint (no core imports from workflows/tools) is a hard rule learned from the 2026-08-31 web-search kill — call it out in the module docstring.
- Field names are the wire contract — do not "improve" them (D10: `retrieved_at`, `confidence`; D7: `fallback_applied`). Renaming breaks two clients.
- `to_client_dict` exists because the Flutter parser reads raw JSON maps (no enum deserialization) — keep the flattening behavior.
- Do NOT wire anything to these models in this story (no chatqna/fusion changes) — consumers adopt them in their own stories; that keeps this diff purely additive and unreviewable-in-depth-by-mistake.

### Testing standards

- pytest in venv; plain assertions on `.model_dump()`/`to_client_dict()` output; no conftest dependencies needed (pure module).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.1] — story text, D10/D7 field lists, AC
- [Source: git show c0008225f:genie-ai-overlay/tools/schemas.py] — the salvage (216 lines, verified complete)
- [Source: genie-ai-overlay/core/source_type.py] — where ChunkSourceType actually lives (3-1, OQ-SST-6)
- [Source: genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai:83-89] — the partial core/ copy that forbids core imports from workflows/tools
- [Source: _bmad-output/implementation-artifacts/2-8-*.md Decisions] — the recorded reason enum + source_type values
- [Source: genie-ai-overlay/workflows/tools/governance.py GovernanceResult] — the live verdict type (no duplicate)
- [Source: _bmad-output/planning-artifacts/prds/prd-server-side-tools.md ~:200-223] — D10 citation schema + D7 degradation schema JSON


### Review Findings

_Code review 2026-09-01 — all 3 layers; both Highs independently confirmed by two layers each, every Edge finding reproduced live in the venv. Auditor: all 5 ACs satisfied, salvage fidelity field-for-field, enum values match live emission strings._

- [x] [Review][Patch] **HIGH (Blind+Edge) — NaN score launders into MAXIMUM confidence** — `min(1.0, nan)` returns 1.0, so `ToolResult(score=nan).to_citation().confidence == 1.0`. FIXED: `allow_inf_nan=False` on `score` (and `confidence`) — NaN/inf rejected at construction (test-pinned).
- [x] [Review][Patch] **HIGH (Blind+Edge) — naive `retrieved_at` serialized offset-less** — JS/Dart read it as the viewer's LOCAL time. FIXED: after-validator coerces naive → UTC; ISO assertion strengthened to require the offset suffix (pydantic emits `Z` — assertion accepts both).
- [x] [Review][Patch] **(Blind+Edge) — `extra="ignore"` in a contract module** — typo'd kwargs silently dropped. FIXED: `ConfigDict(extra="forbid")` on all three models + typo test.
- [x] [Review][Patch] **(Blind+Edge) — `fallback_applied` free-form despite the two-value contract** — FIXED: `Literal["rag_only", "none"]` (matches every live emitter); hyphen-typo test.
- [x] [Review][Patch] **(Blind) — hand-rolled serializers would silently drop future fields** — FIXED: `to_client_dict` now delegates to `model_dump(mode="json")` (+`exclude_none` for Degradation); pydantic cannot drop fields. Empty-`guidance` semantics now explicit (emitted as-is; only None omitted — documented).
- [x] [Review][Patch] **(Blind) — post-construction mutation bypassed every constraint** — FIXED: `frozen=True` (DTOs) + mutation-raises test.
- [x] [Review][Patch] **(Blind+Edge) — empty URL/whitespace-title paths** — `min_length=1` on Citation/ToolResult `url`; title fallback now strip-aware (`"   "` → URL). Blank-citation path closed.
- [x] [Review][Patch] **(Edge+Blind) — cwd-sensitive subprocess import test** — cwd pinned to the overlay root (measures standalone-ness, not the invoker's directory).
- [x] [Review][Patch] **(Edge+Blind) — textual no-core scan brittle** — replaced with an AST walk of Import/ImportFrom nodes (prose-immune).
- [x] [Review][Patch] **(Auditor+Blind) — weak assertions** — ISO offset pinned; boundary values 0.0/1.0 asserted inclusive; `retrieved_at` propagation asserted; `_utcnow`'s false monkeypatch affordance removed from its docstring.
- [x] [Review][Dismiss] Casing asymmetry (`web_search` vs `LOW_QUALITY`) — both conventions are the recorded contract-of-record (D10 JSON lowercase, D7 exemplar uppercase); pinned by tests on purpose.
- [x] [Review][Dismiss] Reserved enum values "frozen as live" — intended: the 2-8 decision explicitly reserves CIRCUIT_OPEN/EXECUTION_ERROR and governance already emits those strings.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Initial port 776 green → review-hardened module + tests → **786 passed** (27 schema tests), ruff clean
- Review depth: every Edge finding reproduced with live venv probes; both Highs found independently by two layers
- Test-authoring mistakes caught in-session: walrus-in-import syntax error, `+00:00` vs pydantic's `Z` UTC suffix

### Completion Notes List

- `workflows/tools/schemas.py`: Citation (D10), Degradation (D7), ToolResult (+ projection), CitationSourceType, DegradationReason — review-hardened: frozen DTOs, `extra="forbid"`, UTC coercion, NaN/inf rejection, `Literal` fallback_applied, serializer delegation to pydantic
- Reconciliations held: no core imports (Dockerfile constraint — AST-enforced by test), no ChunkSourceType duplication (lives in core/source_type.py), no GovernanceOutcome (live GovernanceResult), reason enum = the recorded 2-8 contract
- Zero wiring changes — consumers adopt the models in their own stories (2-9+ for citation emission reconciliation, documented)

### File List

- genie-ai-overlay/workflows/tools/schemas.py (NEW)
- genie-ai-overlay/tests/test_schemas.py (NEW)
- _bmad-output/implementation-artifacts/{1-1 story, sprint-status, plan.md}

### Change Log

- 2026-09-01: Declared contracts ported from c0008225f + reconciled + review-hardened (frozen/forbid/UTC/NaN/Literal); 786 tests green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
