# Step 1 — Interfaces & Characterization Tests

**Date:** 2026-04-20
**Result:** 50/50 tests passing in 2.39s.

## What changed

Additive only. No legacy files were modified.

| File | Role |
|---|---|
| `interfaces.py` (updated) | Added `LanguageDetector` Protocol next to the existing five |
| `adapters/__init__.py` | New package |
| `adapters/legacy.py` | `LegacyTranslatorAdapter` wraps legacy `Translator` → `TranslationProvider` Protocol. `LegacyDetector` wraps the detection methods → `LanguageDetector` Protocol. |
| `tests/__init__.py` | New |
| `tests/conftest.py` | sys.path fixup (adds haystack-chatqna and src to path) + reusable fakes (`FakeRedis`, fake OpenAI client factory, bare `Translator` via `__new__`) |
| `tests/test_detector.py` | 21 pure-logic tests for `detect_language`, `detect_mandinka_intent`, `_mandinka_probability` |
| `tests/test_legacy_adapter.py` | 11 tests: Protocol conformance, delegation, preserved quirks, lazy-import check |
| `tests/test_legacy_cache.py` | 10 tests: cache hit/miss, swallowed errors, key namespacing, quote stripping |
| `tests/test_legacy_batch.py` | 8 tests: list↔dict conversion, order, duplicates, mixed hits/misses, empty, LLM failure |
| `tests/README.md` | How to run |
| `requirements-test.txt` | `pytest>=7.4`, `pytest-asyncio>=0.23` |
| `pytest.ini` | `asyncio_mode=auto`, testpaths=tests |

## What was NOT touched

- `services/translator.py` — no edits
- `services/tts_mandinka_fix.py` — no edits
- `api/agent_routes.py` — no edits
- `haystack-chatqna/requirements.txt` — no edits (test deps live in our own `requirements-test.txt`)
- No env files, compose files, or existing modules touched

## Design decisions

1. **Protocol mismatch on `translate_batch`.** Legacy takes `Dict[str, str]`, v2 Protocol takes `list[str]`. The adapter converts using index-keyed dicts (`{"0": text, "1": text, ...}`) so duplicates aren't collapsed and order is preserved.

2. **Detector methods exposed via a separate Protocol** (`LanguageDetector`), not lumped into `TranslationProvider`. Rationale: not all future providers will do detection (NLLB doesn't). Keeps seams clean.

3. **Legacy quirks preserved, not fixed.** The adapter faithfully exposes:
   - Failure-returns-input (translation fails → returns source text, not an exception)
   - Empty / same-lang / unsupported-lang passthrough (skips LLM, returns input)
   - Swallowed Redis read/write errors
   - Model-output quote stripping (single and double quotes)

   If any of these are actually bugs, they get fixed in Step 3's v2 implementation — not in the adapter, and not in legacy.

4. **Test fakes, not the-thing-under-test.**
   - Detector tests use the real detector. No mocks.
   - Adapter tests mock what's *around* the adapter (Redis, OpenAI client). Never the adapter itself.
   - No real network or Redis calls; tests run offline in < 3 seconds.

5. **Venv choice.** Installed `pytest` + `pytest-asyncio` into the existing `haystack-stack/.venv/`. This is additive (new packages, no removals or version pins touched). Rollback via `pip uninstall pytest pytest-asyncio pluggy iniconfig tomli`.

## Test inventory (50 total)

```
test_detector.py                              21 tests
  TestEmptyInput                               3
  TestPureEnglish                              3
  TestPureMandinka                             4
  TestLengthDampening                          3
  TestThresholds                               3
  TestSignalShape                              3
  TestDetectLanguage                           2

test_legacy_adapter.py                        11 tests
  TestAdapterProtocolConformance               2
  TestAdapterDelegation                        4
  TestAdapterPreservesLegacyQuirks             3
  TestAdapterLazyImport                        2

test_legacy_cache.py                          10 tests
  TestCacheHit                                 2
  TestCacheMiss                                2
  TestCacheFailureIsSwallowed                  2
  TestCacheKeyNamespacing                      2
  TestLLMFailureFallback                       2

test_legacy_batch.py                           8 tests
  TestListDictConversion                       3
  TestBatchCacheBehavior                       2
  TestBatchSourceEqualsTarget                  1
  TestBatchEmptyStrings                        1
  TestBatchLLMFailureFallback                  1
```

## Running

From `haystack-chatqna/src/translation_v2/`:

```bash
../../.venv/Scripts/python.exe -m pytest tests/ -v
```

Expected: `50 passed in ~2-3s`.

## Coverage claim

Per the migration brief, target is **80%+ of legacy translation paths**. Covered:

- `Translator.translate()` — cache hit, cache miss, LLM failure, quote stripping, empty/same-lang/unsupported shortcuts ✓
- `Translator.translate_batch()` — list↔dict conversion, order, duplicates, mixed cache state, LLM failure, empty strings ✓
- `Translator.detect_language()` — threshold, output shape ✓
- `Translator.detect_mandinka_intent()` — all signals, all confidence buckets, rounding, signal shape ✓
- `Translator._mandinka_probability()` — length dampening, direct exercise ✓
- `Translator._extract_signals()` — exercised via detect_mandinka_intent ✓
- `Translator._cache_key()` — namespacing, uniqueness ✓

**Not covered** (out of scope for Step 1):
- `Translator.__init__()` — requires real `settings.OPENAI_API_KEY`; integration scope
- Real OpenAI / Redis / memory_manager — integration scope
- Gemma backend selection branch — covered by induction (same `AsyncOpenAI` client), explicit test is Step 3

## Rollback plan

```bash
rm -rf haystack-stack/haystack-chatqna/src/translation_v2/adapters \
       haystack-stack/haystack-chatqna/src/translation_v2/tests \
       haystack-stack/haystack-chatqna/src/translation_v2/pytest.ini \
       haystack-stack/haystack-chatqna/src/translation_v2/requirements-test.txt \
       haystack-stack/haystack-chatqna/src/translation_v2/STEP_1_NOTES.md
# And revert the one LanguageDetector addition in interfaces.py.
```

## Next step

**Step 2 — Shared Services Layer.** TM cache, glossary, structured logging, PII detector, cost accounting. Adapter gains an optional v2-TM wrap behind `USE_V2_TM_CACHE` (default OFF → byte-identical to legacy).
