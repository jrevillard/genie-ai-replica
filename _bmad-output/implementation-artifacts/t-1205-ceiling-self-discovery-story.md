# #1205 — Concept-document ceiling: self-discovery (story)

- **Issue:** [#1205](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1205) · closes **#1588**
- **Spec:** `_bmad-output/specs/spec-okf-ceiling-self-discovery/SPEC.md` (+ `.memlog.md`, `stories.yaml`)
- **Ruling:** David, 2026-11-15 — SELF-DISCOVERY (okf-server derives the ceiling from the same `/v1/models` window dataprep reads, TTL-cached)
- **Status:** story complete, ready for dev-story (S1 → S2 → S3)
- **Whole-initiative grounding:** the ceiling lineage — #1588 (the static-literal drift gap, named in `concept-ceiling.js`'s header since 2026-11-06), the split feature (#1577) whose 409 remedy texts assume the ceiling is the truncation point, the ingest/editor/publish triad that reads `maxConceptDocChars()`, and dataprep's Contextual Retrieval budget whose discovery is the thing the ceiling must match.

## Problem (one paragraph)

`services/concept-ceiling.js` answers a static number (`OKF_MAX_CONCEPT_DOC_CHARS`, default 250 000) sized for ONE window; dataprep derives its per-document context budget at runtime from the serving model's window (`_serving_model_window` → `_resolve_doc_budget`, `genieai_dataprep_arangodb.py:2803`). On the default 65 536-token window the derived budget measures ~219 700 chars (2026-11-06, recorded in the module header) — a concept AT the ceiling truncates its context today. On a 2048-token T4 profile the ceiling is ~19× too large: documents pass every gate and truncate anyway. "Over the ceiling" and "will be truncated" must be the same condition (the shared number exists for that equivalence); a static literal cannot stay in step with a runtime discovery, and no validator can compare a number against a runtime answer — #1588's exact wording.

## Design (from the SPEC; implementation deltas only here)

### S1 — discovery client (`services/llm-window.js`, new)

- Mirrors dataprep's `_serving_model_window` semantics:
  - `DATAPREP_MAX_MODEL_LEN > 0` → stated window, NO request at all (sanitized the way dataprep sanitizes it — non-positive/garbage → treat as 0);
  - else `GET {VLLM_ENDPOINT}/v1/models` (axios, the component's egress rules) → `data[]` → the served model's `max_model_len`; selection mirrors dataprep's model pick (`VLLM_MODEL_ID` when set, else the listed model);
  - failure / absent `max_model_len` (strict OpenAI-compatible providers) → the client reports "no window" — it does NOT fabricate dataprep's 2048 guess (the ladder in S2 owns what that means for the ceiling).
- Cache: stale-while-revalidate, TTL 300 s (proposed; matches the smoke serviceToken cadence and okf-server's 5-min posture TTL — the SPEC's open question, resolved here). One background probe in flight at a time; callers always get the cached answer synchronously.
- State-change logs (once per change): `ceiling.window.discovered`, `.overridden`, `.unavailable`, `.stale-served` — structured fields with the window and the source.
- **Validator pin**: `tests/config-validator` gains a check that parses dataprep's python source for the constants okf-server mirrors (`CHARS_PER_TOKEN`, `DERIVE_FALLBACK_WINDOW` NOT mirrored — asserted as intentionally absent, `CONTEXTUAL_RETRIEVAL_PROMPT` default length, scaffold constants) and okf-server's mirror module for the same values; a mismatch fails CI. Precedent: the existing validators that parse source (`parse-ansible`, `js-files`).

### S2 — derived ceiling + ladder (`concept-ceiling.js`, extended)

- `maxConceptDocChars()` keeps its contract (call-time read; callers unchanged) but its answer becomes:
  1. explicit `OKF_MAX_CONCEPT_DOC_CHARS` pin (uncapped — an operator pin is deliberate);
  2. derived ceiling = dataprep's formula on the discovered window: `usable = window − prompt_tokens − batch_tokens − output_tokens − scaffold_tokens`, chars = `usable × CHARS_PER_TOKEN`, where output = `DATAPREP_CONTEXTUAL_MAX_TOKENS × DATAPREP_LLM_LABEL_BATCH_SIZE` and the prompt/scaffold terms are the mirrored constants;
  3. last-known-good derived (retained across endpoint failures);
  4. static default 250 000 + loud WARN (boot and per-state-change, not per-request).
- The batch term uses a REPRESENTATIVE serialized user turn (the formula's `_batch_user_turn_chars` of a chunk batch) — okf-server cannot know a future import's real chunks, so the mirror pins the same representative constants dataprep's own budget comment used for the 2026-11-06 measurement; tolerance is asserted in S3's smoke.
- `conceptTooLargeError()` gains the ceiling SOURCE in its message and `details.ceiling_source` (`discovered-from-window` / `operator-pin` / `static-default`) — the three call sites (import, editor save, publish gate) inherit it; UI untouched.
- No new required env vars; `OKF_MAX_CONCEPT_DOC_CHARS` keeps working for local Docker AND cloud Ansible (env.j2 comment updated in S3, value semantics unchanged).

### S3 — smoke leg + docs

- `data/okf/smoke-test/run-smoke-ceiling.js` (new leg, house run-* pattern): reads the live deployment's window from the SAME endpoint, reads okf-server's effective ceiling (via a smoke-only admin readout — see open questions), reads dataprep's derived budget for the same window from dataprep itself (NOT a local re-derivation — that would be the forbidden drift), asserts agreement within tolerance; then proves the ladder: set a pin → pin wins; clear → derived returns.
- `env` + `env.j2` comments move to "unset = derived; set = pin"; CHANGELOG entry (deployer-visible: the ceiling's default source changes; the override keeps working).
- Full smoke harness re-run live on the local build; fixes until green. MR carries the spec/story bookkeeping (docs-merge-with-code).

## Test matrix (minimum)

| Case | Expected |
|---|---|
| `DATAPREP_MAX_MODEL_LEN=8192` | window = 8192, no HTTP call |
| endpoint serves `max_model_len=65536` | ceiling ≈ 219 700 (2026-11-06 measurement, tolerance ±5%) |
| endpoint serves `max_model_len=2048` | proportionally small ceiling (~6 900) |
| endpoint down, cache warm | last-known-good served, `.stale-served` logged once |
| endpoint down, cache cold | static default 250 000 + WARN, source `static-default` |
| `OKF_MAX_CONCEPT_DOC_CHARS=1234` set | pin wins at ANY window; source `operator-pin` |
| strict provider (no `max_model_len`) | no window → ladder step 3/4, never the 2048 guess |
| dataprep constant edited, mirror not | validator red in CI |
| refusal text | names size, ceiling, source, remedy |

## Open questions (carry into implementation)

1. How the smoke reads okf-server's effective ceiling: a tiny admin-scoped readout endpoint (`GET /okf/admin/ceiling`, also useful for support diagnostics) vs deriving it in the smoke from logs. Proposal: the endpoint — it also serves the "which ceiling is in effect" support question. Small additive surface; David's call if he wants it narrower.
2. Remote-GPU reachability of `VLLM_ENDPOINT` from okf-server (expected open; verify at implementation — the judge base is already reachable, `VLLM_ENDPOINT` is env.j2 §18).

## Forward-workflow checklist

- [x] create-story — story grounded in the whole initiative (ceiling lineage + dataprep discovery + three call sites)
- [x] spec kernel + memlog + stories.yaml (SPEC-okf-ceiling-self-discovery)
- [x] checklist — matrix above; acceptance = smoke leg green live + validator red on drift + refusal texts name source
- [ ] dev-story (S1 → S2 → S3 in one MR, branch `fix/okf-ceiling-self-discovery` off main)
- [ ] code-review (high) + /simplify + verify; coverage must not decrease; CHANGELOG; monitor pipeline
