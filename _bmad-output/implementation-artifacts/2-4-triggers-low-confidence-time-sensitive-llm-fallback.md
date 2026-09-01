---
baseline_commit: a260cffda
---

# Story 2.4: Triggers — low-confidence, time-sensitive, LLM fallback (finish)

Status: review

## Story

As a citizen asking about current affairs ("latest deadlines", "is this still valid"),
I want web search to fire when the query is time-sensitive regardless of KB confidence, and to support an LLM-driven election,
so that confidently-retrieved-but-stale documents stop masquerading as answers (FR8, FR9, FR10).

## Current State (verified on `feat/sst` 2026-09-01, post-4-8 `a260cffda`)

- **FR8 (low-confidence) is live** — inline in `_apply_web_search_fallback` (`genieai_chatqna.py`): `threshold = 0.70; if max_score >= threshold: return docs, None`. Null-safe max computed at both seams; cross-seam `web_search_attempted` memo; never-kill-chat guard (all from 2-7/2-8).
- **FR9 (time-sensitive) and FR10 (LLM-driven) do not exist** in the live tree.
- **Salvageable implementation verified in git history** (`git show c0008225f:genie-ai-overlay/tools/fusion.py`, the deleted dupe): a complete trigger engine — `should_search(retrieval_confidence, query, *, confidence_threshold, llm_requested) -> TriggerDecision` with precedence **time-sensitive > llm-requested > low-confidence**, `is_time_sensitive()` word-boundary regex matching ("new" does not fire on "renewal"), `_DEFAULT_TIME_PATTERNS` (18 English patterns) + `WEB_SEARCH_TIME_PATTERNS` env override, `WEB_SEARCH_CONFIDENCE_THRESHOLD` env, `TriggerReason` constants, and a documented decision that the trigger engine deliberately does NOT duplicate the FR11 disabled-tool check (that belongs to the single governance choke point). The dupe had NO tests for any of it.
- **Known gap (NFR11, backlog-flagged)**: governance/Redis is not wired into chatqna — there is no live enabled/disabled tool state. The epic's AC ("a disabled tool never invokes via rule-based or LLM path") therefore has no structural enforcement point today.

## Acceptance Criteria

1. The dupe's trigger engine is ported into live `workflows/tools/fusion.py`: `should_search`, `is_time_sensitive`, `TriggerDecision`, `TriggerReason`, `_DEFAULT_TIME_PATTERNS`, both env overrides — preserving the documented precedence and the no-FR11-duplication design note.
2. `_apply_web_search_fallback` uses `should_search` instead of the inline threshold: a time-sensitive query fires **at any confidence** (even ≥0.70); low-confidence behavior is regression-identical; the trigger reason appears in the log line.
3. `llm_requested` is plumbed as a keyword parameter on the helper (default False) — the FR10 contract exists; **no caller sets it yet** (the LLM-intent caller arrives with the LangGraph/OPEA-1.5 work — recorded decision, not silently dropped).
4. A deployment kill-switch `WEB_SEARCH_ENABLED` (default `true`, `0`/`false` disables) short-circuits the helper before ANY trigger path — the deployable FR11-equivalent while governance stays unwired (flagged gap, not a stealth fix).
5. Truth-table and unit tests: each trigger fires independently; time-sensitive word boundaries ("renewal" ≠ "new", "as often" ≠ "as of"); precedence order; `None` confidence → fires; env pattern override; kill-switch blocks all three paths; helper integration (time-sensitive fires with high max_score; kill-switch returns docs unchanged + no degradation unless empty).
6. Overlay suite green; ruff check + format clean. No frontend/backend changes.

## Tasks / Subtasks

- [x] Task 1 — Port the trigger engine into `workflows/tools/fusion.py` (AC: 1)
  - [x] Copy `DEFAULT_CONFIDENCE_THRESHOLD`, `_DEFAULT_TIME_PATTERNS`, `_time_patterns`, `is_time_sensitive`, `TriggerReason`, `TriggerDecision`, `should_search` from `git show c0008225f:genie-ai-overlay/tools/fusion.py` — keep docstrings (they carry the design rationale), add the ITU header the live file already has
  - [x] Reuse the live file's existing `os` import; `re` needs adding
- [x] Task 2 — Wire the helper to the engine (AC: 2, 3, 4)
  - [x] `_apply_web_search_fallback(self, docs, query, max_score, llm_requested=False)`: kill-switch check first (`WEB_SEARCH_ENABLED` disabled → same return shape as AC1-silent), then `should_search(max_score, query, llm_requested=llm_requested)`; not-triggered → `(docs, None)`; log line includes `decision.reason`
  - [x] Both seams unchanged (they already pass max_score; the memo and null-safe max stay)
- [x] Task 3 — Tests (AC: 5)
  - [x] `tests/test_sst_tools.py`: trigger-engine unit tests (boundaries, precedence, None-confidence, env overrides incl. `monkeypatch`, kill-switch on each path)
  - [x] `tests/test_chatqna_degradation.py`: helper integration — time-sensitive query + high max_score still searches (mock backend); kill-switch short-circuits (backend not called, no degradation when docs exist); `llm_requested=True` fires at max_score 0.9
- [x] Task 4 — Overlay suite + ruff; trackers (sprint-status 2-4 → review, plan.md session log)

## Dev Notes

### Implementation guardrails

- Preserve 2-7/2-8 invariants exactly: never-kill-chat broad guard, cross-seam memo, quality gate before fuse, degradation truth table. The trigger change only replaces the "should we search" decision — everything downstream is untouched.
- `should_search` treats `None` confidence as low (unsafe-direction default) — the seams always pass a float, but keep the semantics for direct callers.
- The dupe's ponytail note on English-only patterns is still true (14 locales; non-English time queries ride the confidence trigger; `WEB_SEARCH_TIME_PATTERNS` is the deployment lever) — keep the comment.
- Do NOT add the FR11 enabled/role check inside the trigger engine (duplication hazard — single choke point when governance lands); the env kill-switch is an operator lever, not an authorization control.
- No changes to geniei_chatqna beyond the helper signature/body + log line; jrevillard's module stays surgical.

### Testing standards

- pytest in the overlay venv; `monkeypatch.setenv` for env overrides; mock `SearxngBackend.search_sync` at the boundary (established pattern in `test_chatqna_degradation.py`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4] — AC ("each trigger fires independently; disabled tool never invokes via either path")
- [Source: _bmad-output/planning-artifacts/prds/prd-server-side-tools.md] — FR8/FR9/FR10 (:89-91), FR11 (:92), NFR1 (2s P95)
- [Source: git show c0008225f:genie-ai-overlay/tools/fusion.py] — the salvage implementation (verified complete)
- [Source: genie-ai-overlay/chatqna/geniei_chatqna.py `_apply_web_search_fallback`] — the live seam to rewire
- [Source: _bmad-output/implementation-artifacts/2-7-*.md + 2-8-*.md Review Findings] — the invariants this story must not break
- Standing decision D3: triggers deferred to this follow-up — this IS that story


### Review Findings

_Code review 2026-09-01 — all 3 layers completed; Edge Hunter re-probed the engine live and diffed against `a260cffda`; Auditor verified the port verbatim against `c0008225f`._

- [x] [Review][Patch] **Kill-switch failed OPEN on unrecognized values** (Blind High + Edge Med) — blank/`off`/typo left search enabled; an emergency-off switch failing open is the unsafe direction. FIXED: fail-closed allow-list — only `1`/`true`/`yes`/unset enable; tests pin blank/`off`/`disabled`/typo → disabled, explicit `yes` → enabled.
- [x] [Review][Patch] **Bad `WEB_SEARCH_CONFIDENCE_THRESHOLD` masqueraded as engine-outage and silently killed FR8** (Blind + Edge) — `float()` ValueError → helper's guard logged "engine unavailable" every query. FIXED: guarded parse falls back to default with a WARNING naming the bad value (mirrors `_time_patterns`' graceful empty handling).
- [x] [Review][Patch] **`%.2f` log broke on the newly legitimized None confidence** — `%s` formatting.
- [x] [Review][Patch] **Pattern override replaced defaults while its comment said "add"** — now both modes: `a,b` replaces (the removal lever), `+a,b` appends (the add-my-locales case); comma-only garbage falls back to defaults with a warning instead of silently disarming FR9.
- [x] [Review][Patch] **`\b` boundaries structurally broken for CJK/Thai patterns and punctuation-edged customs** — non-ASCII or non-word-edged patterns now match by containment; ASCII word patterns keep boundaries.
- [x] [Review][Patch] **NaN confidence silently not-triggered** (contradicting the engine's own unsafe-direction rationale) — NaN now treated like None → LOW_CONFIDENCE.
- [x] [Review][Patch] **Helper docstring stated precedence in FR order with "in that precedence"** — corrected to FR9 > FR10 > FR8.
- [x] [Review][Patch] **FR8 comment on the threshold constant dropped in the port** — restored.
- [x] [Review][Patch] **Three env vars undiscoverable** — SECTION 15 added to the `env` template documenting all three (kill-switch semantics included).
- [x] [Review][Patch] **Ambient CI env could flip default-relying tests** — autouse fixture clears the three vars for the trigger tests.
- [x] [Review][Patch] **Test gaps** — llm-vs-low-confidence precedence, kill-switch+empty-docs, explicit-true-allows, and the inner engine-unavailable guard (never-kill-chat) all pinned.
- [x] [Review][Dismiss] Common patterns ("new"/"current") too broad — the PRD's FR9 names "current"/"latest"/"today"/"deadline" explicitly; operators now have the REPLACE lever. Pattern-list tuning is a deployment concern.
- [x] [Review][Dismiss] Two sources of truth for "enabled" (kill-switch vs future governance) — documented design decision in both docstrings; the switch is an operator lever, not the structural FR11 enforcement.
- [x] [Review][Dismiss] Dead constants (`DEFAULT_QUALITY_THRESHOLD`, `DEFAULT_TOOL_CONTEXT_RATIO`) + unused `confidence_threshold` param — part of the verbatim port (AC1); they document FR20/FR24 intended defaults for the wiring that consumes them.
- [x] [Review][Dismiss] Inflection recall gaps ("deadlines", "up-to-date") — pattern tuning; the override lever exists; noted for a future tuning pass if telemetry shows misses.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Salvage verified complete before porting (`git show c0008225f:...fusion.py`); port is verbatim (Auditor line-verified, docstrings intact)
- 2-7 truth table regression-identical through the engine (all 36 prior tests untouched, green); boundary parity at 0.70 probed by the Edge Hunter (0.6999999/0.70/0.7000001)
- Review patches: +12 tests; overlay **755 passed**, ruff clean; env template gained SECTION 15

### Completion Notes List

- Trigger engine live in `workflows/tools/fusion.py`: precedence FR9 (time-sensitive, any confidence) > FR10 (llm_requested) > FR8 (low-confidence < 0.70 or WEB_SEARCH_CONFIDENCE_THRESHOLD); word-boundary matching with containment fallback for non-Latin scripts; `+`-append / plain-replace pattern override; guarded threshold parse; NaN/None fire LOW_CONFIDENCE
- Helper delegates to the engine (reason logged), `llm_requested` plumbed as the FR10 contract (caller arrives with LangGraph — recorded), fail-closed `WEB_SEARCH_ENABLED` kill-switch blocks every trigger path
- FR11 note: the kill-switch is the operator lever; structural enforcement still waits on the governance/Redis wiring (plan.md NFR11 backlog item)

### File List

- genie-ai-overlay/workflows/tools/fusion.py (trigger engine ported + hardening)
- genie-ai-overlay/chatqna/genieai_chatqna.py (helper delegation, kill-switch, docstrings)
- genie-ai-overlay/tests/test_sst_tools.py (+11 trigger tests + env-hardening tests)
- genie-ai-overlay/tests/test_chatqna_degradation.py (+4 integration tests)
- env (SECTION 15: web-search controls)
- _bmad-output/implementation-artifacts/{2-4 story, sprint-status, plan.md}

### Change Log

- 2026-09-01: FR9/FR10 triggers ported from c0008225f + FR8 delegation; review patches (fail-closed switch, env hardening, containment matching, NaN); 755 tests green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
