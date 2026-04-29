# translation_v2 — staged migration scaffold

This package is part of the EN → Mandinka (mnk_Latn) translation
pipeline refactor tracked by `MIGRATION_INVENTORY.md` at the repo root.

## Status: Step 0 — scaffold only

Every non-trivial function raises `NotImplementedError`. The legacy
translator at `services/translator.py` is the only live path and is
untouched.

## What's here

- `flags.py` — feature flag registry, all flags default OFF
- `interfaces.py` — Protocols that legacy and v2 both satisfy
- `router.py` — dispatcher stub
- `providers/` — OpenAI, Gemma, NLLB adapter stubs
- `rag/` — ingest, retrieve, generate stubs (PDF Q&A)
- `glossary.py`, `tm.py`, `qe.py`, `post_process.py` — shared services

## What's NOT here (deliberately)

- No wiring into `api/agent_routes.py`. The dispatcher is mounted in
  Step 3 via a separate FastAPI router; existing endpoints are not
  edited.
- No new env vars in `.env.example`. Defaults live in `flags.py` and
  apply if env vars are unset.
- No tests. Step 1 writes characterization tests against the legacy
  translator first, before any v2 code has real logic.

## Verification

From `haystack-stack/haystack-chatqna/src/`:

```bash
# 1. Nothing outside this package imports v2.
grep -rn "translation_v2" . --include="*.py" | grep -v "^\./translation_v2/"
# Expected: empty.

# 2. Flags default OFF.
python -c "from translation_v2 import flags; print(flags.snapshot())"
# Expected: all booleans False.
```

## Rollback

Delete the `translation_v2/` directory. No other file depends on it.

## Migration plan

See `MIGRATION_INVENTORY.md` for the 7-step plan. Each step ships
behind a flag and is reversible in under 5 minutes.
