---
title: 'Story 2.10 — Answer translation on the agentic path'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd1fc99714284305bb49adb695b5b2e4e72801c81'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1968 acceptance criteria, operator-authored">

## Intent

**Problem:** The agentic path has no answer translation. The residual-budget contract (story 2.3) is consumerless, and when the agent activates, a non-English UI must get exactly today's multilingual behavior (FR-14): translation executed in the BFF against the vLLM GPU backend only — the OPEA translation image never invoked — on the residual budget under the BFF's end-to-end deadline, with the legacy SSE translation semantics preserved in both modes.

**Approach:** Build the BFF translation leg as shared-code, additive machinery (AD-14): a routing-keyed GPU-only backend selection, `planTranslation`-gated execution under the end-to-end deadline with disconnect cancellation, usage returned-or-estimated into the execution-record accounting, and the V05 client semantics preserved (translated chunk units when streaming translation is on; `done.translationFailed` only for attempted-and-failed translation; the `query_translation_status` vocabulary unchanged). Enforce never-OPEA by a config check plus the served-path e2e contract. The agentic-route request wiring (frame writer, disconnect detection, deadline computation) is stories 2.4/2.5 and consumes this leg.

**Acceptance criteria (issue #1968, the contract):**
- Given the agentic path with a non-English UI locale, when answer translation runs, then it executes in the BFF against the vLLM GPU backend — the OPEA translation image is never invoked (config check + e2e spec enforce it), selected by the routing decision.
- And translation runs on the residual budget under the BFF's end-to-end deadline: no call starts beyond the remaining deadline; disconnect cancels the downstream call; usage is returned or estimated (the backend is extended/wrapped — its string-only response and private timeout do not survive unchanged) and lands in the execution record.
- And both modes keep their semantics: translated units as `chunk` frames when streaming translation is on; `done.translationFailed` preserved; the translated answer never inherits the source-text verdict silently (scope caption per story 2.7).

## Boundaries & Constraints

**Always:**
- AD-14 shape: BFF-executed, vLLM GPU backend only on the agentic path. The backend selection is keyed on the routing decision (an explicit input to the leg); a GPU that is unconfigured or fails at request time means skip-with-recorded-status (the English answer stays) — never the CPU backend, never a probe fallback, never the OPEA image.
- Residual discipline: `planTranslation` decides translate-vs-skip; the per-call timeout is bounded by the remaining deadline (no call runs past it, none starts beyond it); the call/token bounds ride the request (`max_tokens` = remaining allowance); the four frozen skip statuses are the recorded reasons.
- Legacy path frozen (V05): `translation-service.js` behavior and the query-routes SSE flow are untouched; every GPU-backend change is an additive optional parameter with the legacy default; legacy callers behave byte-for-byte as today.
- V05 semantics: `done.translationFailed` is set only when a translation was ATTEMPTED and failed (empty output, backend error, truncation, timeout). A budget/config skip is not a failure — `translationFailed` stays false, the answer stays English, and the recorded status lands in the accounting. The `query_translation_status` vocabulary (`translated / passthrough_english / passthrough_unknown_language / fallback_timeout / fallback_error`) is not extended or renamed.
- Usage accounting: read the vLLM-served usage when the endpoint serves it (returned); estimate it (chars/4, the deployed constant) when the endpoint discards it, flagged `estimated: true`. The estimate never inflates the allowance — the residual contract's never-estimate-up-to-the-allowance rule stands.
- The two new knobs (`AGENT_TRANSLATION_MAX_TOKENS`, `AGENT_TRANSLATION_MAX_CALLS`) are REQUIRED and read fail-closed: a missing or unusable knob means translation cannot be bounded — skip, with the knob named in an ERROR log and in the accounting. No numeric default anywhere.
- The leg returns an accounting block (backend, decision/status, usage with its estimate flag, mode) — the shape story 2.4 persists into the `queries` metadata execution record; its shape is unit-pinned.

**Never:**
- No BFF frame writing, no agent-leg HTTP client, no disconnect detection — the leg consumes an `AbortSignal` and a remaining-deadline value; producing them is story 2.4.
- No agent-service changes (the seam, usage record and orchestrator are story 2.3's, done); no changes to the no-agent pipeline's `AnswerTranslator` (configuration-B evaluation mode is not the client-serving agentic path — AD-14 scope note).
- No change to `formatRequest`'s prompt logic or the cache key shape — `TRANSLATION_LOGIC_VERSION` does not move; no behavior change reaches the legacy path or its Redis cache.
- No frontend changes (the translated-answer scope caption and mode rendering are story 2.7; the leg only records what 2.7 will render).
- No gate greps the shared translation module for backend imports (AD-14: the legacy path may keep the CPU/OPEA backend; enforcement is the routing-keyed selection, asserted by config check + tests).
- No reference to the OPEA translation image or its service endpoint anywhere in the agentic selection path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Translate (happy) | routing decision = agentic, GPU configured, usage available, deadline remaining | `translate` plan; GPU call bounded at remaining tokens, timeout ≤ remaining deadline; translated text + usage returned; accounting block `translated` | N/A |
| GPU not configured | no GPU API configured at request time on the agentic decision | skip before any call; English answer stays; `query_translation_status` = `passthrough_english`; accounting records the GPU-only reason | Never CPU, never probe |
| Usage unavailable | run record missing / null / partial token fields | skip `usage_unavailable` (frozen status); never estimate up to the allowance | N/A |
| Deadline spent | remaining deadline ≤ 0 at plan time | skip `deadline_spent`; no call starts | N/A |
| Call allowance spent | run's calls exhausted the leg allowance | skip `call_allowance_spent` | N/A |
| Token allowance spent | run's tokens exhausted the leg allowance | skip `token_allowance_spent` | N/A |
| Disconnect mid-translation | caller's `AbortSignal` fires | downstream vLLM request destroyed; outcome `cancelled` recorded; no retry | N/A |
| Knob missing/unusable | `AGENT_TRANSLATION_MAX_TOKENS` unset or non-finite | skip before any call; ERROR log names the knob; accounting carries the config error | Fail-closed, never unbounded |
| Endpoint discards usage | vLLM response carries no usage field | usage estimated (chars/4), `estimated: true` in the accounting | N/A |
| Translation attempted, failed | backend error / truncation / empty output / timeout | outcome `failed`; `translationFailed` semantics preserved (V05: attempted-and-failed = true); never cached | Truncation stays a failed request |
| Streaming mode | streaming translation on | per-unit translation semantics preserved (same unit discipline as the legacy streaming path) | Per-unit failure maps to the V05 failed semantics |

## Code Map

- `components/gov-chat-backend/services/agent-residual-budget.js` -- the plan: `SKIP_STATUSES`, `computeResidual`, `planTranslation` (pure, frozen by 2.3). Consume; do not modify.
- `components/gov-chat-backend/services/translation/gpu-translate-backend.js` -- the deployed GPU client: string-only `translate()` (:533), 30 s hardcoded timeout (`callVllmService` :462), `_capMaxTokens` window math (:330), truncation-rejection (:479), usage never read. Additive extension surface: optional options (`{maxTokens, timeoutMs, signal}`) plus a usage-returning entry point; `translate()`'s legacy signature and behavior untouched.
- `components/gov-chat-backend/services/translation-service.js` -- the legacy singleton (backend selection :82, pair resolution :314, markdown pipeline :456). Frozen; reference only. Its PURE helpers are the reuse surface: `services/translation/text-edges.js`, `markdown-normalize.js`, `stream-boundary.js`, `language-request.js`, `language-map-lookup.js`.
- `components/gov-chat-backend/routes/query-routes.js` -- the legacy semantics to preserve (streaming gate :426-431, per-unit commit :451-515, `handleStreamDone` :701-773, `done.translationFailed` :773). Read-only.
- `components/gov-chat-backend/services/query-service.js` -- `finalizeStreamQuery` (:891) persists `metadata` into the `queries` doc; the metadata passthrough (:485-510) carries `query_translation_status` verbatim. Read-only; 2.4 persists the accounting block here.
- NEW `components/gov-chat-backend/services/translation/agentic-translation-leg.js` -- the leg: fail-closed knobs → `planTranslation` → GPU-only selection → bounded, abortable execution → usage returned-or-estimated → accounting block + outcome.
- NEW `components/gov-chat-backend/__tests__/services/translation/agentic-translation-leg.test.js` -- the matrix as executable checks.
- `components/gov-chat-backend/__tests__/services/translation/gpu-translate-backend.test.js` -- extends for the additive options + usage return.
- `docker-compose.yaml` BFF block (:822-858) + `env` template -- the two knob pass-throughs, documented, empty defaults (the 2.3 pattern).
- `docs/agent-budget-deadline-pairs.md` -- :72 names the allowance knobs "at 2.10": fill the names in; add the leg's contract line.
- `tests/config-validator/__tests__/` -- NEW focused config check: the two knobs present in compose + env; the compose `translation` service (`opea/translation:*`) stays `profiles: [opea]`; the BFF block never references the OPEA translation service endpoint (`VLLM_TRANSLATION_ENDPOINT` names `vllm-translation-guardrail`). Follows the `parse-compose.js` pattern of `agent-service.test.js`.
- `tests/e2e/chatbot/send-message-and-stream.spec.js` ('the streamed answer is in French when the UI locale is fr') -- the served-path e2e enforcement, unchanged: on the venue the OPEA image is not in the serving profile, so a chain misrouted to it reds this spec (no French answer, `translationFailed` verdict); see Design Notes.

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-backend/services/translation/gpu-translate-backend.js` -- add optional per-call options (`maxTokens` bound, `timeoutMs` override, `signal`) and a usage-returning entry point that wraps the same internals (`{translations, usage: {prompt_tokens, completion_tokens} | null, estimated}`); legacy `translate()` untouched -- usage returned or estimated; private timeout overridable; disconnect abortable
- [x] `components/gov-chat-backend/services/translation/agentic-translation-leg.js` -- the leg: REQUIRED knob reader (fail-closed), `planTranslation` consumption, routing-keyed GPU-only selection (skip on unconfigured/failed GPU, never CPU/OPEA), deadline-bounded abortable execution, usage accounting, outcome + V05 status mapping, accounting block -- the AC's machinery
- [x] `components/gov-chat-backend/__tests__/services/translation/agentic-translation-leg.test.js` + `gpu-translate-backend.test.js` extensions -- every matrix row executable; legacy-backend regression pins (legacy `translate()` signature/timeout/behavior unchanged)
- [x] `docker-compose.yaml` (BFF block) + `env` -- `AGENT_TRANSLATION_MAX_TOKENS` / `AGENT_TRANSLATION_MAX_CALLS` pass-throughs with empty defaults, documented -- operators size the leg
- [x] `docs/agent-budget-deadline-pairs.md` -- knob names filled in at the placeholder row; the leg's residual contract summarized -- the V08 pair stays complete
- [x] `tests/config-validator/__tests__/` -- the config check file (knobs present; OPEA image profile-gated; BFF never references the OPEA translation endpoint) -- the config check the AC names

**Acceptance Criteria:**
- Given the routing decision selects the agentic path, when translation is requested, then only the vLLM GPU backend can serve it: a GPU-less or GPU-failed deployment skips with the recorded status and the English answer stays — the CPU backend and the OPEA image are unreachable from the agentic selection.
- Given a completed agent run's usage record, when the leg plans translation, then every skip status of the frozen contract is produced by the matching spent condition, and a translate decision bounds the call at the remaining allowance with a timeout within the remaining deadline.
- Given the caller aborts mid-call, when the disconnect signal fires, then the downstream vLLM request is destroyed and the outcome is recorded as cancelled, with no retry.
- Given an endpoint that serves usage and one that does not, when the leg accounts a translation, then the served counts are returned verbatim, and the discarded-usage case carries the chars/4 estimate flagged `estimated: true`.
- Given the legacy path, when the full backend suite runs, then every legacy translation behavior pin (selection, markdown pipeline, SSE `translation` frame, `done.translationFailed`, query-routes suites) stays green without modification.
- Given the config check, when the suite runs, then the knobs are present in compose + env, the OPEA translation image stays `profiles: [opea]`, and the BFF block names no OPEA translation endpoint.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **Markdown pipeline: lazy `require`, not dynamic `import`.** The leg
  reuses the legacy markdown discipline (parse → normalizeInlineSpacing →
  splitEdges → translate only the text-leaf cores → reassemble → stringify)
  but loads unified/remark-parse/remark-stringify/unist-util-visit lazily
  via `require()` inside `loadMarkdownLibs()`. The packages are ESM-only;
  Node's require(esm) resolves them on the image's Node 22 base, and the
  jest VM cannot run `import()` without `--experimental-vm-modules` (the
  legacy translation-service dodges the same constraint by injecting its
  pipeline in tests). Nothing translation-related loads at boot: the leg
  module is only required when the agentic wiring constructs it.
- **The estimation lives in the backend.** `_estimateUsage` (chars/4, the
  same estimator the window math uses) sits next to `_servedUsage` in
  `gpu-translate-backend.js`; `translateWithUsage` returns
  served-or-estimated usage so the leg carries no duplicate estimator. The
  leg's `spent` accumulation (run usage + the leg's own calls) is what each
  `planTranslation` sees, so streaming units bound the whole request, not
  one call.
- **Core calls are sequential** (the legacy markdown path fans its batches
  out through `TRANSLATION_BATCHES`). Sequential keeps the per-call plan
  exact — each call's `max_tokens` is the true remaining allowance and no
  call starts before the deadline check — and the client-visible result is
  identical (cores reassembled in document order).
- **GPU request-time failure = connection error or timeout.** The deployed
  `healthCheck` RESOLVES true on a non-2xx status (it is not the boot gate),
  so the skip-on-failed-GPU path is exercised by error/timeout, and the
  suite pins that. Init is attempted per execution after the plan has
  proven room, with no failure caching — a GPU that fails at request time
  is assessed per request; a GPU-less deployment never reaches init (the
  configured check skips first).
- **Accounting vocabularies.** `status` carries only the four frozen
  `SKIP_STATUSES` values (or null). `configError` carries a REQUIRED-knob
  name or a GPU-only reason (`gpu_not_configured` | `gpu_init_failed`) —
  that field is the accounting's config-level slot. `cancelled` maps onto
  the frozen `fallback_error` value (the vocabulary is not extended; the
  `outcome` field records the cancellation). Mid-pass budget stops are
  failed requests with timeout-classified statuses (`fallback_timeout`),
  never skips — something was attempted.
- **Review-fix round (2026-11-21).** Two vocabulary/arithmetic facts the
  first implementation got wrong, corrected: (1) the `configError`
  vocabulary now has THREE kinds of value — a REQUIRED-knob name, a GPU-only
  selection reason (`gpu_not_configured` / `gpu_init_failed`), and
  `invalid_remaining_ms` (a remaining-deadline no clock could have produced;
  the entry guard returns it as a skip instead of letting a non-finite
  `remainingMs` throw past the accounting contract). (2) The init probes'
  wall time is part of the translation budget: it is subtracted from the
  remaining deadline before `passDeadline` is computed, so no call's timeout
  can exceed the caller's original budget; an abort during the probes is a
  `cancelled` outcome; a deadline the probes consumed is a `deadline_spent`
  skip. Also on this round: the per-call token bound subtracts only the
  CURRENT pass's spend (earlier units' spend already rides inside
  `plan.maxTokens` — the old arithmetic subtracted it twice and could
  throw spuriously), language resolution moved BEFORE init (English and
  unknown-language requests no longer perform the health/models network
  round trips), and `runUsageAvailable` requires finite `model_calls` /
  `aux_model_calls` (a malformed record skips `usage_unavailable` instead
  of poisoning the call-allowance arithmetic with NaN).
- **Verification (2026-11-21):** leg suite 29 + gpu suite 51 green; full
  backend `npm test` 2486 passed / 95 suites (legacy translation-service,
  query-routes and their pins unmodified — the frozen-path proof);
  `tests/config-validator && npm test` 672 passed including the new 5-test
  gate; eslint + prettier clean on every touched file; compose YAML parses
  with the two knob entries in the backend block. `docker compose config`
  was not runnable on this host (no docker binary in the sandbox) — the
  YAML parse plus the config-validator's compose parsing stand in.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

| Round | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| G1 | blind: double-counted leg spend — plan.maxTokens already subtracts `spent`; the pass subtracts it again (`plan.maxTokens - spent.*Tokens`) → unit 2+ bound short by 2× spend; big-spend case throws "token allowance spent" with room left | high | verified real: `mergedPlanUsage` adds `spent`, then `remainingAllowance = plan.maxTokens - spent` re-subtracts. Fix: subtract the pass-local usage only (`passUsage`), test with exact bounds |
| G1 | blind: docstring says English/config-skip requests never build the backend, but `init()` (health + /v1/models round trips) runs before the language check — every English/unknown-language agentic request pings the GPU | medium | verified real: ctor loads the language map, `getLanguageCode` works pre-init; reorder language check before `init()` makes the docstring true and saves two network calls per non-translated request |
| G1 | blind: sticky-failure skips byte-identical to English skips in the accounting | low | rejected: the failed unit's own record carries outcome `failed` + `fallback_error`; the sequence tells the story; the legacy path records nothing per-unit — matching honesty level; extending the pinned shape for this is machinery |
| G1 | blind: AC's e2e enforcement not delivered — French spec is legacy-path only, no task row records the deferral | false | the AC's two instruments exist: the config check (new) and the e2e spec (the French spec, named in Code Map + Design Notes as the served-path enforcement — a misrouted chain reds it because the venue never deploys the OPEA image); the agentic-route e2e lands with 2.4/2.5/2.9 per the frozen Approach's own reading |
| G1 | blind+vg: chart (backend.yaml) and ansible carry neither the new knobs nor 2.3's AGENT_* knobs | defer | verified: the chart/ansible deployment surfaces carry zero AGENT_* knobs today — 2.3 set the pattern (compose+env only); wiring them is the deployment story's surface (2.4/Epic 3). deferred-work entry |
| G1 | blind: "the estimate never widens a bound" overclaims — chars/4 under-counts dense-token scripts, so estimated spend can exceed the allowance across calls | low | verified: the per-call `max_tokens` bound holds regardless; the blanket doc claim is inaccurate on the estimate path. Fix: doc wording (estimate accounts spent work, is not exact; the bound rides each request) |
| G1 | blind: failure classification couples to error-message prose (/timeout/i) | low | rejected: the classified messages are repo-owned constants (the leg's own mid-pass throws + the backend's fixed timeout string); structured error classes = new machinery for a diagnostic field |
| G1 | blind: Code Map line refs stale after the same changeset | false | the refs describe the planning-time baseline the spec was written against; the diff's Implementation Notes record the new surface — the workflow's own convention (2-3 the same) |
| G1 | blind: mid-pass call/token-allowance stops untested | low | verified: only the deadline mid-pass has a test. Patch: two tests driving a multi-core pass into each branch |
| G1 | blind: cores-empty no-op branch untested | low | verified. Patch: one test |
| G1 | blind+edge: execute() escapes the accounting contract — non-finite remainingMs reaches computeResidual (throws outside the try); getLanguageCode throws on a broken-map entry outside the try; caller gets an exception, no accounting block | medium | verified real: both throw paths confirmed in source. Fix: entry isFinite guard (configError `invalid_remaining_ms`) + pre-pass section inside the accounting try |
| G1 | blind: no sizing guidance for the knobs; ENVIRONMENT.md carries neither | defer | ENVIRONMENT.md is an agent-context file (defer by rule); a sizing example rides the doc touch in this MR. deferred-work entry |
| G1 | blind: endpointExplicit configuration signal untested | low | verified. Patch: one test (VLLM_TRANSLATION_ENDPOINT set, GPU_NODE_HOST unset → configured) |
| G1 | blind: mixed served/estimated usage — `estimated:true` does not say which portion is a guess | low | verified; fix = one doc line (`estimated:true` = at least one call of the pass was estimated), not per-call breakdown machinery |
| G1 | vg (pre-verified): the leg's real markdown-library integration runs in no suite — jest mocks all four packages; a loading-shape regression ships green and surfaces as runtime failed translations in 2.4 | medium | trusted pre-verified (the layer ran the mutation probe + a real-node probe). Patch: node --test smoke loading the packages exactly as `loadMarkdownLibs` does and round-tripping one markdown string (precedent: scripts/verifier-real-crypto.node-test.js) |
| G1 | edge: init elapsed never shrinks remainingMs — passDeadline set after init, per-call timeout = pre-init remaining → a call can run ~35 s past the caller's end-to-end deadline | high | verified real. Fix: measure init duration, subtract (≤0 → skip deadline_spent), abort re-check after init, passDeadline from the shrunk remaining |
| G1 | edge: caller abort during init — probes ignore the signal, cancelled recorded ~35 s late | medium | same root as the init-elapsed finding (init not deadline/abort-aware); one fix |
| G1 | edge: non-finite timeoutMs (NaN/Infinity) reaches the socket options → request on a dead socket never settles | low | verified reachable via translateWithUsage (isFinite gate builds deadline=null but passes the raw value through). Fix: non-finite → the 30s default |
| G1 | edge: malformed runUsage (non-finite model_calls) → `|| 0` keeps the string, remainingCalls NaN bypasses the allowance checks | low | verified. Fix: `runUsageAvailable` requires finite call fields → the record is usage_unavailable (skip), never misbound |
| G1 | edge: options passed as null bypasses the parameter default → destructure TypeError | low | verified (trivial). Fix: normalize `options || {}` in both additive entries |
| G1 | edge: only-empty texts returns usage {0,0} while zero texts returns null — the record cannot say no-call vs zero-usage | low | verified. Fix: usage null when no call was made |

## Design Notes

- **The e2e enforcement mapping.** The AC's "config check + e2e spec" is enforced across three layers, honestly: (1) the config check (compose/env static assertions) pins the wiring; (2) the selection unit suite proves the agentic branch cannot reach CPU/OPEA; (3) the existing French e2e spec is the served-path enforcement: the venue's serving profile does not deploy the OPEA image, so any chain misrouted to it produces no French answer and reds the spec — the OPEA-never-invoked invariant is falsifiable there. The agentic-ROUTE e2e leg (driving an agent-routed request end to end) lands with 2.4/2.5/2.9, when the route exists — the same against-the-contract pattern story 2.6 used for the verdict pipeline.
- **Skip is not failure.** V05 ties `translationFailed` to attempted-and-failed. A budget/config skip means translation never ran: the user sees the English answer (the same surface as `passthrough_english`) plus the recorded residual status in the accounting. Inventing a "skipped" flavor of `translationFailed=true` would fabricate a failure that never happened; extending the status vocabulary would break the V05 contract.
- **Cache-free iteration 1.** The leg does not use the Redis translation cache: every call is budget-accounted, and a cached hit's budget semantics (does a hit spend allowance?) is a question iteration 1 answers by not caching. Revisit if venue evidence shows repeated identical translations dominating the budget.
- **Selection is a lazy GPU-only instance.** The leg holds its own `GpuTranslateBackend`, built on first agentic use, independent of the legacy singleton (whose `auto` probe may have chosen CPU — sharing it would couple the paths). Pair resolution reuses the pure language helpers against the GPU backend's own map. A failed health check at leg-build time is the skip condition, recorded — the BFF does not crash at startup on the agentic leg (the legacy GPU-mandatory startup crash semantics are the legacy singleton's, untouched).
- **Accounting block (the shape 2.4 persists):**
  ```js
  {
    backend: 'gpu-vllm',
    decision: 'translate' | 'skip',
    status: <SKIP_STATUSES value | null>,        // null on translate
    outcome: 'translated' | 'skipped' | 'failed' | 'cancelled',
    queryTranslationStatus: <V05 vocabulary value>,
    usage: { prompt_tokens, completion_tokens, estimated: boolean } | null,
    configError: <knob name | null>,
    mode: 'streaming-unit' | 'full-answer'
  }
  ```
- **Deadline arithmetic.** The leg consumes `remainingMs` (clock-skew-free remaining duration, the same convention as `deadline_ms`). Per-call `timeoutMs = remainingMs` at call start (the plan already refused `remainingMs <= 0`); after each unit the remaining budget shrinks by the elapsed time before the next plan check. No new ceiling knob — the remaining deadline IS the bound; the end-to-end deadline is the BFF's (AD-6), computed by the 2.4 caller.

## Verification

**Commands:**
- `cd components/gov-chat-backend && npx jest __tests__/services/translation/agentic-translation-leg.test.js __tests__/services/translation/gpu-translate-backend.test.js` -- expected: green (matrix rows + additive backend pins)
- `cd components/gov-chat-backend && node --test scripts/agentic-translation-markdown.node-test.js` -- expected: green (the real-markdown loading-shape smoke; jest cannot require the ESM-only packages)
- `cd components/gov-chat-backend && npx jest __tests__/routes/query-routes.test.js __tests__/services/translation-service.test.js` -- expected: green unmodified (legacy frozen proof)
- `cd components/gov-chat-backend && npm test` -- expected: full backend suite green
- `rtk proxy npx eslint <touched files> && rtk proxy npx prettier --check <touched files>` (from the backend component dir) -- expected: clean
- `cd tests/config-validator && npm test` -- expected: green (config check file included)
