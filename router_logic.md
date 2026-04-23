# Query Router Logic

## Overview

Every incoming message passes through a routing decision in
`components/gov-chat-backend/services/query-service.js` (`createQuery` method)
before reaching any AI backend. The router runs entirely in the Node.js backend —
there is no LLM call, no embedding lookup, and no semantic similarity check at
this stage. It is a fast, deterministic gate.

---

## Routing branches (in priority order)

```
Incoming message
       │
       ▼
  CONTEXT_OPTION=test-mode? ──yes──▶  mock response (no AI call)
       │
       ▼ no
  isWeatherQuery? ──yes──▶  weather-mcp-service /query
       │                     (Gemini intent → Mapbox geocode → BMD forecast → Gemini answer)
       ▼ no
  TOOLS_ENABLED=true
  AND tools registered? ──yes──▶  vLLM tool orchestration loop
       │
       ▼ no
  OPEA ChatQnA (RAG pipeline)
       embedding → retriever → reranker → vLLM
```

The first matching branch wins. Lower branches are never reached.

---

## Weather routing in detail

### The problem with a flat keyword list

The original implementation matched any of these words anywhere in the message:

```
weather, forecast, rain, rainfall, temperature, humid,
storm, flood, cyclone, monsoon, climate
```

This caused knowledge-base queries like:

> *"What is the minimum temperature for wheat listed under Favorable Weather
> Conditions in the Crop Weather Calendar?"*

to be routed to the live weather forecast service, because `temperature` appeared
in the message. The RAG pipeline (and all the crop calendar documents in ArangoDB)
was completely bypassed.

### The fix: two-condition gate

Weather routing now requires **either**:

1. An **unambiguous weather-event term** — words that almost always signal a
   live forecast request regardless of context, **OR**
2. A **measurable weather parameter** combined with a **temporal / forecast signal**
   — the user must be asking about a future state, not a static fact.

```js
const WEATHER_VARS        = ['weather', 'rainfall', 'storm', 'flood', 'cyclone', 'monsoon'];
const WEATHER_MEASURABLES = ['temperature', 'rain', 'humid', 'climate', 'forecast'];
const TEMPORAL_SIGNALS    = ['next', 'tomorrow', 'today', 'tonight', 'this week',
                             'this month', 'will it', 'going to', 'expected', 'predicted'];

const lowerMsg            = lastUserMsg.toLowerCase();
const hasWeatherVar       = WEATHER_VARS.some(kw => lowerMsg.includes(kw));
const hasWeatherMeasurable = WEATHER_MEASURABLES.some(kw => lowerMsg.includes(kw));
const hasTemporal         = TEMPORAL_SIGNALS.some(kw => lowerMsg.includes(kw));

const isWeatherQuery      = weatherEnabled && (hasWeatherVar || (hasWeatherMeasurable && hasTemporal));
```

### Classification examples

| User message | hasWeatherVar | hasMeasurable | hasTemporal | Routed to |
|---|---|---|---|---|
| "What is the weather next week?" | ✅ `weather` | — | — | **Weather MCP** |
| "Will it rain tomorrow in Dhaka?" | — | ✅ `rain` | ✅ `tomorrow` | **Weather MCP** |
| "Cyclone forecast for Barishal" | ✅ `cyclone` | — | — | **Weather MCP** |
| "Expected rainfall this month in Sylhet?" | ✅ `rainfall` | — | ✅ `this month` | **Weather MCP** |
| "What is the minimum temperature for wheat?" | — | ✅ `temperature` | ❌ none | **RAG pipeline** |
| "Temperature threshold for boro rice germination" | — | ✅ `temperature` | ❌ none | **RAG pipeline** |
| "Favorable weather conditions for jute cultivation" | ✅ `weather` | — | — | **Weather MCP** ⚠️ |
| "Humid conditions required for mushroom farming" | — | ✅ `humid` | ❌ none | **RAG pipeline** |

> **Note on the ⚠️ row**: "favorable weather conditions for jute" contains the word
> `weather` (a `WEATHER_VARS` term), so it currently routes to the weather service.
> This is an edge case — if it becomes a problem, `weather` can be moved to
> `WEATHER_MEASURABLES` so it also requires a temporal signal.

---

## How `categoryLabel` fits in

`categoryLabel` is sent by the frontend as part of `queryData.context`. It plays
**no role in the routing decision**. It is used downstream only:

| Where | What it does |
|---|---|
| ArangoDB lookup (line ~307) | Resolved to `categoryId` for query analytics storage |
| OPEA ChatQnA payload (line ~502) | Forwarded as `context.categoryLabel` to scope the ArangoDB vector search — only documents tagged with that label are retrieved |
| Test-mode mock (line ~114) | Selects mock response text for that category |

In the RAG pipeline, `categoryLabel` is the **primary filter on retrieved documents**.
The retriever uses it to restrict the ArangoDB ANN search to documents whose
metadata label matches (via `ARANGO_FILTER_STRATEGY=OR`). So a query with
`categoryLabel: "Crop Calendar"` will only retrieve chunks from crop calendar
documents, regardless of what other documents exist in the knowledge base.

---

## Environment variables that control routing

| Variable | Effect |
|---|---|
| `WEATHER_ENABLED=true` | Enables the weather branch. If `false`, all queries go to tools or OPEA. |
| `WEATHER_MCP_URL` | Base URL of the Python weather-mcp-service (default `http://localhost:8000`) |
| `TOOLS_ENABLED=true` | Enables the vLLM tool orchestration branch for non-weather queries |
| `CONTEXT_OPTION=test-mode` | Bypasses all AI calls, returns mock responses |
| `OPEA_HOST` / `OPEA_PORT` | Address of the OPEA ChatQnA megaservice (default port 8888) |

---

## Logging

The router emits a single INFO log line for every request showing the three
boolean flags and the final decision:

```
[WEATHER] routing check — hasWeatherVar=false hasWeatherMeasurable=true hasTemporal=false → isWeatherQuery=false
```

This makes it straightforward to diagnose misrouted queries in the backend logs
without enabling debug-level verbosity.
