# Chatbot Prompt & Weather Router Configuration Guide

This document explains how to configure the system prompt for the MEWA chatbot,
how the weather/RAG routing decision works, which LLM models are used at each stage,
and what went wrong when the container had a "baked" (stale) configuration.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [LLM Models in Use](#llm-models)
3. [System Prompt — What It Is and Where It Lives](#system-prompt)
4. [The Docker env_file Trap — Why Changes Don't Stick](#docker-env-trap)
5. [How to Safely Update the Prompt](#how-to-update)
6. [The Five-Tier Weather Router](#weather-router)
7. [Weather Agent Pipeline](#weather-agent)
8. [Frontend: Auto-Send and Quick-Help Overlay](#frontend)
9. [Nginx DNS Caching After Rebuild](#nginx-dns)
10. [Quick Reference: Key Files](#key-files)

---

## 1. Architecture Overview <a name="architecture-overview"></a>



```
Browser
  └─► NGINX (443 SSL)
        ├─► /           → frontend container (Vue.js, port 8090)
        └─► /api/       → Kong API Gateway (port 8000)
                              └─► backend Node.js service (query-service.js)
                                    │
                                    ├─► [Tier 3 only] classifyWeatherWithLLM()
                                    │       └─► vllm container  →  Granite 3.3-2b  (YES/NO)
                                    │
                                    ├─► [weather query]  → weather-mcp-service (Python/FastAPI)
                                    │       ├─► _extract_intent()  → vllm-translation-guardrail  → Gemma-3-4b-it
                                    │       ├─► ArangoDB forecast cache  (no LLM, pre-filled hourly)
                                    │       └─► _generate_explanation() → vllm-translation-guardrail  → Gemma-3-4b-it
                                    │
                                    └─► [RAG query] → retriever (ArangoDB + BGE embeddings)
                                                         → reranker (ms-marco-MiniLM)
                                                         → vllm container  →  Granite 3.3-2b
                                                              ↑
                                                  CHATQNA_SYSTEM_PROMPT injected here
```

The system prompt is passed to the **vLLM inference service** by the backend's
`chatqna-xeon-backend-server` container. That container reads it from the `.env` file
**only at startup** (container creation time, not `docker restart`).

---

## 2. LLM Models in Use <a name="llm-models"></a>

Four different model invocations happen across a single user interaction. Each has a distinct
role, endpoint, and container.

### Model 1 — Granite 3.3-2b-instruct (main RAG answer)

| | |
|---|---|
| **Purpose** | Generates the final answer to the user from retrieved knowledge base chunks |
| **Model ID** | `ibm-granite/granite-3.3-2b-instruct` |
| **Container** | `vllm` |
| **Endpoint** | `http://vllm:8000/v1/chat/completions` |
| **Env vars** | `VLLM_LLM_MODEL_ID`, `VLLM_MODEL_ID`, `VLLM_ENDPOINT` |
| **Config** | `VLLM_GPU_UTIL=0.35`, `VLLM_MAX_MODEL_LEN=16384`, `VLLM_DTYPE=half` |
| **Called by** | `chatqna-xeon-backend-server` (OPEA ChatQnA stack) |

The `CHATQNA_SYSTEM_PROMPT` you configure in `.env` is the system message sent to this model.
It receives: system prompt + user profile + chat history + top-N reranked chunks.

---

### Model 2 — Granite 3.3-2b-instruct (Tier 3 router classifier)

| | |
|---|---|
| **Purpose** | Classifies whether an ambiguous query (e.g. "what are the temperatures?") is asking for a live weather forecast (YES) or a document query (NO) |
| **Model ID** | `ibm-granite/granite-3.3-2b-instruct` (same model as above) |
| **Container** | `vllm` |
| **Endpoint** | `http://vllm:8000/v1/chat/completions` |
| **Env vars** | `VLLM_ENDPOINT`, `VLLM_LLM_MODEL_ID` |
| **Called by** | `query-service.js` → `classifyWeatherWithLLM()` |

This call is made **only at Tier 3** (ambiguous terms like `weather`, `temperature`, `rain`
with no other context). It uses `max_tokens: 3, temperature: 0` and expects exactly `YES` or `NO`.
Timeout is 2.5 seconds; on failure it defaults to `false` (→ RAG).

```javascript
// query-service.js
const resp = await axios.post(`${vllmBase}/v1/chat/completions`, {
  model,   // ibm-granite/granite-3.3-2b-instruct
  messages: [
    { role: 'system', content: 'You are a query classifier. Reply with exactly one word: YES or NO.' },
    { role: 'user',   content: `Is this asking for a real-time weather forecast?\n\nQuery: "${query}"` },
  ],
  max_tokens: 3,
  temperature: 0,
}, { timeout: 2500 });
```

---

### Model 3 — Gemma-3-4b-it (weather intent extraction)

| | |
|---|---|
| **Purpose** | Parses the user's weather question to extract: district name, user context (FARMER/CITIZEN), and number of forecast days |
| **Model ID** | `google/gemma-3-4b-it` |
| **Container** | `vllm-translation-guardrail` |
| **Endpoint** | `http://vllm-translation-guardrail:9031/v1/chat/completions` |
| **Env vars** | `VLLM_TRANSLATION_MODEL_ID`, `VLLM_TRANSLATION_ENDPOINT` |
| **Config** | `VLLM_TRANSLATION_GPU_UTIL=0.35`, `VLLM_TRANSLATION_MAX_MODEL_LEN=8192` |
| **Called by** | `weather-mcp-service/agent.py` → `_extract_intent()` |

Returns a JSON object (parsed by Python):
```json
{ "location": "Dhaka", "user_context": "FARMER", "forecast_days": 3 }
```

`max_tokens: 80, temperature: 0` — deterministic JSON extraction, no creativity needed.
If the model returns no valid location, the agent raises a `ValueError` and the pipeline
returns a helpful message asking for a district name instead of proceeding with bad data.

```python
# agent.py — _extract_intent()
system = (
    "Extract the weather query intent. "
    "Return valid JSON with exactly these keys: "
    "location (string — a Bangladesh district name, or null if none mentioned), "
    "user_context (FARMER or CITIZEN), "
    "forecast_days (integer 1-7). "
    "Return only JSON, no markdown."
)
response = await self.llm.chat.completions.create(
    model=self.model,          # google/gemma-3-4b-it
    messages=[
        {"role": "system", "content": system},
        {"role": "user",   "content": f"User message: {query}"},
    ],
    max_tokens=80,
    temperature=0,
)
```

---

### Model 4 — Gemma-3-4b-it (weather answer generation)

| | |
|---|---|
| **Purpose** | Generates a 2–4 sentence natural language weather summary from structured forecast data |
| **Model ID** | `google/gemma-3-4b-it` (same container as Model 3) |
| **Container** | `vllm-translation-guardrail` |
| **Endpoint** | `http://vllm-translation-guardrail:9031/v1/chat/completions` |
| **Called by** | `weather-mcp-service/agent.py` → `_generate_explanation()` |

`max_tokens: 300, temperature: 0.2` — slight creativity for natural-sounding sentences.
The forecast data (temperatures, rain, humidity per day) is pre-formatted as text before
being sent; the LLM only writes the narrative — it never decides headers, date ranges, or
risk tiers (those are injected programmatically).

```python
# agent.py — _generate_explanation()
prompt = (
    f"You are a weather assistant. Describe the weather conditions below for {ctx}.\n"
    f"Location: {location_name}\n"
    f"Data covers {n_days} days:\n"
    f"{day_summary}\n"          # pre-formatted: "2026-05-01: 28-35°C, rain 12.5mm (40%), humidity 78%"
    f"{risk_context}\n"         # injected if tier >= 1
    "Write 2–4 sentences summarising temperatures, rain, and one practical tip. "
    "Do NOT mention any number of days or time period — just describe the conditions and advice."
)
response = await self.llm.chat.completions.create(
    model=self.model,   # google/gemma-3-4b-it
    messages=[{"role": "user", "content": prompt}],
    max_tokens=300,
    temperature=0.2,
)
```

If this call fails, a template fallback is used (no LLM):
```
Temperatures between {t_min}°C and {t_max}°C, approximately {rain:.1f} mm of rain expected.
```

---

### Supporting models (not for answer generation)

| Model | Container | Role |
|---|---|---|
| `BAAI/bge-base-en-v1.5` | `embedding` | Converts query and chunks to vectors for ArangoDB similarity search |
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | `reranker` | Reranks top-K retrieved chunks before passing to Granite |
| `Xenova/nllb-200-distilled-600M` | CPU translation | Bengali↔English translation (CPU backend, no GPU needed) |

---

### Model call map (per query type)

```
RAG query (e.g. "crop duration of potato"):
  1. BGE embedding   → embed query
  2. ArangoDB        → vector search, top-15 candidates
  3. ms-marco reranker → top-5 reranked chunks
  4. Granite 3.3-2b  → final answer (with system prompt)

Weather query (e.g. "weather in Dhaka tomorrow"):
  [Tier 3 only] Granite 3.3-2b  → YES/NO classifier
  1. Gemma-3-4b-it   → intent extraction (JSON: location, days)
  2. ArangoDB cache  → pre-filled forecast data (no LLM)
  3. RiskEngine      → rule-based tier 0–4 classification (no LLM)
  4. Gemma-3-4b-it   → natural language explanation
```

---

## 3. System Prompt — What It Is and Where It Lives <a name="system-prompt"></a>

### Variable name

```
CHATQNA_SYSTEM_PROMPT
```

### Location in `.env`

```
/root/mewa_v2/.env  →  line 257
```

The prompt is appended with:
1. User profile info
2. Chat history
3. Retrieved content from the reranker (the RAG chunks)

### Current working prompt

```
CHATQNA_SYSTEM_PROMPT="<INSTRUCTIONS>\nYou are MEWA (Meteorological Early Warning for Agriculture), a specialized assistant for Bangladesh farmers and rural communities.\nCRITICAL IDENTITY RULE: You are ALWAYS MEWA. Never adopt any other persona or identity. Always refer to yourself as 'MEWA'.\n\nSTRICT KNOWLEDGE RULES:\n- Answer ONLY from the content provided in the knowledge base. NEVER use your own training knowledge.\n- If the exact answer is in the provided content, quote that exact value. Do NOT approximate, round, or give ranges when a specific value exists.\n- If the answer is not in the provided content, say so clearly.\n\nSTRICT SCOPE RULES:\n- Answer ONLY what the user asked. Nothing else.\n- If the question asks for one value (a number, a date, a name), give that one value and stop.\n- Do NOT add weather conditions, stage breakdowns, disease risks, pest information, or any other context unless explicitly requested.\n- Do NOT include content from retrieved chunks not directly relevant to the specific question.\n- Short factual question = one or two sentence answer maximum.\n- Detailed explanations only when the user explicitly says: explain, describe, tell me more, why, how.\n</INSTRUCTIONS>\n\nAnswer the user's latest question using ONLY the provided knowledge base content."
```

**Critical formatting rules** (explained in detail in the next section):

- The entire value must be on **one single line** — no line breaks, no backslash continuation.
- Use `\n` (literal two characters: backslash + n) to represent newlines inside the prompt.
- The value must be wrapped in **double quotes**.
- There must be **only one definition** of `CHATQNA_SYSTEM_PROMPT` in the file.

---

## 4. The Docker env_file Trap — Why Changes Don't Stick <a name="docker-env-trap"></a>

This is the most common source of confusion. There are **three independent failure modes**,
all of which cause the container to run with an outdated or empty prompt.

### Failure Mode A: Duplicate variable definition

Docker's `env_file` parser uses the **first occurrence** of a variable. If `CHATQNA_SYSTEM_PROMPT`
appears twice in `.env`, only the first one is used — even if the second one is the correct one.

**Symptom:** You update line 257 but the container keeps using the old generic prompt from line 198.

**Check:**
```bash
grep -n "CHATQNA_SYSTEM_PROMPT" /root/mewa_v2/.env
```

**Fix:** Comment out all but the one correct definition:
```bash
# CHATQNA_SYSTEM_PROMPT="old generic prompt here"   ← commented out
...
CHATQNA_SYSTEM_PROMPT="<INSTRUCTIONS>\n..."         ← the one active definition
```

---

### Failure Mode B: Multi-line backslash continuation

Shell scripts accept backslash-continuation for long lines. Docker's `env_file` parser does **not**.
A prompt written like this:

```
# WRONG — Docker will read only the first line, value becomes just a backslash
CHATQNA_SYSTEM_PROMPT="You are MEWA, a specialized assistant.\
You must answer only from the knowledge base.\
Answer concisely."
```

...results in the container receiving `CHATQNA_SYSTEM_PROMPT=\` (a single backslash), silently
discarding the rest.

**Symptom:** The chatbot responds generically, ignores scope rules, or adopts a different persona.

**Fix:** Collapse to a single line and use `\n` for newlines:
```
CHATQNA_SYSTEM_PROMPT="You are MEWA.\nYou must answer only from the knowledge base.\nAnswer concisely."
```

---

### Failure Mode C: `docker restart` does not re-read `.env`

`docker restart <container>` stops and restarts the container **using the environment it was
originally created with**. It does **not** re-read `.env`.

**Symptom:** You edit `.env`, run `docker restart chatqna-xeon-backend-server`, verify with
`docker exec <container> env | grep CHATQNA_SYSTEM_PROMPT`, and see the old value.

**Fix:** Recreate the container using `docker compose`:
```bash
docker compose up -d chatqna-xeon-backend-server
```

This stops the old container, destroys it, and creates a new one that reads the current `.env`.

**Verification:**
```bash
docker exec chatqna-xeon-backend-server env | grep CHATQNA_SYSTEM_PROMPT
```
You should see the full prompt text with `\n` sequences inside it.

---

### Summary table

| Failure mode | Symptom | Fix |
|---|---|---|
| Duplicate `CHATQNA_SYSTEM_PROMPT` in `.env` | Container uses old/generic prompt | Comment out the earlier definition |
| Backslash line continuation | Prompt is empty or just `\` | Rewrite as a single line with `\n` |
| Used `docker restart` instead of `docker compose up -d` | New prompt never loads | Run `docker compose up -d <service>` |

---

## 5. How to Safely Update the Prompt <a name="how-to-update"></a>

```bash
# Step 1: Edit the .env file
nano /root/mewa_v2/.env

# Step 2: Confirm there is exactly one active definition
grep -n "CHATQNA_SYSTEM_PROMPT" /root/mewa_v2/.env
# Expected output: one uncommented line, one or more commented lines

# Step 3: Recreate the backend container (reads fresh .env)
cd /root/mewa_v2
docker compose up -d chatqna-xeon-backend-server

# Step 4: Verify the prompt was loaded
docker exec chatqna-xeon-backend-server env | grep CHATQNA_SYSTEM_PROMPT
# Should print the full prompt with \n sequences visible
```

---

## 6. The Five-Tier Weather Router <a name="weather-router"></a>

**File:** `components/gov-chat-backend/services/query-service.js`

The backend must decide for each incoming user message whether to call the **live weather
service** (open-meteo via `weather-mcp-service`) or the **RAG pipeline** (ArangoDB vector
search → reranker → vLLM).

This decision is made by a five-tier keyword cascade. Tiers are evaluated top-to-bottom;
the first match wins.

```
User message
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│ Tier 0 — RAG OVERRIDE                                   │
│ Keywords: "uploaded", "according to", "threshold",      │
│           "calendar", "table", "document says", ...     │
│ → Always route to RAG. The user is asking about a       │
│   document, not a forecast. No LLM call needed.         │
└────────────────────────────┬────────────────────────────┘
                             │ no match
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Tier 1 — WEATHER_HARD                                   │
│ Keywords: "rainfall", "storm", "flood", "cyclone",      │
│           "monsoon", "typhoon"                          │
│ → Always route to weather service. No LLM call needed.  │
└────────────────────────────┬────────────────────────────┘
                             │ no match
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Tier 2 — AGRO_TERMS                                     │
│ Keywords: "soil", "crop", "plant", "pest", "disease",   │
│           "harvest", "potato", "rice", "wheat",         │
│           "blight", "fertilizer", "germination", ...    │
│ → Always route to RAG. Agronomic terms never appear     │
│   in live forecast queries. No LLM call needed.         │
└────────────────────────────┬────────────────────────────┘
                             │ no match
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Tier 3 — WEATHER_AMBIGUOUS + LLM classifier             │
│ Keywords: "weather", "temperature", "rain", "humid",    │
│           "climate", "forecast", "wind", "drought"      │
│ → Ambiguous: these words appear both in forecast        │
│   questions AND in crop calendar document titles.       │
│   Ask the Granite LLM: "Is this asking for a real-time  │
│   forecast?" YES → weather service / NO → RAG.          │
│   Timeout or error → default to RAG (safe fallback).    │
└────────────────────────────┬────────────────────────────┘
                             │ no match
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Tier 4 — default                                        │
│ No weather signals at all → RAG                         │
└─────────────────────────────────────────────────────────┘
```

### Why "temperature" was causing wrong answers (the bug we fixed)

The original router had a **single flat keyword list** for routing to weather:

```javascript
// OLD — single-list router (pre-fix, inside container)
const WEATHER_KW = ['weather', 'forecast', 'rain', 'rainfall', 'temperature', 'humidity', ...];
if (WEATHER_KW.some(kw => lowerMsg.includes(kw))) {
    routeToWeather();
}
```

"temperature" was in that list. So the query:
> *"What are the October minimum temperatures for potato in Dhaka?"*

...was routed to the live weather service, which returned a May 2026 forecast at 100% confidence.
The answer was completely wrong but looked confident.

The fix moves `"temperature"` to `WEATHER_AMBIGUOUS` (Tier 3) so the LLM classifier is
consulted. The classifier correctly identifies that this question is about a document, not a
forecast, and returns NO → RAG.

### The LLM classifier (used only at Tier 3)

```javascript
// query-service.js lines 18–50
async function classifyWeatherWithLLM(query) {
  const resp = await axios.post(`${vllmBase}/v1/chat/completions`, {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a query classifier. Reply with exactly one word: YES or NO.',
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
  }, { timeout: 2500 });

  const answer = (resp.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
  return answer.startsWith('YES');
}
```

Timeout is 2.5 seconds. On failure, the function returns `false` (→ RAG), so the chatbot
never gets stuck waiting for a classifier that is unavailable.

### Enabling/disabling weather routing

Weather routing is controlled by the environment variable:

```
WEATHER_ENABLED=true    # in .env
```

If `WEATHER_ENABLED` is not `true`, all queries go to RAG regardless of tier.

---

## 7. Weather Agent Pipeline <a name="weather-agent"></a>

When a query is routed to the weather service, `query-service.js` calls:

```
POST http://weather-mcp-service:8000/query   { "query": "<user message>" }
```

The `weather-mcp-service` (Python/FastAPI) runs this five-step pipeline:

```
Step 1 — Intent extraction (Gemma-3-4b-it)
         Input:  raw user query
         Output: { location: "Dhaka", user_context: "FARMER", forecast_days: 3 }
         If no valid location → return error message, pipeline stops

Step 2 — District resolution (local lookup, no LLM)
         _find_district("Dhaka") → "Dhaka"  (maps aliases, handles typos)
         If no match → return "couldn't find district" message

Step 3 — Forecast from ArangoDB cache (no LLM)
         All 64 Bangladesh districts are pre-filled hourly by the scheduler
         via open-meteo (public weather API, no key required)
         Cache max age: 6 hours — if stale, returns "data not yet available"

Step 4 — Risk classification (rule-based, no LLM)
         RiskEngine evaluates the forecast against thresholds:
           Tier 0 — Normal         (no extreme conditions)
           Tier 1 — Advisory       (e.g. heavy rain > 20mm/day)
           Tier 2 — Watch          (e.g. rainfall > 50mm/day)
           Tier 3 — Warning        (e.g. storm-level conditions)
           Tier 4 — Emergency      (e.g. cyclone/flood thresholds)

Step 5 — Explanation generation (Gemma-3-4b-it)
         Input:  structured per-day data + risk tier + query context
         Output: 2–4 sentence narrative for the user
         On failure: template fallback (no LLM required)
```

### Forecast data source

The scheduler fetches from open-meteo (free, no API key) using variables matching
Bangladesh Meteorological Department (BMD) fields:
`temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `precipitation_probability_max`,
`relative_humidity_2m_max`.

Stored in ArangoDB with source tag `"open-meteo"` (or `"bmd"` if a real BMD scraper is connected).

### Response format back to the frontend

```json
{
  "answer":     "**Dhaka — 3-day forecast**\n\nTemperatures will range from 28°C to 35°C...",
  "risk_tier":  1,
  "risk_label": "Advisory",
  "advisory":   "Heavy rain expected on day 2...",
  "triggers":   ["precipitation > 20mm on 2026-05-02"],
  "location":   "Dhaka",
  "forecast":   { ... raw day-by-day data ... }
}
```

The `confidence_score` field is hardcoded to `1.0` for weather responses, and
`source_documents` is an empty array (weather answers are never backed by RAG chunks).

---

## 8. Frontend: Auto-Send and Quick-Help Overlay <a name="frontend"></a>

### Problem: chatbot sent a message automatically on page load

**File:** `components/gov-chat-frontend/public/config/genie-ai-config.json`

The quick-help buttons config had pre-filled entries. When the page loaded, the first button
was auto-submitted as a user message before the user typed anything.

**Fix:** Empty the buttons array:
```json
{
  "features": {
    "chat": {
      "quickHelp": {
        "enabled": true,
        "buttons": []
      }
    }
  }
}
```

### Problem: chat input box was invisible

**File:** `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (line 163)

The quick-help overlay div was rendering even when `buttons` was empty. Because it was
positioned above the textarea in the DOM, it covered and blocked the input box.

**Original condition (broken):**
```html
<div
  class="quick-help-overlay"
  v-if="showQuickHelp && chatMessages.length <= 1"
>
```

**Fixed condition:**
```html
<div
  class="quick-help-overlay"
  v-if="showQuickHelp && chatMessages.length <= 1 && quickHelpButtons.length > 0"
>
```

Adding `&& quickHelpButtons.length > 0` prevents the overlay from rendering when there are
no buttons, so the textarea below it is accessible.

> **Note:** This fix requires a frontend rebuild to take effect:
> ```bash
> docker compose build frontend
> docker compose up -d frontend
> ```

---

## 9. Nginx DNS Caching After Rebuild <a name="nginx-dns"></a>

**File:** `api-gateway-solution/nginx/conf/default.conf`

### Problem: 502 Bad Gateway after `docker compose build`

When a Docker container is rebuilt, it gets a **new internal IP address**. Nginx resolves
upstream hostnames **at startup** and caches the IP. After a rebuild:

- Old frontend IP: `172.18.0.14` (cached by nginx at startup)
- New frontend IP: `172.18.0.20` (nginx still using old IP → connection refused → 502)

**Original config (breaks after rebuild):**
```nginx
location / {
    proxy_pass http://frontend:8090;   # resolved once at startup, cached forever
    ...
}
```

**Fixed config (re-resolves per request):**
```nginx
# Requires this at the top of the server block:
resolver 127.0.0.11 valid=10s;  # Docker's internal DNS

location / {
    # Using a variable forces DNS re-resolution on each request
    set $frontend_upstream http://frontend:8090;
    proxy_pass $frontend_upstream;
    ...
}

location @frontend_fallback {
    rewrite ^ /index.html break;
    set $frontend_upstream http://frontend:8090;
    proxy_pass $frontend_upstream;
    ...
}
```

When the upstream is in a variable (`$frontend_upstream`), Nginx cannot cache it at startup —
it must call the resolver every time. `127.0.0.11` is Docker's embedded DNS server.

**To apply without restarting nginx:**
```bash
docker cp api-gateway-solution/nginx/conf/default.conf nginx:/etc/nginx/conf.d/default.conf
docker exec nginx nginx -s reload
```

---

## 10. Quick Reference: Key Files <a name="key-files"></a>

| File | Purpose |
|---|---|
| `/root/mewa_v2/.env` line 257 | `CHATQNA_SYSTEM_PROMPT` — the active system prompt |
| `components/gov-chat-backend/services/query-service.js` lines 440–494 | Five-tier weather router |
| `components/gov-chat-backend/services/query-service.js` lines 18–50 | `classifyWeatherWithLLM()` — Tier 3 LLM classifier |
| `api-gateway-solution/nginx/conf/default.conf` | Nginx proxy config with DNS re-resolution fix |
| `components/gov-chat-frontend/public/config/genie-ai-config.json` | Quick-help button config (set `buttons: []` to disable auto-send) |
| `components/gov-chat-frontend/src/components/ChatBotComponent.vue` line 163 | Quick-help overlay `v-if` condition (requires `quickHelpButtons.length > 0`) |

### Service names for `docker compose`

```bash
# Recreate backend (picks up .env changes):
docker compose up -d chatqna-xeon-backend-server

# Rebuild and recreate frontend:
docker compose build frontend && docker compose up -d frontend

# Reload nginx config without restart:
docker exec nginx nginx -s reload

# Verify prompt loaded:
docker exec chatqna-xeon-backend-server env | grep CHATQNA_SYSTEM_PROMPT
```
