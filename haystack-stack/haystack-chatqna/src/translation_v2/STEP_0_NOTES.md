# Step 0 — Scaffold + Safety Net

**Date:** 2026-04-20
**Target language:** Mandinka (mnk_Latn)
**Approach:** Strict-additive (option a) — no legacy files moved or edited.

## What changed

New package created at
`haystack-stack/haystack-chatqna/src/translation_v2/`:

| File | Purpose |
|---|---|
| `__init__.py` | Package marker + docstring |
| `README.md` | Migration status + re-enable instructions |
| `STEP_0_NOTES.md` | This file |
| `flags.py` | 6 boolean flags + 2 provider selectors; all OFF by default |
| `interfaces.py` | 6 Protocols + `Chunk` and `QEResult` dataclasses |
| `router.py` | Router class stub; `is_v2_active()` reports flag state |
| `providers/__init__.py` | Package marker |
| `providers/openai.py` | OpenAIProvider stub (conforms to TranslationProvider) |
| `providers/gemma.py` | GemmaProvider stub |
| `providers/nllb.py` | NLLBProvider stub — golden standard for mnk_Latn |
| `rag/__init__.py` | Package marker |
| `rag/ingest.py` | `ingest_pdf()` stub |
| `rag/retrieve.py` | `retrieve()` stub (hybrid + rerank) |
| `rag/generate.py` | `generate_answer()` stub; strategy param documented |
| `glossary.py` | Glossary class stub |
| `tm.py` | TranslationMemory class stub (reuses legacy Redis client) |
| `qe.py` | ChrFPlusPlusQE class stub (no COMET — not trained on mnk) |
| `post_process.py` | `normalize_mandinka()`, `strip_model_artifacts()` stubs |

Every non-trivial function raises `NotImplementedError` with a pointer
to the step that implements it.

## What was NOT touched

- `haystack-chatqna/src/services/translator.py` — unchanged
- `haystack-chatqna/src/services/tts_mandinka_fix.py` — unchanged
- `haystack-chatqna/src/services/tts.py`, `tts_mms.py` — unchanged
- `haystack-chatqna/src/api/agent_routes.py` — unchanged
- `haystack-chatqna/src/api/tts_mandinka_routes.py` — unchanged
- `components/frontend/src/i18n/*` — unchanged
- `mobile/genie_ai_mobile/*` — unchanged
- `.env`, `.env.example`, any `docker-compose*.yaml` — unchanged

Zero edits to existing source/config files. Additive only.

## Verification commands

From `haystack-stack/haystack-chatqna/src/`:

```bash
# 1. No legacy import of v2 exists.
grep -rn "translation_v2" . --include="*.py" | grep -v "^\./translation_v2/"
# Expected: no output.

# 2. Flags all default to False / configured providers.
python -c "from translation_v2 import flags; print(flags.snapshot())"
# Expected:
#   USE_V2_TRANSLATION_PIPELINE=False, USE_V2_TM_CACHE=False,
#   USE_V2_GLOSSARY=False, USE_V2_RAG=False, USE_V2_QE=False,
#   USE_V2_SHADOW_MODE=False,
#   V2_PRIMARY_PROVIDER='openai', V2_FALLBACK_PROVIDER='gemma'

# 3. Legacy translator is still the only live translation path.
grep -rn "from services.translator" . --include="*.py"
# Expected: same call sites as before (agent_routes.py, tts_mandinka_fix.py).
```

## Test impact

No existing pytest suite covers `translator.py` or `tts_mandinka_fix.py`
(see `MIGRATION_INVENTORY.md` § 5). "Full test suite passes unchanged"
is trivially true — there are no translation-path tests to run.

**Step 1's first job** is to write characterization tests against the
legacy translator. That becomes the contract v2 must honor.

## Flags introduced (all default OFF)

| Flag | Env Var | Default |
|---|---|---|
| `USE_V2_TRANSLATION_PIPELINE` | same | `false` |
| `USE_V2_TM_CACHE` | same | `false` |
| `USE_V2_GLOSSARY` | same | `false` |
| `USE_V2_RAG` | same | `false` |
| `USE_V2_QE` | same | `false` |
| `USE_V2_SHADOW_MODE` | same | `false` |
| `V2_PRIMARY_PROVIDER` | same | `"openai"` |
| `V2_FALLBACK_PROVIDER` | same | `"gemma"` |

No env-file edits were needed; unset env vars fall back to the defaults
above.

## Rollback plan

```
rm -rf haystack-stack/haystack-chatqna/src/translation_v2/
```

Returns the repo to its pre-Step-0 state. No other file depends on
this package.

## Decisions locked in this step

1. **Module location (Q from pre-Step-0 plan):** Option (a) — lives
   inside `haystack-chatqna/src/` for clean imports.
2. **Dispatcher wiring:** Deferred to Step 3 via a new FastAPI router
   mounted alongside existing `agent_routes`. No edits to the existing
   router.
3. **NLLB hosting:** Deferred. Step 3 will define a separate container
   matching the existing `vllm-translation-guardrail` pattern.
   `NLLBProvider` stub assumes HTTP interface.

## Open questions still outstanding

From `MIGRATION_INVENTORY.md` § 9, items that do not block Step 1 but
shape Step 2 onward:

- Q1: Mobile Mandinka — in or out of scope for v2?
- Q2: Wolof / Fula / Jola — in scope for v2?
- Q3: Native Mandinka NLP via training corpus — integrate or leave
  aspirational?
- Q4: Language-detection validation set (500–1000 labelled messages)?
- Q5: TTS failure UX — hard fail vs English fallback?
- Q6: Gambia GPU hardware — is translategemma-12b-it viable there?
- Q9: PII masking before OpenAI API calls — GDPR posture?

Flagging for answers before we start Step 2.

## Next step

**Step 1 — Define Interfaces & Characterization Tests.**

- Write pytest fixtures against the legacy translator: capture current
  behaviour for translate / translate_batch / detect_mandinka_intent,
  including known quirks.
- Write thin adapters that make the legacy translator and MMS TTS
  conform to the Protocols defined in `interfaces.py`, without
  modifying the legacy classes.
- Run tests. They pass (they characterize current behaviour).
- Target: 80%+ coverage of legacy translation paths.

Step 1 requires explicit "proceed" ack from tech lead before execution.
