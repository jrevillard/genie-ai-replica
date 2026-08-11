---
baseline_commit: 2972f0420
---

# Story 1.4: Land the pre-rebase cleanup as its own v1.3 commit

Status: ready-for-dev

<!-- PRD: opea-1.5-upgrade | Epic 1: Upgrade foundation — provable-parity groundwork -->
<!-- Dependency: none. Runs on the v1.3 tree in its own commit. Runs AFTER 1.3 spike (decision log) and in parallel to 1.5. -->
<!-- Consumed by: Story 2.1+ (overlay rebase — clean surface, one variable). Sibling: 1-1 (RAG baseline, done), 1-3 (kwargs spike, review). -->

## Story

As a platform engineer,
I want the overlay debt consolidated on v1.3 before the bump,
so that a post-rebase regression has one variable, not two.

## Acceptance Criteria

1. **One commit, own land.** The cleanup lands on the v1.3 tree as its own commit, independently reviewable and testable — NOT bundled with the OPEA 1.5 bump (architecture §6 sequence: cleanup-as-separate-commit).
2. **5 `add_remote_service*` variants consolidated to one site.** The 5 near-duplicate graph builders in `genieai_chatqna.py` (and their mirrored stubs in `tests/testing_genieai_chatqna.py`) collapse to one parameterized method, with the per-mode differences (rerank present/absent, LLM endpoint `chat/completions` vs `faqgen`) expressed as parameters. The CLI dispatch (line ~2707-2726) maps the existing flags to the parameterized builder.
3. **`_parent_mod` monkeypatches replaced with subclass overrides.** In `genieai_dataprep_arangodb.py`, the module-level `_parent_mod.ARANGO_DB_NAME` (line 39) and the `_parent_mod.VLLM_MODEL_ID` reassignment (line 279) are replaced by overrides inside the existing `GenieArangoDataprep(OpeaArangoDataprep)` subclass — the proper OO mechanism, no import-time module mutation.
4. **Behavior unchanged — same flow_to graph.** The consolidated builder produces the IDENTICAL graph (same services, same `flow_to` edges) for each mode. A test asserts graph equivalence (same node set + same edges) before/after.
5. **Full suites stay green on v1.3.** All OPEA pytest + affected tests pass post-cleanup; ruff lint/format clean.

## Tasks / Subtasks

- [ ] T1: Consolidate the 5 `add_remote_service*` variants in `genieai_chatqna.py` (AC: 2, 4)
  - [ ] Introduce one parameterized builder (e.g. `_build_rag_graph(include_rerank: bool = True, llm_endpoint: str = ...)`) covering all 4 distinct shapes (with-rerank, without-rerank, faqgen endpoint)
  - [ ] Delete the 5 methods; keep thin public wrappers ONLY if external callers exist (verify: the only callers are the CLI dispatch + test stubs)
  - [ ] Update the `__main__` CLI dispatch (lines ~2707-2726) to call the parameterized builder per flag — preserving the exact current flag→graph mapping (`--without-rerank`, `--faqgen`, `--genieai`, default)
  - [ ] Add a graph-equivalence test: each mode produces the same node set + `flow_to` edges as the pre-cleanup behavior (AC: 4)
- [ ] T2: Mirror the consolidation in `tests/testing_genieai_chatqna.py` (AC: 2, 5)
  - [ ] The test file's 5 duplicated stub builders (lines ~741-909) collapse to the same parameterized shape
  - [ ] The test dispatch (lines ~1476-1484) updated to match the new API
  - [ ] Existing test assertions still hold (they target behavior, not method names — verify)
- [ ] T3: Replace the `_parent_mod` dataprep monkeypatches with subclass overrides (AC: 3, 5)
  - [ ] `ARANGO_DB_NAME`: move the GENIE convention (use `ARANGO_DB`, default `genie-ai`, not OPEA `_system`) into a subclass attribute/method the parent reads, OR into the `GenieArangoDataprep.__init__` before `super().__init__` — verify which the vendored parent actually reads (the parent is built into the image at `/app/comps/dataprep/src/integrations/arangodb.py`)
  - [ ] `VLLM_MODEL_ID`: the `_initialize_llm` override (line ~270-283) already sets `os.environ["VLLM_MODEL_ID"]`; drop the `_parent_mod.VLLM_MODEL_ID` reassignment IF the parent reads env at call-time (verify in the vendored parent) — else keep a subclass-safe mechanism
  - [ ] Verify `ARANGO_DB`/`ARANGO_DB_NAME` env contract is preserved for both retriever and dataprep (they must target the SAME database)
- [ ] T4: Full validation (AC: 5)
  - [ ] OPEA pytest suite green (`genie-ai-overlay` venv)
  - [ ] ruff check + format clean on both changed files
  - [ ] Commit as its OWN commit (single, reviewable) — not bundled with any 1.5 change

### Review Findings

_(No prior review — first implementation. Add findings here as code review surfaces them.)_

## Dev Notes

### Non-negotiable constraints

- **Own commit, v1.3 tree, behavior-neutral.** This is architecture §6 "cleanup-as-separate-commit" (pre-rebase milestone (c)). It must NOT contain any OPEA 1.5 code. A post-rebase regression must have ONE variable — the bump — which requires the cleanup to be proven green on v1.3 first. Do NOT bundle with Story 2.x.
- **Same flow_to graph — asserted, not assumed.** The consolidation's whole risk is a subtly different graph (a dropped edge, a wrong endpoint). The graph-equivalence test is the guard: same node set + same edges per mode.
- **Delete the monkeypatch, don't soften it.** The `_parent_mod.X = ...` import-time mutations are the debt. Replace with subclass override. Do NOT leave the mutation AND add an override — that's two sources of truth.
- **The test file mirrors the prod code.** `tests/testing_genieai_chatqna.py` duplicates the 5 builders as stubs. A prod-only consolidation leaves the tests diverged — both must collapse.
- **`--with-translation` (CLI line 2711) is a documented no-op** (accepted for compat, never dispatched). Preserve its acceptance; it does not select a graph.

### Refactoring reality discovered during story creation (2026-08-11)

Inspecting `genieai_chatqna.py` directly:
- **5 variants, only 3 distinct shapes.** `add_remote_service` (1797), `add_remote_service_without_translation` (1916), `add_remote_service_genieai` (1964) are **byte-identical except the docstring** — same embedding→retriever→rerank→llm graph, same `/v1/chat/completions` endpoint. `add_remote_service_without_rerank` (1840) = embedding→retriever→llm (no rerank). `add_remote_service_faqgen` (1873) = full graph but LLM endpoint `/v1/faqgen`.
- **Only 2 real axes of variation:** (a) rerank node present/absent, (b) LLM endpoint `chat/completions` vs `faqgen`. A parameterized builder `_build_rag_graph(include_rerank=True, llm_endpoint=...)` covers all 4 distinct shapes.
- **Callers are only the CLI dispatch** (lines 2707-2726, flags `--without-rerank`/`--faqgen`/`--without-translation`/`--genieai`/default) **and the mirrored test stubs** (lines ~741-909, dispatch ~1476-1484). No library/external caller — safe to collapse the public methods.
- **Translation is NOT a graph node.** GENIE's translation happens in the chat handler (LLM call), not as an orchestrator node — which is why `without_translation` and `genieai` produce the same graph as `add_remote_service`. Confirmed: no `translator_in`/`translator_out` MicroService in any variant.

Dataprep monkeypatch (`genieai_dataprep_arangodb.py`):
- Line 39: `_parent_mod.ARANGO_DB_NAME = os.getenv("ARANGO_DB", os.getenv("ARANGO_DB_NAME", "_system"))` — import-time alignment of OPEA's DB-name constant with GENIE's convention. The parent (`comps.dataprep.src.integrations.arangodb`) is vendored at image build (`Dockerfile-dataprep_genie-ai` line 56 `COPY ... /app/comps/`), NOT in this repo — **the dev agent MUST inspect the vendored parent to see where `ARANGO_DB_NAME` is read** (module-level constant read at class-init, or method-time `os.getenv`) to choose between subclass-attribute vs constructor override.
- Line 279: `_parent_mod.VLLM_MODEL_ID = detected` inside the existing `_initialize_llm` override (lines ~260-283). The override already sets `os.environ["VLLM_MODEL_ID"]`; the module-attr mutation is likely redundant IF the parent reads env at call-time — verify in the vendored parent before dropping.

### Environment / deployment facts

- The vendored OPEA dataprep parent lives in the image at `/app/comps/dataprep/src/integrations/arangodb.py` (copied from the GenAIComps clone in `Dockerfile-dataprep_genie-ai`). To inspect it locally: clone `https://github.com/opea-project/GenAIComps.git` tag `v1.3` (same approach as Story 1.3's spike harness) and read `comps/dataprep/src/integrations/arangodb.py` — this is how to verify where `ARANGO_DB_NAME`/`VLLM_MODEL_ID` are read.
- Retriever also reads the DB name (story's comment: "Both retriever and dataprep must target the same database"). Preserve the shared `ARANGO_DB`→database contract.
- OPEA pytest runs from `genie-ai-overlay/` with the venv (`python3 -m venv .venv; pip install -e ".[test]"`). conftest mocks `OpeaArangoDataprep` (`tests/conftest.py` lines 40-49) and sets `ARANGO_DB=genie` (line 198).

### Files to create / touch

| File | Action |
|------|--------|
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | UPDATE — consolidate 5 `add_remote_service*` → 1 parameterized builder; update CLI dispatch |
| `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` | UPDATE — replace `_parent_mod.ARANGO_DB_NAME` + `_parent_mod.VLLM_MODEL_ID` monkeypatches with subclass overrides |
| `tests/testing_genieai_chatqna.py` | UPDATE — mirror the 5-builder consolidation in the test stubs + dispatch |
| `genie-ai-overlay/tests/conftest.py` | READ/VERIFY — confirm the `OpeaArangoDataprep` mock still aligns after subclass changes (no prod-code test writes if the subclass override is compatible) |
| `genie-ai-overlay/tests/` (chatqna/dataprep test files) | VERIFY — run full suite; add graph-equivalence test where the chatqna tests live |

### Testing standards

- Graph-equivalence test: for each mode, assert the consolidated builder registers the same services and same `flow_to` edges as the pre-cleanup behavior (the invariant the consolidation must preserve).
- Full OPEA pytest green + ruff clean on all touched files.
- Dataprep: the existing `OpeaArangoDataprep` mock in conftest must still satisfy the subclass override (no new mock surface needed if the override stays within inherited methods).

### Project Structure Notes

- This is the "pre-rebase cleanup" — part of Epic 1's groundwork, referenced by the architecture §6 sequence and the evidence-ledger (pattern 12). It is NOT a verification artifact; it's a code-quality debt fix that reduces rebase blast radius.
- Keep the change surgical: only the 2 prod files + the mirroring test file + any graph-equivalence test. No unrelated refactors.

### References

- Architecture §Implementation Sequence (pre-rebase milestones: baseline → kwargs spike → cleanup-as-separate-commit → contract tests) + §Delta philosophy (one variable per regression) — `_bmad-output/planning-artifacts/architecture.md`
- PRD FR-4/FR-6 (clean rebase surface; one-variable regression) + NFR-M1 (remove dead divergence) — `_bmad-output/planning-artifacts/prds/prd-genie-ai-2026-08-07/prd.md`
- Code: `genie-ai-overlay/chatqna/genieai_chatqna.py` (variants 1797/1840/1873/1916/1964, CLI dispatch 2707-2726), `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` (monkeypatches 39/279, subclass 229), `tests/testing_genieai_chatqna.py` (stubs 741-909, dispatch 1476-1484)
- Vendored OPEA parent (verify): GenAIComps `v1.3` → `comps/dataprep/src/integrations/arangodb.py`
- Story 1.3 (sibling — established the clone-verify pattern for vendored comps) — `_bmad-output/implementation-artifacts/schedule-kwargs-spike.md`

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash[1m] (Claude Code, bmad-create-story)

### Debug Log References

- Story scope: epics.md Story 1.4 (pre-rebase cleanup, own commit) + architecture §6 sequence + PRD FR-4/6/NFR-M1
- Code read: `genieai_chatqna.py` (5 variants + CLI dispatch 2707-2726 + confirmed 3 byte-identical), `genieai_dataprep_arangodb.py` (monkeypatches 39/279, subclass 229, `_initialize_llm` override 260-283), `tests/testing_genieai_chatqna.py` (mirrored stubs + dispatch), `conftest.py` (OpeaArangoDataprep mock + ARANGO_DB=genie), `Dockerfile-dataprep_genie-ai` (vendored comps copy)
- Sibling precedent: Story 1.3 (clone-verify vendored comps pattern via GenAIComps tag)

### Implementation Plan

_(filled during dev-story)_

### Completion Notes List

- Story created from epics.md Story 1.4 + architecture §6. Key refactor realities documented: (1) the 5 chatqna variants collapse to 3 distinct shapes on 2 axes (rerank on/off, LLM endpoint) — the triplicat is byte-identical; (2) callers are only the CLI dispatch + mirrored test stubs, so public-method collapse is safe; (3) translation is not a graph node; (4) the dataprep monkeypatch targets a VENDORED parent (not in repo) — dev agent must clone GenAIComps v1.3 to verify where ARANGO_DB_NAME/VLLM_MODEL_ID are read before choosing the subclass override shape. Story 1.2 cancelled before this story (GitLab Ultimate) — numbering preserved.

### File List

- `_bmad-output/implementation-artifacts/1-4-land-the-pre-rebase-cleanup-as-its-own-v1-3-commit.md` (this file)

### Change Log

- 2026-08-11: Story created (ready-for-dev) by bmad-create-story. Scope: consolidate 5 `add_remote_service*` variants (chatqna + mirrored test stubs) into one parameterized builder with asserted graph equivalence; replace `_parent_mod.ARANGO_DB_NAME`/`VLLM_MODEL_ID` dataprep monkeypatches with subclass overrides; land as its own v1.3 commit, suites green.
