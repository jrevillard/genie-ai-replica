# AMINA Translation Process (EN ↔ Mandinka)

## Architecture Overview

AMINA uses a two-layer translation system: a **legacy translator** and a **v2 pipeline** that wraps/replaces it via monkey-patching.

```
User message (language="ma")
  │
  ▼
agent_routes.py  ─── import translation_v2 (side-effect: autoinstall)
  │
  ▼
src.services.translator.get_translator()
  │
  ├── [v2 shim installed] → LegacyProxyViaV2 → v2 Router
  │                                                │
  │                                      ┌─────────┴─────────┐
  │                                      ▼                   ▼
  │                               Primary Provider     Fallback Provider
  │                               (OpenAI gpt-4o)       (NLLB local)
  │                                      │
  │                                      ▼
  │                               Glossary Injection (pre-translation)
  │                                      │
  │                                      ▼
  │                               Bridge Polish (post-translation)
  │                                      │
  │                                      ▼
  │                               Return translated text
  │
  └── [v2 shim NOT installed] → Legacy Translator (OpenAI gpt-4o-mini)
                                        │
                                        ▼
                                 Simple prompt, no glossary, no polish
                                        │
                                        ▼
                                 Return translated text (prone to loops)
```

---

## Components

### 1. Legacy Translator (`src/services/translator.py`)

- Original translation service, uses OpenAI (model set by `OPENAI_MODEL` env var)
- Simple system prompt without anti-repetition rules or glossary
- Redis-cached translations (30-day TTL, keyed by backend+text+direction)
- **Problem**: With low-resource languages like Mandinka, LLMs tend to fall into repetition loops without explicit constraints

### 2. v2 Pipeline (`src/translation_v2/`)

Staged migration (8 stages). Key modules:

| Module | Role |
|--------|------|
| `flags.py` | Feature flags — all default OFF, read from env vars |
| `router.py` | Request coordinator: TM lookup → provider → glossary → polish → TM write-back |
| `prompts.py` | Enhanced system prompt with LEXICAL RULE + REGISTER + anti-repetition CRITICAL rule |
| `legacy_shim.py` | Monkey-patches `get_translator()` to route through v2 Router |
| `_autoinstall.py` | Runs on import; installs shim if any v2 flag is active |
| `bridge_polish.py` | Post-translation glossary substitution (catches leaked English terms) |
| `glossary.py` | Loads `data/glossary_seed.csv` — 85 medical/everyday term mappings |
| `providers/openai_provider.py` | OpenAI translation provider (gpt-4o) |
| `providers/nllb_provider.py` | Local NLLB fallback |

### 3. Activation Chain

```
agent_routes.py (top-level import)
  → import translation_v2          # triggers __init__.py
  → from . import _autoinstall     # side-effect import
  → _should_install()              # checks if ANY USE_V2_* flag is True
  → _install_once()                # calls legacy_shim.install()
  → monkey-patches get_translator  # all future calls go through v2 Router
```

---

## Feature Flags (`.env`)

| Flag | Effect |
|------|--------|
| `USE_V2_TRANSLATION_PIPELINE=true` | Master switch — enables the v2 router |
| `USE_V2_FOR_LEGACY_TRANSLATOR=true` | Shim intercepts `get_translator()` calls |
| `USE_V2_FOR_V1_ENDPOINTS=true` | v1 HTTP endpoints also route through v2 |
| `USE_V2_GLOSSARY=true` | Injects glossary snippet into prompt |
| `USE_V2_BRIDGE_POLISH=true` | Post-translation word-boundary substitution |
| `V2_PRIMARY_PROVIDER=openai` | Which LLM provider to use (openai/nllb) |

All flags default to `false`. Set in `.env`; read at process start via `os.getenv()`.

---

## Translation Quality Improvements (v2 vs Legacy)

### Enhanced Prompt (`prompts.py`)

1. **LEXICAL RULE**: Explicitly lists medical words that MUST be translated to Mandinka (diabetes→sukari-kuuraŋo, symptoms→taamasiroolu, etc.)
2. **REGISTER directive**: "Write as a community health worker would speak to a patient" — prevents bookish literal translations
3. **Anti-repetition CRITICAL rule**: "Do NOT repeat phrases or particles. If you cannot fluently translate a sentence, stop. Never pad output with repeated words. Truncation is always better than repetition."
4. **Do-not-translate list**: Medication names, place names, clinical acronyms, Gambian food names

### Glossary Injection

- 85 entries in `data/glossary_seed.csv` (EN term → Mandinka term)
- Injected into the system prompt so the LLM sees correct translations
- Terms marked `do_not_translate` are preserved as-is

### Bridge Polish (`bridge_polish.py`)

Post-translation pass that catches English terms the LLM leaked through:
- Word-boundary regex substitution (case-insensitive)
- Morphological variant generation (plurals, gerunds, consonant doubling)
- Safety: never touches tokens < 3 chars (avoids clobbering Mandinka particles like "ko", "la", "ye")
- Runs in < 1ms, idempotent

### Model Upgrade

- Legacy: `gpt-4o-mini` (cheaper but worse at low-resource languages)
- v2: `gpt-4o` (stronger at following complex translation constraints)

---

## The Bug: Why Translation Was Still Looping (Apr 2026)

### Symptom
Mandinka output collapsed into repetition: "a be nyinata i laa koyo kono ani a be nyinata..." — typical of an LLM without anti-repetition constraints translating a low-resource language.

### Root Cause: Python Import Path

The Docker container's `WORKDIR` is `/app`. Python's `sys.path` includes `/app` (CWD) but NOT `/app/src`.

The v2 package lives at `/app/src/translation_v2/`. When `agent_routes.py` does:
```python
import translation_v2  # looks for /app/translation_v2/ — DOES NOT EXIST
```
This raises `ModuleNotFoundError`, caught by the try/except, logged at DEBUG level. The legacy shim is NEVER installed. All translation goes through the legacy path with the old simple prompt — no LEXICAL RULE, no anti-repetition guard, no glossary, no bridge polish.

### The Fix

Add `PYTHONPATH=/app/src` to the container environment (in `docker-compose.override.yml`):

```yaml
services:
  haystack-chatqna:
    environment:
      PYTHONPATH: /app/src
```

This adds `/app/src` to Python's `sys.path`, so:
- `import translation_v2` → finds `/app/src/translation_v2/__init__.py` ✓
- `from translation_v2 import flags` (inside router.py, legacy_shim.py) → resolves ✓
- The autoinstall chain fires → shim installs → v2 pipeline is live

### Verification

After restarting the container with the fix:
```bash
docker exec haystack-chatqna python -c "import translation_v2; from translation_v2 import flags; print(flags.snapshot())"
```

Expected: all flags show `True`, no import errors.

---

## Request Flow (When Working Correctly)

1. User sends message with `language: "ma"`
2. Agent generates English response
3. `translator.translate(text, source="en", target="ma")` is called
4. **v2 shim intercepts** → delegates to v2 Router
5. Router checks `USE_V2_TRANSLATION_PIPELINE` flag
6. If glossary flag active: builds glossary snippet from CSV
7. Calls OpenAI gpt-4o with enhanced prompt (LEXICAL RULE + anti-repetition + glossary)
8. If bridge polish flag active: runs word-boundary substitution on output
9. Returns Mandinka text back through the translator surface
10. If v2 errors at any step: falls back silently to legacy translator

---

## File Locations

```
haystack-chatqna/
├── src/
│   ├── services/
│   │   └── translator.py          # Legacy translator (get_translator factory)
│   ├── api/
│   │   └── agent_routes.py        # Side-effect import triggers v2 autoinstall
│   └── translation_v2/
│       ├── __init__.py            # from . import _autoinstall
│       ├── _autoinstall.py        # Checks flags, calls legacy_shim.install()
│       ├── flags.py               # USE_V2_* env var registry
│       ├── router.py              # Request coordinator
│       ├── prompts.py             # Enhanced system prompt
│       ├── legacy_shim.py         # Monkey-patches get_translator()
│       ├── bridge_polish.py       # Post-translation lexicon substitution
│       ├── glossary.py            # Loads glossary_seed.csv
│       ├── providers/
│       │   ├── openai_provider.py # gpt-4o translation
│       │   └── nllb_provider.py   # Local NLLB fallback
│       └── data/
│           └── glossary_seed.csv  # 85 EN→MA medical term mappings
├── docker-compose.override.yml    # PYTHONPATH=/app/src fix lives here
└── .env                           # v2 flags (USE_V2_*=true)
```
