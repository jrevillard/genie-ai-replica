# Step 7 — Legacy Retirement + Frontend-Transparent v1 Shim

**Date:** 2026-04-20
**Result:** 308/308 tests passing in 2.21s (Step 1-6: 293 + Step 7: 15).

Step 7 in our world differs from the brief's "move legacy to legacy_archived/" instruction because we used **strict-additive** migration (Option A chosen pre-Step 0). There is no `translation/legacy/` directory to archive — everything legacy stayed in its original place, untouched, throughout the migration.

So Step 7 ends up as two smaller pieces of work:

1. **`MIGRATION_COMPLETE.md`** — the long-lived historical record of what changed, what we deliberately preserved vs fixed, and the final flag state. Stays in the repo forever.

2. **Frontend-transparent v1 shim** — one ASGI middleware + one new flag so the existing React frontend's two "translate" buttons (top toggle and per-message "Mandinka" button) transparently pick up v2 without any frontend edits.

## What changed (files)

| File | Status | Role |
|---|---|---|
| `flags.py` | Edited (v2) | Added `USE_V2_FOR_V1_ENDPOINTS` flag; included in `snapshot()` |
| `api/v1_compat.py` | New | `V1ToV2CompatMiddleware` — routes `/api/v1/agent/translate{,batch}` through the v2 Router when the flag is ON or the `X-Translation-Pipeline: v2` header is present. Byte-identical v1 response shape. |
| `main_with_translation_v2.py` | Extended | `app.add_middleware(V1ToV2CompatMiddleware)` installed after the v1 routes are already registered. |
| `RUNBOOK.md` | Edited | New flag documented in the cheat-sheet. |
| `tests/test_v1_compat.py` | New | 15 tests — pass-through when off, flag-on routing, header override, shape parity, validation, v2 failure → 502. |
| `MIGRATION_COMPLETE.md` | New | Historical summary. |
| `STEP_7_NOTES.md` | New | This file. |

No edits to existing frontend code. No edits to `agent_routes.py`, `translator.py`, or any other legacy file. 

## Why middleware, not a new route

FastAPI's route resolution keeps the **first** match. Because `main_with_translation_v2.py` does `from src.main import app`, the v1 routes are already registered when our code runs. Registering a second handler at `/api/v1/agent/translate` is ignored. Middleware intercepts *before* routing, which is exactly the seam we need.

## Why the shim routes per-entry in batch instead of one v2 batch call

The v2 `Router.translate` method is single-string. `Router.translate_batch` is deferred to a later step (Step 3 brief was explicit: "simple chat translation case only"). Rather than add a batch method to `Router` — which would need to re-implement TM/PII/shadow for the batch case — the shim loops over the dict's entries and calls `router.translate` per item. Each call still gets the full v2 treatment: TM cache, PII routing, shadow mode, post-processing. Slight per-request overhead vs a true batch LLM call, but zero new code paths.

If this becomes a real bottleneck (UI with hundreds of strings), Step 7.5 can add `Router.translate_batch` and update the shim.

## Frontend wiring — what the user sees

Screenshot had two translate surfaces:

1. **Top "English / Mandinka" toggle** → triggers the React autoTranslator, which batches committed DOM text and POSTs to `/api/v1/agent/translate/batch`. Middleware catches it.

2. **Per-message "Mandinka" button** under the assistant's reply → presumably POSTs the message text to `/api/v1/agent/translate`. Middleware catches that too.

Both now flow through the v2 Router as soon as:
- `USE_V2_FOR_V1_ENDPOINTS=true` is set in the environment, **OR**
- The request carries `X-Translation-Pipeline: v2` (useful for per-user debugging).

The frontend continues making the same HTTP calls to the same URLs. No React rebuild needed.

## Rollout interaction with Step 6 RUNBOOK

The RUNBOOK's gateway-level 5% canary (`nginx split_clients`) still works — routes a percentage of traffic to the v2 replica, and on that replica `USE_V2_FOR_V1_ENDPOINTS=true` makes v1 URLs feel like v2.

**For a softer rollout**, skip the nginx split entirely and just set `USE_V2_FOR_V1_ENDPOINTS=true` on the v2 replica. Now *every* request on that replica is served by v2, but the v1 replica (still serving `src.main:app`) is untouched. Scaling the v2 replica up/down shifts the traffic ratio. This is the simplest possible canary.

**For targeted verification**, set the header `X-Translation-Pipeline: v2` from a curl or a browser extension — a single request goes through v2 regardless of replica or flag state.

## Production impact

- Without changes to uvicorn command or env: **zero impact**. `src.main:app` doesn't include the middleware.
- Switch to `src.main_with_translation_v2:app`, flag off: middleware installed but inert (falls through for all paths). **Zero impact**.
- Flag on (`USE_V2_FOR_V1_ENDPOINTS=true`): `/api/v1/agent/translate{,batch}` now served by v2 Router. v2 endpoints under `/api/v2/*` still available. Legacy translator singleton still in-process and reachable if anything else still imports it, but the two user-facing translate endpoints skip it.

## Rollback

Three granularities, any one reverses:

1. Flag: `USE_V2_FOR_V1_ENDPOINTS=false` — restarts optional; effect on next request.
2. Entry point: revert uvicorn command to `src.main:app` — v2 code disappears entirely.
3. File-level: delete `api/v1_compat.py` + the two-line middleware install in `main_with_translation_v2.py`.

## Known limitations of the shim

- **Per-entry batch**. Documented above; not a correctness issue, just a perf shape.
- **Response ordering**. Python dicts preserve insertion order, so the batch output keys come out in the same order as the input. Legacy behaves the same (dict in, dict out). No test regression expected.
- **Empty-string passthrough parity**. The shim short-circuits empty strings to empty output, matching the legacy translator's `if not text or not text.strip(): return text` guard. Test: `test_empty_string_passes_through_in_batch`.
- **The middleware consumes the request body** for the matched paths; the downstream v1 handler never runs for those requests. This is safe because we respond fully ourselves. For unmatched paths or when the flag is off, we `call_next` **before** reading the body, so nothing is consumed.

## Test inventory (new in Step 7)

```
test_v1_compat.py                              15 tests
  TestPassThrough                              4
  TestFlagOn                                   4
  TestHeaderOverride                           3
  TestValidation                               3
  TestV2Failure                                1
```

## Not in Step 7

- Moving `translator.py` / `tts_mandinka_fix.py` into a `legacy_archived/` dir. Our strict-additive choice means these files never moved from the start. The deprecation notice lives in `MIGRATION_COMPLETE.md` and in the legacy code's own docstrings (untouched — they describe the *original* design and are still accurate for that role).
- Removing v1 endpoints from `agent_routes.py`. Out of scope and against the "never delete" discipline.
- Running the shim in front of anything except the two translate endpoints (e.g., `/agent/chat`, `/agent/prescription`). Those paths touch translation indirectly via the legacy `Translator` singleton. Routing them through v2 would need a different seam — intercepting `get_translator()` at import time, which **is** an edit to existing code. Deliberately left as-is; Step 8+ work if ever needed.
