---
baseline_commit: 2972f0420
---

# Story 1.3: Run the `schedule()` kwargs-forwarding spike (blocking gate)

Status: ready-for-dev

<!-- PRD: opea-1.5-upgrade | Epic 1: Upgrade foundation — provable-parity groundwork -->
<!-- Dependency: none (runs on a BARE v1.5 clone — zero overlay, zero Dockerfile change). Blocking gate for Story 2.6 (chatqna rebase). -->
<!-- Consumed by: Story 2.6 (chatqna orchestrator re-graft per spike outcome). Sibling: 1-1 (RAG baseline, done), 1-4 (cleanup), 1-5 (contract tests). -->

## Story

As a platform engineer,
I want the v1.5 `execute()` kwargs-forwarding contract proven on a bare v1.5 clone before any Dockerfile changes,
so that the chatqna rebase approach is decided with evidence, not guesswork.

## Acceptance Criteria

1. **Bare v1.5 spike harness.** A throwaway test proves, on a bare GenAIComps `v1.5` clone (no overlay, no Dockerfile change), that `schedule(initial_inputs, llm_parameters, **custom_kwargs)` forwards the 6 GENIE custom kwargs — `retriever_parameters`, `reranker_parameters`, `full_chat_history_string`, `retrieval_context`, `original_language`, `user_details` — to the registered service handlers. `v1.3` is cloned alongside as the control (PRD FR-6).
2. **Behavioral assertion, not signature check.** The spike asserts the kwargs actually ARRIVE on `align_inputs` (and `align_outputs`/`align_generator`) — a real registered service receives them — not just that the `**kwargs` parameter exists in the signature (FR-6 "behaviorally verified, not just imported").
3. **Outcome recorded in the decision log.** The spike writes a committed outcome (FORWARDS / DROPS) + the evidence (which kwarg, which handler) to `_bmad-output/implementation-artifacts/schedule-kwargs-spike.md`, dated. This is the decision log Story 2.6 consumes.
4. **D1 contingency gated on the outcome.** If any of the 6 kwargs is dropped, the decision log records the D1 contingency (subclass `ServiceOrchestrator` to inject the kwargs — architecture decision D1) as the chosen path BEFORE any rebase work. No shim/compat wrapper outside the spike gate.
5. **Spike artifact committed + reproducible.** The harness (`tests/spike-schedule-kwargs/`) is committed, and re-running it against the pinned `v1.5` tag reproduces the outcome (idempotent, pinned tag, recorded commit).

## Tasks / Subtasks

- [ ] T1: Write the spike harness `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py` (AC: 1, 2, 5)
  - [ ] Clone GenAIComps `v1.3` (control) + `v1.5` (target) at pinned tags into a temp dir (shallow, depth 1)
  - [ ] Build a minimal `ServiceOrchestrator` (from the cloned `comps` package — NO overlay) registering one throwaway service whose `align_inputs` records which kwargs it received
  - [ ] Call `schedule(initial_inputs=..., llm_parameters=..., **{6 custom kwargs})`; assert each of the 6 arrives on the handler with the exact value sent
  - [ ] Repeat for `align_outputs` and `align_generator` where the orchestrator forwards kwargs (v1.5 line ~353 `align_generator(generate(), **kwargs)`, ~379/384 `align_outputs(..., **kwargs)`)
  - [ ] Emit a structured outcome: per-kwarg PASS/FAIL per hook, so the decision log is data-driven, not vibes
- [ ] T2: Author unit tests `tests/spike-schedule-kwargs/test_prove_kwargs_forwarding.py` (AC: 5)
  - [ ] Determinism/idempotency: the harness is a pure function of the pinned tag (mock the clone + orchestrator, assert same input → same outcome)
  - [ ] Each of the 6 kwargs individually asserted (a dropped kwarg is a FAIL, not silently skipped)
  - [ ] Handler assertion: the registered handler really receives it (not a no-op harness that "passes" by checking nothing)
- [ ] T3: Run the spike + commit the decision log (AC: 3, 4)
  - [ ] Run the harness against pinned `v1.3` + `v1.5` tags (network clone; record the resolved commits in the log)
  - [ ] Write `_bmad-output/implementation-artifacts/schedule-kwargs-spike.md`: outcome (FORWARDS/DROPS), per-kwarg evidence, v1.3-vs-v1.5 diff of the execute()/schedule()/align_* forwarding paths, D1 trigger decision, date
  - [ ] Commit the harness + tests + decision log

### Review Findings

_(No prior review — first implementation. Add findings here as code review surfaces them.)_

## Dev Notes

### Non-negotiable constraints

- **BARE clone — zero overlay, zero Dockerfile change.** The whole point is a zero-cost proof BEFORE touching any v1.3→v1.5 code. Do NOT copy `genieai_chatqna.py` into the harness. Do NOT modify the cloned `comps`. The harness imports the clone's `ServiceOrchestrator` and registers a throwaway service on top.
- **This is a blocking gate.** PRD FR-6 + architecture "first implementation priority" list it second, before any rebase. Story 2.6 (chatqna re-graft) cannot start until the outcome is recorded. Do not defer.
- **Behavioral, not signature.** A signature diff is NOT evidence. The harness must show a real handler receiving each kwarg. (This is exactly the failure class FR-6 calls out: "behaviorally verified, not just imported".)
- **D1 is the ONLY sanctioned fallback.** If a kwarg drops: subclass `ServiceOrchestrator` to inject it (D1). Explicitly NOT: side-channel via request-context object (hidden coupling), NOT file-pinning v1.3 orchestrator (dead divergence). Record the choice; do not build the subclass in this story — just decide + record.
- **Evidence must be reproducible.** Pinned tags (record the resolved commits), idempotent harness, committed artifact. Story 2.6 (or a reviewer) must be able to re-run it and get the same answer.

### Spike reality discovered during story creation (2026-08-11)

Inspecting GenAIComps `v1.3` and `v1.5` orchestrators directly (shallow clones):
- **`schedule()` signature is identical v1.3→v1.5:** `async def schedule(self, initial_inputs, llm_parameters=LLMParams(), **kwargs)` — the `**kwargs` bucket is present in both.
- **`execute()` forwards `**kwargs` verbatim to the hooks in BOTH versions:** `inputs = self.align_inputs(inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs)` (line 255); `align_generator(generate(), **kwargs)` (line 353); `align_outputs(..., **kwargs)` (lines 379/384). A `diff` of the v1.3 vs v1.5 `execute()` bodies and `schedule()` signatures returned **identical files**.
- **`ServiceOrchestrator` class still exists in v1.5** (`comps/cores/mega/orchestrator.py` line 103) and its base `align_*` methods are `(self, inputs, *args, **kwargs)` — compatible with GENIE's positional override.
- **LLMParams moved context:** in v1.5 it's `comps.cores.proto.docarray.LLMParams` (BaseDoc, line 465) — the docarray rename hack (FR-8/FR-9 surface) is RELEVANT to the rebase but NOT to this spike (the spike uses the clone's own docarray).

**What this means for the spike:** the naive hypothesis "v1.5 drops kwargs" is likely WRONG — both versions forward them. The spike's value is (a) proving it behaviorally on a REAL registered service (not signature reading), (b) establishing the reproducible harness + decision-log format that Story 2.6 and the wire test (FR-10) reuse, (c) catching any 1.4→1.5 subtlety the tag-level diff missed (e.g. `llm_parameters.dict()` vs `.model_dump()`, Pydantic version semantics on `align_inputs` consumption). **Design the harness to FAIL LOUDLY on a drop — the "expected pass" does not excuse a harness that can't detect a regression.**

### Environment / deployment facts

- GenAIComps: `https://github.com/opea-project/GenAIComps.git`, tags `v1.3` / `v1.5`. Shallow clone: `git clone --depth 1 --branch <tag> <url> <dir>`.
- GenAIExamples (chatqna's example base): `https://github.com/opea-project/GenAIExamples.git`, tag `v1.5` — clone ONLY if the spike needs the example's service wiring; the orchestrator contract lives in GenAIComps.
- The GENIE chatqna consumes the 6 kwargs in `align_inputs` (see `genie-ai-overlay/chatqna/genieai_chatqna.py` lines 826-950): `original_language` (830), `retriever_parameters` (877), `retrieval_context` (897), `reranker_parameters` (908), `full_chat_history_string` (921), `user_details` (923). These are the EXACT 6 the spike must prove forwarded. (`_blend_history_text`/`_blend_alpha` ride in `initial_inputs`, not kwargs — out of spike scope.)
- The GENIE monkeypatch installs at runtime: `ServiceOrchestrator.align_inputs = align_inputs` (chatqna:1377-1379). The spike does NOT monkeypatch — it subclasses/registers on the clone to prove the BASE forwarding path.

### Files to create / touch

| File | Action |
|------|--------|
| `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py` | NEW — bare-clone spike harness (v1.3 control + v1.5 target) |
| `tests/spike-schedule-kwargs/test_prove_kwargs_forwarding.py` | NEW — idempotency + per-kwarg + handler-assertion tests |
| `_bmad-output/implementation-artifacts/schedule-kwargs-spike.md` | NEW — the committed decision log (outcome, evidence, D1 trigger) |
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | READ-ONLY — the 6 kwargs' consumption sites; do NOT modify in this story |

### Testing standards

- Harness tests are pure (mock the clone + orchestrator registration) — no live network in CI. The real network run is T3, executed on a dev machine.
- Determinism: same pinned tag + same inputs → same outcome (assert in a unit test).
- Per-kwarg coverage: all 6 asserted individually; a dropped kwarg FAILS the test (no silent skip).
- The handler assertion is real: the registered service records received kwargs and the test compares them to what was sent — not a no-op.

### Project Structure Notes

- Spike/evidence artifacts live in `_bmad-output/implementation-artifacts/` (architecture verification boundary §4). The decision log here feeds Story 2.6 and is referenced by the evidence-ledger (pattern 12).
- The harness lives in `tests/spike-schedule-kwargs/` — NOT under `rag-benchmarks/` (different concern: coupling-surface proof vs retrieval-quality).
- Do not commit the cloned GenAIComps trees — clone into a gitignored temp dir at run time.

### References

- PRD FR-6 (kwargs-forwarding contract proven first as a blocking pre-rebase spike; 6 kwargs enumerated; "behaviorally verified, not just imported") — `_bmad-output/planning-artifacts/prds/prd-genie-ai-2026-08-07/prd.md`
- Architecture §Implementation Sequence (pre-rebase milestones: baseline → kwargs spike → cleanup → contract tests) + decision D1 (subclass orchestrator) + named fallbacks (a/b/c) + pattern 12 (evidence-ledger) — `_bmad-output/planning-artifacts/architecture.md`
- GENIE chatqna kwargs consumption — `genie-ai-overlay/chatqna/genieai_chatqna.py` (align_inputs 826-950; monkeypatch install 1377-1379; schedule() call 2548-2567)
- OPEA GenAIComps orchestrator (v1.3 + v1.5): `comps/cores/mega/orchestrator.py` — `schedule()` (128), `execute()` (234, align_inputs call 255, align_generator 353, align_outputs 379/384), base `align_*` (388-400), `ServiceOrchestrator` class (103)
- OPEA GenAIComps `LLMParams` (v1.5): `comps/cores/proto/docarray.py` (417, 465)
- Story 2.6 (consumes the decision log) + Story 1.1 (sibling baseline precedent for artifact discipline) — `_bmad-output/planning-artifacts/epics.md`

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash[1m] (Claude Code, bmad-create-story)

### Debug Log References

- Story scope: epics.md Story 1.3 (schedule() kwargs spike, blocking gate) + PRD FR-6 + architecture D1/fallbacks/sequence
- Code read: `genie-ai-overlay/chatqna/genieai_chatqna.py` (schedule() call 2548-2567; align_inputs 826-950 consuming the 6 kwargs; monkeypatch 1377-1379)
- Upstream verified: shallow-cloned GenAIComps v1.3 + v1.5; `schedule()`/`execute()`/`align_*` forwarding paths byte-identical between tags; `ServiceOrchestrator` present in v1.5
- Sibling precedent: story 1-1 (driver + artifact + review discipline)

### Implementation Plan

_(filled during dev-story)_

### Completion Notes List

- Story created from epics.md Story 1.3 + PRD FR-6 + architecture D1/sequence. Key spike-reality insight documented: v1.3/v1.5 forwarding signatures are byte-identical, so the spike must prove behaviorally (real registered handler receives the 6 kwargs), and must be designed to FAIL LOUDLY — the "expected pass" is not an excuse for a harness that cannot detect a regression. Story 1.2 (CVE/SBOM baseline) was cancelled before this story (GitLab Ultimate covers natively) — sprint numbering preserved with 1-3 unchanged.

### File List

- `_bmad-output/implementation-artifacts/1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate.md` (this file)

### Change Log

- 2026-08-11: Story created (ready-for-dev) by bmad-create-story. Scope: bare v1.5 spike proving the 6 custom kwargs reach the registered handlers; outcome recorded in a committed decision log; D1 contingency gated on outcome.
