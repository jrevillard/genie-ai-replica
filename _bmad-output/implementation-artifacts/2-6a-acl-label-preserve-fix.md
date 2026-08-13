---
baseline_commit: pending
---
# Story 2.6a: ACL-label preserve fix (extracted, UNGATED — highest P0 priority)

Status: ready-for-dev
Story key: `2-6a-acl-label-preserve-fix` | GitLab: #916 (`prd::okf-server`, `okf-server::epic-2.9`)
Epic: 2.9 (Write-side Orchestration) | Branch: `feat/okf-server`
FRs: **FR-18** (ACL as `chunk_labels` `t:`/`r:`/`d:`), **FR-24** (per-graph ACL enforcement) | Gap: **G4** (P0) | Launch gate: **LG-3**

> Extracted from gated Story 2.6 (which keeps `graph_name` wiring + retract). **Ungated** — the label-finalization logic is pure Python, independent of the OPEA 1.5 bump (see §Gating). This is the load-bearing wall for OKF isolation.

## Story

As a **platform engineer**,
I want **ACL-prefixed `file_labels` (`t:`/`r:`/`d:`) preserved into `chunk_labels` at ingest, and the LLM label call short-circuited when concept frontmatter already carries labels**,
so that **per-tenant/repo/domain isolation actually holds at retrieval once the orchestrator (2.9.1) and authz resolver (6.1b) land.**

## Acceptance Criteria

> **Verbatim AC (epics.md, the authority):** *Given dataprep `_finalize_chunk_labels` (today silently drops ACL prefixes — `genieai_dataprep_arangodb.py:1051-1104`), When an OKF ingest carries `file_labels:[t:,r:,d:]`, Then those prefixes survive into `chunk_labels` on the `_SOURCE` chunk doc (regression test asserts the exact labels post-ingest), and the LLM label call is short-circuited when concept frontmatter already carries labels. (ADR-okf-013 revision; G4; LG-3 launch gate.)*
>
> The AC below makes that verbatim criterion **implementable and gap-free**, folding in findings from the 2.6a whole-initiative context analysis (5 analyzers + adversarial critic).

1. **ACL preserve — main LLM path (P0).** Given `file_labels` containing ACL-prefixed labels (exact prefix set `{t:, r:, d:}`), when a chunk is ingested through the LLM labeling path, then every ACL-prefixed label is **unioned into the returned `labels_list` unconditionally** (bypassing taxonomy validation and the scope filter), survives into `doc["labels"]` (line 506) and lands on `metadata["chunk_labels"]` (line 1300). Existing taxonomy-validated content labels are **not** removed. *(Closes G4 on the happy path.)*
2. **ACL preserve — per-chunk fallback path (P0, critic gap #1).** Given the per-chunk fallback fires (the batch call fails/returns `None` and `_llm_call_single` exhausts its 3 internal retries, then returns `file_labels` as `suggested` — lines 892/915/920/976), ACL prefixes **still survive** into `chunk_labels` via the same union. *(The fallback path also drops ACL labels today — it is NOT already-safe. With Part 2 in place this path is unreachable for ACL-bearing docs in production, so it is tested by calling `_finalize_chunk_labels`/`_label_with_llm` directly — defense-in-depth at the primitive.)*
3. **LLM short-circuit (AC #2 of the verbatim).** When `file_labels` contains **at least one ACL-prefixed entry**, `_apply_labels` (line 1135) **skips** the `_label_with_llm`/embedding/bm25 call (no **label-call** vLLM round-trip, no `dataprep.llm.label_*` spans), emits `file_labels` (de-duplicated, order-preserving) as `doc["labels"]` per chunk (ACL + concept tags), and writes an INFO ingestion-log line recording the short-circuit. *(Note: Contextual Retrieval, on by default, still runs its own vLLM calls beforehand at line 1278 — intentional and out of scope for 2.6a. This AC is mutually exclusive with AC 1's LLM path: the LLM never runs here, so `file_labels` is the authoritative set.)*
   - **PINNED PREDICATE (decision — see §Open decisions):** the short-circuit fires **iff `file_labels` contains ≥1 ACL-prefixed entry**. It must **NOT** fire on bare `file_labels` non-emptiness (that would skip LLM labeling for every legacy Gov-Chat doc carrying taxonomy scope labels — a corpus-wide regression, breaking `test_file_labels_scope_filters_out_of_scope`).
4. **No-op for the free-form GRAPH corpus (backward compat).** Given `file_labels` is `None`/empty **or** contains only non-ACL content/taxonomy labels (e.g. `["Healthcare","Water"]`), `chunk_labels` output is **byte-identical to pre-fix behavior** — the LLM still runs, out-of-scope taxonomy suggestions are still dropped, and no spurious ACL tokens appear. Pinned by existing tests (unchanged): `test_file_labels_scope_filters_out_of_scope` (test_dataprep.py:434), `test_file_labels_empty_keeps_taxonomy_labels` (:471), `test_fallback_to_file_labels_when_empty_taxonomy` (:335).
5. **No spurious WARN (critic gap #2).** ACL-prefixed labels are **excluded from `new_labels`** (line 1083) before the WARN decision — no "consider adding `t:/r:/d:` to the Knowledge Hierarchy" message is ever emitted. (ACL labels are enforcement tokens, not taxonomy candidates.)
6. **Exact `chunk_labels` format.** ACL labels are stored as **individual exact-string list elements** verbatim (e.g. `["t:tenant1","r:repoA","d:health","Healthcare"]`) — no concatenation, no nesting, no normalization. The retriever matches by **exact membership** (`in` / AQL `ANY|ALL IN`) with **no** prefix/startswith/regex/split matching. **Duplicates are de-duplicated on both paths** — Part 1's union dedups against `labels_list`; Part 2's short-circuit dedups `file_labels` order-preserving (`list(dict.fromkeys(...))`).
7. **Regression: LG-3 (dataprep unit test, not deployed).** A pytest asserts that a chunk labeled with `file_labels=["t:tenant1","r:repoA","d:health","Healthcare"]` yields `chunk_labels` containing all three ACL strings (case-sensitive, membership assertion) plus the taxonomy-validated content label. **LG-3 is a dataprep unit test** — there is no ACL injector and no `OKF_{repo_id}_SOURCE` graph today (orchestrator 2.9.1 unbuilt; microservice hardcodes `graph_name` at microservice:191 — see §Scope boundary), so deployed isolation cannot be probed on 2.6a alone.
8. **Standards.** Ruff-clean (line-length 120, py310, double quotes; pyproject.toml:40-63); pytest green; ITU copyright header on any new test file (copy test_dataprep.py:1 verbatim — **do not** modify source headers at genieai_dataprep_arangodb.py:1-3). All exceptions handled + logged via `CustomLogger` / `_write_ingestion_log` (never `print()`).

## Tasks / Subtasks

- [ ] **T1 — ACL-preserve primitive in `_finalize_chunk_labels`** (AC: 1, 2, 5)
  - [ ] `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — define a **module-level** (not a method) `_ACL_LABEL_PREFIXES = frozenset({"t:", "r:", "d:"})` near the other constants; add a module-level helper `def _is_acl_label(l): return isinstance(l, str) and l.startswith(("t:", "r:", "d:"))` (single-source the rule for both T1 and T2; both call it **bare** — `_is_acl_label(l)` — without `self.`, so it must be module scope). The `startswith` is **case-sensitive by design** — `"T:tenant1"` is NOT an ACL label (pins the L4 canonicalization boundary; the orchestrator 2.9.1 must emit lowercase prefixes).
  - [ ] In `_finalize_chunk_labels` (1051-1104): **after** the scope-filter block (after line 1094) and **before** the log build (line 1096), union ACL-prefixed `file_labels` into `labels_list` (dedup against existing). Exclude ACL-prefixed entries from `new_labels` (so the WARN at 1100-1102 never lists them).
  - [ ] Extend the existing "Final labels" ingestion-log line (1097) additively (e.g. append ` (incl. N ACL)` when ACL labels were preserved) — do **not** restructure the message (log parsers may regex it).
- [ ] **T2 — LLM short-circuit in `_apply_labels`** (AC: 3)
  - [ ] `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — in `_apply_labels` (1135), add the short-circuit as the **first** branch (before the `if not all_labels` check): if `any(_is_acl_label(l) for l in (file_labels or []))` and `file_labels`, write an INFO ingestion-log line and `return [{"text": c, "labels": list(file_labels)} for c in plain_chunks]`.
  - [ ] This also covers the embedding/bm25 strategies (they dispatch after this point) — Part 1 alone does **not** (see AC 9 / critic gap).
- [ ] **T3 — Tests: ACL preserve (direct unit test of the bug site)** (AC: 1, 2, 7) — add `TestFinalizeChunkLabels` to `genie-ai-overlay/tests/test_dataprep.py` (reuse `create_dataprep()` at test_dataprep.py:25-39; stub `_write_ingestion_log` with `AsyncMock`):
  - [ ] `test_acl_prefixed_file_labels_preserved` — `suggested=["Cucumber"], all_labels=["Cucumber"], file_labels=["Cucumber","t:t1","r:r1","d:dom"]` → result contains `t:t1/r:r1/d:dom` AND `Cucumber` survives (scope intact). Fails pre-fix, passes post-fix.
  - [ ] `test_acl_only_file_labels_preserved_when_no_taxonomy_match` — `suggested=[], all_labels=["Healthcare"], file_labels=["t:t1"]` → result == `["t:t1"]`.
  - [ ] `test_no_acl_no_behavior_change` — `file_labels=["Healthcare"], suggested=["Healthcare"], all_labels=["Healthcare"]` → result == `["Healthcare"]` (regression guard for non-OKF docs).
  - [ ] `test_finalize_excludes_acl_from_new_labels` (critic gap #2) — `suggested=["t:t1"], all_labels=[]` → no ingestion-log WARN whose `new_labels` contains an ACL entry.
  - [ ] `test_acl_predicate_membership` — `_is_acl_label("t:x")` True; `_is_acl_label("r:y")`/`("d:z")` True; `_is_acl_label("Healthcare")` False; **`_is_acl_label("T:x")` False** (pins the case-sensitive contract so a dev does not later "fix" it to case-insensitive); `_is_acl_label("t:")` True (empty-value degenerate token — note value sanitization is owned by 2.9.1/L3, not 2.6a).
- [ ] **T4 — Tests: short-circuit (proves the LLM is skipped)** (AC: 3) — add `TestApplyLabelsAclShortCircuit`; mirror the `assert_not_called()` pattern from `test_flag_off_returns_chunks_unchanged` (test_dataprep.py:1519-1528) and `TestLabelWithLlm` (:358-389):
  - [ ] `test_short_circuits_llm_when_acl_present` — `all_labels=["Healthcare"]` (NON-empty, so the empty-taxonomy branch is not taken), `file_labels=["t:t1","r:r1","d:dom","Healthcare"]` → patch `_build_vllm_client` (line 207) and `_label_with_llm` as mocks; assert **neither called**; result labels contain all 3 ACL prefixes + `Healthcare`. Fails pre-fix.
  - [ ] `test_llm_still_called_when_no_acl` (AC 4 + pinned predicate) — `file_labels=["Healthcare"]` (no ACL) → `_label_with_llm` IS called (existing behavior preserved). **This is the test that pins the predicate** — it fails if a dev gates on bare `file_labels` non-emptiness.
  - [ ] `test_short_circuit_dedups_duplicate_acl_labels` (AC 6 on the short-circuit path) — `file_labels=["t:t1","t:t1","Healthcare"]` → result labels contain `t:t1` exactly once (order-preserving dedup).
  - [ ] `test_short_circuits_embedding_strategy_when_acl_present` + a `bm25` variant (critic gap — Part 2 is the ONLY ACL-preserve for non-LLM strategies) — `patch.object(dp_module, "LABELING_STRATEGY", "embedding")`, patch `_label_with_embedding`, ACL `file_labels`; assert `_label_with_embedding.assert_not_called()` AND result carries the ACL labels. Repeat for `LABELING_STRATEGY="bm25"`. (Without this, a future refactor moving Part 2 after strategy dispatch silently loses ACL labels on embedding/bm25 with zero test failure.)
- [ ] **T5 — Test: per-chunk fallback path preserves ACL** (AC: 2, critic gap #1) — the fallback returns `file_labels` as `suggested` (line 976) which flows through `_finalize_chunk_labels`; without T1 the ACL labels hit `new_labels` (1083) and are dropped.
  - [ ] `test_acl_survives_per_chunk_fallback` — call `_label_with_llm` (or `_finalize_chunk_labels` directly) and **simulate the line-976 fallback return** by EITHER (a) patching the vLLM client (`chat.completions.create`) to raise 3× so the **real** `_llm_call_single` exhausts its internal retry loop (line 920) and returns `list(file_labels)` at 976 — mirror `test_retry_and_fallback_on_failure` (test_dataprep.py:392-409); OR (b) patch `_llm_call_single` to **return** `list(file_labels)` directly. With `file_labels=["t:t1","r:r1","d:dom","Healthcare"]`, `all_labels=["Healthcare"]`; assert all 3 ACL labels survive into the result. **Do NOT** patch `_llm_call_single` to raise — it wraps its body in try/except over 3 attempts and **never propagates**; raising hard-fails `_label_with_llm` (uncaught through `_llm_suggest_labels`:915 / `asyncio.gather`:496) instead of returning fallback labels. (For a single-chunk input the batched branch at line 892 is skipped, so `_llm_call_batch` setup is irrelevant.) Must call `_label_with_llm`/`_finalize_chunk_labels` **directly** — Part 2 makes the fallback unreachable for ACL docs via `_apply_labels` in production.
- [ ] **T6 — Test: end-to-end metadata** (AC: 1, 7) — feed `create_mock_ingest_input(file_labels=["t:tenant1","r:repoA","d:health","Healthcare"])` through `ingest_file_with_guardrail`; capture the chunk via a `_process_batch` side-effect; assert its `metadata["chunk_labels"]` contains the 3 ACL prefixes + `Healthcare`. **Do NOT mock `_apply_labels`** — the existing `test_document_metadata_correct` (test_dataprep.py:956-990) mocks it, so a test mirroring it would pass **pre-fix** (it only checks the `chunk_labels = doc["labels"]` plumbing, not the preserve). Instead let the **real Part 2 short-circuit fire** and mock only the surrounding surface: `_fetch_all_labels`, `_load_and_chunk`, `_run_guardrail`, `_process_batch`, `ArangoGraph`, `Document`, AND `_apply_contextualization` (it runs first at line 1278 and would otherwise make vLLM calls). Also mock `graph_name` (hardcoded to the default GRAPH today — §Scope boundary). If `_apply_labels` must be mocked for wiring isolation, drop AC 1 from this test (T3 covers `_finalize_chunk_labels` directly) and re-scope T6 as wiring-only.
- [ ] **T7 — Lint/format/verify** (AC: 8)
  - [ ] `cd genie-ai-overlay && ruff check . && ruff format --check . --extend-exclude '*.md' && pytest tests/test_dataprep.py -v` then full `pytest`. **Note:** ruff/pytest are **not** on the local Windows PATH — run inside a venv: `python -m venv .venv && . .venv/bin/activate && pip install -e ".[test]" ruff` (mirrors `.gitlab-ci.yml:2224-2228`). PostToolUse ruff hook auto-fixes only on edits to existing files — a new test file must be lint-checked explicitly or CI `lint:python` (.gitlab-ci.yml:2050) fails.

## Dev Notes

### The bug (verified, file:line)

`_finalize_chunk_labels(self, index, suggested, all_labels, file_id, file_labels=None)` at **genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:1051-1104**:

- Builds `final_labels` **only** from the LLM `suggested` list resolved against the taxonomy `all_labels` (exact + plural/synonym match, lines 1068-1083). Anything not in the taxonomy → `new_labels` (line 1083) → discarded + WARNed.
- `labels_list = list(final_labels)` (line 1085).
- The scope block (lines 1091-1094) reads `file_labels` but **only to DROP** out-of-scope taxonomy labels: `labels_list = [l for l in labels_list if l in scope]`. It **never unions `file_labels` into the output.**
- ACL labels (`t:`/`r:`/`d:`) arrive in `file_labels` (set at line 1272 from `input.file_labels`) but are (a) never in the taxonomy `all_labels` (service categories — `_fetch_all_labels` lines 355-396), so the LLM never suggests them; (b) would fail the taxonomy match and land in `new_labels`. → They never reach `labels_list` → never reach `chunk_labels` (written at line 1300: `"chunk_labels": doc["labels"]`).

**Single call site:** line 506 inside `_label_with_llm` (def line 467). `_label_with_llm` is reached via the default `LABELING_STRATEGY == "llm"` branch of `_apply_labels` (line 1150-1152). Full chain: `ingest_file_from_repo` (microservice:134) → `ingest_file_with_guardrail` (microservice:210 / arangodb:1226) → `_apply_labels` (arangodb:1284) → `_label_with_llm` (arangodb:1152) → `_finalize_chunk_labels` (arangodb:506). OKF + free-form docs **share** this path.

### The fix (suggested, additive, minimal)

**Part 1 — in `_finalize_chunk_labels`, after the scope filter (after line 1094), before the log build:**
```python
# Preserve ACL labels (t:<tenant>, r:<repo_id>, d:<domain>) from file_labels.
# These are access-control tokens, NOT taxonomy entries: never taxonomy-resolved,
# scoped, or WARNed — only propagated verbatim so the retriever can enforce
# per-tenant/repo/domain isolation (OKF gap G4).
acl_labels = [l for l in (file_labels or []) if _is_acl_label(l)]
if acl_labels:
    _existing = set(labels_list)
    for l in acl_labels:
        if l not in _existing:
            labels_list.append(l)
            _existing.add(l)
```
Also: when building `new_labels` (line 1083), skip ACL-prefixed entries (critic gap #2 — prevents the spurious "add to Knowledge Hierarchy" WARN).

**Part 2 — in `_apply_labels`, as the FIRST branch (before `if not all_labels`):**
```python
# Short-circuit: when file_labels carries ACL prefixes, it is the authoritative,
# orchestrator/author-declared label set (OKF concept frontmatter). The LLM/
# embedding/bm25 call is redundant cost. No-op for free-form docs (no ACL prefixes).
if any(_is_acl_label(l) for l in (file_labels or [])) and file_labels:
    _labels = list(dict.fromkeys(file_labels))  # order-preserving dedup (AC #6)
    await self._write_ingestion_log(
        file_id, "INFO", "Labeling",
        f"Skipping LLM labeling: file_labels carries ACL prefixes; "
        f"preserving {len(_labels)} label(s) verbatim.",
    )
    return [{"text": c, "labels": list(_labels)} for c in plain_chunks]
```
**Why both layers:** Part 1 is defense-in-depth at the primitive (covers the per-chunk fallback that re-enters `_finalize_chunk_labels`). Part 2 is the only ACL-preserve mechanism for the **embedding/bm25** strategies (`_label_with_embedding`/`_label_with_bm25` at 1106-1133 neither call `_finalize_chunk_labels` nor receive `file_labels`) — so Part 2 is **mandatory, not optional** (critic gap).

### The consumer contract (retriever — do NOT change, this is what 2.6a must satisfy)

- `chunk_labels` is a `list[str]` matched by **exact membership**: Python `_chunk_passes_label_filter` does `label in chunk_labels` (genie-ai-overlere_retriever_arangodb.py:87-100); AQL does `[...] ANY|ALL IN doc.chunk_labels` (:798-810). **No** prefix/regex/split matching anywhere. → Store each ACL label as a verbatim individual list element.
- **AND/OR semantics:** AND = all required present; OR = any one. **Deployment default is `ARANGO_FILTER_STRATEGY=OR` (config.py:221).**

### ⚠️ Critical dependencies & limitations (document, do not fix in 2.6a)

| # | Limitation | Detail | Owned by |
|---|---|---|---|
| **L1** | **Default OR leaks same-tenant/cross-repo.** | Under OR, a repo-B chunk in the same tenant shares `t:t1` → passes → **cross-repo leak** even after 2.6a preserves labels. End-to-end per-repo isolation requires **AND** for ACL labels. | Follow-up: force AND when any `t:/r:/d:` is in `labels_to_filter`, OR split taxonomy(OR)+ACL(AND), OR Epic 1 per-dimension grouping. **Not 2.6a.** |
| **L2** | **G12 — filter only on `search_start=='chunk'`.** | node/edge search and `fetch_neighborhoods` traversal apply **no** `chunk_labels` filter (:957/974/982/994/1024, :389). 2.6a guarantees chunk-mode dense+BM25 enforcement only. | Story 1.1 (all-modes filter). |
| **L3** | **AQL injection vector.** | Retriever builds the filter by **raw string interpolation** (:799 `labels_array = '[' + ', '.join(f'"{label}"'...) + ']'`). ACL values (tenant/repo/domain) will flow through this once 6.1b resolves tokens. A value with `"`/`\`/newline breaks AQL or permits injection. | Orchestrator (2.9.1) MUST sanitize tenant/repo/domain to `[A-Za-z0-9_-]`; retriever should parameterize. **Hard dependency for 6.1b.** |
| **L4** | **Canonicalization skipped under short-circuit.** | Part 2 emits frontmatter labels verbatim (no plural/synonym/case normalization). Retriever exact-match means `"healthcare"` ≠ `"Healthcare"` → silent recall collapse. | Producer/parser (Story 2.3) must emit taxonomy-canonical labels; 2.6a does not re-canonicalize. |
| **L5** | **No backfill.** | `chunk_labels` is written only at ingest (line 1300). Old chunks lack ACL labels until re-ingest (idempotent per ADR-okf-021 §5). Moot for OKF pre-2.9.1 (no chunks carry ACL labels yet). | Operational note. |

### Scope boundary (what 2.6a does NOT do — critic gap #3, "latent not active")

- **No ACL injector exists today.** The microservice handoff wires `file_labels` (microservice:190), but today it carries taxonomy category labels from the Gov-Chat upload path, **not** ACL prefixes. The sole ACL injector is the orchestrator (**Story 2.9.1**, unbuilt).
- **`graph_name` is hardcoded** to `ARANGO_GRAPH_NAME` (the default `GRAPH`) at microservice:191 — it does **not** read the request body (G5, **Story 2.9.6**). So `OKF_{repo_id}_SOURCE` does not exist today; any integration test asserting `chunk_labels` on an OKF graph must **mock `graph_name`**.
- **2.6a is a forward-fix:** it makes `_finalize_chunk_labels` preserve ACL labels so the isolation wall is load-bearing **when** 2.9.1 (inject) + 6.1b (read-side resolver) + 2.9.6 (`graph_name` wiring) land. It delivers **zero observable isolation improvement on its own.** The LG-3 regression is a **dataprep unit test** (mock `file_labels`), not a deployed isolation probe.

### Gating (confirmed UNGATED)

The course-correction carves G4 out as "Extract Story 2.6a (ungated)" (okf-course-correction-2026-08-13.md:36 gap table; :467 Phase 1 "highest priority, ungated. The load-bearing wall"; :436 §5 new-stories row). The fix target (`_finalize_chunk_labels`) is pure-Python label-set logic (set/list comprehensions, `str.lower()`/`endswith()`, `_write_ingestion_log`) with **zero** dependency on the bump-gated surface — no `comps`/`graph_name`/`MicroService`/`register_microservice`/`constants.py`/Dockerfile imports in that code path. `file_labels` and `graph_name` are already present on `ArangoDBDataprepRequestFromDocRepo` (core/genieai_api_protocol.py:201,209,249) — no model/Dockerfile/constants change needed. ADR-okf-023 §3 (D24) gates only the **read-side** `graph_names` transport; the bump's dataprep risk is dependency re-validation (OPEA-1.5-upgrade-analysis §A4), not label logic. **May land on the current base immediately.**

**Files this story touches (and ONLY these):** MODIFIED `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` (`_finalize_chunk_labels` 1051-1104; `_apply_labels` 1135-1152; + `_ACL_LABEL_PREFIXES`/`_is_acl_label`); MODIFIED `genie-ai-overlay/tests/test_dataprep.py` (new test classes; keep :335/:434/:471/:956-990 green). **Must NOT touch:** `core/constants.py`, any Dockerfile, `docker-compose.yaml`, `requirements.*`, `build-patches/`, or the microservice wrapper's `graph_name` plumbing (gated — ADR-okf-023 §3).

### Test infrastructure (patterns to mirror)

- **comps mock:** import-time in `conftest.py:17-50` via `sys.modules.setdefault('comps', MagicMock())`.
- **dataprep construction:** `create_dataprep()` (test_dataprep.py:25-39) — `GenieArangoDataprep.__new__(...)` + assign `dp.db`/`dp.embeddings`/`dp.llm_transformer` as MagicMocks. Reuse it (do not reinvent).
- **LLM mock:** `patch.object(dp_module, "AsyncOpenAI", return_value=mock_client)` with `mock_client.chat.completions.create = AsyncMock(...)`; stub `_write_ingestion_log` with `AsyncMock`. For short-circuit: assert `_build_vllm_client` (line 207) / `_label_with_llm` `.assert_not_called()`.
- **`assert_not_called()` precedent:** `test_flag_off_returns_chunks_unchanged` (test_dataprep.py:1519-1528).
- `pytest.ini`: `asyncio_mode = auto`, `testpaths = tests`, emits `reports/pytest-report.xml` — new tests flow into CI `test:python` (.gitlab-ci.yml:2220) with no config change.

### CI gates for a dataprep Python change

`lint:python` (ruff, .gitlab-ci.yml:2050) · `test:python` (pytest --junitxml --cov, :2220) · `smoke:dataprep-arango` (import/boot inside vendored comps, :1309) · `scan:dataprep-arango` (Trivy, :1348). `verify:dataprep-lock` (:2383) is NOT triggered (no requirements change).

### Inherited lessons from 2.1–2.4 reviews

MELT where the service supports it (dataprep uses `CustomLogger` + `_write_ingestion_log`, the visible channel per DEBUGGING-TRACING.md §6.1) · all exceptions handled + logged · additive-only (NFR-S7) · direct AQL (no ORM) · ruff/pytest clean · ITU copyright headers.

### Open decisions (confirm at validation — NOT assumptions)

1. **Short-circuit predicate** = "fires iff `file_labels` has ≥1 ACL-prefixed entry" (AC 3). Recommended by the analysis (the only choice that doesn't regress the legacy corpus). Alternative: split the short-circuit into a **2.6b** if the team prefers a dedicated `concept_labels`/`authoritative_labels` input field. **Confirm: keep bundled in 2.6a with the ACL-prefix gate?**
2. **ACL label value charset** — `_is_acl_label` uses `startswith(("t:","r:","d:"))`. A taxonomy label literally named e.g. `"d:design"` would be misclassified (very low risk). Stricter option: `re.match(r"^(t|r|d):", l)`. **Confirm: frozenset/startswith is acceptable for 2.6a?** (L3 sanitization is a separate concern owned by 2.9.1/6.1b.)

### Out of scope

- `graph_name` request-body reading + retract-default fix + repo/bundle retract + additive `concept_id`/`repo_id`/`bundle_version`/`source_type` chunk fields → gated **Story 2.6 / 2.9.6**.
- All-`search_start` ACL filter (G12) → **Story 1.1**.
- Token→graph-set resolution + read-side AND enforcement → **Story 6.1b** (+ L1 follow-up).
- ACL injection into `file_labels` → orchestrator **Story 2.9.1**.
- Backfill of existing chunks → operational (retract + re-ingest).

### References

- [Source: epics.md#Story-2.6a] (AC verbatim) · [Source: prd.md#FR-18] (ACL as `chunk_labels` `t:/r:/d:`) · [Source: prd.md#FR-24] (per-graph ACL) · [Source: prd.md#§3-glossary "ACL labels (dual role)"] · [Source: prd.md#LG-3]
- [Source: architecture.md#collection-model] (`_SOURCE.chunk_labels`) · [Source: architecture.md#write-path-step-5ii] (`_finalize_chunk_labels` PRESERVES `t:/r:/d:`)
- [Source: ADR-okf-013] (revised 2026-08-13 — ACL preserve extraction) · [Source: ADR-okf-021#§1] (orchestrator is sole ACL-label injector — G4 root cause) · [Source: ADR-okf-022#§4] (`_finalize_chunk_labels` preserves ACL `file_labels`) · [Source: ADR-okf-024#§5] (ACL dual role) · [Source: ADR-okf-025#§2] (per-graph labels)
- [Source: okf-course-correction-2026-08-13#§2.3-step-5ii + Gap G4] · [Source: sprint-change-proposal-2026-08-13#Story-2.6a]
- Code: [genieai_dataprep_arangodb.py:1051-1104](`_finalize_chunk_labels`) · [:1135-1152](`_apply_labels` short-circuit site) · [:976](`_llm_call_single` fallback) · [:1300](`chunk_labels` write) · [genieai_retriever_arangodb.py:87-100,798-810] (consumer) · [retriever/config.py:221] (default OR) · [tests/test_dataprep.py:25-39,335,434,471,956-990,1519-1528] (test patterns/anchors)

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
