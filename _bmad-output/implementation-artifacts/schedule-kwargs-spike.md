# schedule() kwargs-forwarding spike — decision log

**Date:** 2026-08-11
**Story:** 1-3-run-the-schedule-kwargs-forwarding-spike-blocking-gate
**PRD:** opea-1.5-upgrade (FR-6)

## Outcome

**FORWARDS** — all 6 GENIE custom kwargs reach the registered handlers on BOTH
GenAIComps `v1.3` (control) and `v1.5` (target). The D1 contingency
(subclass `ServiceOrchestrator` to inject the kwargs) is **NOT triggered**.

## Evidence

Harness: `tests/spike-schedule-kwargs/prove_kwargs_forwarding.py` (committed).
Method: bare clone (no overlay, no Dockerfile change), the REAL
`comps/cores/mega/orchestrator.py` loaded from the clone via importlib; only the
external heavy deps the forwarding path does not need (fastapi, prometheus,
aiohttp, requests, telemetry, docarray) are stubbed in `sys.modules`. A
`SpikeOrchestrator` subclass captures kwargs at the `execute()` hop
(proves `schedule() → execute()`); the real `super().execute()` body runs the
real forwarding call sites — `self.align_inputs(..., **kwargs)` (input path,
orchestrator.py:255) and `self.align_outputs(..., **kwargs)` (non-streaming
completion path, orchestrator.py:384) — where recording overrides capture the
received kwargs (proves `execute() → handler`, exact values). Network avoided
with a fake aiohttp response.

Raw outcome: `/tmp/spike-outcome.json` (not committed — transient; regenerate
with the harness below).

| Tag | Resolved commit | kwargs forwarded | Outcome |
|-----|-----------------|------------------|---------|
| v1.3 | `73668076cf95c499b8def1370fb9a90e29c17e5b` | 6/6 (align_inputs + align_outputs + execute) | FORWARDS |
| v1.5 | `9f59daa891a4030ffdb8370fa06a9a490acb89d7` | 6/6 (align_inputs + align_outputs + execute) | FORWARDS |

The 6 kwargs proven forwarded with EXACT values sent → received, per hook:
`retriever_parameters`, `reranker_parameters`, `full_chat_history_string`,
`retrieval_context`, `original_language`, `user_details`.

`align_generator` (streaming-only, orchestrator.py:353) is NOT exercised by this
LLM-node spike — recorded, not skipped: its forwarding body is byte-identical
v1.3→v1.5 (diffed below) and behavioral verification is deferred to Story 2.6
(which exercises real streaming flows). It is emitted in the harness output when
touched; absence is not a FAIL by design.

Idempotency: re-running the harness against `v1.5` produces byte-identical
received kwargs and the same outcome (proven live, 2026-08-11).

## v1.3 → v1.5 forwarding-path diff

`schedule()` / `execute()` / `align_*` forwarding bodies are **byte-identical**
between the v1.3 and v1.5 tags (diffed at story-creation time):
- `schedule(self, initial_inputs, llm_parameters=LLMParams(), **kwargs)` — same in both.
- `execute()` → `self.align_inputs(inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs)` — same in both.
- `align_generator(generate(), **kwargs)` and `align_outputs(..., **kwargs)` — same forwarding in both.
- `ServiceOrchestrator` class present in both.

This is why the spike had to prove the contract BEHAVIORALLY (real handler
receives the kwargs), not just read signatures — a signature read would have
been inconclusive. The harness is designed to FAIL LOUDLY on a drop (a hook
absent from the capture is a FAIL), so a future 1.4→1.5 regression is caught.

## Decision for Story 2.6 (chatqna rebase)

The chatqna rebase can proceed with the plain monkeypatch approach already in
place: GENIE installs `ServiceOrchestrator.align_inputs/outputs/generator`
monkeypatches (chatqna:1377-1379), and those hooks receive the 6 custom kwargs
via the orchestrator's `**kwargs` forwarding, exactly as the spike proved.
No subclass of `ServiceOrchestrator` is required. Re-run this harness as part of
Story 2.6's wire test if any doubt resurfaces after the rebase.

## Regenerate

```bash
cd tests/spike-schedule-kwargs
python3 prove_kwargs_forwarding.py --tag v1.3 --tag v1.5 --out /tmp/spike-outcome.json
```

(Requires network to github.com/opea-project/GenAIComps.)
