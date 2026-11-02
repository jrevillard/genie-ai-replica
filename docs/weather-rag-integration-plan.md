# Weather Data Integration into RAG Pipeline

## Status: Phase 1 Complete ✅ | Phase 2 Planned

---

## 1. Context & Motivation

The GENIE.AI platform (Agrivisory-Lesotho) serves smallholder farmers with AI-powered agricultural advisory. Weather is a critical factor in farming decisions — planting timing, irrigation, pest risk, harvest scheduling — yet the RAG pipeline previously only answered based on static documents in the knowledge base.

The platform **already collects weather data** for the dashboard widget. This integration makes that same weather information available to the LLM so it can give weather-aware responses to farmers' questions.

---

## 2. Architecture Overview

### 2.1 How It Works (Implemented)

```
User sends chat message
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  ChatQnA Service (genieai_chatqna.py)                   │
│                                                         │
│  1. Extract user's last message (translated to English) │
│  2. Resolve weather location (priority cascade):        │
│     a. Geocode place name from query (Nominatim)        │
│     b. Frontend widget selection (context.weatherLocation)│
│     c. Default Maseru coordinates                       │
│  3. Fetch weather from backend (with 15min cache)       │
│  4. Inject into LLM prompt as CURRENT WEATHER DATA      │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Location Resolution Priority

| Priority | Source | Example | Latency |
|----------|--------|---------|---------|
| 1 (highest) | Geocode from user's query | "Will it rain in Semonkong?" → Nominatim resolves coordinates | +100-300ms (cached after first hit) |
| 2 | Frontend weather widget selection | User selected "Mokhotlong" in widget dropdown | 0ms |
| 3 (fallback) | Default deployment location | Maseru (-29.3167, 27.4833) | 0ms |

### 2.3 Prompt Structure

```
SYSTEM PROMPT (with weather-aware instructions)

USER INFORMATION:
- name, age, preferences...

CURRENT WEATHER DATA:
Location: Semonkong, Lesotho
Now: 14°C, Clear, Humidity 55%, Wind 8 km/h
2026-06-04: Rain, High 16°C / Low 3°C, Rain 12mm
2026-06-05: Partly Cloudy, High 18°C / Low 2°C
2026-06-06: Clear, High 19°C / Low 1°C
2026-06-07: Clear, High 20°C / Low 3°C
2026-06-08: Rain, High 15°C / Low 5°C, Rain 8mm
2026-06-09: Cloudy, High 16°C / Low 4°C
2026-06-10: Partly Cloudy, High 17°C / Low 2°C

CHAT HISTORY:
USER: ... |<-MSG->| ASSISTANT: ... |<-MSG->| USER: latest question

CONTENT FROM THE KNOWLEDGE BASE:
[Retrieved and reranked document chunks]
```

---

## 3. Geocoding: Nominatim Integration

### 3.1 How It Works

When the user's message (already translated to English) arrives at the ChatQnA service:

1. **Keyword check** — Does the message contain location-related terms? (weather, rain, plant, harvest, irrigation, "in", "near", "at", "around", "for")
2. **Regex extraction** — Extract capitalized place names following prepositions: "in Semonkong", "near Katse Dam", "Mokhotlong weather"
3. **Nominatim forward geocoding** — Call `GET https://nominatim.openstreetmap.org/search?q={place}&countrycodes=ls&format=json&limit=1` with a 3-second timeout
4. **Cache result** — Place names don't move; cache the lat/lon indefinitely

### 3.2 What It Handles

| User Query | Detected Location | Resolution |
|------------|-------------------|------------|
| "Will it rain in Semonkong?" | "Semonkong" | Geocoded via Nominatim |
| "Should I plant near Katse Dam?" | "Katse Dam" | Geocoded via Nominatim |
| "Weather for Ha Matala" | "Ha Matala" | Geocoded via Nominatim |
| "Mokhotlong weather this week" | "Mokhotlong" | Geocoded via Nominatim |
| "When should I irrigate?" | None detected | Falls to widget selection or default |
| "Tell me about maize varieties" | None detected | Falls to widget selection or default |

### 3.3 Graceful Degradation

- Nominatim returns no results → falls to widget selection or default
- Nominatim times out (>3s) → falls to widget selection or default
- Nominatim rate-limited → falls to widget selection or default
- No location indicators in query → skips geocoding entirely (no wasted API call)

### 3.4 Caching

- **Geocode cache**: Indefinite TTL per place name (stored in `_geocode_cache` dict, keyed by lowercase name)
- **Weather cache**: 15-minute TTL per coordinate pair (stored in `_weather_cache` dict, keyed by rounded lat/lon)

---

## 4. Data Flow (End-to-End)

### 4.1 Frontend → Backend → ChatQnA

```
ChatBotComponent.vue
  │ getWeatherLocation()
  │   → reads localStorage['genie-ai-weather-location'] (e.g., "mokhotlong")
  │   → looks up {latitude, longitude} from cached config locations
  │   → includes in queryData.context.weatherLocation
  ▼
chatbotService.submitQuery(queryData)
  │
  ▼
Backend POST /api/queries (query-service.js)
  │ → builds opeaPayload with context.weatherLocation passthrough
  ▼
ChatQnA POST /v1/chatqna (genieai_chatqna.py)
  │ → parses ChatCompletionRequest with RequestContext.weatherLocation
  │ → calls _fetch_weather_context(location_data, query_text)
  │     → tries geocoding from query_text first
  │     → falls back to location_data (widget)
  │     → falls back to default Maseru
  │ → passes weather_context as kwarg to megaservice.schedule()
  ▼
align_inputs (ServiceType.LLM branch)
  │ → reads kwargs["weather_context"]
  │ → injects as CURRENT WEATHER DATA section in prompt
  ▼
LLM generates weather-aware response
```

### 4.2 Weather Fetch Path (Internal Docker Network)

```
ChatQnA container
  │ POST http://backend:3000/api/weather
  │   body: { latitude, longitude }
  │   auth: Bearer token (from http-service:6666/get-token)
  ▼
Backend weather-service.js
  │ GET https://api.open-meteo.com/v1/forecast
  │   params: latitude, longitude, forecast_days=7, precipitation_sum
  ▼
Returns formatted weather data to ChatQnA
```

---

## 5. Configuration

### 5.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEATHER_AUGMENTATION_ENABLED` | `true` | Enable/disable weather injection into RAG |
| `WEATHER_DEFAULT_LATITUDE` | `-29.3167` | Fallback latitude (Maseru) |
| `WEATHER_DEFAULT_LONGITUDE` | `27.4833` | Fallback longitude (Maseru) |
| `WEATHER_CACHE_TTL_SECONDS` | `900` | Cache weather response for 15 minutes |
| `WEATHER_FORECAST_DAYS` | `7` | Number of forecast days (max 16 via Open-Meteo) |

### 5.2 System Prompt (Weather-Aware)

The `CHATQNA_SYSTEM_PROMPT` in `.env` includes:

```
When current weather data is provided, incorporate it into your responses where relevant
to the user's question (e.g., planting advice, irrigation timing, harvest planning, pest risk).
Do not repeat the raw weather data back to the user unless they explicitly ask about the weather.
```

### 5.3 Docker Compose (`docker-compose-t4.yaml`)

The chatqna service receives weather env vars explicitly:
```yaml
environment:
  WEATHER_AUGMENTATION_ENABLED: ${WEATHER_AUGMENTATION_ENABLED:-true}
  WEATHER_DEFAULT_LATITUDE: ${WEATHER_DEFAULT_LATITUDE:--29.3167}
  WEATHER_DEFAULT_LONGITUDE: ${WEATHER_DEFAULT_LONGITUDE:-27.4833}
  WEATHER_CACHE_TTL_SECONDS: ${WEATHER_CACHE_TTL_SECONDS:-900}
  BACKEND_SERVICE_URL: ${BACKEND_SERVICE_URL:-http://backend:3000}
```

---

## 6. Token Budget

| Component | Estimated Tokens |
|-----------|-----------------|
| Current conditions | ~25 |
| 7-day forecast (with precipitation) | ~120 |
| **Total weather block** | **~145 tokens** |

On an 8192-token context window with 1024 reserved for the answer, this leaves ~7000 tokens for system prompt, user info, chat history, and RAG content — negligible impact.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Weather API down | LLM gets no weather context | Graceful fallback: empty string, no error to user |
| Nominatim rate limit (1 req/s) | Geocoding fails | Cache all results indefinitely; keyword pre-filter avoids unnecessary calls |
| Extra latency (geocoding) | +100-300ms on first query for a new place | Cached after first hit; 3s timeout with fallback |
| Extra latency (weather fetch) | +100-200ms | 15min cache; only calls backend once per location per 15min |
| Token budget pressure | Reduced space for RAG content | ~145 tokens; minimal impact on 8192 context |
| Inaccurate geocoding | Wrong location matched | Scoped to Lesotho (`countrycodes=ls`); only matches capitalized place names after prepositions |
| False positive location detection | "In general" parsed as location | Nominatim returns no results → graceful fallback to widget/default |

---

## 8. Files Modified (Complete List)

| File | Change | Status |
|------|--------|--------|
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | Weather env vars, `_geocode_location_from_query()`, `_fetch_weather_context()`, `_format_weather_context()`, prompt injection in `align_inputs`, weather fetch in `handle_request` | ✅ |
| `genie-ai-overlay/core/genieai_api_protocol.py` | Added `weatherLocation: Optional[Dict[str, float]]` to `RequestContext` | ✅ |
| `tests/testing_genieai_api_protocol.py` | Same `RequestContext` update for test copy | ✅ |
| `components/gov-chat-backend/services/weather-service.js` | Configurable `forecast_days` (default 7), added `precipitation_sum` to API call and response | ✅ |
| `components/gov-chat-backend/services/query-service.js` | Passes `context.weatherLocation` through to OPEA payload | ✅ |
| `components/gov-chat-frontend/src/components/ChatBotComponent.vue` | `getWeatherLocation()`, `loadWeatherLocations()`, includes `weatherLocation` in chat context | ✅ |
| `.env` | New weather env vars + updated system prompt | ✅ |
| `docker-compose-t4.yaml` | Weather env vars + `BACKEND_SERVICE_URL` passed to chatqna service | ✅ |

---

## 9. Forecast Details

### 9.1 Why 7 Days

| Decision Type | Useful Horizon | Accuracy |
|---------------|---------------|----------|
| Irrigation timing | 1-2 days | ~90% |
| Spraying pesticides/fertilizer | 2-3 days | ~85% |
| Planting decisions | 5-7 days | ~70% |
| Harvest planning | 5-10 days | ~65% |

7 days covers all actionable farming decisions with acceptable accuracy.

### 9.2 Weather Response Format (from backend)

```json
{
  "location": "Semonkong, Lesotho",
  "current": {
    "temperature": 14,
    "condition": "Clear",
    "humidity": 55,
    "windSpeed": 8
  },
  "forecast": [
    {
      "date": "2026-06-04T00:00:00.000Z",
      "condition": "Rain",
      "highTemp": 16,
      "lowTemp": 3,
      "precipitation": 12.4
    },
    ...
  ]
}
```

---

## 10. Phase 2 — Planned (Future)

### 10.1 Historical Rainfall Data

Add a **recent 14-day rainfall summary** alongside the forecast:

```
RECENT WEATHER HISTORY (last 14 days):
Total rainfall: 23mm
Rain days: 4 (May 22, May 25, May 28, May 31)
Last rain: 2 days ago (8mm)
Avg temp: High 19°C / Low 6°C
```

- Source: Open-Meteo Historical API (`archive-api.open-meteo.com`)
- Cache: 24-hour TTL per location
- Token cost: ~50 additional tokens

### 10.2 Climate Profile Documents

Pre-computed monthly climate summaries per district, ingested into the RAG knowledge base:

```
Title: Historical Climate Data - Maseru - June
Labels: ["Weather & Climate", "Seasonal Forecasts"]

Average conditions for Maseru in June (based on 2015-2025 data):
- Average High: 17°C | Average Low: 2°C
- Rainfall: 12mm total (2-3 rain days typical)
- Frost risk: High (60% of nights below 0°C)
- Key advisory: Protect frost-sensitive crops. Minimal irrigation needed.
```

### 10.3 Remaining Decisions

1. **Recent history window**: 7 days or 14 days of rainfall lookback?
2. **Climate summaries**: Who generates/validates the per-district monthly profiles?
3. **Cache TTL for historical**: Confirm 24-hour is appropriate

---

## 11. Deployment

To deploy the weather RAG integration:

1. Pull latest code with all changes
2. Rebuild the chatqna image: `docker compose -f docker-compose-t4.yaml build chatqna-xeon-backend-server`
3. Rebuild the backend image: `docker compose -f docker-compose-t4.yaml build backend`
4. Restart services: `docker compose -f docker-compose-t4.yaml up -d chatqna-xeon-backend-server backend`

No database migrations needed. No new external dependencies. The feature can be toggled off via `WEATHER_AUGMENTATION_ENABLED=false` in `.env` without redeployment (requires container restart).
