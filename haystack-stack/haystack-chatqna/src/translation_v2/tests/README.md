# translation_v2 tests

Characterization + protocol-conformance tests for the translation
pipeline refactor. These run against the existing legacy translator
(via thin adapters) to lock in current behavior before any v2 logic
replaces it.

## What's tested

| File | Scope | Mocks |
|---|---|---|
| `test_detector.py` | Mandinka detection calibration (pure logic) | none |
| `test_legacy_adapter.py` | Protocol conformance + delegation | fake Redis, fake OpenAI |
| `test_legacy_cache.py` | Redis cache hit/miss/swallow-errors | fake Redis, fake OpenAI |
| `test_legacy_batch.py` | List↔dict conversion, order, duplicates | fake Redis, fake OpenAI |

No test mocks the thing it is testing:
- Detector tests use the real detector on a bare `Translator` instance
  (no mocks at all).
- Adapter tests mock the thing *around* the adapter (the legacy
  Translator's OpenAI client + Redis), never the adapter itself.

## Running

From `haystack-chatqna/`:

```bash
# 1. Install test deps into the haystack-stack venv.
../.venv/Scripts/python.exe -m pip install -r src/translation_v2/requirements-test.txt

# 2. Run the suite.
../.venv/Scripts/python.exe -m pytest src/translation_v2/tests -v
```

On Linux / WSL replace `Scripts/python.exe` with `bin/python`.

The `conftest.py` at `src/translation_v2/tests/` inserts both
`haystack-chatqna/` and `haystack-chatqna/src/` into `sys.path`, so
the usual legacy imports (`from src.config import settings`,
`from services.translator import Translator`) resolve the same way
they do at runtime.

## Not tested here

- Real OpenAI calls (integration scope — different test suite).
- Real Redis (integration scope — fake is sufficient for behavior).
- The legacy TTS path (Step 2's PII + observability work opens the
  door for that; not required for Step 1).
