# Step 2 — Shared Services Layer

**Date:** 2026-04-20
**Result:** 101/101 tests passing in 0.96s (50 from Step 1 + 51 new).

## What changed

Additive. One v2 file (adapters/legacy.py) gained an optional `tm` param; its behavior is unchanged when the flag is OFF.

| File | Status | Role |
|---|---|---|
| `tm.py` | Rewritten from stub | `TranslationMemory` class: versioned Redis cache (namespace `v2:tm:*`), 30-day TTL, reuses memory_manager's Redis |
| `glossary.py` | Rewritten from stub | `Glossary` class: CSV loader, case-insensitive word-boundary substitution, prompt-snippet formatter, do-not-translate preservation |
| `observability.py` | New | `log_event()` JSON logger, `TokenCounter` (approximate), `timed()` context manager with ok/error status |
| `pii.py` | New | `PIIDetector` + `PIIReport` dataclass; detects Gambian phone (+220), email, national-ID patterns; detection-only (no masking) |
| `data/glossary_seed.csv` | New | 25 seed entries covering clinical terms + Gambian proper nouns / food names marked do-not-translate |
| `adapters/legacy.py` | Extended (v2 code I own) | Added optional `tm` param + flag-gated v2 TM wrap in `translate()`. Batch intentionally excluded until Step 3 |
| `tests/test_tm.py` | New | 12 tests |
| `tests/test_glossary.py` | New | 11 tests |
| `tests/test_observability.py` | New | 9 tests |
| `tests/test_pii.py` | New | 11 tests |
| `tests/test_adapter_with_tm.py` | New | 8 tests covering OFF byte-identical, ON hit, ON miss write-back, LLM failure no-write, shortcuts, batch-not-affected |

## What was NOT touched

- `services/translator.py`, `tts_mandinka_fix.py`, `agent_routes.py`, `tts_mandinka_routes.py` — no edits
- `haystack-chatqna/requirements.txt`, any `.env*`, any `docker-compose*.yaml` — no edits
- Step 1's test files and adapter — only additive Edit to the one adapter I own, explicitly marked in the diff. Step 1's 50 tests still pass unchanged.

## Design decisions

1. **TM layered, not replacing legacy cache.** The legacy `translator.py` has its own Redis cache under the `translate:{backend}:*` namespace. The v2 TM lives under `v2:tm:{provider}:{version}:*`. When the flag is ON both caches are warm simultaneously. This is the right shape for a staged migration — v2 can be rolled back without cache eviction.

2. **Versioned keys in v2 TM.** Keys include provider *and* a provider_version string. Switching from `openai:v1` to `openai:v2` prompt-template doesn't serve stale translations; it builds a fresh warm cache alongside. Step 3 will bump the version whenever the system prompt or glossary changes materially.

3. **Batch not wrapped with v2 TM in Step 2.** Legacy's batch path already has a Redis cache. Layering v2 TM on top of a batched LLM call introduces double-cache semantics that are hard to reason about. Step 3 re-owns batching and introduces TM at that layer cleanly. The test `test_batch_does_not_use_v2_tm_in_step_2` locks this in.

4. **PII is detect-only.** Open question Q9 (PII masking policy) is still outstanding. The detector produces a `PIIReport` that can be logged via `log_event("pii_detected", **report.summary())` — counts only, never values. Step 3 can add a `PIIMasker` that uses the report once you decide the policy. No dependencies in the wrong direction.

5. **TokenCounter is approximate.** ~4 chars/token for English, ~3 for Mandinka. This is for cost-trend visibility, not billing. If we ever need exact counts we swap in `tiktoken` for OpenAI or the tokenizer metadata for NLLB — both slot into the same `add()` signature.

6. **Adapter's flag check is runtime, not import-time.** `_tm_enabled()` reads `flags.USE_V2_TM_CACHE` on every call. This lets us flip the flag at runtime via environment or (in Step 3) via per-request header override without restarting. Tests `monkeypatch` the flag module attribute to exercise both states.

7. **Glossary do-not-translate vs translated terms.** Rows where `do_not_translate=true` and `mnk_term` is empty (e.g. `metformin`, `Banjul`) are preserved verbatim — enforced in `apply_en_to_mnk()` (skip) and surfaced in `prompt_snippet()` ("keep unchanged"). Rows where `do_not_translate=false` and both columns are populated are candidates for substitution (e.g. `headache → kung dimi`).

## Flag matrix — what each combination means today

| `USE_V2_TM_CACHE` | TM injected | Behavior |
|---|---|---|
| OFF | either | Byte-identical to a plain legacy call. No v2 TM read or write. |
| ON | None | v2 TM wrap skipped; legacy called; no v2 TM side effects. |
| ON | provided | v2 TM consulted before legacy; legacy result cached to v2 TM if non-trivial. |

The default in production remains **OFF + None** (no TM injected anywhere) until Step 3's router owns instantiation. Nothing in the live pipeline changes with Step 2 deployed.

## Open questions answered in Step 2

From the inventory's § 9:

- **Q7 Cache namespacing across backends.** Resolved: the v2 TM uses `v2:tm:{provider}:{version}:*`. Cross-backend cache isolation stays, but versioning is now explicit. Legacy's existing namespace is unchanged.
- **Q9 PII masking.** Partially resolved: detection is live, masking is deferred. The `PIIDetector` produces a report; tech lead decides policy for Step 3.

Still outstanding (do not block Step 3 universally, but shape it):
- Q1, Q2 (mobile Mandinka, other Gambian languages) — Step 6 cutover scope
- Q3 (native Mandinka NLP) — out of v2 scope unless tech lead says otherwise
- Q4 (detection validation set) — needs Gambian labeler; infra for this is ready, blocker is data
- Q5 (TTS failure UX) — Step 3+ frontend work
- Q6 (Gambia GPU hardware for Gemma) — deployment conversation

## Test inventory (new in Step 2 — 51 tests)

```
test_tm.py                                    12 tests
  TestBasicRoundtrip                           3
  TestKeyNamespacing                           4
  TestRedisFailureIsSwallowed                  2
  TestNoOpCases                                3

test_glossary.py                              11 tests
  TestLoading                                  3
  TestApplySubstitutions                       4
  TestPromptSnippet                            3
  TestTermsToPreserve                          1

test_observability.py                          9 tests
  TestLogEvent                                 2
  TestTokenCounter                             5
  TestTimed                                    2

test_pii.py                                   11 tests
  TestEmpty                                    2
  TestPhone                                    3
  TestEmail                                    2
  TestNationalID                               3
  TestSummary                                  1

test_adapter_with_tm.py                        8 tests
  TestFlagOffByteIdentical                     2
  TestFlagOnHit                                1
  TestFlagOnMiss                               2
  TestFlagOnShortcuts                          2
  TestBatchStillUsesLegacyCacheOnly            1
```

## Running

Unchanged from Step 1. From `haystack-chatqna/src/translation_v2/`:

```bash
../../.venv/Scripts/python.exe -m pytest tests/ -v
```

Expected: `101 passed in ~1s`.

## Rollback

```bash
rm translation_v2/tm.py translation_v2/glossary.py translation_v2/observability.py \
   translation_v2/pii.py
rm -rf translation_v2/data
rm translation_v2/tests/test_tm.py translation_v2/tests/test_glossary.py \
   translation_v2/tests/test_observability.py translation_v2/tests/test_pii.py \
   translation_v2/tests/test_adapter_with_tm.py
# Revert tm.py and glossary.py to their Step 0 NotImplementedError stubs.
# Revert adapters/legacy.py to its Step 1 state (remove tm param, TM checks).
```

One flag flip reverses behavior even without file changes:
```
unset USE_V2_TM_CACHE   # (default is False anyway)
```

## Next step

**Step 3 — v2 Text Translation Path (no RAG yet).**

- Implement `providers/openai.py`, `providers/gemma.py`, `providers/nllb.py` bodies.
- Wire `Router` with real provider selection + shadow-mode mirroring.
- Add a new FastAPI router mounted alongside `agent_routes` (no edits to existing endpoints) exposing `/api/v2/agent/translate` behind `USE_V2_TRANSLATION_PIPELINE`.
- Wire glossary + PII + observability + v2 TM into the v2 path.
- Per-request header override for staged rollout.

Requires explicit "proceed" ack. Also recommend answering Q5, Q6, Q9 before Step 3 since they shape the provider and deployment choices.
