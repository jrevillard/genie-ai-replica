---
baseline_commit: 22920b0f4
---

# Story 2.7: Degradation + transparent insufficiency

Status: review

## Story

As a citizen using chat,
I want honest responses when web search fails or returns junk — RAG-only silently when the KB suffices, a visible degradation notice when web results were unusable, and a transparent "insufficient information + guidance" answer when nothing is usable,
so that the system never fabricates answers and never hides degradation (FR23, FR24, NFR12).

## Current State (verified on `feat/sst` 2026-08-31)

- **Both seams bypass governance entirely.** `genieai_chatqna.py:1186-1204` (no-rerank) and `:1318-1332` (rerank) call `SearxngBackend().search_sync()` directly — no circuit breaker, no audit, no quality gate. The governance pipeline (`workflows/tools/governance.py`, tested, review status) is **not wired into chatqna**: the chatqna compose service has **no Redis env**, and `GovernancePipeline`/`CircuitBreaker` require a redis client. Full NFR11 wiring is therefore **out of scope** (see Scope).
- **Failures are swallowed.** Both seams wrap the call in `try/except Exception` → log only. No degradation object, no user-visible signal (same silent-no-op pattern as the fixed image-wiring bug).
- **No quality threshold exists (FR24 unimplemented).** `fusion.py:72-94` fuses whatever SearXNG returned, each item stamped with a synthetic `"score": 0.85` — empty-title/empty-content garbage enters the LLM prompt unchallenged.
- **Abstention fork exists but is quality-blind.** `genieai_chatqna.py:1206` (`if not retrieved_docs`) appends abstention instructions when the fused list is empty — but junk web results make the list non-empty, suppressing abstention; and there is no alternative-source guidance or degradation metadata for the UI.
- `search_sync` raises `WebSearchError` on any backend failure (`web_search.py:57-59`), returns a possibly-empty list otherwise. This is the failure-mode signal to branch on.

## Acceptance Criteria

Behavior truth table (epic 2.7 text is authoritative — note the epic's "breaker open" case maps to today's reality as "search backend failure", since no breaker is in the path):

| # | Situation | Required behavior |
|---|-----------|-------------------|
| AC1 | Search fails (`WebSearchError`) **and KB docs exist** | RAG-only answer, **no** degradation object in the response (deliberate silence per epic: "Breaker open → RAG-only, no degradation message (KB results exist)") |
| AC2 | Search fails **and no KB docs** | Abstention/insufficiency path (existing mechanism), zero fabrication; response metadata carries the degradation info so the UI can render a notice (forwarding formalized in 2-8) |
| AC3 | Search returns results but **none pass the quality filter** | Degradation object `{tool_id: "web_search", reason: "LOW_QUALITY", fallback_applied: "none", message: <guidance text>}` attached to response metadata; **unusable results are NOT fused** into the LLM prompt |
| AC4 | Search returns usable results | Fused as today — existing behavior unchanged (regression-guarded) |
| AC5 | Neither KB nor usable web content | Transparent "insufficient information" with guidance — never a fabricated answer (abstention instructions present in the prompt) |

Plus:
- AC6: A SearXNG outage does not affect feeds — asserted by **not touching** the stream ingestor and having no shared state (verify in review; no code expected).
- AC7: Overlay pytest suite green (incl. new tests); `ruff check` + `ruff format --check` green.

## Tasks / Subtasks

- [x] Task 1 — Quality gate in `workflows/tools/fusion.py` (AC: 3, 5)
  - [x] Add module-level `filter_usable_results(tool_results, min_content_chars=None) -> list[dict]`: keep a result only if `title` and `url` are non-empty AND `len(content.strip()) >= min_content_chars`; default from `WEB_SEARCH_MIN_CONTENT_CHARS` env (default 80), `<= 0` disables the gate
  - [x] Do NOT change `fuse()`'s signature/return (callers + tests depend on it); the gate is applied by the caller before fusing
  - [x] Tests in `tests/test_sst_tools.py`: keeps a good result; drops empty-title/empty-content/too-short; env default; disabled when 0
- [x] Task 2 — Extract a testable fallback helper in `genieai_chatqna.py` (AC: 1-5)
  - [x] New method `_apply_web_search_fallback(self, docs, query) -> tuple[list, dict | None]` implementing the truth table: low-confidence trigger (keep existing `< 0.70` on max metadata score) → `search_sync` → on `WebSearchError`: return `(docs, degradation_if_docs_empty_else_None)`; on results: filter via Task 1 → usable-empty → `(docs, LOW_QUALITY degradation)`, else `(fuse(docs, usable), None)`
  - [x] Both seams (`:1186-1204` no-rerank, `:1318-1332` rerank) call the helper; the bare try/except blocks are replaced (helper owns error handling — no more silent swallow)
  - [x] Degradation dict (when non-None) is attached to the response metadata: non-stream `result_dict["degradation"]`; stream path — the same `result_dict` is passed to `_stream_with_metadata` at `:2676`, so set the key before streaming starts. Follow Decision-7 schema exactly: `{tool_id, reason, fallback_applied, message}` with human-readable guidance text (built-in defaults; reuse existing `CHATQNA_ABSTENTION_INSTRUCTIONS` env for LLM-side guidance customization — no new env vars unless a deployment need appears)
  - [x] Abstention fork (`:1206`) unchanged in mechanism — verify it fires exactly when the final doc list is empty (AC5) and does NOT fire when junk web results were filtered out but KB docs exist
- [x] Task 3 — Tests for the helper (AC: 1-5)
  - [x] Unit tests (mock `SearxngBackend.search_sync` and `ResultFusionEngine.fuse`): one test per truth-table row; assert degradation presence/absence and that unusable results never reach `fuse`
  - [x] Follow existing patterns in `tests/test_sst_tools.py` / conftest mocks; ITU copyright header required
- [x] Task 4 — Run overlay suite + ruff; update `sprint-status.yaml` (2-7 → review) and plan.md session log

### Review Findings

_Code review 2026-08-31 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Edge Hunter reproduced both crash paths with minimal scripts; Auditor re-verified all 7 ACs._

- [x] [Review][Patch] **Narrowed exception handling can kill the whole chat request** [genieai_chatqna.py helper] — old seams' blanket `except Exception` was load-bearing ("never kill chat"); helper catches only `WebSearchError` with imports/filter/fuse outside any guard → `ImportError` (the exact 0b9b64531 image failure mode), a `fuse` bug, or null-field crash propagates out of `align_outputs` → 500. Corroborated by all 3 layers; violates PRD binding "degrade gracefully to RAG-only". Fix: broad `try` around imports+search+filter+fuse in the helper — `except WebSearchError` keeps precise handling, `except Exception` logs ERROR and returns RAG-only (degradation only if docs empty).
- [x] [Review][Patch] **`filter_usable_results` crashes on explicit null fields** [fusion.py:45-47] — SearXNG passes `"title": null` through verbatim (`web_search.py:51-53`); `.get(k, "")` doesn't default on present-but-null → `AttributeError`, reproduced. Fix: `(res.get(k) or "")` for title/url/content.
- [x] [Review][Patch] **`None` doc score crashes `max_score` at both seams** [genieai_chatqna.py:1188, 1309] — raw-TEI branch stores `score: None` when TEI omits it; `max([0.5, None])` → TypeError (reproduced). Previously swallowed, now a 500. Fix: null-safe score extraction (filter non-numeric, default 0.0) at both seams.
- [x] [Review][Patch] **LOW_QUALITY message lies when the KB is empty** [helper message text] — "based on available knowledge base documents only" while `docs == []` (AC5 case). Fix: conditional message like the SEARCH_UNAVAILABLE branch.
- [x] [Review][Patch] **80-char threshold is script-biased** [fusion.py:47] — CJK/Arabic snippets routinely 30–70 code points → usable results dropped as LOW_QUALITY on a multilingual platform. Fix: halve the threshold for predominantly non-Latin content (script-aware), + test.
- [x] [Review][Patch] **Degradation wiring in `align_outputs` executed by zero tests** — all 6 existing seam tests stub the helper to `(docs, None)`; `next_data["degradation"]` assignment never runs under test. Fix: one `align_outputs`-level test with the helper stubbed to return a degradation, asserting it lands in the node output dict (channel to `result_dict` is production-proven via `_assemble_source_documents`; full `schedule()` propagation is orchestrator internals — residual risk documented).
- [ ] [Review][Record] Dev Record test counts wrong — 15 new tests (5 gate + 10 helper), baseline 696 → 711; "19/19" was the collected count of two files incl. 4 pre-existing tests. Fix the record.
- [x] [Review][Flag-2-8] `tool_id: "web_search"` (underscore) vs Decision-7 exemplar `"web-search"`; `reason: "SEARCH_UNAVAILABLE"` is a new enum value — both get frozen by 2-8's declared contract. Decide spelling + enumerate reasons in 2-8 (current code consistent with fusion's existing `tool_id` param).
- [x] [Review][Dismiss] Double-fire of both seams — disproven: `with_rerank and retrieved_docs` routes to exactly one seam (edge hunter traced node routing); single carrier, so first-match extraction is safe.
- [x] [Review][Dismiss] Unconditional `docs` rebuild changes behavior — verified equivalent for all 3 rerank output branches by two independent layers.
- [x] [Review][Dismiss] Asymmetric notice policy (silent outage-with-KB vs always-LOW_QUALITY) — spec-mandated (PRD degradation path scopes silence to unavailability).
- [x] [Review][Defer] Blocking `search_sync` (10s `requests.get`) on the event loop — pre-existing, 2-4/D3 territory [web_search.py:35]
- [x] [Review][Defer] Client disconnect mid-stream loses the post-token metadata event (degradation included) — pre-existing channel, same as confidence [genieai_chatqna.py:~1872]

## Dev Notes

### Scope (binding)

- **OUT of scope — governance/Redis wiring into chatqna.** The epic's "breaker open" language assumes `GovernancePipeline` in the request path; today chatqna has no Redis env and the pipeline needs one. Wiring it = compose + env + client changes → separate follow-up (this is really 2-6 debt: "integration at both seams" shipped without governance; NFR11 is currently bypassed at these seams). Flag: propose adding it to plan.md Remaining work when this story closes. In this story, "breaker open" is realized as its deployable equivalent: backend failure.
- **OUT of scope — SSE contract forwarding (2-8/OQ-SST-7) and Vue rendering (2-9).** 2-7 produces the degradation object in the response metadata; 2-8 declares and forwards it; 2-9 renders it. Do not design 2-8's contract here — attach the dict per Decision-7 schema and stop.
- **OUT of scope — stream ingestor.** AC6 needs no code; feeds are a separate service with no SearXNG dependency.

### Implementation guardrails

- Python/OPEA conventions: PEP 8 + ruff, ITU copyright headers, `CustomLogger`/logging per existing file style, `os.getenv` with defaults.
- The seams are inside jrevillard's chatqna module — keep the diff surgical: one new helper + two call-site replacements. Do not restructure the orchestration methods.
- Preserve the existing low-confidence trigger exactly (max metadata score < 0.70, `num_results=3`) — trigger tuning is story 2-4 territory (D3 deferred).
- `fusion.py` fusion behavior for usable results must not change (synthetic score, pseudo-ids, budget rollover all stay — other tests pin them).
- Degradation `message` strings: user-facing English, guidance-oriented ("Web results were found but did not meet quality standards…"), matching FR23's alternative-source guidance intent.

### Testing standards

- pytest from `genie-ai-overlay/` (venv per overlay CLAUDE.md: `source .venv/bin/activate`); tests in `tests/`, `test_*.py`, conftest fixtures for comps/ArangoDB mocks.
- Chatqna helper tests must not require a running SearXNG/LLM — mock at `SearxngBackend` boundary.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.7] — truth table, AC
- [Source: _bmad-output/planning-artifacts/prds/prd-server-side-tools.md] — FR23 (transparent insufficiency, Joseph's Missing Permit journey), FR24 (quality threshold), §degradation-path (binding: RAG-only without message when KB exists), Decision 7 degradation schema (lines 214-223), NFR12/NFR15
- [Source: genie-ai-overlay/chatqna/genieai_chatqna.py:1186-1218, 1318-1332, 2676] — the seams, abstention fork, stream result_dict
- [Source: genie-ai-overlay/workflows/tools/fusion.py:72-94] — synthetic score, fuse contract
- [Source: genie-ai-overlay/workflows/tools/web_search.py:32-59] — `search_sync` failure mode (`WebSearchError`)
- [Source: genie-ai-overlay/workflows/tools/governance.py:241-247] — Decision-7 degradation dict shape (CIRCUIT_OPEN exemplar)
- [Source: docker-compose.yaml chatqna service] — no Redis env (governance wiring blocker)
- Previous-story intelligence (4-1, this session): compose-app/in-the-assembly tests catch what unit tests miss — hence the helper-extraction task (testability); review caught silent-skip patterns — hence "no more silent swallow" and explicit AC1 deliberate-silence test

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- RED: import error (`filter_usable_results` missing) + helper tests failing pre-implementation
- GREEN: full overlay suite grew 696 (baseline) → 711 after initial dev (15 new: 5 gate + 10 helper/extraction), → 722 after review patches (11 more: null/CJK/unexpected-exception gate tests + seam-wiring test)
- Regression found+fixed during validation: 6 pre-existing `align_outputs` tests construct `MagicMock` selves; calling the new helper on them returned a MagicMock that failed tuple-unpacking. Fixed by a `stub_web_search_fallback(self_mock)` passthrough in `tests/test_chatqna.py` applied at those 6 tests (the helper's real behavior has its own suite in `test_chatqna_degradation.py`)
- `ruff check` + `ruff format --check` clean on all touched files

### Completion Notes List

- `fusion.py`: added `filter_usable_results()` (FR24 gate: non-empty title+url, `len(content.strip()) >= WEB_SEARCH_MIN_CONTENT_CHARS`, default 80, `<=0` disables); `fuse()` signature/return untouched
- `genieai_chatqna.py`: new `_apply_web_search_fallback(docs, query, max_score)` implementing the full truth table (AC1 silent RAG-only on outage-with-KB; AC2 `SEARCH_UNAVAILABLE` degradation when nothing usable; AC3/AC5 `LOW_QUALITY` degradation with guidance, junk never fused; AC4 fuse unchanged) + `_extract_degradation(result_dict)` recovering the dict from the node-keyed result state
- Both seams rewired through the helper; the silent `try/except Exception` swallow is gone; degradation rides the existing `metadata` event in BOTH response paths (`_stream_with_metadata` and the non-stream payload) — no new SSE event, so 2-8 only needs to declare/forward what already flows
- Abstention fork untouched; verified it fires exactly on the final empty doc list (junk no longer suppresses it — junk is filtered before fusion)
- Deviation from story text (documented): helper signature is `(docs, query, max_score)` — seams compute max_score with their own accessors (no-rerank reads `metadata.score`, rerank reads top-level `score`)
- No stream-ingestor changes (AC6); no new env vars beyond `WEB_SEARCH_MIN_CONTENT_CHARS`

### File List

- genie-ai-overlay/workflows/tools/fusion.py (modified — filter_usable_results + env default)
- genie-ai-overlay/chatqna/genieai_chatqna.py (modified — helper, extractor, both seams rewired, degradation in both metadata paths)
- genie-ai-overlay/tests/test_sst_tools.py (modified — 5 gate tests)
- genie-ai-overlay/tests/test_chatqna_degradation.py (new — 10 truth-table + extraction tests)
- genie-ai-overlay/tests/test_chatqna.py (modified — passthrough stub at 6 align_outputs tests)
- _bmad-output/implementation-artifacts/sprint-status.yaml, plan.md, this story file

### Change Log

- 2026-08-31: Implemented 2-7 truth table + FR24 quality gate; degradation object in both response metadata paths; 711 overlay tests green, ruff clean → status review
- 2026-08-31: Code review (3 layers) — 6 patches applied: never-kill-chat broad guard (imports+search+filter+fuse inside try), null-safe gate fields, null-safe max_score at both seams, KB-aware LOW_QUALITY wording, script-aware threshold halving (non-Latin), align_outputs degradation-wiring test. Suite 722 green, ruff clean. 2-8 flags recorded: tool_id spelling (web_search vs web-search) + SEARCH_UNAVAILABLE enum.
