# MCP Weather Forecast — Full Implementation Guide

This document explains how weather forecasting is implemented in MEWA, from the Python
weather service (BMD scraping + MCP tools) to backend routing and chatbot responses.
It also documents the OPEA port `9000` compatibility limits for OpenAI-style tool calling.

---

## Table of Contents

- [Concept: MCP Tool Calling](#1-concept-mcp-tool-calling)
- [Architecture Overview](#2-architecture-overview)
- [OPEA Port 9000 Limitations](#3-opea-port-9000-limitations)
- [Component Map](#4-component-map)
- [Python Service: `weather-mcp-service`](#5-python-service-weather-mcp-service)
- [Node.js Backend: Keyword Router and Tool Infrastructure](#6-nodejs-backend-keyword-router-and-tool-infrastructure)
- [Backend Integration](#7-backend-integration)
- [Environment Variables Reference](#8-environment-variables-reference)
- [Running the Full Stack](#9-running-the-full-stack)
- [Testing the Integration](#10-testing-the-integration)
- [Adding a New MCP Tool](#11-adding-a-new-mcp-tool)
- [Troubleshooting](#12-troubleshooting)

---

## 1. Concept: MCP Tool Calling

**MCP (Model Context Protocol)** is a standard for exposing callable functions to LLMs.
Instead of the LLM guessing an answer, it can request data from external services at runtime.

**OpenAI-style tool calling** (which standard vLLM supports) works like this:

```
You → LLM: "What is the weather in Pabna?"
         + here are the tools you can call: [retrieve_weather_forecast]

LLM → You: finish_reason = "tool_calls"
            tool_call: retrieve_weather_forecast({ district_name: "Pabna", forecast_days: 3 })

You → Tool: execute retrieve_weather_forecast({ district_name: "Pabna", forecast_days: 3 })
      Tool → You: { location: "Pabna", forecast: [ {temperature: {min:22, max:31}, ...} ] }

You → LLM: here is the tool result: <json>
LLM → You: finish_reason = "stop"
            "Tomorrow in Pabna expect 22–31°C with 3.2mm of rain..."
```

**MCP specifically** defines a standard wire protocol for exposing these tools as subprocess
servers (stdio transport) or HTTP servers. This codebase uses both:
- The Python weather tools run as **stdio subprocesses** (MCP stdio protocol, inside the container)
- The Node.js backend calls the Python service over **HTTP** (simpler, no MCP SDK in Node)

> **Important**: In the current implementation, the Node.js backend does **not** use
> the OpenAI tool-calling loop. Instead it detects weather keywords and routes directly to
> the Python `/query` endpoint, which runs its own internal pipeline using Gemini + MCP.
> See [Section 3](#3-opea-port-9000-limitations) for details.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser / Frontend (Vue, port 8090)                                        │
│    User types: "What is the weather in Dhaka next 3 days?"                 │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  POST /api/queries  { messages: [...] }
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  gov-chat-backend (Node.js, port 3000) — query-service.js                   │
│                                                                             │
│  WEATHER_ENABLED=true AND message contains weather keyword?                 │
│    YES → POST http://localhost:8000/query { query: "..." }                  │
│    NO  → OPEA ChatQnA worker thread (RAG pipeline, port 8888)               │
│                                                                             │
│  Note: TOOLS_ENABLED / vLLM tool-calling loop is present in code           │
│  but CANNOT be used — port 9000 is an OPEA wrapper, not raw vLLM           │
│  (see Section 3 for full explanation)                                       │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  POST /query { query: "..." }
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  weather-mcp-service (Python/FastAPI, port 8000)                            │
│                                                                             │
│  agent.py → WeatherAgent.run("What is the weather in Dhaka?")              │
│    Step 1: Gemini flash-lite — extract intent                               │
│            { location: "Dhaka", user_context: "CITIZEN", forecast_days: 3 }│
│    Step 2: Mapbox MCP geocode "Dhaka" → lat/lon + district                 │
│            (falls back to direct district lookup if Mapbox fails)           │
│    Step 3: Buffer point around coordinates (skipped on Mapbox fallback)     │
│    Step 4: BMD BAMIS scraper — https://www.bamis.gov.bd/en/bmd/wrf/...     │
│            → { temperature: {min:24, max:33}, rain: 2.1mm, humidity: 74% } │
│    Step 5: Gemini flash — compose plain-English explanation                 │
│    Returns: { answer: "...", location: "Dhaka", forecast: {...} }           │
└──────────────────────────────┬──────────────────────────────────────────────┘
                        ┌──────┴───────┐
                        │ stdio (MCP)  │
                        ▼             ▼
             Mapbox MCP server    mcp_weather/main.py
             (npx @mapbox/        (FastMCP stdio server)
              mcp-server)         buffer_point
             geocodes locations   retrieve_weather_forecast
```

**Data flow back to frontend:**

```
weather-mcp-service → { answer, location, forecast }
    ↓
query-service.js: opeaResponseContent = wResp.data.answer
    ↓
POST /api/queries response: { queryId, response: "answer text", metadata: {...} }
    ↓
ChatBotComponent.vue: result.response → displayed in chat bubble
```

---

## 3. OPEA Port 9000 Limitations

`TOOLS_ENABLED=true` with OpenAI-style autonomous tool calling (`tool_choice: "auto"`) does not
work against OPEA port `9000`. The endpoint is an OPEA-wrapped LLM microservice with a custom
schema, not a raw vLLM OpenAI-compatible endpoint.

### 3.1 OPEA Service Model

OPEA (Open Platform for Enterprise AI) is a microservice framework from Intel for building
RAG pipelines. It works by chaining "megaservices" and "microservices" together, each running
in its own container, connected through a dataplane orchestrator.

```
┌──────────────────────────────────────────────────────────────────┐
│  OPEA ChatQnA stack at 91.203.132.198                            │
│                                                                  │
│  Port 8888  — ChatQnA Megaservice (nginx/Kong gateway)           │
│               Orchestrates the full RAG pipeline:                │
│               1. Embedding microservice (query → vector)         │
│               2. Retriever microservice (vector → documents)     │
│               3. Reranker microservice (re-rank retrieved docs)  │
│               4. LLM microservice (docs + query → answer)        │
│                                                                  │
│  Port 9000  — LLM Microservice (internal component)             │
│               Wraps the underlying model (ibm-granite/           │
│               granite-3.3-2b-instruct) with OPEA's own          │
│               request/response schema. NOT a public API.         │
│                                                                  │
│  Port 7000  — Embedding Microservice                             │
│  Port 7025  — Retriever Microservice                             │
│  Port 8808  — Reranker Microservice (if enabled)                 │
└──────────────────────────────────────────────────────────────────┘
```

Port 9000 is designed to be called **internally by the megaservice orchestrator**, not by
external clients. OPEA exposes it externally only for debugging. It validates requests
against a union of three internal schemas, and does not implement the full OpenAI
`tool_choice: "auto"` behaviour.

### 3.2 Validation Error Breakdown

When we sent a standard OpenAI tool-calling request to port 9000:

```bash
curl http://91.203.132.198:9000/v1/chat/completions \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "model": "ibm-granite/granite-3.3-2b-instruct",
    "messages": [{"role": "user", "content": "What is the weather in Dhaka?"}],
    "tools": [{ "type": "function", "function": { "name": "retrieve_weather_forecast", ... } }],
    "tool_choice": "auto",
    "max_tokens": 200
  }'
```

The response was a validation error with four distinct failures:

```json
{"detail": [
  {
    "type": "missing",
    "loc": ["body", "LLMParamsDoc", "query"],
    "msg": "Field required"
  },
  {
    "type": "literal_error",
    "loc": ["body", "ChatCompletionRequest", "tool_choice", "literal['none']"],
    "msg": "Input should be 'none'"
  },
  {
    "type": "model_attributes_type",
    "loc": ["body", "ChatCompletionRequest", "tool_choice", "ChatCompletionNamedToolChoiceParam"],
    "msg": "Input should be a valid dictionary or object"
  },
  {
    "type": "missing",
    "loc": ["body", "SearchedDoc", "retrieved_docs"],
    "msg": "Field required"
  }
]}
```

What this error indicates:

OPEA port 9000 uses a Pydantic **union validator** — it tries to parse the request body
against three different schemas simultaneously and reports a failure for each one that
doesn't match:

| Schema | What it is | Why it failed |
|--------|------------|---------------|
| `LLMParamsDoc` | OPEA's custom plain-LLM format | Missing required field `query` (string) |
| `ChatCompletionRequest` | OPEA's partial OpenAI implementation | `tool_choice` must be literal `'none'` or a named tool object — not `"auto"` |
| `SearchedDoc` | OPEA's RAG handoff format | Missing `retrieved_docs` and `initial_query` fields |

The critical line is `"literal['none']"` — OPEA's `ChatCompletionRequest` only permits
`tool_choice: "none"` (disable tools) or `tool_choice: { type: "function", function: { name: "..." } }`
(force a specific named tool). The value `"auto"` — which tells the LLM to decide itself
whether to call a tool — is simply not in the validator.

### 3.3 OPEA Internal Request Schema

OPEA defines its own Pydantic models in `comps/llms/src/` of the GenAIComps repository.
These are the three schema types the union validator tries:

```python
# From OPEA GenAIComps — comps/llms/src/text-generation/llm.py (simplified)

from typing import Literal, Union
from pydantic import BaseModel

# Schema 1: LLMParamsDoc — simple single-string query (used by embedding/retriever internally)
class LLMParamsDoc(BaseModel):
    query: str                        # required — our request has no "query" field
    max_new_tokens: int = 1024
    top_k: int = 10
    top_p: float = 0.95
    temperature: float = 0.01
    # ... other generation params

# Schema 2: ChatCompletionRequest — partial OpenAI compatibility
class ChatCompletionRequest(BaseModel):
    model: str
    messages: list
    stream: bool = False
    # Tool calling — ONLY none or a named tool; "auto" is NOT accepted
    tool_choice: Union[Literal["none"], ChatCompletionNamedToolChoiceParam] = "none"
    tools: list | None = None
    # ... other standard fields

# Schema 3: SearchedDoc — internal RAG handoff from retriever to LLM
class SearchedDoc(BaseModel):
    retrieved_docs: list[TextDoc]     # required — chunks from the retriever
    initial_query: str                # required — original user question
    top_n: int = 1

# The endpoint accepts any of the three:
@router.post("/v1/chat/completions")
async def llm_generate(input: Union[LLMParamsDoc, ChatCompletionRequest, SearchedDoc]):
    ...
```

When `"auto"` is passed as `tool_choice`, it fails all three schemas because:
- `LLMParamsDoc` has no `tool_choice` field but lacks `query`
- `ChatCompletionRequest` has `tool_choice` but only allows `Literal["none"]`
- `SearchedDoc` has no `tool_choice` field and lacks `retrieved_docs`

The simple `POST` without tools **did** work (first test returned a chat completion) because
the request with just `model`, `messages`, and `max_tokens` successfully matched
`ChatCompletionRequest` with `tool_choice` defaulting to `"none"`.

### 3.4 ChatQnA Megaservice at Port 8888

Port 8888 is what the Node.js backend actually uses. It is the **megaservice gateway** that
orchestrates the complete RAG pipeline. When a query arrives:

```
POST http://91.203.132.198:8888/v1/chatqna
{
  "messages": "What government services exist for small businesses?",
  "stream": false
}

                    ┌─────────────────────────────────┐
                    │  ChatQnA Megaservice (port 8888) │
                    │                                  │
                    │  1. Embedding (port 7000)         │
                    │     query → 768-dim vector       │
                    │                                  │
                    │  2. Retriever (port 7025)         │
                    │     vector → top-5 ArangoDB docs │
                    │                                  │
                    │  3. LLM (port 9000)              │
                    │     SearchedDoc {                │
                    │       retrieved_docs: [...],     │
                    │       initial_query: "..."       │
                    │     }                            │
                    │     → answer text                │
                    └─────────────────────────────────┘

Response:
{
  "text": "The government offers the following services...",
  "retrieved_docs": [...],
  "initial_query": "..."
}
```

OPEA calls port 9000 **internally**, sending `SearchedDoc` (retrieved chunks + query), not
the user's raw message. The LLM never sees the conversation in OpenAI format — it sees the
OPEA-internal `SearchedDoc` schema with pre-retrieved context injected.

This is why the RAG system answers with "the provided content does not include weather
forecasts" — the retriever found no weather documents in ArangoDB, sent an empty
`retrieved_docs` list to the LLM, and the LLM correctly reported it had no data.

### 3.5 Example: Raw Tool-Capable vLLM

A standard vLLM deployment (without OPEA wrapping) exposes the bare OpenAI API:

```bash
# Standard vLLM — this would work for tool calling
vllm serve ibm-granite/granite-3.3-2b-instruct \
  --host 0.0.0.0 --port 9000 \
  --enable-auto-tool-choice \
  --tool-call-parser granite

# Then this request would work:
curl http://vllm-host:9000/v1/chat/completions \
  -d '{"model": "ibm-granite/granite-3.3-2b-instruct",
       "messages": [...],
       "tools": [...],
       "tool_choice": "auto"}'
# → { "choices": [{ "finish_reason": "tool_calls", "message": { "tool_calls": [...] } }] }
```

The OPEA LLM microservice at port 9000 wraps this binary with its own FastAPI application,
stripping out the standard tool-calling path and replacing the schema with its internal
union type. To use vLLM tool calling with this infrastructure you would need to either
run a separate raw vLLM instance, or bypass the OPEA wrapper and call the underlying
model server directly.

Routing outcome summary:

| Approach | Status | Reason |
|----------|--------|--------|
| `tool_choice: "auto"` to port 9000 | **Fails** | OPEA schema rejects it |
| `tool_choice: "none"` to port 9000 | Works but useless | LLM answers from training, no tool called |
| Keyword router → Python `/query` | **Working** | Detects weather intent, calls full pipeline |
| Separate raw vLLM instance | Would work | Requires additional infrastructure |

---

## 4. Component Map

| File | Language | Role |
|------|----------|------|
| `components/weather-mcp-service/main.py` | Python | FastAPI app — `/health`, `/query` (agent pipeline), `/mcp/tools/call` |
| `components/weather-mcp-service/agent.py` | Python | WeatherAgent — Gemini intent → Mapbox geocode (with fallback) → BMD → Gemini explanation |
| `components/weather-mcp-service/mcp_client.py` | Python | MCPClientManager — launches Mapbox + weather stdio sessions; handles empty geocoding responses |
| `components/weather-mcp-service/mcp_weather/main.py` | Python | FastMCP stdio server — `buffer_point` and `retrieve_weather_forecast` tools |
| `components/weather-mcp-service/mcp_weather/tools/weather_forecast.py` | Python | BMD BAMIS scraper — browser headers required (fixes 406); Bengali→English district mapping |
| `components/weather-mcp-service/mcp_weather/tools/buffer_point.py` | Python | Geodesic buffer polygon using pyproj WGS84 |
| `components/weather-mcp-service/requirements.txt` | — | Python dependencies |
| `components/weather-mcp-service/Dockerfile` | — | Python 3.11 + Node.js 20 image |
| `components/gov-chat-backend/services/tool-registry.js` | Node.js | Singleton Map of tool name → definition + handler |
| `components/gov-chat-backend/services/tool-orchestrator.js` | Node.js | Multi-round vLLM tool-calling loop (implemented but unused — see Section 3) |
| `components/gov-chat-backend/tools/weather-mcp-bridge.js` | Node.js | OpenAI tool definition + HTTP handler for the weather service |
| `components/gov-chat-backend/index.js` | Node.js | Registers weather tool on startup |
| `components/gov-chat-backend/services/query-service.js` | Node.js | Keyword router: weather queries → Python service; everything else → OPEA |

---

## 5. Python Service: weather-mcp-service

### 5.1 Directory Structure

```
components/weather-mcp-service/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── main.py                     # FastAPI app — HTTP API entry-point
├── agent.py                    # WeatherAgent (Gemini + MCP pipeline, Mapbox fallback)
├── mcp_client.py               # MCPClientManager (Mapbox + weather stdio, empty-response guard)
└── mcp_weather/
    ├── __init__.py
    ├── main.py                 # FastMCP stdio server
    └── tools/
        ├── __init__.py
        ├── buffer_point.py     # Geodesic buffer (pyproj WGS84)
        └── weather_forecast.py # BMD BAMIS scraper (browser headers for 406 fix)
```

### 5.2 requirements.txt

```
fastapi==0.110.0
uvicorn==0.29.0
google-genai==0.8.0
mcp>=1.0.0
shapely==2.0.3
pyproj==3.6.1
geojson==3.1.0
requests==2.31.0
beautifulsoup4==4.12.3
python-multipart==0.0.6
pydantic>=2.11.0
```

### 5.3 Dockerfile

```dockerfile
FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y \
    build-essential libgeos-dev libproj-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 required for Mapbox MCP Server (npx @mapbox/mcp-server)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs
RUN npm install -g @mapbox/mcp-server@latest --network-timeout=600000

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
    CMD python -c "import requests; exit(0) if requests.get('http://localhost:8000/health', timeout=5).status_code == 200 else exit(1)"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

> **Why Node.js inside a Python image?** The Mapbox MCP server is an npm package
> (`@mapbox/mcp-server`). `MCPClientManager` launches it as a subprocess via `npx`.
> Both runtimes must be present in the container.

### 5.4 main.py — FastAPI Entry-Point

Two sets of routes. The Node.js backend uses `/query` (keyword-routing path) and
`/mcp/tools/call` (direct scraper, used when `TOOLS_ENABLED=true` with a proper vLLM).

```python
# main.py
from fastapi import FastAPI, Request
from mcp_client import MCPClientManager
from agent import WeatherAgent
from mcp_weather.tools.weather_forecast import fetch_forecast_logic

mcp_manager = None
weather_agent = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_manager, weather_agent
    try:
        mcp_manager = MCPClientManager()
        await mcp_manager.start()        # starts Mapbox + weather stdio subprocesses
        weather_agent = WeatherAgent(mcp_manager)
    except Exception as exc:
        print(f"[STARTUP] Failed to initialize MCP sessions: {exc}")
        mcp_manager = None
        weather_agent = None
    yield
    if mcp_manager:
        await mcp_manager.stop()

app = FastAPI(title="Weather MCP Service", lifespan=lifespan)

# ── Agent route — called by Node.js keyword router ──────────────────────────

@app.get("/health")
async def health():
    if weather_agent is None:
        return JSONResponse(status_code=503, content={"status": "unhealthy"})
    return {"status": "healthy"}

@app.post("/query")
async def query(request: QueryRequest):
    """Natural-language weather query → full Gemini+BMD pipeline."""
    result = await weather_agent.run(request.query)
    return result

# ── MCP HTTP routes — used when TOOLS_ENABLED=true with a real vLLM ─────────

@app.post("/mcp/tools/list")
async def mcp_tools_list():
    return {"tools": [TOOL_DEFINITION]}

@app.post("/mcp/tools/call")
async def mcp_tools_call(request: Request):
    """Direct scraper call — bypasses Gemini, just fetches BMD data."""
    body = await request.json()
    name = body.get("name")
    args = body.get("arguments", {})

    if name == "retrieve_weather_forecast":
        result_str = fetch_forecast_logic(
            district_name=args.get("district_name", ""),
            forecast_days=args.get("forecast_days", 3),
            parameters=args.get("parameters", [])
        )
        return {"content": [{"type": "text", "text": result_str}]}

    return {"error": {"code": "unknown_tool", "message": f"Tool '{name}' not found"}}
```

### 5.5 mcp_client.py — MCPClientManager

Manages two stdio MCP subprocess sessions. Key fix: the geocoding call now handles empty
responses gracefully instead of crashing with `JSONDecodeError`.

```python
# mcp_client.py

class MCPClientManager:
    async def start(self):
        """Launch Mapbox and weather MCP subprocesses."""
        mapbox_token = os.getenv("MAPBOX_ACCESS_TOKEN", "")

        mapbox_params = StdioServerParameters(
            command="npx",
            args=["-y", "@mapbox/mcp-server"],
            env={**os.environ, "MAPBOX_ACCESS_TOKEN": mapbox_token}
        )
        weather_params = StdioServerParameters(
            command="python",
            args=["-m", "mcp_weather.main"]
        )

        for key, params in [("mapbox", mapbox_params), ("weather", weather_params)]:
            stdio_transport = await self._exit_stack.enter_async_context(stdio_client(params))
            read, write = stdio_transport
            session = await self._exit_stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            self._sessions[key] = session

    async def geocode_location(self, location_name: str) -> dict:
        """Geocode a place name using the Mapbox MCP server."""
        session = self._sessions["mapbox"]
        result = await session.call_tool(
            "mapbox_geocoding_forward",
            {"q": location_name, "limit": 1, "country": "BD"}
        )

        # ── Fix: guard against empty response (invalid/missing MAPBOX_ACCESS_TOKEN) ──
        raw_text = result.content[0].text if result.content else ""
        if not raw_text.strip():
            raise ValueError(
                f"Empty geocoding response for '{location_name}' — check MAPBOX_ACCESS_TOKEN"
            )

        data = json.loads(raw_text)
        features = data.get("features", [])
        if not features:
            raise ValueError(f"No features returned for '{location_name}'")

        feature = features[0]
        coords = feature.get("geometry", {}).get("coordinates", [0, 0])
        district = self._extract_district_from_mapbox(feature)
        return {
            "longitude": coords[0],
            "latitude": coords[1],
            "district": district,
            "display_name": feature.get("properties", {}).get("full_address", location_name)
        }

    def _extract_district_from_mapbox(self, feature: dict) -> str:
        context = feature.get("properties", {}).get("context", {})
        district_info = context.get("district")
        if isinstance(district_info, dict):
            return district_info.get("name", "Unknown")
        if feature.get("properties", {}).get("feature_type") == "district":
            return feature["properties"].get("name", "Unknown")
        full_address = feature.get("properties", {}).get("full_address", "")
        return full_address.split(",")[0].strip() or "Unknown"

    async def call_weather_tool(self, tool_name: str, args: dict) -> str:
        session = self._sessions["weather"]
        result = await session.call_tool(tool_name, args)
        return result.content[0].text if result.content else "{}"
```

### 5.6 agent.py — WeatherAgent (with Mapbox fallback)

The agent now has a two-level fallback strategy for geocoding:

```python
# agent.py

class WeatherAgent:
    async def run(self, query: str) -> dict:
        # Step 1: Gemini flash-lite — extract structured intent from natural language
        intent = await self._extract_intent(query)
        # intent = WeatherIntent(location="Dhaka", user_context="CITIZEN", forecast_days=3)

        # Step 2: Geocode — try Mapbox, fall back to direct district lookup
        buffer_geojson = None
        try:
            geo = await self.mcp.geocode_location(intent.location)

            # Step 3: Create geodesic buffer (only when we have real coordinates)
            radius_km = 15.0 if intent.user_context == "FARMER" else 20.0
            buffer_json_str = await self.mcp.call_weather_tool("buffer_point", {
                "latitude": geo["latitude"],
                "longitude": geo["longitude"],
                "radius_km": radius_km
            })
            buffer_geojson = json.loads(buffer_json_str)

        except Exception as geo_err:
            # Mapbox token invalid or service unavailable.
            # Fall back: match location name directly against the BMD district list.
            # _find_district() does fuzzy normalisation (strips apostrophes, hyphens, spaces)
            # so "Cox's Bazar" → "coxsbazar" → canonical "Cox's Bazar"
            from mcp_weather.tools.weather_forecast import _find_district
            district = _find_district(intent.location) or intent.location
            geo = {
                "longitude": 0.0,
                "latitude": 0.0,
                "district": district,
                "display_name": intent.location
            }
            # buffer_geojson stays None — no coordinates available

        # Step 4: BMD BAMIS scraper via weather MCP stdio server
        forecast_str = await self.mcp.call_weather_tool("retrieve_weather_forecast", {
            "district_name": geo["district"],
            "forecast_days": intent.forecast_days,
            "parameters": ["temperature", "precipitation", "humidity"]
        })
        forecast_data = json.loads(forecast_str)

        # Step 5: Gemini flash — compose human-readable explanation
        answer = await self._generate_explanation(query, intent, geo, forecast_data)

        return {
            "answer": answer,
            "buffer": {"type": "Feature", "geometry": buffer_geojson, "properties": {}}
                      if buffer_geojson else None,
            "location": geo.get("display_name", intent.location),
            "forecast": forecast_data
        }

    async def _extract_intent(self, query: str) -> WeatherIntent:
        """Use Gemini flash-lite with JSON schema enforcement."""
        prompt = (
            "Extract the weather query intent from the user message. "
            "Return JSON with keys: location (string), user_context (FARMER or CITIZEN), "
            f"forecast_days (integer 1-7).\n\nUser message: {query}"
        )
        try:
            response = self.client.models.generate_content(
                model=self.flash_lite_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=WeatherIntent
                )
            )
            return WeatherIntent.model_validate_json(response.text)
        except Exception:
            return WeatherIntent(location=query, user_context="CITIZEN", forecast_days=3)

    async def _generate_explanation(self, query, intent, geo, forecast_data) -> str:
        """Use Gemini flash to write a natural-language weather summary."""
        ctx = "a farmer" if intent.user_context == "FARMER" else "a citizen"
        prompt = (
            f"The user asked: \"{query}\"\n"
            f"They are {ctx} in {geo.get('display_name', intent.location)}.\n"
            f"Official BMD forecast:\n{json.dumps(forecast_data, indent=2)}\n\n"
            "Write a clear, concise weather explanation. Include temperature range, "
            "rain outlook, and practical advice for the user context."
        )
        try:
            response = self.client.models.generate_content(model=self.flash_model, contents=prompt)
            return response.text
        except Exception as exc:
            # Template fallback — never fail silently
            day = forecast_data["forecast"][0]["parameters"]
            loc = forecast_data.get("location", {}).get("area_name", intent.location)
            return (
                f"Weather forecast for {loc}: temperatures between "
                f"{day['temperature']['min']}°C and {day['temperature']['max']}°C, "
                f"with approximately {day['precipitation']['value']:.1f}mm of rain expected."
            )
```

**Fallback chain:**

```
Mapbox token valid → geocode → real lat/lon + district + buffer polygon
Mapbox fails       → _find_district(intent.location) → district name only, no buffer
Gemini explanation fails → template string from raw BMD numbers
```

### 5.7 mcp_weather/main.py — FastMCP stdio Server

A separate process launched by `MCPClientManager` that exposes two tools over the MCP
stdio protocol. This process runs **inside the container** and communicates with the
FastAPI app via stdin/stdout using JSON-RPC.

```python
# mcp_weather/main.py
from mcp.server.fastmcp import FastMCP
from mcp_weather.tools.buffer_point import create_buffer
from mcp_weather.tools.weather_forecast import fetch_forecast_logic

mcp = FastMCP("Weather Service")

@mcp.tool()
def buffer_point(latitude: float, longitude: float, radius_km: float) -> str:
    """Create a geodesic buffer zone around coordinates (WGS84 ellipsoid).

    Args:
        latitude:  Centre latitude in decimal degrees.
        longitude: Centre longitude in decimal degrees.
        radius_km: Buffer radius in kilometres.
    Returns:
        GeoJSON Polygon JSON string.
    """
    return create_buffer(latitude, longitude, radius_km)

@mcp.tool()
def retrieve_weather_forecast(district_name: str, forecast_days: int, parameters: list) -> str:
    """Retrieve weather forecast from Bangladesh Meteorological Department BAMIS WRF table.

    Args:
        district_name: Bangladesh district name in English (e.g. "Pabna", "Dhaka").
        forecast_days: Number of days to forecast (1-7).
        parameters:    List of parameter names to include (all returned by default).
    Returns:
        JSON string with location and forecast array.
    """
    return fetch_forecast_logic(district_name, forecast_days, parameters)

if __name__ == "__main__":
    mcp.run()
```

### 5.8 mcp_weather/tools/weather_forecast.py — BMD Scraper

Scrapes `https://www.bamis.gov.bd/en/bmd/wrf/table/all/{days}/`.

**Critical fix: browser headers required.** Without them, BAMIS returns HTTP 406 (Not
Acceptable) because the server checks the `Accept` and `User-Agent` headers and rejects
automated clients. Adding Chrome-like headers resolves this immediately.

```python
# mcp_weather/tools/weather_forecast.py

BENGALI_TO_ENGLISH = {
    "ঢাকা": "Dhaka", "চট্টগ্রাম": "Chittagong", "খুলনা": "Khulna",
    "রাজশাহী": "Rajshahi", "বরিশাল": "Barisal", "সিলেট": "Sylhet",
    "পাবনা": "Pabna", "সিরাজগঞ্জ": "Sirajganj", "নাটোর": "Natore",
    # ... 55+ more Bengali → English district name entries
}

# Fuzzy normaliser: strips apostrophes, hyphens, spaces for matching
# "Cox's Bazar" → "coxsbazar" → maps back to canonical "Cox's Bazar"
_ENGLISH_NORMALISED = {
    v.lower().replace("'", "").replace("-", "").replace(" ", ""): v
    for v in BENGALI_TO_ENGLISH.values()
}

BAMIS_URL = "https://www.bamis.gov.bd/en/bmd/wrf/table/all/{days}/"


def fetch_forecast_logic(district_name: str, forecast_days: int, parameters: list) -> str:
    db_district = _find_district(district_name)
    if not db_district:
        return json.dumps({"error": f"District '{district_name}' not found in BMD database."})

    try:
        url = BAMIS_URL.format(days=forecast_days)

        # ── Fix: browser headers required to avoid 406 Client Error ──────────
        # BAMIS rejects requests that don't look like browser traffic.
        # Without User-Agent and Accept headers, the server returns:
        #   406 Client Error: Not Acceptable
        # Adding Chrome-like headers makes the request indistinguishable from
        # a normal browser visit.
        headers = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        # ─────────────────────────────────────────────────────────────────────

        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("table tbody tr")

        target_row = None
        for row in rows:
            cells = row.find_all("td")
            if not cells:
                continue
            cell_text = cells[0].get_text(strip=True)
            # BAMIS table uses Bengali names — translate then fuzzy-match
            english_name = BENGALI_TO_ENGLISH.get(cell_text, cell_text)
            if _normalise(english_name) == _normalise(db_district):
                target_row = cells
                break

        if not target_row:
            return json.dumps({"error": f"No forecast row found for district '{db_district}'."})

        # Column indices in the BAMIS WRF table:
        # 1 = MinT (°C), 3 = MaxT (°C), 5 = Humidity (%), 10 = Total Rain (mm)
        t_min = safe_float(target_row, 1)
        t_max = safe_float(target_row, 3)
        hum   = safe_float(target_row, 5)
        total_rain = safe_float(target_row, 10)
        daily_rain = total_rain / max(forecast_days, 1)

        # BMD provides a single row per district for the entire forecast period.
        # Temperature and humidity are the same across all days.
        # Total rain is distributed evenly (approximation).
        forecast_days_list = [
            {
                "date": (datetime.now() + timedelta(days=i + 1)).strftime("%Y-%m-%d"),
                "parameters": {
                    "temperature": {"min": t_min, "max": t_max, "unit": "Celsius"},
                    "precipitation": {
                        "value": round(daily_rain, 2),
                        "unit": "mm",
                        "probability": min(daily_rain / 10.0, 1.0)
                    },
                    "humidity": {"value": hum, "unit": "percent"}
                }
            }
            for i in range(forecast_days)
        ]

        return json.dumps({
            "location": {"area_name": db_district.title()},
            "forecast": forecast_days_list
        })

    except Exception as exc:
        return json.dumps({"error": f"Failed to fetch BMD forecast: {str(exc)}"})
```

**Example response** for `district_name="Dhaka", forecast_days=3`:

```json
{
  "location": { "area_name": "Dhaka" },
  "forecast": [
    {
      "date": "2026-03-05",
      "parameters": {
        "temperature": { "min": 24.0, "max": 33.5, "unit": "Celsius" },
        "precipitation": { "value": 2.1, "unit": "mm", "probability": 0.21 },
        "humidity": { "value": 74.0, "unit": "percent" }
      }
    },
    { "date": "2026-03-06", "parameters": { "...same values..." } },
    { "date": "2026-03-07", "parameters": { "...same values..." } }
  ]
}
```

### 5.9 mcp_weather/tools/buffer_point.py — Geodesic Buffer

```python
# mcp_weather/tools/buffer_point.py
import json, pyproj

def create_buffer(latitude: float, longitude: float, radius_km: float) -> str:
    geod = pyproj.Geod(ellps="WGS84")
    boundary = []
    for i in range(37):   # 0° to 360° in 10° steps — closes the ring
        lon_pt, lat_pt, _ = geod.fwd(
            lons=longitude, lats=latitude,
            az=i * 10,
            dist=radius_km * 1000   # pyproj expects metres
        )
        boundary.append([lon_pt, lat_pt])
    return json.dumps({"type": "Polygon", "coordinates": [boundary]})
```

Only used when Mapbox geocoding succeeds (coordinates available). When Mapbox fails,
the agent skips buffer creation and returns `"buffer": null`.

---

## 6. Node.js Backend: Keyword Router and Tool Infrastructure

### 6.1 services/tool-registry.js — Singleton Registry

```javascript
// components/gov-chat-backend/services/tool-registry.js
class ToolRegistry {
  constructor() { this._tools = new Map(); }

  register(definition, handler) {
    this._tools.set(definition.function.name, { definition, handler });
  }

  async execute(name, args) {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: "${name}"`);
    return await tool.handler(args);
  }

  getDefinitions() { return [...this._tools.values()].map(t => t.definition); }
  list() { return [...this._tools.keys()]; }
}

module.exports = new ToolRegistry(); // singleton
```

### 6.2 services/tool-orchestrator.js — Tool-Calling Loop

Present for deployments that use a raw OpenAI-compatible vLLM endpoint.
Not active in the current OPEA `9000` setup.

```javascript
// components/gov-chat-backend/services/tool-orchestrator.js
const MAX_TOOL_ROUNDS = parseInt(process.env.MAX_TOOL_ROUNDS || '5', 10);

async function runWithTools(llmClient, messages, tools, toolRegistry) {
  const conversationMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await llmClient.chat({ messages: conversationMessages, tools, tool_choice: 'auto' });
    const choice = response.choices[0];

    if (choice.finish_reason === 'stop') {
      return { content: choice.message.content, toolsUsed: round, messages: conversationMessages };
    }

    if (choice.finish_reason === 'tool_calls') {
      conversationMessages.push(choice.message);
      const toolResults = await Promise.all(
        choice.message.tool_calls.map(async (toolCall) => {
          try {
            const result = await toolRegistry.execute(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments)
            );
            return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) };
          } catch (err) {
            return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) };
          }
        })
      );
      conversationMessages.push(...toolResults);
    }
  }

  const lastAssistant = [...conversationMessages].reverse().find(m => m.role === 'assistant');
  return { content: lastAssistant?.content || 'Unable to complete the request.', toolsUsed: MAX_TOOL_ROUNDS, messages: conversationMessages };
}

module.exports = { runWithTools };
```

### 6.3 tools/weather-mcp-bridge.js — HTTP Adapter

Used by the tool-calling loop (TOOLS_ENABLED path). Calls `/mcp/tools/call` for a
direct BMD scrape without the Gemini explanation layer.

```javascript
// components/gov-chat-backend/tools/weather-mcp-bridge.js
const PYTHON_SERVICE_URL = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';

const definition = {
  type: 'function',
  function: {
    name: 'retrieve_weather_forecast',
    description: 'Fetches official 3-7 day weather forecasts for Bangladesh districts from BMD.',
    parameters: {
      type: 'object',
      properties: {
        district_name: { type: 'string', description: 'Bangladesh district name (e.g. "Dhaka", "Pabna")' },
        forecast_days: { type: 'integer', description: 'Number of forecast days (1-7)', default: 3 }
      },
      required: ['district_name']
    }
  }
};

async function handler(args) {
  const response = await axios.post(`${PYTHON_SERVICE_URL}/mcp/tools/call`, {
    name: 'retrieve_weather_forecast',
    arguments: args
  });
  return JSON.parse(response.data.content[0].text);
}

module.exports = { definition, handler };
```

---

## 7. Backend Integration

### 7.1 index.js — Tool Registration on Startup

Non-fatal — the backend starts normally even if the weather service is down.

```javascript
// components/gov-chat-backend/index.js  (around line 958)
try {
  logger.info('Initializing MCP Tool Registry...');
  const toolRegistry = require('./services/tool-registry');
  const weatherMcpBridge = require('./tools/weather-mcp-bridge');
  toolRegistry.register(weatherMcpBridge.definition, weatherMcpBridge.handler);
  logger.info(`MCP Tool Registry ready. Available tools: ${toolRegistry.list().join(', ')}`);
} catch (toolError) {
  logger.warn('Failed to initialize MCP Tool Registry (Continuing without tools):', {
    error: toolError.message
  });
}
```

### 7.2 services/query-service.js — Keyword Router

Current routing logic. Reads the `backendMode` from `CONTEXT_OPTION` env var,
then applies three-level routing:

```javascript
// components/gov-chat-backend/services/query-service.js

const backendMode = process.env.CONTEXT_OPTION || 'single-message';
// backendMode = "conversation-with-context-labels" in production

if (backendMode === 'test-mode') {
  // ── Mock response (for frontend development) ──────────────────────────────
  const mockData = this.getMockOpeaResponse(queryData);
  opeaResponseContent = mockData.response;

} else {

  // ── Level 1: Weather keyword router ───────────────────────────────────────
  // Detects weather intent by keyword — routes to Python service, bypasses OPEA.
  // This was added because port 9000 (OPEA LLM microservice) does not support
  // tool_choice: "auto" — see the OPEA architecture explanation in the guide.

  const weatherEnabled = process.env.WEATHER_ENABLED === 'true';
  const weatherMcpUrl = process.env.WEATHER_MCP_URL || 'http://localhost:8000';

  // Use last user message for keyword matching (not the full history)
  const lastUserMsg = [...(queryData.messages || [])]
    .reverse()
    .find(m => m.role === 'user')?.content || queryText;

  const WEATHER_KW = ['weather', 'forecast', 'rain', 'rainfall', 'temperature',
                      'humid', 'storm', 'flood', 'cyclone', 'monsoon', 'climate'];
  const isWeatherQuery = weatherEnabled &&
    WEATHER_KW.some(kw => lastUserMsg.toLowerCase().includes(kw));

  if (isWeatherQuery) {
    logger.info(`[WEATHER] Routing to weather-mcp-service: "${lastUserMsg}"`);
    try {
      const wResp = await axios.post(
        `${weatherMcpUrl}/query`,
        { query: lastUserMsg },
        { timeout: 30000 }
      );
      opeaResponseContent = wResp.data.answer;   // Gemini-composed explanation
      opeaMetadata = {
        source_documents: [],
        confidence_score: 1.0,
        weather: true,
        location: wResp.data.location,
        forecast: wResp.data.forecast          // raw BMD data, available for UI use
      };
    } catch (wErr) {
      logger.error(`[WEATHER] Service call failed: ${wErr.message}`);
      opeaResponseContent = "I'm sorry, I couldn't fetch the weather right now. Please try again.";
      opeaMetadata = { source_documents: [], confidence_score: 0, weather: true };
    }
    opeaResponseTime = Date.now() - opeaStartTime;
    await this.queries.update(queryId, {
      response: opeaResponseContent, responseTime: opeaResponseTime,
      isAnswered: true, metadata: opeaMetadata
    });

  } else {

    // ── Level 2: vLLM tool-calling loop (TOOLS_ENABLED=true) ─────────────────
    // Only works with a raw vLLM instance — NOT port 9000 on the OPEA server.
    // Currently disabled (TOOLS_ENABLED=false).
    const toolsEnabled = process.env.TOOLS_ENABLED === 'true';
    const availableTools = toolsEnabled ? toolRegistry.getDefinitions() : [];

    if (toolsEnabled && availableTools.length > 0) {
      const vllmUrl = process.env.VLLM_URL;
      const vllmModel = process.env.VLLM_MODEL || 'ibm-granite/granite-3.3-2b-instruct';
      const llmClient = {
        chat: async ({ messages, tools, tool_choice }) => {
          const r = await axios.post(vllmUrl, { model: vllmModel, messages, tools, tool_choice, stream: false });
          return r.data;
        }
      };
      const result = await runWithTools(llmClient, vllmMessages, availableTools, toolRegistry);
      opeaResponseContent = result.content;
      opeaMetadata = { toolsUsedCount: result.toolsUsed, source_documents: [], confidence_score: 1.0, orchestrator: true };

    } else {

      // ── Level 3: OPEA ChatQnA (RAG pipeline) ─────────────────────────────
      // Default path. Calls port 8888 ChatQnA megaservice, which runs the full
      // embedding → retrieval → reranking → LLM pipeline internally.
      const opeaUrl = `http://${process.env.OPEA_HOST}:${process.env.OPEA_PORT}/v1/chatqna`;
      const workerResult = await this.runOPEAWorker(opeaUrl, opeaPayload);
      opeaResponseContent = workerResult.response;
      opeaMetadata = workerResult.metadata;
    }
  }
}
```

**Routing decision tree:**

```
Incoming query
    │
    ├─ backendMode === 'test-mode'  →  mock response
    │
    └─ else
         │
         ├─ WEATHER_ENABLED=true AND keyword match
         │    →  POST :8000/query  (Gemini+BMD)   ← active path
         │
         ├─ TOOLS_ENABLED=true AND tools registered
         │    →  vLLM tool-calling loop            ← disabled (OPEA port 9000 incompatible)
         │
         └─ default
              →  OPEA ChatQnA :8888               ← fallback for all non-weather queries
```

---

## 8. Environment Variables Reference

### gov-chat-backend `.env`

```env
# ── OPEA Configuration ──────────────────────────────────────────────────────
OPEA_HOST=91.203.132.198
OPEA_PORT=8888                    # ChatQnA megaservice (RAG pipeline)
CONTEXT_OPTION=conversation-with-context-labels

# ── Weather Keyword Router ───────────────────────────────────────────────────
# When true: queries containing weather keywords bypass OPEA entirely
# and are sent to weather-mcp-service /query endpoint.
WEATHER_ENABLED=true
WEATHER_MCP_URL=http://localhost:8000   # Docker: http://weather-mcp-service:8000

# ── vLLM Tool Calling (disabled — OPEA port 9000 does not support tool_choice: auto) ──
# These are wired in query-service.js but require a raw vLLM instance to work.
TOOLS_ENABLED=false
VLLM_URL=http://91.203.132.198:9000/v1/chat/completions
VLLM_MODEL=ibm-granite/granite-3.3-2b-instruct
MAX_TOOL_ROUNDS=5
```

### weather-mcp-service `.env`

```env
# Gemini — intent extraction and explanation generation
# Free tier: https://aistudio.google.com
GOOGLE_API_KEY=your_gemini_api_key

# Mapbox — geocoding Bangladesh location names to lat/lon
# Free tier: 100k requests/month — https://account.mapbox.com
# Optional: agent falls back to direct district matching if missing or invalid
MAPBOX_ACCESS_TOKEN=your_mapbox_token

PYTHONUNBUFFERED=1
```

---

## 9. Running the Full Stack

### Step 1 — Build and start the weather-mcp-service

```bash
# From ~/MEWA/components/weather-mcp-service/

# Create env file with API keys
cat > .env << 'EOF'
GOOGLE_API_KEY=your_gemini_key
MAPBOX_ACCESS_TOKEN=your_mapbox_token
EOF

docker build -t weather-mcp:local .
docker stop weather-mcp 2>/dev/null; docker rm weather-mcp 2>/dev/null
docker run -d \
  --name weather-mcp \
  -p 8000:8000 \
  --env-file .env \
  weather-mcp:local

# Wait ~20s then verify
curl http://localhost:8000/health
# → {"status": "healthy"}
```

### Step 2 — Configure the backend

In `components/gov-chat-backend/.env`:
```env
WEATHER_ENABLED=true
WEATHER_MCP_URL=http://localhost:8000
```

### Step 3 — Restart the backend

```bash
# Kill the running process (Ctrl+C), then:
cd ~/MEWA/components/gov-chat-backend
npm start
```

> **Node.js reads `.env` only at startup** via `require('dotenv').config()`. Changing the
> file without restarting the process has no effect on the running server.

---

## 10. Testing the Integration

### Test 1 — Health check

```bash
curl http://localhost:8000/health
# → {"status": "healthy"}
```

### Test 2 — Direct BMD scrape (no LLM, fastest)

```bash
curl -X POST http://localhost:8000/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name": "retrieve_weather_forecast", "arguments": {"district_name": "Dhaka", "forecast_days": 3}}'
```

Expected:
```json
{
  "content": [{"type": "text", "text": "{\"location\": {\"area_name\": \"Dhaka\"}, \"forecast\": [...]}"}]
}
```

### Test 3 — Full agent pipeline (Gemini + BMD)

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the weather in Dhaka for the next 3 days?"}'
```

Expected:
```json
{
  "answer": "Over the next 3 days in Dhaka, temperatures will range from 24°C to 33°C...",
  "location": "Dhaka, Bangladesh",
  "forecast": { "location": {...}, "forecast": [...] },
  "buffer": null
}
```

### Test 4 — End-to-end via chatbot

1. Both services running (backend + weather-mcp-service)
2. `WEATHER_ENABLED=true` in backend `.env`, backend restarted
3. Ask in chat: **"What is the weather in Dhaka?"**
4. Backend logs show:
   ```
   [WEATHER] Routing to weather-mcp-service: "What is the weather in Dhaka?"
   ```
5. Chat shows a Gemini-composed forecast based on live BMD data

---

## 11. Adding a New MCP Tool

### Step 1 — Create the bridge file

```javascript
// components/gov-chat-backend/tools/my-new-tool-bridge.js
const axios = require('axios');
const { logger } = require('../shared-lib');

const SERVICE_URL = process.env.MY_SERVICE_URL || 'http://my-service:8080';

const definition = {
  type: 'function',
  function: {
    name: 'my_tool_name',
    description: 'What this tool does and when the LLM should use it.',
    parameters: {
      type: 'object',
      properties: {
        param_one: { type: 'string', description: 'Description of param_one' }
      },
      required: ['param_one']
    }
  }
};

async function handler(args) {
  const response = await axios.post(`${SERVICE_URL}/endpoint`, args);
  return response.data;
}

module.exports = { definition, handler };
```

### Step 2 — Register in index.js

```javascript
const toolRegistry    = require('./services/tool-registry');
const weatherBridge   = require('./tools/weather-mcp-bridge');
const myBridge        = require('./tools/my-new-tool-bridge');

toolRegistry.register(weatherBridge.definition, weatherBridge.handler);
toolRegistry.register(myBridge.definition,      myBridge.handler);
```

### Step 3 — Add keyword detection in query-service.js (for keyword routing)

If you want the keyword router to handle your new tool's domain:
```javascript
const MY_TOOL_KW = ['keyword1', 'keyword2'];
const isMyToolQuery = myToolEnabled &&
  MY_TOOL_KW.some(kw => lastUserMsg.toLowerCase().includes(kw));

if (isMyToolQuery) {
  const resp = await axios.post(`${myServiceUrl}/query`, { query: lastUserMsg });
  opeaResponseContent = resp.data.answer;
  // ...
}
```

---

## 12. Troubleshooting

### `weather-mcp-service` health returns 503

The Mapbox or weather stdio sessions failed to start at container startup.

```bash
# Check API keys are set in the container
docker exec weather-mcp env | grep -E "GOOGLE|MAPBOX"

# Check container startup logs
docker logs weather-mcp | head -40
# Look for: [STARTUP] Failed to initialize MCP sessions:
```

If Mapbox fails at startup, the health check still returns 503 because `weather_agent`
is set to `None`. The agent now has a runtime fallback (direct district matching), but
that fallback only activates during a query — not during startup initialization.

**Workaround**: If you don't have a Mapbox token, the agent can still work during queries
(district lookup fallback), but the startup will fail. To fix this properly, make the
Mapbox session non-fatal in `MCPClientManager.start()` — initialize the weather session
separately even if Mapbox fails.

---

### 406 Client Error from BAMIS

The scraper is sending requests without browser headers. Verify the fix is in place:

```python
# weather_forecast.py — this block must be present
headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...',
    'Accept': 'text/html,application/xhtml+xml,...',
    'Accept-Language': 'en-US,en;q=0.5',
}
resp = requests.get(url, headers=headers, timeout=15)
```

After adding headers, rebuild the Docker image — the old image doesn't have the fix.

---

### District not found

```json
{"error": "District 'XYZ' not found in BMD database."}
```

The location string from Gemini's intent extraction doesn't fuzzy-match any entry in
`BENGALI_TO_ENGLISH`. Common causes:

- Gemini returned a city name instead of district ("Mirpur" instead of "Dhaka")
- Spelling variant not in the normaliser ("Chittagong" vs "Chittagonj")

Fix: add the variant to `_ENGLISH_NORMALISED` directly:

```python
# Add at the bottom of weather_forecast.py after _ENGLISH_NORMALISED is built
_ENGLISH_NORMALISED["mirpur"] = "Dhaka"       # Mirpur is in Dhaka district
_ENGLISH_NORMALISED["motijheel"] = "Dhaka"    # etc.
```

---

### OPEA still answering weather questions

OPEA answering means the keyword router isn't activating. Check in order:

```bash
# 1. Is WEATHER_ENABLED=true visible to the running Node process?
#    (the .env file on disk doesn't matter — only what was loaded at startup)
# Restart the backend and check logs immediately on startup for the env var

# 2. Does the backend log show the weather routing line?
# Should see: [WEATHER] Routing to weather-mcp-service: "..."
# If not seen: either WEATHER_ENABLED is false, or keyword didn't match

# 3. Test the keyword matching manually
node -e "
  const msg = 'What is the weather in Dhaka?';
  const WEATHER_KW = ['weather','forecast','rain','rainfall','temperature','humid','storm','flood','cyclone','monsoon','climate'];
  console.log('Match:', WEATHER_KW.some(kw => msg.toLowerCase().includes(kw)));
"
# → Match: true
```

---

### `tool_choice: "auto"` error from vLLM endpoint

This is expected when using OPEA port 9000. See [Section 3](#3-opea-port-9000-limitations).

To use `TOOLS_ENABLED=true`, you need a raw vLLM instance:
```bash
# Run your own vLLM (requires GPU)
docker run --runtime nvidia -p 9001:8000 \
  vllm/vllm-openai:latest \
  --model ibm-granite/granite-3.3-2b-instruct \
  --enable-auto-tool-choice \
  --tool-call-parser granite

# Then set:
TOOLS_ENABLED=true
VLLM_URL=http://localhost:9001/v1/chat/completions
```
