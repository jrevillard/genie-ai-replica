# AMINA Translation System — Migration Inventory
**Date:** 2026-04-20
**Scope:** Read-only survey prior to EN→Mandinka pipeline refactor
**Target language:** Mandinka (mnk_Latn) — confirmed with tech lead

---

## 1. Executive Summary

AMINA has a **mature, partially-integrated translation system** for English ↔ Mandinka (mnk_Latn), with strong backend infrastructure but inconsistent frontend coverage:

- **Backend:** Robust translator service (OpenAI gpt-4o-mini default, Gemma vLLM fallback) with Redis caching, calibrated Mandinka intent detection, and strict error handling for TTS synthesis.
- **Frontend:** React i18n (i18next) wired for UI chrome (Inbox, Forms, Scribe); legacy shells (App.jsx, BeginnerChat, CaregiverPortal) use DOM-level batch auto-translation via `/api/v1/agent/translate/batch`.
- **Mobile:** Flutter i18n supports 11 locales (en, ar, de, es, fr, id, pt, ru, sw, th, zh) but **Mandinka is not implemented** — only desktop web.
- **Training:** Mandinka health corpus exists ([training/mandinka_nlp.py](training/mandinka_nlp.py), training_data/) but is decoupled from the translator; native Mandinka NLP is aspirational, not active in the main pipeline.
- **Gaps:** No Mandinka in mobile app; TTS path has hardcoded cold-start workarounds; Wolof/Fula/Jola commented-out despite historical mention; autoTranslator uses naive batching (200-item cap, no adaptive rate-limiting).
- **Risk flags:** Language detection thresholds are empirically calibrated (no validation set); Gemma vLLM backend untested in production; translator singleton leaks Redis client lifecycle; no test coverage on core translation paths.

---

## 2. File Map

| Path | LOC | Last Modified | Purpose |
|------|-----|---------------|---------|
| [haystack-stack/haystack-chatqna/src/services/translator.py](haystack-stack/haystack-chatqna/src/services/translator.py) | 475 | 2026-04-20 | Core translator service: OpenAI/Gemma LLM dispatch, Mandinka intent detection (4-signal model: diacritics, strong/weak words, English counter-signals, length penalty), Redis caching (30d TTL) |
| [haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py](haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py) | 289 | 2026-04-20 | Mandinka TTS robustness layer: content-based language sniffing, strict translator error propagation, MMS synthesis with 3-attempt retry + progressive backoff |
| [haystack-stack/haystack-chatqna/src/api/tts_mandinka_routes.py](haystack-stack/haystack-chatqna/src/api/tts_mandinka_routes.py) | 115 | 2026-04-20 | Diagnostic endpoints for Mandinka TTS (`/tts/diag`, `/tts/v2`, `/tts/diag/translate`); structured error JSON on pipeline failure |
| [haystack-stack/haystack-chatqna/src/api/agent_routes.py](haystack-stack/haystack-chatqna/src/api/agent_routes.py) | 1360+ | 2026-04-20 | Main agent chat endpoint with language param; endpoints: `/agent/chat` (language="ma" triggers translate), `/agent/translate`, `/agent/translate/batch`, `/agent/languages` |
| [components/frontend/src/i18n/index.js](components/frontend/src/i18n/index.js) | 145 | 2026-02-12 | i18next bootstrap: loads en/ma locales; browser language detection + localStorage persistence (AMINA_LANG key); RTL placeholder for Arabic |
| [components/frontend/src/i18n/autoTranslator.js](components/frontend/src/i18n/autoTranslator.js) | 372 | 2026-02-12 | DOM-level batch translator for legacy shells: MutationObserver scans committed text nodes, debounces 250ms, POSTs to `/api/v1/agent/translate/batch` in 200-item chunks, caches in localStorage |
| [components/frontend/src/i18n/LanguagePicker.jsx](components/frontend/src/i18n/LanguagePicker.jsx) | 211 | 2026-02-12 | Floating language switch button (top-right, z-index 9850); toggles document.dir + language state |
| [components/frontend/src/i18n/I18nBootstrap.jsx](components/frontend/src/i18n/I18nBootstrap.jsx) | 66 | 2026-02-12 | React component that initializes i18n on mount; calls startAutoTranslator() for legacy shells |
| [components/frontend/src/i18n/useT.js](components/frontend/src/i18n/useT.js) | 255 | 2026-02-12 | Custom React hook for per-component translations; wraps useTranslation() from react-i18next |
| [components/frontend/src/i18n/locales/en.json](components/frontend/src/i18n/locales/en.json) | 128 | 2026-02-12 | English UI strings (common, language, inbox, forms, scribe, model fallback, channels) |
| [components/frontend/src/i18n/locales/ma.json](components/frontend/src/i18n/locales/ma.json) | 129 | 2026-02-12 | **MVP-quality** Mandinka translations; mix of native Mandinka + English loanwords for clinical terms; reviewed flag = false; disclaimer: "Native-speaker review required before production use in the Gambia" |
| [components/frontend/src/i18n/locales/fr.json](components/frontend/src/i18n/locales/fr.json) | 128 | 2026-02-12 | French locale (present but not wired — not in SUPPORTED_LANGS) |
| [components/frontend/src/i18n/locales/ar.json](components/frontend/src/i18n/locales/ar.json) | 130 | 2026-02-12 | Arabic locale (present but not wired — not in SUPPORTED_LANGS) |
| [haystack-stack/haystack-chatqna/src/services/tts.py](haystack-stack/haystack-chatqna/src/services/tts.py) | 139 | 2026-04-20 | Legacy TTS dispatcher (piper, etc.); superseded by tts_mandinka_fix.py in prod entrypoint |
| [haystack-stack/haystack-chatqna/src/services/tts_mms.py](haystack-stack/haystack-chatqna/src/services/tts_mms.py) | 96 | 2026-04-20 | MMS-TTS-MNK wrapper (POST to http://voice-tts-mnk:5500/v1/tts with 30s timeout) |
| [training/mandinka_nlp.py](training/mandinka_nlp.py) | 450+ | 2026-04-09 | Mandinka health corpus builder; vocabulary: greetings, body parts, medical terms, symptoms, food, household; adapts tokenizer; generates training data (JSONL) |
| [training/training_data/mandinka_health.jsonl](training/training_data/mandinka_health.jsonl) | unknown | 2026-04-09 | Bilingual EN/MA health conversations (for LoRA fine-tuning, not active in v2 pipeline) |
| [training/mandinka_corpus/mandinka_training.jsonl](training/mandinka_corpus/mandinka_training.jsonl) | unknown | 2026-04-09 | Mandinka corpus JSONL (support file for mandinka_nlp.py) |
| [mobile/genie_ai_mobile/lib/services/i18n_service.dart](mobile/genie_ai_mobile/lib/services/i18n_service.dart) | 100+ | 2026-02-12 | Flutter i18n singleton; loads 11 locales (en, ar, de, es, fr, id, pt, ru, sw, th, zh); **no Mandinka** |
| [mobile/genie_ai_mobile/lib/i18n/locales/en.dart](mobile/genie_ai_mobile/lib/i18n/locales/en.dart) | 50,603 | 2026-02-12 | Flutter English strings |
| [mobile/genie_ai_mobile/lib/i18n/locales/*.dart](mobile/genie_ai_mobile/lib/i18n/locales/) | ~1,000 each | 2026-02-12 | Flutter locales for ar, de, es, fr, id, pt, ru, sw, th, zh (11 files, **no Mandinka**) |

**Exclusions:** `.venv/`, `node_modules/` excluded from counts.

---

## 3. Translation Entry Points

### Backend (FastAPI — haystack-chatqna)

| Entry Point | File:Line | Signature | Notes |
|---|---|---|---|
| **POST /api/v1/agent/chat** | [agent_routes.py:206–319](haystack-stack/haystack-chatqna/src/api/agent_routes.py#L206-L319) | `async def agent_chat(request: AgentChatRequest, ...)` | Main user message handler. If `request.language == "ma"`, calls `translator.translate(english_response, "en", "ma")` on the LLM reply (line 284). Also detects Mandinka intent on input (line 291) and suggests language switch (line 293). |
| **POST /api/v1/agent/translate** | [agent_routes.py:1215–1222](haystack-stack/haystack-chatqna/src/api/agent_routes.py#L1215-L1222) | `async def translate_text(req: TranslateRequest)` | Single-string translation; calls `translator.translate()`. |
| **POST /api/v1/agent/translate/batch** | [agent_routes.py:1225–1232](haystack-stack/haystack-chatqna/src/api/agent_routes.py#L1225-L1232) | `async def translate_batch(req: TranslateBatchRequest)` | Batch translation for UI; calls `translator.translate_batch(texts, source, target)`. Used by autoTranslator (frontend). |
| **POST /api/v1/agent/prescription** | [agent_routes.py:1301+](haystack-stack/haystack-chatqna/src/api/agent_routes.py#L1301) | `async def analyze_prescription(...)` | Language param flows through; prescription analysis response is (optionally) translated if `language="ma"`. |
| **Translator singleton init** | [translator.py:467–475](haystack-stack/haystack-chatqna/src/services/translator.py#L467-L475) | `def get_translator() -> Translator` | Lazy-init at first call; selects OpenAI (default) or Gemma backend. |
| **Translator.translate()** | [translator.py:127–175](haystack-stack/haystack-chatqna/src/services/translator.py#L127-L175) | `async def translate(text, source="en", target="ma")` | Core method; checks Redis cache, calls LLM, writes cache (30-day TTL). |
| **Translator.translate_batch()** | [translator.py:177–261](haystack-stack/haystack-chatqna/src/services/translator.py#L177-L261) | `async def translate_batch(texts, source="en", target="ma")` | Batches misses into one LLM call, splits cache hits. |
| **Translator.detect_mandinka_intent()** | [translator.py:340–376](haystack-stack/haystack-chatqna/src/services/translator.py#L340-L376) | `async def detect_mandinka_intent(text)` | 4-signal classifier (diacritics, strong/weak words, EN counter-signal, length penalty); returns probability ≥ 0.60 to trigger UX suggestion. |
| **TTS synthesize_wav (strict path)** | [tts_mandinka_fix.py:211–234](haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py#L211-L234) | `async def synthesize_wav(text, lang="ma", source_lang="en")` | For Mandinka (`lang in {"ma", "mnk", ...}`), calls strict translator, retries MMS on 503/timeout. |
| **TTS synthesize_ogg** | [tts_mandinka_fix.py:237–252](haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py#L237-L252) | `async def synthesize_ogg(...)` | Same as WAV but returns OGG Opus for IVR/SMS. |

### Frontend (React — components/frontend)

| Entry Point | File:Line | Type | Notes |
|---|---|---|---|
| **startAutoTranslator()** | [autoTranslator.js:342–372](components/frontend/src/i18n/autoTranslator.js#L342-L372) | Function | Called from I18nBootstrap; sets up MutationObserver for legacy shells. On language change (i18n event + `amina:lang-changed` custom event), loads cache from localStorage, scans DOM, flushes batch translations. |
| **flush()** | [autoTranslator.js:222–264](components/frontend/src/i18n/autoTranslator.js#L222-L264) | Function | POSTs up to 200 text nodes to `/api/v1/agent/translate/batch` every 250ms; handles cache misses only. |
| **LanguagePicker.handleSelect()** | [LanguagePicker.jsx:46–50](components/frontend/src/i18n/LanguagePicker.jsx#L46-L50) | React callback | Calls `setLanguage(lng)`, which fires i18next `languageChanged` event + custom `amina:lang-changed` event. |
| **setLanguage()** | [index.js:129–143](components/frontend/src/i18n/index.js#L129-L143) | Async function | Changes i18n.language, persists to localStorage (AMINA_LANG), fires events for autoTranslator + analytics. |
| **Chat send (language param)** | App.jsx (call site) | User action | Frontend passes `language: "ma"` in AgentChatRequest body if user selected Mandinka mode. |

### Mobile (Flutter — mobile/genie_ai_mobile)

| Entry Point | File | Type | Notes |
|---|---|---|---|
| **I18nService.changeLanguage()** | [i18n_service.dart](mobile/genie_ai_mobile/lib/services/i18n_service.dart) | Method | Changes `_currentLocale` and notifies listeners. Only supports 11 locales (**no Mandinka**). |
| **I18nService.translate()** | [i18n_service.dart](mobile/genie_ai_mobile/lib/services/i18n_service.dart) | Method | Looks up string in nested map, falls back to English. |

---

## 4. Current Providers & Models

### Backend Translation Providers

| Backend | Default | Env Vars | Invocation | Status |
|---|---|---|---|---|
| **OpenAI GPT** | YES (default) | `OPENAI_API_KEY`, `OPENAI_MODEL` (default: gpt-4o-mini), `OPENAI_BASE_URL` | `AsyncOpenAI(api_key, base_url).chat.completions.create()` | **LIVE — production**: translator.py uses this by default; cached in Redis for 30 days. |
| **Gemma vLLM** | NO (opt-in) | `USE_GEMMA_TRANSLATOR=true/false`, `GEMMA_BASE_URL` (default: http://vllm-translation-guardrail:9031/v1), `GEMMA_MODEL` (default: google/gemma-3-4b-it), `GEMMA_API_KEY` (default: "not-needed") | `AsyncOpenAI(api_key, base_url)` to Gemma endpoint | **OPTIONAL**: toggled at startup. Notes from translator.py: gemma-3-4b-it has hallucinations on low-resource langs; translategemma-12b-it best quality (fits 24GB GPU); translategemma-27b-it exceeds A40. |
| **MMS-TTS-MNK** | N/A (audio synthesis, not translation) | `MMS_TTS_URL` (default: http://voice-tts-mnk:5500), `MMS_TTS_TIMEOUT_SECONDS` (default: 90), `MMS_TTS_MAX_RETRIES` (default: 2), `MMS_TTS_RETRY_BACKOFF` (default: 3.0s) | POST to `/v1/tts` | **LIVE — Mandinka only**: facebook/mms-tts-mnk. Cold-start model load can take 25-60s (hence 90s timeout + retries). |

### Frontend Translation Path

| Method | Config | Invocation | Status |
|---|---|---|---|
| **Server-side batch API** | `ENDPOINT = "/api/v1/agent/translate/batch"` (hardcoded in autoTranslator.js) | `fetch()` with JSON body `{ texts, source, target }` | **LIVE**: used by autoTranslator for legacy shells. Rate-limited to 200 items per request, debounced 250ms. |

### Training (Not active in current pipeline)

| System | Corpus | Status | Notes |
|---|---|---|---|
| **Mandinka LoRA** | mandinka_nlp.py + training_data/ | **NOT ACTIVE** in current pipeline | Intended to enable native Mandinka understanding without translation layer; vocabulary built (body parts, symptoms, greetings, medical terms) but decoupled from translator service. LoRA fine-tuning scripts exist but are not invoked by the v2 orchestrator. |

---

## 5. Existing Tests

| File | Type | Count | Command | Coverage |
|---|---|---|---|---|
| (none found for translator) | — | 0 | — | **CRITICAL GAP**: No pytest/unittest for translator.py, tts_mandinka_fix.py, or language detection. Mandinka intent detector is calibrated by hand ("a few dozen realistic Gambian patient messages") with no validation set. |
| autoTranslator.js | Jest (implied) | ~370 LOC | `npm test` (in components/frontend/) | Not examined; frontend tests likely not run in CI. |
| (mandinka training scripts) | Python scripts | Multiple | `python mandinka_nlp.py --build-corpus` | Data generation scripts are not test suites; no assertions. |

**Test Gap Summary:**
- No unit tests for language detection thresholds (0.60 probability for Mandinka intent).
- No integration tests for OpenAI ↔ Gemma backend switching.
- No stress tests for batch translation (200-item chunks, debounce timing).
- No e2e tests for TTS retry + backoff logic.
- No coverage of edge cases: diacritics in non-Mandinka text, very long messages (>1200 chars rejected by autoTranslator), RTL reversion.

**Step 1 of migration will need to write characterization tests before any code change** — per the migration brief's Prime Directive #5.

---

## 6. Shared Services (reusable for v2)

### 6a. Embedding Generation
- **Vector retrieval:** `arcade_vector_retriever.py` (uses ArcadeDB vector search; no translation of metadata keys or search results)
- **Embedding service:** Referenced in env (EMBEDDING_SERVER_HOST_IP=tei, port 80) but not directly in translator codebase
- **Reuse for v2:** Embeddings are language-agnostic; no changes needed for Mandinka queries *unless* chunking logic needs to account for different token/character ratios in Mandinka vs English.

### 6b. Caching
- **Redis client:** Accessed via `translator.redis` property (lazy-init from `memory_manager.get_memory_manager().redis`)
- **Cache key namespace:** `translate:{backend}:{source}:{target}:{hash}` (e.g., `translate:openai:en:ma:a1b2c3d4e5f6`)
- **TTL:** 30 days (2.592M seconds)
- **Reuse for v2:** Existing Redis cache is shared; v2 can extend cache key prefix to include model version/variant for non-breaking switches.

### 6c. Logging
- **Module logger:** `logger = logging.getLogger(__name__)` in each service
- **Structured:** `logger.info()`, `.warning()`, `.error()` in translator.py (lines 100–110, 166, 173, 232, 237, 250–260)
- **No log aggregation:** Logs to console (Docker captures stdout)
- **Reuse for v2:** Can add JSON-structured logging via a handler; translator already logs backend selection, cache hits/misses, translation failure reasons.

### 6d. Error Handling Middleware
- **Custom exception:** `MandinkaTTSError(stage, detail)` in tts_mandinka_fix.py (lines 56–66)
- **HTTP status mapping:** 502 (translator failure), 503 (MMS unreachable), 500 (catch-all)
- **Graceful fallback:** translator.translate() returns **original text on failure** (line 167); TTS routes raise `HTTPException` (strict mode)
- **Reuse for v2:** Extend MandinkaTTSError to handle other providers; add context (request ID, user session, retry count) to structured error logs.

### 6e. Cost / Token Accounting
- **Not present:** No token counting, rate-limiting, or per-user budgeting in translator or TTS
- **Implied via:** OpenAI API call counts tokens in response headers (not captured in translator.py)
- **Reuse for v2:** Add `async def log_translation_cost()` wrapper around translator.translate_batch() that sums estimated tokens and logs to Redis for dashboarding.

### 6f. PII Detection
- **Not present:** No PII masking or detection in translator
- **Implication:** Translator sends raw patient text to OpenAI API (if not using local Gemma). Clinical data (symptoms, medications) flows through.
- **Reuse for v2:** Add optional PII filter before translate() call; mask names, phone numbers, medical record IDs. Coordinate with privacy policy updates.

### 6g. PDF Ingestion & OCR
- **Document generation:** `document_gen.py` (generates SOAP/care plans in English; can be translated via `translate_doc_for_render()`)
- **Translation wrapper:** Lines 97–146 of agent_routes.py show `translate_doc_for_render(doc_content, language)` which translates title, subtitle, section headings/content
- **OCR:** Not present (imports PDF libraries but doesn't extract text from images)
- **Reuse for v2:** Extend translate_doc_for_render() to handle PDFs with embedded Mandinka formatting (font fallback, line-breaking for diacritics).

### 6h. Text Chunking
- **Not language-aware:** Chunks are created at document ingestion time (DATAPREP_CHUNK_SIZE=500 in env); no re-chunking post-translation
- **Risk:** Translating a chunk may shorten it (English→Mandinka) or lengthen it (Mandinka→English), breaking page layouts
- **Reuse for v2:** Add optional post-translation re-chunking if target text exceeds length limits for rendering.

---

## 7. Configuration Surface

### Environment Variables (Translator + TTS)

| Variable | Location | Default | Type | Purpose |
|---|---|---|---|---|
| `USE_GEMMA_TRANSLATOR` | haystack-stack/.env.example | `false` | bool | Backend selection at import time (no runtime switching) |
| `GEMMA_BASE_URL` | haystack-stack/.env.example | `http://vllm-translation-guardrail:9031/v1` | URL | Gemma OpenAI-compatible endpoint (local or Cloudflare tunnel) |
| `GEMMA_MODEL` | haystack-stack/.env.example | `google/gemma-3-4b-it` | string | Gemma model ID; tested: 4b (hallucinations), 12b (best fit), 27b (OOM) |
| `GEMMA_API_KEY` | haystack-stack/.env.example | `not-needed` | string | Gemma auth; defaults to anon for local/tunnel endpoints |
| `OPENAI_API_KEY` | haystack-stack/.env.example | (required) | string | OpenAI bearer token |
| `OPENAI_MODEL` | haystack-stack/.env.example | `gpt-4o-mini` | string | OpenAI model ID |
| `OPENAI_BASE_URL` | haystack-stack/.env.example | `https://api.openai.com/v1` | URL | OpenAI API base (allows custom proxies) |
| `MMS_TTS_URL` | tts_mandinka_fix.py | `http://voice-tts-mnk:5500` | URL | Mandinka TTS service endpoint |
| `MMS_TTS_TIMEOUT_SECONDS` | tts_mandinka_fix.py | `90` | float | HTTP timeout (cold-start model load: 25–60s) |
| `MMS_TTS_MAX_RETRIES` | tts_mandinka_fix.py | `2` | int | Retry attempts (covers cold-start + transient blips) |
| `MMS_TTS_RETRY_BACKOFF` | tts_mandinka_fix.py | `3.0` | float | Backoff multiplier (attempt × seconds) |
| `MMS_TTS_STRICT_TRANSLATION` | tts_mandinka_fix.py | `true` | bool | If true, raise error on translator failure instead of fallback to English synthesis |

### Legacy Express-Backend Env Vars (from `env` file — not used by Haystack)

| Variable | Default | Purpose |
|---|---|---|
| `TRANSLATION_THREADS` | `4` | Legacy Express backend; unused in current Haystack pipeline |
| `TRANSLATION_BATCHES` | `5` | Legacy Express backend |
| `TRANSLATION_CACHE` | `on` | Legacy Express backend |
| `TRANSLATION_CACHE_HOST` | `redis-cache` | Legacy Express backend |
| `TRANSLATION_CACHE_PORT` | `6379` | Legacy Express backend |

### Code-Level Configuration

| Setting | Location | Value | Scope |
|---|---|---|---|
| **SUPPORTED_LANGUAGES** | [translator.py:51–55](haystack-stack/haystack-chatqna/src/services/translator.py#L51-L55) | `{"en": "English", "ma": "Mandinka"}` | Hard-coded; Wolof/Fula commented out |
| **TRANSLATE_PROMPT_TEMPLATE** | [translator.py:71–87](haystack-stack/haystack-chatqna/src/services/translator.py#L71-L87) | Health-specific system prompt | Instructs LLM to keep clinical terms simple, preserve medication/place/food names |
| **_MA_DIACRITICS** | [translator.py:288](haystack-stack/haystack-chatqna/src/services/translator.py#L288) | `{"ŋ", "ñ", "ɛ", "ɔ", "ɲ"}` | Tier 1: very strong Mandinka evidence |
| **_MA_STRONG_WORDS** | [translator.py:291–306](haystack-stack/haystack-chatqna/src/services/translator.py#L291-L306) | ~30 words (greetings, copula, health, cultural) | Tier 2: highly distinctive Mandinka vocab |
| **_MA_WEAK_WORDS** | [translator.py:309–314](haystack-stack/haystack-chatqna/src/services/translator.py#L309-L314) | ~10 words | Tier 3: less distinctive, can appear in English |
| **_EN_COMMON_WORDS** | [translator.py:317–324](haystack-stack/haystack-chatqna/src/services/translator.py#L317-L324) | ~20 words | Counter-signal: common English health vocab |
| **_EN_STRONG_BIGRAMS** | [translator.py:327–331](haystack-stack/haystack-chatqna/src/services/translator.py#L327-L331) | ~10 phrases (e.g., "my bp", "i have") | Counter-signal: very specific English health patterns |
| **Mandinka probability thresholds** | [translator.py:363–375](haystack-stack/haystack-chatqna/src/services/translator.py#L363-L375) | `< 0.35: low, 0.35–0.60: medium, > 0.60: high` | Calibrated by hand; no validation set |
| **detect_mandinka_intent threshold** | [translator.py:338](haystack-stack/haystack-chatqna/src/services/translator.py#L338) | `>= 0.50` for `detect_language()` | Used for informational hints |
| **suggest_language_switch threshold** | [agent_routes.py:292](haystack-stack/haystack-chatqna/src/api/agent_routes.py#L292) | `>= 0.60` for `is_mandinka_intent` | UX trigger: one-time prompt per session |
| **Cache batch cap** | [autoTranslator.js:227](components/frontend/src/i18n/autoTranslator.js#L227) | `200 items` | Frontend batch request limit |
| **Cache debounce** | [autoTranslator.js:219](components/frontend/src/i18n/autoTranslator.js#L219) | `250 ms` | Coalesce React-commit mutations |

### Feature Flags (Frontend)

| Flag | Type | Default | Purpose |
|---|---|---|---|
| `SUPPORTED_LANGS` (index.js:44) | array | `["en", "ma"]` | Active locales in react-i18next |
| `RTL_LANGS` (index.js:48) | array | `[]` | RTL locales (currently empty; "ar" disabled) |
| `LANG_STORAGE` (index.js:49) | string | `"AMINA_LANG"` | localStorage key for persisted language choice |
| `autoTranslator.enabled` | bool (internal state) | `false` when lang="en" | Disables DOM scanning in English mode |

**Migration note:** There is currently **no feature-flag registry** (e.g., `flags.py`) on the backend. Step 0 of the migration will introduce this. Existing env-var toggles (USE_GEMMA_TRANSLATOR, MMS_TTS_STRICT_TRANSLATION) will be preserved and surfaced through the registry.

---

## 8. Risk Flags

### 8a. Dead Code Candidates

| Location | Code | Status | Notes |
|---|---|---|---|
| [translator.py:54](haystack-stack/haystack-chatqna/src/services/translator.py#L54) | `# "wo": "Wolof", "ff": "Fula"` | COMMENTED OUT | Wolof & Fula are mentioned in project context but not implemented. See open question #2. |
| [translator.py:43–47](haystack-stack/haystack-chatqna/src/services/translator.py#L43-L47) | Cache read/write wrapped in try/except that logs but doesn't raise | LIVE BUT SILENT | Cache failures are swallowed; if Redis is down, translator silently falls back to repeating LLM calls. No metric/alert. |
| [autoTranslator.js:195–196](components/frontend/src/i18n/autoTranslator.js#L195-L196) | `el.dataset.aminaTrAttrOrig` logic | CONVOLUTED | Attribute translation tracking is fragile; uses `+ "\|" + attr` string key which may collide if attr name contains `\|`. |
| [tts.py](haystack-stack/haystack-chatqna/src/services/tts.py) | Original TTS routes | SUPERSEDED | tts_mandinka_fix.py is wired in via main_with_tts_mandinka_fix.py; original tts.py is unreachable in production but not removed. |

### 8b. Load-Bearing Undocumented

| Location | Logic | Risk | Mitigation |
|---|---|---|---|
| [translator.py:268–335](haystack-stack/haystack-chatqna/src/services/translator.py#L268-L335) | Mandinka detection probability calibration | **HIGH**: 4-signal weighted logit model with hand-tuned coefficients (-1.5 prior, +3.0 diacritics, +2.0 strong words, -1.5 EN bigrams, etc.). No validation set. False positives = annoying UX. | Add unit tests with 100+ labeled examples (native speaker or linguist). Log all detections ≥ 0.50 to Redis for drift detection. |
| [translator.py:418–464](haystack-stack/haystack-chatqna/src/services/translator.py#L418-L464) | Logit → logistic squash; length penalty (0.5x for ≤2 words) | **MEDIUM**: Short messages (e.g., "ŋ" alone) get 50% dampening; can flip a marginal case. | Document rationale; add sensitivity analysis (sweep word_count thresholds). |
| [tts_mandinka_fix.py:80–91](haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py#L80-L91) | Content-based language sniffing (diacritic detection) | **MEDIUM**: Fast heuristic, but may miss Mandinka-in-ASCII (e.g., transliterated "ng" for "ŋ"). | Coordinate with frontend: encourage diacritical entry for Mandinka (or auto-convert). |
| [agent_routes.py:288–294](haystack-stack/haystack-chatqna/src/api/agent_routes.py#L288-L294) | Language switch suggestion (one-time per session) | **MEDIUM**: Uses in-memory flag `memory.language_switch_suggested`. If session is reloaded, flag is lost → repeat suggestion. | Persist flag in Redis (session key `lang_switch_hint:{session_id}`). |
| [tts_mandinka_fix.py:116–161](haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py#L116-L161) | Strict translator error propagation | **HIGH**: If strict_translation=true, synthesis fails on translator passthrough. Frontend may not handle 502/503 gracefully. | Add retry logic to frontend; show user-friendly message + fallback to English audio. |

### 8c. Latent Bugs

| Location | Issue | Severity | Reproduction |
|---|---|---|---|
| [translator.py:104–109](haystack-stack/haystack-chatqna/src/services/translator.py#L104-L109) | `AsyncOpenAI` client is stored in `self.client` for Gemma backend, but `base_url` may point to a tunnel/proxy. If the tunnel is down at import time, get_translator() succeeds but first call fails with confusing error. | MEDIUM | Deploy with GEMMA_BASE_URL pointing to a dead tunnel; call translator.translate(). Error message will not mention the tunnel URL. |
| [translator.py:113–118](haystack-stack/haystack-chatqna/src/services/translator.py#L113-L118) | Redis property lazy-init: `if self._redis is None: ... get_memory_manager().redis`. If get_memory_manager() has not yet initialized Redis connection, this blocks. If Redis crashes after init, `redis.setex()` exceptions are caught but logged only. Translator continues returning original text. | MEDIUM | Kill redis-cache container during a translation request. Message will be returned untranslated; no user-visible error. |
| [tts_mandinka_fix.py:165–207](haystack-stack/haystack-chatqna/src/services/tts_mandinka_fix.py#L165-L207) | MMS retry loop uses `asyncio.sleep(backoff)` inside async for; if event loop is blocked, sleep may not honor deadline. Also, last_err is set but only reported on final failure; intermediate attempts' errors are logged but not surfaced. | LOW | Under high concurrency, retries may take >90s total. |
| [autoTranslator.js:195–207](components/frontend/src/i18n/autoTranslator.js#L195-L207) | Attribute translation stores original on first sight (`el.dataset.aminaTrAttrOrig = origKey`); if React re-renders and commits the SAME attribute with the SAME value, the tracking breaks because the re-assigned value may not equal `origKey` after whitespace normalization. | LOW | Edge case: `<input placeholder="hello" />` → (re-render) → `<input placeholder="hello" />`. Second render may not restore if placeholder was already translated. |
| [autoTranslator.js:223–264](components/frontend/src/i18n/autoTranslator.js#L223-L264) | Batch request POSTs 200 items per request, but if a request hangs (network timeout), pending items are cleared but never re-queued. Frontend will serve stale translated text for the dropped batch. | MEDIUM | Network slowdown; frontend user sees cached translation from previous session. No retry. |
| [translator.py:161](haystack-stack/haystack-chatqna/src/services/translator.py#L161) | `max_tokens=500` is hardcoded for both single and batch translation. If a medical term or Gambian food name requires >500 tokens (unlikely but possible with 3-way explanations), translation is truncated. | LOW | Unlikely given Mandinka's relative verbosity, but not impossible for complex medical cases. |
| main_with_tts_mandinka_fix.py (referenced by tts_mandinka_routes.py) | The overlay replaces translator via monkey-patch. If two overlays try to patch the same module, the last one wins, hiding earlier patches. | LOW | Developer error; mitigated by code review. |

---

## 9. Open Questions for Tech Lead

1. **Mobile Mandinka:** Does the v2 pipeline require Mandinka in the Flutter app? If yes, should we add `"ma": "Mandinka"` to i18n_service.dart's supportedLanguages and load ma.dart locale? Currently only 11 locales are wired, and ma.dart doesn't exist.

2. **Wolof/Fula/Jola:** Project context mentions these languages, but they are only commented-out in translator.py:54. Are they in scope for v2, or is Mandinka-only acceptable for the initial rollout?

3. **Mandinka training corpus:** The training/mandinka_nlp.py module builds a corpus and can fine-tune a tokenizer, but it is decoupled from the translator service. Should v2 integrate native Mandinka understanding (no translation layer) for chat input, or is the current translate-on-output model sufficient?

4. **Language detection validation:** The Mandinka intent detector is calibrated by hand on "a few dozen realistic Gambian patient messages." For v2, should we collect labeled data (e.g., 500–1000 messages from the Gambia) to validate thresholds and drift detection?

5. **TTS failure handling:** When MMS synthesis fails after retries, what should the frontend do? Currently it returns a 503 JSON error. Should we fall back to English audio synthesis (piper), or should users be prompted to try again?

6. **Gemma vLLM in production:** The Gemma backend is wired but has a note ("translategemma-12b-it is best quality that fits a 24GB GPU"). What GPU hardware is available in the Gambia deployment, and has the translategemma-12b-it model been tested end-to-end in that environment?

7. **Redis cache namespace collisions:** The cache key is `translate:{backend}:{source}:{target}:{hash}`. If we switch from OpenAI to Gemma for the same text, a new entry is created. Is this intentional (to avoid stale cross-backend results), or should we share a single cache and just increment a model version in the key?

8. **Batch translation cap:** autoTranslator.js caps batches at 200 items and debounces 250ms. For a large legacy shell with thousands of visible text nodes, is this rate-limiting sufficient, or will the frontend feel sluggish on slow networks?

9. **PII in translations:** If a patient says "My name is Fatou and I live in Banjul", the translator will send this to OpenAI API (if not using Gemma). Is this GDPR/privacy compliant, or should we add PII masking before translation?

10. **Frontend fallback on translate failure:** If the autoTranslator batch request fails (network error, server 500), the frontend retries or just shows English? Currently it silently falls back to English ([autoTranslator.js:257–259](components/frontend/src/i18n/autoTranslator.js#L257-L259) catches the error but doesn't retry). Should we add exponential backoff + user notification?

11. **Target for `/v2/*` endpoints:** The migration brief specifies parallel endpoints (e.g., `/v2/translate`) rather than mutating v1. Should these live under `/api/v2/agent/translate` to match the existing `/api/v1/agent/*` pattern, or under a new top-level `/v2/*` namespace?

12. **Legacy Express-backend translation envs:** The `env` file has `TRANSLATION_THREADS`, `TRANSLATION_BATCHES`, `TRANSLATION_CACHE*` — these look like they belong to an earlier Express-based translation service. Are they safe to ignore during the migration, or is there a code path I missed that still reads them?

---

**End of Inventory. Awaiting tech lead review per the migration brief. No code changes will be made until you approve or amend.**
