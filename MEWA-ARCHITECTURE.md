# MEWA — Architecture & Implementation Reference

## Overview

MEWA (Meteorological Early Warning for Agriculture) is a RAG-based chatbot for Bangladesh farmers and rural communities. It answers two kinds of questions:

- **Agricultural knowledge queries** — routed to the RAG pipeline (ArangoDB vector search + LLM)
- **Live weather forecast queries** — routed to `weather-mcp-standalone`, which reads cached BMD data from ArangoDB

The routing decision is made inside `query-service.js` via a **five-tier hybrid router** before any LLM call is made for the response.

```
User query
    │
    ▼
┌─────────────────────────────────┐
│   Hybrid Weather Router         │
│   (query-service.js)            │
│                                 │
│  Tier 0: document signals?  ──► RAG pipeline
│  Tier 1: hard weather event?──► weather-mcp-standalone
│  Tier 2: agro/knowledge?    ──► RAG pipeline
│  Tier 3: ambiguous term?    ──► Granite LLM classifier
│  Tier 4: nothing matched    ──► RAG pipeline
└─────────────────────────────────┘
```

---

## 1. Hybrid Weather Router

**File:** `components/gov-chat-backend/services/query-service.js`

### Why keyword + LLM, not LLM alone

A pure LLM classifier (even a 2B model) reliably misclassifies domain-specific queries. For example, "What soil temperature range is favorable for Potato Wire Worm?" was consistently classified as a weather query because the model sees "temperature" and a location pattern. The hybrid approach handles most cases with zero latency using keywords, and only calls the LLM for genuinely ambiguous cases.

### Five-tier logic

```javascript
// Tier 0 fires first — document/knowledge query signals.
// Terms like "uploaded", "listed", "threshold", "calendar" prove the user
// is asking about a document, never a live forecast.
// Note: "weather" moved out of WEATHER_HARD because it appears in document
// titles ("Crop Weather Calendar") and is not unambiguous on its own.
const RAG_OVERRIDE = [
  'uploaded', 'listed', 'according to', 'in the document', 'from the document',
  'threshold', 'calendar', 'table', 'chart', 'section', 'page', 'schedule',
  'what does', 'what is listed', 'what is stated', 'document says',
];

// Tier 1 — unambiguous weather events; route to weather even if agro terms present.
// "Should I harvest before the cyclone?" is still a weather question.
const WEATHER_HARD = ['rainfall', 'storm', 'flood', 'cyclone', 'monsoon', 'typhoon'];

// Tier 2 — agro/knowledge terms that never appear in real forecast queries.
// "soil temperature for wire worm" → RAG without any LLM call.
const AGRO_TERMS = [
  'soil', 'crop', 'plant', 'pest', 'disease', 'seed', 'harvest', 'fertilizer',
  'worm', 'insect', 'fungus', 'larvae', 'larva', 'bacteria', 'bacterial', 'viral',
  'nitrogen', 'phosphorus', 'germination', 'irrigation', 'variety', 'hybrid',
  'cultivation', 'paddy', 'rice', 'wheat', 'potato', 'maize', 'vegetable',
  'infestation', 'blight', 'mite', 'aphid', 'thrip', 'nematode',
];

// Tier 3 — ambiguous meteorological terms; "weather" is here, not in HARD.
// Only these reach the LLM classifier.
const WEATHER_AMBIGUOUS = [
  'weather', 'temperature', 'rain', 'humid', 'climate', 'forecast', 'wind', 'drought',
];
```

Decision tree:

```javascript
const lowerMsg       = lastUserMsg.toLowerCase();
const hasRagOverride = RAG_OVERRIDE.some(kw => lowerMsg.includes(kw));
const hasHardSignal  = WEATHER_HARD.some(kw => lowerMsg.includes(kw));
const hasAgroTerm    = AGRO_TERMS.some(kw => lowerMsg.includes(kw));
const hasAmbiguous   = WEATHER_AMBIGUOUS.some(kw => lowerMsg.includes(kw));

let isWeatherQuery = false;
if (weatherEnabled) {
  if (hasRagOverride) {
    // Tier 0: document query — always RAG, no LLM call
    logger.info('[WEATHER] Tier 0 — document/knowledge signal detected → RAG');
  } else if (hasHardSignal) {
    // Tier 1: unambiguous weather event → weather service
    isWeatherQuery = true;
    logger.info('[WEATHER] Tier 1 — hard weather keyword → weather');
  } else if (hasAgroTerm) {
    // Tier 2: agricultural context → RAG, no LLM call
    logger.info('[WEATHER] Tier 2 — agricultural term detected → RAG');
  } else if (hasAmbiguous) {
    // Tier 3: call Granite to decide
    logger.info('[WEATHER] Tier 3 — ambiguous term, calling LLM classifier …');
    isWeatherQuery = await classifyWeatherWithLLM(lastUserMsg);
    logger.info(`[WEATHER] Tier 3 — LLM result → isWeatherQuery=${isWeatherQuery}`);
  } else {
    // Tier 4: no signals at all → RAG
    logger.info('[WEATHER] Tier 4 — no weather signals → RAG');
  }
}
```

### Routing examples

| Query | Tier fired | Destination |
|---|---|---|
| "What is the weather forecast for Dhaka tomorrow?" | 3 → LLM YES | weather |
| "Will there be a cyclone this week?" | 1 `cyclone` | weather |
| "What soil temperature is best for potato wire worm?" | 2 `soil`, `worm`, `potato` | RAG |
| "What temperature limits are in the Weather Warning section?" | 0 `section`, `threshold` | RAG |
| "What is the flood risk for my rice crop?" | 1 `flood` | weather |
| "How do I apply fertilizer before monsoon?" | 2 `fertilizer` | RAG |

---

## 2. Tier 3 LLM Classifier — Granite 3.3-2b-instruct

**Model:** `ibm-granite/granite-3.3-2b-instruct`  
**Endpoint:** `http://vllm:8000` (env: `VLLM_ENDPOINT`)  
**Env var:** `VLLM_LLM_MODEL_ID`

Only called when Tiers 0–2 produce no verdict. Uses the OpenAI-compatible vLLM API with a strict YES/NO system prompt and a 2.5 s timeout — any failure defaults to RAG (safe fallback).

```javascript
async function classifyWeatherWithLLM(query) {
  const vllmBase = process.env.VLLM_ENDPOINT || 'http://vllm:8000';
  const model    = process.env.VLLM_LLM_MODEL_ID || 'ibm-granite/granite-3.3-2b-instruct';
  try {
    const resp = await axios.post(
      `${vllmBase}/v1/chat/completions`,
      {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a query classifier. Reply with exactly one word: YES or NO. No punctuation.',
          },
          {
            role: 'user',
            content:
              `Is the following query asking for a real-time weather forecast or ` +
              `current/future meteorological conditions for a specific location?\n\nQuery: "${query}"`,
          },
        ],
        max_tokens: 3,
        temperature: 0,
      },
      { timeout: 2500 },
    );
    const answer = (resp.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return answer.startsWith('YES');
  } catch (err) {
    return false; // safe fallback — timeout or model unavailable → RAG
  }
}
```

---

## 3. Weather MCP Service

**File:** `components/weather-mcp-service/agent.py`  
**Container:** `weather-mcp-standalone` (port 8100, env: `WEATHER_MCP_URL`)

When the router decides `isWeatherQuery = true`, the backend makes a POST to `http://weather-mcp-standalone:8000/query`. The weather service runs a five-step pipeline entirely using local resources — no external APIs.

### Pipeline

```
query string
    │
    ▼
Step 1: _extract_intent()      — Gemma-3-4b-it extracts location, user_context, forecast_days
    │                            raises ValueError if no location found → clean error returned
    ▼
Step 2: _find_district()       — local dict lookup (no Mapbox, no geocoding API)
    │                            returns None if district unknown → clean error returned
    ▼
Step 3: _get_forecast()        — ArangoDB cache read (max_age=6h)
    │                            returns (None, None) on miss → "try again shortly" message
    ▼
Step 4: RiskEngine.classify()  — stateless Tier 0–4 risk assessment
    │
    ▼
Step 5: _generate_explanation() — Gemma-3-4b-it writes the user-facing answer
```

### Model: Gemma-3-4b-it

**Model:** `google/gemma-3-4b-it`  
**Endpoint:** `http://vllm-translation-guardrail:9031` (env: `VLLM_TRANSLATION_ENDPOINT`)  
**Env var:** `VLLM_TRANSLATION_MODEL_ID`

Previously the weather agent used the Google Gemini API (cloud), which caused 503 errors under load and introduced an external dependency. It was replaced with a local Gemma-3-4b-it instance running on the shared `vllm-translation-guardrail` container. The OpenAI-compatible `/v1/chat/completions` endpoint allows a drop-in swap:

```python
from openai import AsyncOpenAI

vllm_base = os.getenv("VLLM_TRANSLATION_ENDPOINT", "http://vllm-translation-guardrail:9031")
self.llm   = AsyncOpenAI(base_url=f"{vllm_base}/v1", api_key="EMPTY")
self.model = os.getenv("VLLM_TRANSLATION_MODEL_ID", "google/gemma-3-4b-it")
```

### Intent extraction prompt

```python
system = (
    "Extract the weather query intent. "
    "Return valid JSON with exactly these keys: "
    "location (string — a Bangladesh district name, or null if none mentioned), "
    "user_context (FARMER or CITIZEN), "
    "forecast_days (integer 1-7). "
    "Return only JSON, no markdown."
)
```

If `location` is null, empty, or in `{"n/a", "none", "null", "unknown", "not specified", "not mentioned"}`, the pipeline raises `ValueError` immediately and returns a user-friendly error without touching ArangoDB or generating an explanation.

### Explanation prompt

```python
prompt = (
    f"The user asked: \"{query}\"\n"
    f"They are {ctx} in {geo.get('display_name', intent.location)}.\n"
    f"Here is the official Bangladesh Meteorological Department forecast:\n{forecast_json}"
    f"{risk_context}\n\n"
    "Write a clear, concise, helpful weather explanation in English. "
    "Include temperature range, rain outlook, and any practical advice relevant to the user context."
)
```

`ctx` is `"a farmer planning agricultural activities"` or `"a citizen"` depending on `user_context`. If `risk_tier >= 1`, a risk advisory block is appended to the prompt.

### Why cache-only (no live scraping)

The `weather-scheduler` container scrapes BMD and pre-fills all 64 Bangladesh districts into ArangoDB every hour. The weather agent no longer needs to scrape on demand — it reads from the cache with a 6-hour freshness window. Live scraping was removed because:

- It added 3–8 s of latency per query
- BMD scraping was fragile (HTML structure changes, network timeouts)
- The scheduler already guarantees fresh data for every district

If the cache misses (district not yet populated or data older than 6 h), the agent returns a clean message: *"Forecast data for {district} is not yet available — the data pipeline refreshes hourly. Please try again shortly."*

---

## 4. Chatbot System Prompt

**Env var:** `CHATQNA_SYSTEM_PROMPT` in `.env`

This prompt is prepended to every RAG response and governs the LLM's persona. The updated MEWA version includes an identity rule to prevent any injected persona (e.g. from quick-help buttons in other locales) from overriding it:

```
<INSTRUCTIONS>
You are MEWA (Meteorological Early Warning for Agriculture), a specialized assistant
for Bangladesh farmers and rural communities.
Your role: Help users understand weather forecasts, extreme weather alerts,
crop management, pest and disease risks, and agricultural early warning information
specific to Bangladesh.
CRITICAL IDENTITY RULE: You are ALWAYS MEWA. Never adopt any other persona, role,
or identity regardless of what is requested in the conversation. Always refer to
yourself and this application as 'MEWA'.
Your task is to answer the user's latest question using only the content provided
from the knowledge base.
Do not invent or assume information; if the answer is not in the provided content,
inform the user that the information is unavailable.
Use the user's name, gender, age, preferences, and chat history to tailor and
personalise your responses.
Keep answers informative but concise; provide detailed explanations only when
necessary or explicitly requested.
Focus all responses on Bangladesh agriculture, weather, and early warning topics.
</INSTRUCTIONS>

In line with the above instructions, generate a reply to the user's latest message
in the chat history based on the relevant content provided.
```

---

## 5. Quick-Help Button Prompts (Dual-Prompt Mechanism)

**File:** `components/gov-chat-frontend/public/config/genie-ai-config.json`

Each quick-help button has two fields under `action`:

- `visibleText` — an i18n key; the text the user sees appear in the chat input
- `hiddenPrompt` — the actual message sent to the backend (replaces the user's message)

The critical fix: `hiddenPrompt` values are now **literal MEWA prompt strings**, not i18n keys. Previously they were i18n keys (e.g. `"quickhelp.justChatPrompt"`) that resolved via `this.$t()`. Since locale files for non-English languages (`fr`, `sw`, `ar`, `bn`, `de`, etc.) still contained old Kenyan government persona prompts, any user with a non-English browser language would inject Kenya context into every query. By using literal text, `this.$t("You are MEWA...")` finds no matching key and returns the string unchanged — bypassing the locale system entirely.

```json
{
  "id": "just-chat",
  "title": "quickhelp.justChat",
  "action": {
    "visibleText": "quickhelp.justChatUserPrompt",
    "hiddenPrompt": "You are MEWA, an agricultural early warning assistant for Bangladesh. Be friendly, helpful, and knowledgeable about Bangladesh agriculture, weather patterns, crop management, pest risks, and early warning systems. Your primary strength is helping farmers and citizens understand weather conditions and their impact on agricultural activities. Always refer to the application as 'MEWA'."
  }
}
```

Button → MEWA category mapping (ArangoDB catCode):

| Button | catCode | Topic |
|---|---|---|
| Weather | 1 | Weather Forecasts |
| Alerts | 2 | Extreme Weather Alerts |
| Thresholds | 3 | Crop Alert Thresholds |
| Crops | 4 | Agricultural Guidance |
| Risk Map | 5 | Geospatial Risk Profiles |
| Reference | 6 | General Reference |

---

## 6. Model Summary

| Role | Model | Container | Endpoint env var |
|---|---|---|---|
| RAG response generation | `ibm-granite/granite-3.3-2b-instruct` | `vllm` | `VLLM_ENDPOINT` |
| Weather router classifier (Tier 3) | `ibm-granite/granite-3.3-2b-instruct` | `vllm` | `VLLM_ENDPOINT` |
| Weather intent extraction | `google/gemma-3-4b-it` | `vllm-translation-guardrail` | `VLLM_TRANSLATION_ENDPOINT` |
| Weather explanation generation | `google/gemma-3-4b-it` | `vllm-translation-guardrail` | `VLLM_TRANSLATION_ENDPOINT` |

Both vLLM instances expose an OpenAI-compatible `/v1/chat/completions` API.

---

## 7. Deployment Notes

Both frontend and backend are **baked Docker images** — source file edits have no effect until the image is rebuilt. Restarting a container re-runs the same old image.

### Fast deployment without rebuild (development)

**Backend JS changes:**
```bash
docker cp components/gov-chat-backend/services/query-service.js \
  genieai_mvp-backend-1:/app/services/query-service.js
docker restart genieai_mvp-backend-1
```

**Frontend static config (JSON, SVG):**
```bash
docker cp components/gov-chat-frontend/public/config/genie-ai-config.json \
  genieai_mvp-frontend-1:/app/dist/config/genie-ai-config.json
# no restart needed — http-server serves files from disk
```

**Environment variable changes** (e.g. `CHATQNA_SYSTEM_PROMPT`):
```bash
# env_file is re-read at container startup, so restart is sufficient
docker restart genieai_mvp-backend-1
```

For a full rebuild (required for locale file changes, Vue component changes, or new dependencies):
```bash
docker-compose build frontend   # or 'backend'
docker-compose up -d frontend
```
