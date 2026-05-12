# weather-mcp-service

FastAPI service that owns **weather data ingestion**, **natural-language query handling**, **risk classification**, and the **MCP tool interface** for the MEWA early warning system.

---

## Position in the Stack

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            MEWA v2 Platform                               │
│                                                                           │
│  ┌───────────────────────┐      ┌─────────────────────────────────────┐  │
│  │   gov-chat-backend    │      │      vllm-translation-guardrail     │  │
│  │  (API gateway /       │      │   (Gemma-3-4b-it — intent extract   │  │
│  │   user-facing chat)   │      │    + explanation generation)        │  │
│  └──────────┬────────────┘      └──────────────────┬──────────────────┘  │
│             │  POST /query                         │ OpenAI-compat API   │
│             │  GET  /risk/latest                   │                     │
│             ▼                                      │                     │
│  ┌──────────────────────────────────────────────┐ │                     │
│  │          weather-mcp-service  :8000          │◄┘                     │
│  │                                              │                       │
│  │  • Hourly ingestor (Open-Meteo + BMD)        │                       │
│  │  • WeatherAgent (5-step NL pipeline)         │                       │
│  │  • RiskEngine (Tier 0–4 classifier)          │                       │
│  │  • FastMCP stdio server (MCP tools)          │                       │
│  │  • Query router (6 handlers)                 │                       │
│  └──────────────┬───────────────────────────────┘                       │
│                 │  reads / writes                                        │
│                 ▼                                                        │
│  ┌─────────────────────────────┐                                        │
│  │   ArangoDB  (arango-vector) │                                        │
│  │                             │  ◄── warning_system_engine writes:     │
│  │  weather_forecasts          │       risk_assessments                 │
│  │  risk_assessments           │       seasonal_forecasts               │
│  │  alerts_sent                │       drought_assessments              │
│  │  seasonal_forecasts  (R/O)  │                                        │
│  │  drought_assessments (R/O)  │                                        │
│  └─────────────────────────────┘                                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    warning_system_engine                           │  │
│  │  (APScheduler — EWS classification, Copernicus SEAS5, Twilio SMS) │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Division of responsibility:**
| Concern | Owner |
|---|---|
| Weather data ingestion (Open-Meteo, BMD) | **weather-mcp-service** |
| General risk classification (Tier 0–4) | **weather-mcp-service** (RiskEngine) |
| NL query handling | **weather-mcp-service** (WeatherAgent) |
| MCP tool interface | **weather-mcp-service** (FastMCP) |
| Copernicus SEAS5 seasonal forecasts | **warning_system_engine** |
| Crop-specific EWS (potato, rice, …) | **warning_system_engine** |
| Drought monitoring | **warning_system_engine** / drought_monitoring |
| SMS / voice alerts | **warning_system_engine** (Twilio) |

---

## Package Structure

```
weather-mcp-service/
├── main.py                  # FastAPI app — routes, lifespan, query router
├── agent.py                 # WeatherAgent — 5-step NL pipeline
├── data_ingestor.py         # DataIngestor — Open-Meteo + BMD, sense_check, 64 districts
├── risk_engine.py           # RiskEngine — stateless Tier 0–4 classifier
├── storage.py               # StorageLayer — ArangoDB read/write client
├── models.py                # Pydantic schemas (UnifiedForecast, RiskAssessment, …)
├── mcp_client.py            # MCPClientManager — stdio subprocess manager
│
├── mcp_weather/
│   ├── main.py              # FastMCP stdio server (2 tools: buffer_point, retrieve_weather_forecast)
│   └── tools/
│       ├── weather_forecast.py   # fetch_forecast_logic — BMD BAMIS WRF scraper
│       └── buffer_point.py       # Geodesic buffer zone (WGS84)
│
├── scripts/
│   ├── crawl_bamis.py            # Download BAMIS PDFs → raw/<crop>/<region>/
│   ├── upload_bamis_pdfs_to_dataprep.py  # Upload PDFs to dataprep service
│   ├── ingest_bamis_to_vectors.py        # PDF → vector_ready_chunks.jsonl
│   ├── build_faiss_index.py              # JSONL → FAISS index + bamis_metadata.json
│   ├── fetch_bmd_data.py                 # One-off BMD scrape test
│   ├── test_pipeline.py                  # End-to-end pipeline smoke test
│   └── test_drought_alert_flow.py        # Drought alert flow test
│
├── data/                    # Runtime data directory (bulletins, images)
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

---

## Data Sources

| Source | Type | Variables | Frequency | Coverage |
|---|---|---|---|---|
| **Open-Meteo** | Free REST API | temp min/max, precip, wind, humidity, soil moisture | On-demand / hourly cache refresh | All 64 Bangladesh districts |
| **BMD BAMIS WRF** | Web scraper | temp min/max, precip, humidity | On-demand | ~60 districts (BAMIS table) |
| **Copernicus SEAS5** | Read from ArangoDB | temp anomaly, precip anomaly, RH | Weekly (written by warning_system_engine) | Per-district outlook |
| **BAMIS Bulletins** | PDF / markdown | Agro-met advisories | Hourly (written by warning_system_engine) | National |

---

## Short-Term Pipeline (Hourly)

Every time the service starts and then every 60 minutes, `DataIngestor.ingest_short_term()` refreshes forecasts for all 64 districts.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DataIngestor.ingest_short_term()                         │
│                    (runs once at startup, then every hour)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 0 ──────────────────────────────────────────────────────────────────  │
│  Fetch BAMIS WRF table (1 HTTP request for ALL districts)                   │
│  → sense_check reference: {district: {t_min, t_max, rain, humidity}}        │
│                                                                             │
│  FOR EACH district (64 total)  ─────────────────────────────────────────   │
│  │                                                                          │
│  │  STEP 1: Open-Meteo API (primary)                                        │
│  │  GET api.open-meteo.com/v1/forecast?latitude=…&daily=…&hourly=soil…      │
│  │  → temp_2m_max/min, precip_sum, precip_prob, windspeed,                  │
│  │     winddirection, humidity_2m_max, soil_moisture_0_to_1cm               │
│  │                                                                          │
│  │  STEP 2: sense_check (validate OM vs BAMIS bounds, ±20% tolerance)       │
│  │  Checks: temperature max | precipitation (upper-bound only) | humidity   │
│  │                                                                          │
│  │       violation_rate < 0.5?                                              │
│  │       ┌───────────────┴───────────────┐                                  │
│  │      YES                             NO                                  │
│  │       │                              │                                   │
│  │  sense_check_passed=True      STEP 3: BMD BAMIS scraper (fallback)       │
│  │  use Open-Meteo data          fetch_forecast_logic(district, 7 days)     │
│  │                               fallback_used=True, sense_check_passed=False│
│  │                                                                          │
│  │  STEP 4: StorageLayer.upsert_forecast(UnifiedForecast)                   │
│  │  → ArangoDB  weather_forecasts  key: "{district}__open_meteo__short"     │
│  │                                 (or "{district}__bmd__short" on fallback) │
│  └──────────────────────────────────────────────────────────────────────    │
│                                                                             │
│  LOG: [INGESTOR] Refresh complete — 64/64 districts stored                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sense-Check Logic

The sense check prevents unreliable Open-Meteo data from reaching users by comparing OM day-0 values against official BAMIS bounds:

```
Variable       OM value    BAMIS bounds             Violation?
─────────────────────────────────────────────────────────────
temperature    33.2°C      min=28.0 max=36.0±20%    NO  (within 22.4–43.2)
precipitation  180mm       BAMIS=45mm, upper=64mm   YES (180 > 64)
humidity       75%         BAMIS=80%, bounds=64–96% NO  (within bounds)

violation_rate = 1/3 = 0.33  →  < 0.5  →  PASS  →  use Open-Meteo
```

If ≥50% of checked variables fall outside bounds, the service falls back to live BMD BAMIS scraping for that district.

---

## Long-Term / Seasonal (Read-Only)

The `weather-mcp-service` does **not** generate seasonal data — it reads what `warning_system_engine` writes.

```
warning_system_engine (weekly, Monday 06:00 UTC)
  └── Copernicus SEAS5 fetch
      └── Unit conversions: K→°C, m/day→mm/month, Magnus formula for RH
          └── ArangoDB seasonal_forecasts
              key: "{district}__copernicus__long"

weather-mcp-service
  └── POST /query  (seasonal keywords detected)
      └── StorageLayer.get_seasonal_forecast(district)
          └── _build_seasonal_answer() → markdown table (3–6 month outlook)
```

**Seasonal outlook format (example response):**
```
Dhaka — 3-month seasonal outlook (Copernicus SEAS5)

Month       Temp (°C)    Precip (mm)    Humidity (%)
──────────────────────────────────────────────────
Jun 2026    32.1         210            82
Jul 2026    31.8         280            88
Aug 2026    31.5         250            86

Source: Copernicus Climate Change Service (SEAS5).
```

---

## WeatherAgent Pipeline

`POST /query` → `WeatherAgent.run(query)` → 5-step pipeline:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     WeatherAgent.run(query)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  STEP 1: Intent Extraction (Gemma-3-4b-it)                              │
│  ─────────────────────────────────────────                              │
│  Input:  "What is the weather in Sylhet this week for my rice?"         │
│  Prompt: system: "Extract JSON: location, user_context, forecast_days"  │
│  Output: {"location": "Sylhet", "user_context": "FARMER",              │
│           "forecast_days": 7}                                           │
│  Guard:  location ∈ {"n/a", "none", "null", …} → ValueError (clean msg)│
│                                                                         │
│  STEP 2: District Resolution (local fuzzy lookup, no Mapbox)            │
│  ─────────────────────────────────────────────────────────              │
│  _find_district("Sylhet") → "Sylhet"                                    │
│  Falls back to partial match; returns None if no Bangladesh district    │
│  is found → clean "Please specify a district name" response             │
│                                                                         │
│  STEP 3: Forecast Fetch (ArangoDB cache, max_age=6h)                    │
│  ────────────────────────────────────────────────────                   │
│  StorageLayer.get_latest_forecast("Sylhet", horizon="short")            │
│  Cache HIT  → slice to forecast_days, convert to legacy dict + unified  │
│  Cache MISS → return None → "data pipeline refreshes hourly, try again" │
│  No live scraping at query time — hourly ingestor pre-fills all 64 dist │
│                                                                         │
│  STEP 4: Risk Classification (RiskEngine, stateless)                    │
│  ───────────────────────────────────────────────────                    │
│  engine.classify(unified_forecast) → RiskAssessment                    │
│    - Worst single day scored (rain / temp / wind thresholds)            │
│    - Multi-day patterns (heatwave ≥3 d, drought ≥14 d)                 │
│    - IPC multi-hazard escalation: ≥2 Tier-2+ triggers → +1 tier        │
│    - Returns tier (0–4), tier_label, triggers[], reasoning              │
│                                                                         │
│  STEP 5: Explanation Generation (Gemma-3-4b-it)                         │
│  ──────────────────────────────────────────────                         │
│  Prompt: conditions summary + risk context + "2–4 sentences, farmer tip"│
│  Appends: deterministic visual strip (sky emoji, temp range, rain prob, │
│           wind speed, soil moisture) — generated in Python, not by LLM  │
│  Fallback: template string if vLLM call fails                           │
│                                                                         │
│  OUTPUT dict                                                            │
│  {answer, risk_tier, risk_label, advisory, triggers[], location,        │
│   forecast, buffer}                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Visual strip example (appended to every forecast answer):**
```
---

**Daily outlook:**
- ⛈ **Mon 12 May** — 28–34°C · 💧85% · 💨 45 km/h · moist 🌱 0.22 m³/m³
- 🌧 **Tue 13 May** — 27–32°C · 💧70%
- ☀️ **Wed 14 May** — 26–33°C · 💧10%
```

---

## Query Routing

`POST /query` applies keyword-based routing before passing to WeatherAgent. Routes are tested in priority order:

```
POST /query  {"query": "..."}
│
├─ _DELINEATION_KEYWORDS   → "delineate field / show farm boundary / map land"
│   └─ lat/lon in query? → Mapbox MCP buffer_point tool
│      else             → "Please provide coordinates: lat=X lon=Y"
│
├─ _FLOOD_DETECTION_KEYWORDS → "detect floods / satellite flood map / Prithvi"
│   └─ Forward to GEO_INFERENCE_URL (Prithvi-EO model service)
│      else → "Flood mapping requires the satellite model endpoint"
│
├─ _SEASONAL_KEYWORDS  → "next 2 months / seasonal forecast / long-term outlook"
│   └─ Find district in query
│      StorageLayer.get_seasonal_forecast(district)
│      → _build_seasonal_answer() markdown table
│      No data? → "Seasonal data refreshed weekly by warning_system_engine"
│
├─ _BULLETIN_KEYWORDS  → "bulletin / agro-met / agromet advisory"
│   └─ Read data/bulletin.md  →  return as-is with image URLs resolved
│      No bulletin? → "No bulletin available yet"
│
├─ _DROUGHT_KEYWORDS   → "drought / soil moisture / water stress"
│   └─ Find district in query
│      POST drought_monitoring /run/district → run assessment
│      Return drought report markdown or link to PDF
│
└─ DEFAULT             → WeatherAgent.run(query)
    └─ 5-step pipeline (see above)
```

---

## Risk Tier Table

```
Tier  Label      Rain (mm/day)  Temp max (°C)  Wind (km/h)  Pattern trigger
────  ─────────  ─────────────  ─────────────  ───────────  ─────────────────────────────
 0    Normal     —              —              —            —
 1    Advisory   ≥ 50           ≥ 38           ≥ 62         Drought: 14+ consecutive dry days
 2    Warning    ≥ 100          ≥ 40           ≥ 88         Heatwave: 3+ days ≥40°C
 3    Severe     ≥ 200          ≥ 43           ≥ 118        Cyclone flag set by source
 4    Emergency  (multi-hazard: ≥2 independent Tier-2+ triggers add +1, capped at 4)
```

**IPC multi-hazard escalation:** When a single day has two or more independent Tier-2+ triggers (e.g. extreme rain _and_ cyclone-strength wind), the tier is bumped by +1 (capped at 4). This aligns with IPC combined-risk guidance.

---

## HTTP API Reference

Base URL: `http://weather-mcp-service:8000` (internal); `http://localhost:8100` (host, docker-compose standalone)

### `GET /health`

Returns service readiness and storage status.

```json
{"status": "healthy", "storage": true}
```

Returns `503` with `{"status": "unhealthy", "reason": "agent not initialized"}` if WeatherAgent failed to start.

---

### `POST /query`

Natural-language weather query. Accepts plain text; routes to the correct handler automatically.

**Request:**
```json
{"query": "Will there be heavy rain in Comilla this week? I'm a farmer."}
```

**Response:**
```json
{
  "answer": "**Comilla — 7-day forecast**\n\nTemperatures ...",
  "risk_tier": 2,
  "risk_label": "Warning",
  "advisory": "Risk level 2 (Warning) detected for Comilla ...",
  "triggers": ["Heavy rainfall 110mm/day (≥100mm — warning)"],
  "location": "Comilla",
  "forecast": { ... },
  "buffer": null
}
```

**Query examples by handler:**

| Query | Handler |
|---|---|
| `"What is the weather in Sylhet tomorrow?"` | WeatherAgent |
| `"3-month rainfall outlook for Dhaka"` | Seasonal (Copernicus SEAS5) |
| `"Show me the latest agrometeorological bulletin"` | Bulletin reader |
| `"Drought risk in Rajshahi this season?"` | Drought monitoring |
| `"Delineate my field at lat=23.5 lon=90.3"` | Mapbox buffer_point |
| `"Map the flood extent using satellite"` | GEO_INFERENCE_URL (Prithvi) |

---

### `GET /risk/latest`

Retrieve the latest stored risk assessment for a district (written by `warning_system_engine`).

**Parameters:** `location` (required), `horizon` (optional, default `"short"`)

```
GET /risk/latest?location=Dhaka&horizon=short
```

**Response:** `RiskAssessment` JSON:
```json
{
  "location": "Dhaka",
  "assessed_at": "2026-05-12T05:30:00Z",
  "horizon": "short",
  "tier": 1,
  "tier_label": "Advisory",
  "triggers": ["Significant rainfall 52mm/day (≥50mm — advisory)"],
  "reasoning": "Risk level 1 (Advisory) detected ...",
  "forecast_source": "open_meteo",
  "raw_forecast": { ... }
}
```

---

### `GET /potato/risk/latest`

Retrieve the latest crop-specific risk for potato at a given location.

```
GET /potato/risk/latest?location=Dhaka
```

---

### `GET /drought/risk/latest`

Retrieve the latest drought assessment for a location (written by `warning_system_engine`).

```
GET /drought/risk/latest?location=Rajshahi
```

---

### `GET /geocode`

Resolve a district name to latitude/longitude.

```
GET /geocode?location=Sylhet
```

**Response:**
```json
{"district": "Sylhet", "latitude": 24.8949, "longitude": 91.8687}
```

---

### `POST /mcp/tools/list`

Return all tools registered with the MCP server.

**Response:**
```json
{
  "tools": [
    {"name": "retrieve_weather_forecast", "description": "..."},
    {"name": "buffer_point", "description": "..."}
  ]
}
```

---

### `POST /mcp/tools/call`

Call a named MCP tool.

**Request:**
```json
{
  "tool": "retrieve_weather_forecast",
  "params": {"district_name": "Pabna", "forecast_days": 3, "parameters": []}
}
```

---

### `GET /bulletin/image/{filename}`

Serve bulletin images from `data/` (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`).

### `GET /drought/report/{filename}`

Serve drought report files from `data/`.

---

## MCP Tools (FastMCP stdio server)

The `mcp_weather/main.py` subprocess exposes two tools over the MCP stdio protocol, called by `gov-chat-backend` via `MCPClientManager`:

### `retrieve_weather_forecast`

Scrapes the BMD BAMIS WRF table for a single district.

```python
retrieve_weather_forecast(
    district_name: str,   # "Dhaka", "Sylhet", etc.
    forecast_days: int,   # 1–7
    parameters: List[str] # ignored — all returned
) -> str  # JSON with location + forecast array
```

**Note:** At query time the WeatherAgent reads from ArangoDB cache (pre-filled by the hourly ingestor), not by calling this tool live. This tool is used by the ingestor's `_from_bmd()` fallback path.

### `buffer_point`

Creates a geodesic buffer zone around a coordinate pair (WGS84 ellipsoid).

```python
buffer_point(
    latitude: float,   # 23.5
    longitude: float,  # 90.3
    radius_km: float   # 5.0
) -> str  # GeoJSON Polygon JSON string
```

Used for field delineation queries.

---

## ArangoDB Collections

The service connects to `arango-vector-db:8529` (env: `ARANGO_URL`). Collections are created automatically on first run.

| Collection | Writer | Reader | Key pattern | TTL (recommended) |
|---|---|---|---|---|
| `weather_forecasts` | **weather-mcp-service** | weather-mcp-service, warning_system_engine | `{district}__{source}__{horizon}` | 30 days |
| `risk_assessments` | warning_system_engine | **weather-mcp-service** (read-only) | `{district}__short` | 90 days |
| `alerts_sent` | warning_system_engine | warning_system_engine | auto `_key` | 7 days |
| `seasonal_forecasts` | warning_system_engine | **weather-mcp-service** (read-only) | `{district}__copernicus__long` | 90 days |
| `drought_assessments` | drought_monitoring | **weather-mcp-service** (read-only) | `{district}__drought` | 30 days |

**Upsert behaviour:** Every hourly ingestor run replaces the existing document for each district. The key is deterministic so the collection never grows unbounded within a forecast window.

**Staleness check:** `get_latest_forecast()` uses `max_age_hours=30` by default — covers one full 24h cycle plus a 6-hour buffer. WeatherAgent uses `max_age_hours=6` (tighter — only trusts data from the last ingestor run).

---

## Scripts

All scripts live in `scripts/`. Run them inside the `weather-mcp-service` container or in an environment where `requirements.txt` is installed.

### `crawl_bamis.py`

Downloads BAMIS crop-calendar PDFs from [bamis.gov.bd](https://bamis.gov.bd) for all crops and regions.

```bash
python scripts/crawl_bamis.py --out-dir /data/raw_pdfs
```

Output structure:
```
/data/raw_pdfs/
└── raw/
    ├── potato/
    │   ├── dhaka/potato_dhaka.pdf
    │   └── rajshahi/potato_rajshahi.pdf
    └── rice/
        └── ...
```

**Next step:** Pass the PDFs to `warning_system_engine/scripts/build_crop_profiles_pipeline.py` to generate crop profiles and risk engine modules.

---

### `ingest_bamis_to_vectors.py`

Parses BAMIS PDFs (row-oriented) and writes `vector_ready_chunks.jsonl` — one chunk per advisory/climate record with metadata. Uses `pdfplumber` for row-oriented table extraction.

```bash
python scripts/ingest_bamis_to_vectors.py \
    --pdf-dir /data/raw_pdfs \
    --out /data/vector_ready_chunks.jsonl
```

---

### `build_faiss_index.py`

Reads `vector_ready_chunks.jsonl`, embeds each chunk, and builds a FAISS IVF index. Also writes `bamis_metadata.json` as a metadata sidecar (in the same order as the FAISS vectors).

```bash
python scripts/build_faiss_index.py \
    --chunks /data/vector_ready_chunks.jsonl \
    --index  /data/bamis_ivf.index \
    --meta   /data/bamis_metadata.json
```

---

### `upload_bamis_pdfs_to_dataprep.py`

Uploads crawled BAMIS PDFs to the dataprep service for document chunking and ingestion into the RAG vector store.

```bash
python scripts/upload_bamis_pdfs_to_dataprep.py \
    --pdf-dir /data/raw_pdfs \
    --endpoint http://dataprep-service:6007
```

---

### `fetch_bmd_data.py`

One-off script to test BMD BAMIS scraping for a single district. Useful for debugging scraper changes.

```bash
python scripts/fetch_bmd_data.py Dhaka 7
```

---

### `test_pipeline.py`

End-to-end smoke test: starts the ingestor, fetches one district, classifies risk, and prints the result.

```bash
python scripts/test_pipeline.py
```

---

### `test_drought_alert_flow.py`

Tests the drought alert flow from district lookup → drought monitoring → report retrieval.

```bash
python scripts/test_drought_alert_flow.py --district Rajshahi
```

---

## End-to-End Data Pipelines

### Short-Term (Hourly) — Operational Flow

```
[On startup + every 60 minutes]

Open-Meteo API ─────────────────────────────────────────┐
                                                         │
BAMIS WRF table ──► sense_check ──► fallback to BMD?    │
                                          │              │
                                         YES             NO
                                          │              │
                             BMD scraper  │    Open-Meteo│
                             (_from_bmd)  │    forecast  │
                                 │        │              │
                                 └────────┴──────────────┘
                                          │
                                    UnifiedForecast
                                    (64 districts)
                                          │
                                 StorageLayer.upsert_forecast()
                                          │
                               ArangoDB weather_forecasts
                                          │
                                [1 hour later — repeat]


[On query: POST /query]

User query ──► route detection ──► WeatherAgent.run()
                                        │
                          ArangoDB cache lookup (max_age=6h)
                                        │
                              RiskEngine.classify()  ──► Tier 0–4
                                        │
                               Gemma explanation
                                        │
                              JSON response to user
```

### Long-Term (Weekly) — Seasonal Flow

```
[Every Monday 06:00 UTC — in warning_system_engine]

Copernicus SEAS5 API
  └── 5-month outlook (temperature, precipitation, humidity)
  └── Unit conversions:
        K → °C  |  m/day → mm/month  |  Magnus formula → RH%
  └── ArangoDB seasonal_forecasts (key: {district}__copernicus__long)


[On query: POST /query with seasonal keywords]

weather-mcp-service
  └── StorageLayer.get_seasonal_forecast(district)
      └── _build_seasonal_answer() → markdown table
      └── "Copernicus SEAS5" attribution always appended
```

### BAMIS Knowledge Pipeline (On-Demand)

```
bamis.gov.bd ──► crawl_bamis.py ──► /data/raw_pdfs/raw/<crop>/<region>/
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
             RAG vector store      warning_system_engine    Visualization
             (dataprep upload)     build_crop_profiles_pipeline.py
                    │                     │
           FAISS index + meta     example_crop_profile.json
           bamis_metadata.json          │
                                  app/crops/<crop>/profile.py
                                  app/crops/<crop>/risk_engine.py
```

---

## Configuration

All settings are environment variables. Set them in `.env` or in the Docker Compose `environment:` block.

| Variable | Default | Description |
|---|---|---|
| `ARANGO_URL` | `http://arango-vector-db:8529` | ArangoDB connection |
| `ARANGO_DB_NAME` | `genie-ai` | Database name |
| `ARANGO_USER` | `root` | ArangoDB username |
| `ARANGO_PASSWORD` | `test` | ArangoDB password |
| `VLLM_TRANSLATION_ENDPOINT` | `http://vllm-translation-guardrail:9031` | vLLM base URL (OpenAI-compat) |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | Model for intent extraction + explanation |
| `MAPBOX_ACCESS_TOKEN` | _(empty)_ | Required for Mapbox MCP delineation tools |
| `DROUGHT_MONITORING_URL` | _(empty)_ | Base URL of drought_monitoring service |
| `GEO_INFERENCE_URL` | _(empty)_ | Prithvi-EO model URL for flood detection |
| `PUBLIC_API_BASE` | `/api/weather/bulletin-image` | Base URL for serving bulletin images |
| `LOG_LEVEL` | `INFO` | Log verbosity (`DEBUG`, `INFO`, `WARNING`) |
| `WARNING_SYSTEM_ENGINE_DIR` | `/warning_system_engine` | Mount point for warning_system_engine volume |

**Tip:** Set `LOG_LEVEL=DEBUG` in docker-compose to see the full WeatherAgent trace — every step is logged with `[AGENT]` prefix.

---

## Running

### As part of the full MEWA stack

The service is typically started via the root `docker-compose.yml`:

```bash
# From the repo root
docker compose up weather-mcp-service
```

The `warning_system_engine` must be running and sharing the same ArangoDB instance for seasonal/drought reads to work.

### Standalone (development)

```bash
cd components/weather-mcp-service
docker compose up
# Exposed at http://localhost:8100
```

### Local development (no Docker)

```bash
cd components/weather-mcp-service
pip install -r requirements.txt

# Point to a local ArangoDB
export ARANGO_URL=http://localhost:8529
export ARANGO_PASSWORD=yourpassword

uvicorn main:app --reload --port 8000
```

### Running scripts individually

```bash
# Test the BMD scraper
python scripts/fetch_bmd_data.py Dhaka 7

# Refresh BAMIS PDFs
python scripts/crawl_bamis.py --out-dir /data/raw_pdfs

# Full BAMIS knowledge pipeline (pass PDFs to warning_system_engine)
cd ../warning_system_engine
python scripts/build_crop_profiles_pipeline.py \
    --pdf-dir /data/raw_pdfs \
    --skip-enrich  # if example_crop_profile.json is already current
```

---

## Troubleshooting

### `weather_agent` is `None` → `POST /query` returns 503

MCP sessions failed to start. Check:
```bash
docker logs weather-mcp-standalone | grep "\[STARTUP\]"
```
Common causes: `@mapbox/mcp-server` npm package failed to install (check `MAPBOX_ACCESS_TOKEN`), or the `mcp_weather/main.py` subprocess exited.

### Forecast data stale or missing

```bash
docker logs weather-mcp-standalone | grep "\[INGESTOR\]"
```
If you see `[INGESTOR] Both sources failed for Dhaka`, both Open-Meteo and BMD are unreachable. Check internet connectivity from the container.

### Seasonal queries return "No seasonal data available"

The `warning_system_engine` scheduler runs the Copernicus job every Monday. Verify:
```bash
docker logs warning_system_engine | grep "SEAS5\|long.term\|seasonal"
```
If it has never run, trigger it manually:
```bash
docker exec warning_system_engine python -c "
from app.core.scheduler import run_long_term_pipeline_now; run_long_term_pipeline_now()
"
```

### sense_check failures are frequent

Increase tolerance (default 20%) by editing `data_ingestor.py:_sense_check()` — change `tolerance=0.2` to `tolerance=0.3`. A high rate of sense_check failures usually means Open-Meteo and BAMIS disagree on a weather event (e.g. an unforecast cyclone) — BMD fallback data is used in those cases.

### Debug a single district end-to-end

```bash
docker exec -it weather-mcp-standalone python - <<'EOF'
from data_ingestor import DataIngestor
from storage import StorageLayer

d = DataIngestor()
results = d.ingest_short_term(districts=["Sylhet"], forecast_days=7)
print(results[0].model_dump_json(indent=2))
EOF
```
