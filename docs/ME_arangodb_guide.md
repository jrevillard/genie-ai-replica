# ArangoDB — Complete Usage Guide

ArangoDB is the single database for the entire MEWA system. It serves three completely
independent purposes that share one instance:

| Purpose | Collections | Written by | Read by |
|---|---|---|---|
| **RAG knowledge graph** | `chunk`, `document`, `belongs_to` (+ others) | `dataprep-arango-service` | `retriever-arango-service` |
| **Application data** | `users`, `sessions`, `chat_history`, etc. | `backend` | `backend` |
| **Weather forecast cache** | `weather_forecasts`, `risk_assessments`, `alerts_sent` | `weather-mcp-standalone` | `weather-mcp-standalone` |

---

## Table of Contents

1. [Connection & Container](#connection)
2. [Database Layout](#layout)
3. [RAG Knowledge Graph](#rag-graph) — chunks, vectors, labels, GRAPH_TEST
4. [Weather Forecast Collections](#weather-collections)
   - [Data Sources: Open-Meteo and BAMIS](#sources)
   - [Hourly Pipeline Flow](#pipeline-flow)
   - [Sense Check: Open-Meteo vs BAMIS](#sense-check)
   - [Document Schema: UnifiedForecast](#unified-forecast)
   - [Document Schema: RiskAssessment](#risk-assessment)
   - [Document Schema: alerts_sent](#alerts-sent)
   - [Storage keys and upsert strategy](#upsert-keys)
   - [AQL queries used in production](#aql-queries)
5. [Application Collections](#app-collections) — users, chat history, sessions
6. [Vector Search Configuration](#vector-search)
7. [Data Lifecycle and Retention](#retention)
8. [Admin and Maintenance](#admin)

---

## 1. Connection & Container <a name="connection"></a>

```yaml
container:  arango-vector-db
image:      arangodb/arangodb:3.12.4
port:       8529
data dir:   /root/arango_data  (host path — NOT a named Docker volume)
startup:    --experimental-vector-index=true  (required for HNSW vector index)
```

**Connection string used by all services:**
```
ARANGO_URL=http://arango-vector-db:8529
ARANGO_DB_NAME=genie-ai
ARANGO_USER=root
ARANGO_PASSWORD=<from .env>
```

**Web UI** (direct, not through Nginx):
```
http://<server-ip>:8529
```

> **Critical:** data lives at `/root/arango_data` on the host, mounted directly. If you
> run `docker compose down -v` it will NOT delete the data (it's not a named volume), but
> deleting `/root/arango_data` will destroy everything permanently. Back this up before any
> ArangoDB upgrade.

> **Version matters:** `--experimental-vector-index=true` is a 3.12 feature. Do not
> downgrade — the HNSW vector index used by the retriever will not be available on 3.11 or
> below.

---

## 2. Database Layout <a name="layout"></a>

```
Database: genie-ai
│
├── RAG Graph
│   ├── [vertex] chunk              ← text chunks + 768-dim embedding vectors
│   ├── [vertex] document           ← document metadata (filename, file_id, status)
│   ├── [edge]   belongs_to         ← chunk → document
│   ├── [graph]  GRAPH_TEST         ← named graph over the above
│   └── (+ other knowledge hierarchy collections)
│
├── Weather Early Warning
│   ├── weather_forecasts           ← one doc per district × source × horizon
│   ├── risk_assessments            ← one doc per district × horizon
│   └── alerts_sent                 ← deduplication log (alert history)
│
└── Application
    ├── users                       ← user accounts, roles, preferences
    ├── sessions                    ← active sessions
    ├── chat_history                ← full message history per user/session
    ├── service_categories          ← knowledge hierarchy labels
    ├── ingestion_log               ← per-file ingestion status
    └── (password_reset, analytics, …)
```

---

## 3. RAG Knowledge Graph <a name="rag-graph"></a>

This is the core of the retrieval system. When a user asks a question, the system embeds the
query and searches this graph for the most relevant text chunks.

### Collections in GRAPH_TEST

```
GRAPH_TEST
  edgeDefinitions:
    - edge collection: belongs_to
      from: [chunk]
      to:   [document]
```

#### `chunk` collection (vertex)

Each document is split into small pieces of text. Each piece becomes one `chunk` document.

**Document structure:**
```json
{
  "_key":         "1777579598916_792fbd0b_0",
  "_id":          "chunk/1777579598916_792fbd0b_0",
  "text":         "Week 42 | October Week 2 | Dhaka | Min Temp: 23°C ...",
  "embedding":    [0.0123, -0.0456, 0.0789, ...],  // 768 floats (BAAI/bge-base-en-v1.5)
  "file_id":      "1777579598916_792fbd0b",
  "file_name":    "potatoe_test.md",
  "source_path":  "/uploads/potatoe_test.md",
  "labels":       ["Crop Calendar", "Temperature", "Potato"],
  "chunk_index":  0
}
```

The `embedding` array is a 768-dimension dense vector produced by `BAAI/bge-base-en-v1.5`
via the TEI embedding server. This is what the HNSW vector index is built on.

#### `document` collection (vertex)

One document per ingested file.

```json
{
  "_key":        "1777579598916_792fbd0b",
  "file_id":     "1777579598916_792fbd0b",
  "file_name":   "potatoe_test.md",
  "source_path": "/uploads/potatoe_test.md",
  "status":      "completed",
  "chunk_count": 14,
  "labels":      ["Crop Calendar", "Potato", "Weather"],
  "uploaded_at": "2026-04-20T10:23:11Z"
}
```

#### `belongs_to` collection (edge)

```json
{
  "_from": "chunk/1777579598916_792fbd0b_0",
  "_to":   "document/1777579598916_792fbd0b"
}
```

This edge is what makes ArangoDB a graph rather than a plain document store. Graph traversal
(currently disabled: `RETRIEVER_ARANGO_TRAVERSAL_ENABLED=false`) can walk these edges to
retrieve neighboring chunks from the same document, which is useful when the top-scoring
chunk lacks context that appears in adjacent chunks.

### How a chunk gets into ArangoDB

The full dataprep pipeline (in `genieai_dataprep_arangodb.py`):

```
1. File upload received by document-repository
       │
       ▼
2. Content extraction  (CONTENT_EXTRACTION_METHOD=docling)
   - PDF/DOCX/PPTX → Docling (GPU, OCR-capable)
   - HTML          → LangChain HTMLHeaderTextSplitter.split_text()
   - MD/TXT        → plain text read
       │
       ▼
3. Chunking  (RecursiveCharacterTextSplitter)
   - Separators: ["\n\n", "\n", " ", ".", ",", ...]
   - Size is per file type (characters, not words):
       MD:   500 chars,  overlap 50
       PDF:  500 chars,  overlap 50
       DOCX: 1000 chars, overlap 50
       XLSX: 1500 chars, overlap 50
       HTML: 500 chars,  overlap 50
       TXT:  500 chars,  overlap 50
       │
       ▼
4. Embedding  (BAAI/bge-base-en-v1.5 via TEI at port 7000)
   - Each chunk text → POST tei:7000/embed → [float × 768]
       │
       ▼
5. Labeling  (LABELING_STRATEGY=llm  →  Granite 3.3-2b via vllm:8000)
   - LLM assigns 1–3 semantic labels per chunk from the knowledge hierarchy
   - MAX_CONCURRENT_BATCHES=5 batches processed in parallel
       │
       ▼
6. Write to ArangoDB
   - Insert chunk vertex (text + embedding + labels + metadata)
   - Insert/update document vertex
   - Insert belongs_to edge
```

### How a query hits ArangoDB

```
User question
    │
    ▼
POST embedding:6000
    → TEI embeds the query → 768-dim vector
    │
    ▼
POST retriever-arango-service:7025
    → AQL vector search (HNSW approximate nearest neighbour)
    → RETRIEVER_ARANGO_FETCH_K=15 candidates returned
    │
    ▼
POST reranker:6100
    → ms-marco-MiniLM-L-6-v2 reranks candidates by (query, chunk) score
    → RERANKER_TOP_N=5 best chunks returned
    │
    ▼
POST vllm:8000
    → Granite 3.3-2b generates answer from top-5 chunks
```

**AQL vector search query (simplified):**
```aql
FOR doc IN chunk
  LET score = COSINE_SIMILARITY(doc.embedding, @query_vector)
  FILTER score >= 0.5        // RETRIEVER_ARANGO_SCORE_THRESHOLD
  SORT score DESC
  LIMIT 15                   // RETRIEVER_ARANGO_FETCH_K
  RETURN { doc, score }
```

The actual HNSW index query uses ArangoDB's `APPROX_NEAR` syntax when
`RETRIEVER_ARANGO_USE_APPROX_SEARCH=true` (currently `false` — exact cosine search).

---

## 4. Weather Forecast Collections <a name="weather-collections"></a>

These three collections are owned entirely by `weather-mcp-standalone`. The backend never
writes to them; it only reads via `GET /risk/latest?location=` or forwards the result from
`POST /query`.

### 4a. Data Sources: Open-Meteo and BAMIS <a name="sources"></a>

```
┌──────────────────────────────────────────────────────────────────┐
│  PRIMARY SOURCE: Open-Meteo  (open-meteo.com)                    │
│  • Free, no API key                                              │
│  • 1 km grid resolution, daily aggregated                        │
│  • 7-day forecast window                                         │
│  • Variables fetched per district:                               │
│      temperature_2m_max         (°C)                             │
│      temperature_2m_min         (°C)                             │
│      precipitation_sum          (mm/day)                         │
│      precipitation_probability_max  (%)                          │
│      windspeed_10m_max          (km/h)                           │
│      winddirection_10m_dominant (degrees)                        │
│      relative_humidity_2m_max   (%)                              │
│  • URL pattern:                                                   │
│      https://api.open-meteo.com/v1/forecast                      │
│      ?latitude={lat}&longitude={lon}                             │
│      &daily=temperature_2m_max,temperature_2m_min,...            │
│      &timezone=Asia%2FDhaka                                      │
│      &forecast_days=7                                            │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │  validated against
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  REFERENCE / FALLBACK: BAMIS WRF table                           │
│  Bangladesh Agricultural Meteorological Information Service      │
│  • Official source: Bangladesh Meteorological Department (BMD)   │
│  • URL: https://www.bamis.gov.bd/en/bmd/wrf/table/all/{days}/    │
│  • HTML scrape — one row per Bangladesh district                 │
│  • Columns used:                                                 │
│      col 1  = MinT (°C)                                          │
│      col 3  = MaxT (°C)                                          │
│      col 5  = Humidity (%)                                       │
│      col 10 = Total rain (mm for the requested period)           │
│  • Fetched ONCE per pipeline run (all districts in one page)     │
│  • Both Bengali and English district names handled               │
└──────────────────────────────────────────────────────────────────┘
```

All 64 Bangladesh districts are covered, with lat/lon centroids hardcoded in
`data_ingestor.py`:

```python
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka":        (23.8103,  90.4125),
    "Chittagong":   (22.3569,  91.7832),
    "Sylhet":       (24.8949,  91.8687),
    "Rajshahi":     (24.3636,  88.6241),
    "Khulna":       (22.8456,  89.5403),
    "Barisal":      (22.7010,  90.3535),
    "Rangpur":      (25.7439,  89.2752),
    # ... all 64 districts
}
```

Bengali district names on the BAMIS page are translated using a hardcoded mapping in
`weather_forecast.py`:

```python
BENGALI_TO_ENGLISH = {
    "ঢাকা": "Dhaka",
    "চট্টগ্রাম": "Chittagong",
    "সিলেট": "Sylhet",
    "রাজশাহী": "Rajshahi",
    # ... 60+ entries
}
```

Some BAMIS spellings differ from the canonical names used in the system. A second map
handles these:
```python
_BAMIS_NAME_MAP = {
    "Chattogram":       "Chittagong",      # official new spelling
    "Cumilla":          "Comilla",          # Bengali romanisation
    "Barishal":         "Barisal",          # official new spelling
    "Chapai Nawabganj": "Chapainawabganj",  # space variation
    "Khagrachari":      "Khagrachhari",     # missing 'h'
    "Jhalokati":        "Jhalokathi",       # missing 'h'
}
```

---

### 4b. Hourly Pipeline Flow <a name="pipeline-flow"></a>

The pipeline is driven by an APScheduler job inside `weather-mcp-standalone`. It runs
every hour while the container is alive.

```
APScheduler: IntervalTrigger(hours=1)
max_instances=1          ← prevents parallel runs if one is slow
misfire_grace_time=3600  ← runs up to 1h late if container was down

Pipeline per run:
┌─────────────────────────────────────────────────────────────────┐
│ Step 0 — Fetch BAMIS reference (ONE request for all districts)  │
│   GET https://www.bamis.gov.bd/en/bmd/wrf/table/all/1/         │
│   → parse HTML table, build {district: {t_min, t_max,          │
│                                          humidity, rain}} dict  │
│   → On failure: skip sense_check, continue with OM only        │
└─────────────────────────────────────────────────────────────────┘
         │  (for each of 64 districts, in series)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1 — Fetch Open-Meteo 7-day forecast for the district       │
│   GET api.open-meteo.com/v1/forecast?lat=…&lon=…&daily=…       │
│   → parse daily arrays → build UnifiedForecast (source="open_meteo") │
│   → On failure: skip to Step 3 (BMD direct)                    │
└─────────────────────────────────────────────────────────────────┘
         │  (OM succeeded)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2 — sense_check: compare OM day-0 against BAMIS bounds     │
│   Checks 3 variables: temp_max, precipitation, humidity         │
│   Tolerance: ±20%                                               │
│   Threshold: fail if ≥50% of variables are outside tolerance    │
│                                                                 │
│   PASS (violation_rate < 0.5):                                  │
│     → use OM forecast (sense_check_passed=True)                 │
│     → continue to Step 4                                        │
│                                                                 │
│   FAIL (violation_rate ≥ 0.5):                                  │
│     → discard OM data                                           │
│     → fetch full BMD per-district data (fallback_used=True,     │
│                                          sense_check_passed=False) │
│     → continue to Step 4                                        │
└─────────────────────────────────────────────────────────────────┘
         │  (OM failed entirely)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3 — BMD fallback (no OM data at all)                       │
│   GET bamis.gov.bd/en/bmd/wrf/table/all/{days}/                 │
│   → find district row → extract t_min, t_max, humidity, rain    │
│   → distribute rain evenly across forecast_days                 │
│   → build UnifiedForecast (source="bmd", fallback_used=True)    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4 — Persist UnifiedForecast to weather_forecasts           │
│   upsert key: "{district}__open_meteo__short"                   │
│            or "{district}__bmd__short"                          │
│   → if key exists: replace the whole document                   │
│   → if key absent: insert                                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5 — Classify with RiskEngine                               │
│   Stateless rule evaluation (no LLM, no DB)                     │
│   → RiskAssessment (tier 0–4, triggers, reasoning)              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6 — Persist RiskAssessment to risk_assessments             │
│   upsert key: "{district}__short"                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 7 — Notify if tier ≥ 2                                     │
│   Check alerts_sent: was this tier already sent < 12h ago?      │
│   Tier 2 → FCM push                                             │
│   Tier 3 → FCM push + Twilio SMS                                │
│   Tier 4 → FCM push + SMS + voice call + broadcast webhook      │
│   → Record in alerts_sent                                       │
└─────────────────────────────────────────────────────────────────┘
```

**Triggering the pipeline manually:**
```bash
curl -X POST http://localhost:8100/internal/run-pipeline
# Returns immediately — runs in background
# Monitor logs: docker logs weather-mcp-standalone -f
```

**Pipeline result object:**
```json
{
  "status":               "ok",
  "districts_processed":  64,
  "sense_check_passed":   58,
  "sense_check_failed":   3,
  "fallback_used":        6,
  "errors":               0,
  "alerts_dispatched":    1
}
```

---

### 4c. Sense Check: Open-Meteo vs BAMIS <a name="sense-check"></a>

Open-Meteo is a global model (ERA5/GFS). BAMIS is official Bangladesh government data.
When they disagree significantly, the official source wins.

```
Variables checked:                  Condition for violation
─────────────────────────────────────────────────────────────────
Temperature (max):   OM max_t  outside [ bmd_t_min × 0.8 , bmd_t_max × 1.2 ]
Precipitation:       OM rain   >  max(bmd_rain × 1.2, bmd_rain + 10 mm)
                     (lower bound = 0 — OM reporting less rain is fine)
Humidity:            OM humid  outside [ bmd_humid × 0.8 , min(bmd_humid × 1.2, 100) ]
─────────────────────────────────────────────────────────────────
Fail threshold: violation_rate ≥ 0.5  (majority of checked variables)
Tolerance:      20% on each variable
```

Example log output when sense_check fires:
```
[INGESTOR] sense_check FAILED for Sylhet
  (violations=2/3 rate=0.667) — switching to BMD
[INGESTOR] BMD fallback for Sylhet: ingested successfully (fallback_used=True)

[INGESTOR] sense_check OK for Dhaka
  (violations=0/3 rate=0.000)
```

The `sense_check_passed` and `fallback_used` flags are stored on the `UnifiedForecast`
document so you can query which districts used which source on any given run:
```aql
// AQL: find all districts that used BMD fallback in the last run
FOR doc IN weather_forecasts
  FILTER doc.fallback_used == true
    AND doc.horizon == "short"
  SORT doc.ingested_at DESC
  COLLECT loc = doc.location INTO grp
  RETURN FIRST(FOR g IN grp SORT g.ingested_at DESC RETURN g).location
```

---

### 4d. Document Schema: `weather_forecasts` <a name="unified-forecast"></a>

Collection: `weather_forecasts`
Upsert key: `{district_normalised}__{source}__{horizon}`

Examples: `dhaka__open_meteo__short`, `sylhet__bmd__short`

```json
{
  "_key":     "dhaka__open_meteo__short",
  "_id":      "weather_forecasts/dhaka__open_meteo__short",

  "location":  "Dhaka",
  "latitude":  23.8103,
  "longitude": 90.4125,
  "source":    "open_meteo",         // or "bmd"
  "horizon":   "short",              // "short" = 0–7 days
  "ingested_at": "2026-05-01T06:00:00+00:00",   // ISO 8601 UTC
  "fallback_used":      false,       // true = BMD used instead of OM
  "sense_check_passed": true,        // null = check not performed

  "forecast": [
    {
      "date":  "2026-05-01",
      "temperature": {
        "min":  26.4,
        "max":  34.8,
        "unit": "Celsius"
      },
      "precipitation": {
        "value":       12.5,    // mm/day total
        "probability": 0.72,    // 0.0–1.0
        "unit": "mm"
      },
      "wind": {
        "speed":     18.2,      // km/h, daily max
        "direction": 195.0      // degrees, null for BMD source
      },
      "humidity": 84.0,         // %, daily max
      "extreme_flags": {
        "heatwave":    false,   // max_t ≥ 40°C
        "heavy_rain":  false,   // precipitation ≥ 50mm/day
        "cyclone_risk": false,  // wind ≥ 88km/h
        "drought_risk": false
      }
    },
    // ... up to 7 days
  ]
}
```

**Note on BMD data vs Open-Meteo:**
- BMD has `wind.speed = 0.0` and `wind.direction = null` — the BAMIS table has no wind column
- BMD rain is the total for the entire period divided evenly per day (`total_rain / forecast_days`)
- BMD does not have per-day temperature variation — all days get the same `t_min`/`t_max`

---

### 4e. Document Schema: `risk_assessments` <a name="risk-assessment"></a>

Collection: `risk_assessments`
Upsert key: `{district_normalised}__short`

Example: `dhaka__short`

```json
{
  "_key":         "dhaka__short",
  "_id":          "risk_assessments/dhaka__short",

  "location":     "Dhaka",
  "assessed_at":  "2026-05-01T06:00:05+00:00",
  "horizon":      "short",
  "tier":         1,
  "tier_label":   "Advisory",
  "forecast_source": "open_meteo",

  "triggers": [
    "Significant rainfall 52.3 mm/day (≥50 mm — advisory)"
  ],

  "reasoning": "Risk level 1 (Advisory) detected for Dhaka on 2026-05-03. Key triggers: Significant rainfall 52.3 mm/day (≥50 mm — advisory). Be aware and monitor conditions.",

  "raw_forecast": {
    "date": "2026-05-03",
    "temperature": { "min": 26.1, "max": 33.9, "unit": "Celsius" },
    "precipitation": { "value": 52.3, "probability": 0.88, "unit": "mm" },
    "wind": { "speed": 22.1, "direction": 210.0 },
    "humidity": 91.0,
    "extreme_flags": {
      "heatwave": false, "heavy_rain": true, "cyclone_risk": false, "drought_risk": false
    }
  }
}
```

**Risk tier thresholds (RiskEngine):**

| Tier | Label | Precipitation | Temperature | Wind | Pattern |
|---|---|---|---|---|---|
| 0 | Normal | < 50 mm/day | < 38°C | < 62 km/h | — |
| 1 | Advisory | ≥ 50 mm/day | ≥ 38°C | ≥ 62 km/h | 14+ dry days |
| 2 | Warning | ≥ 100 mm/day | ≥ 40°C | ≥ 88 km/h | 3+ day heatwave |
| 3 | Severe | ≥ 200 mm/day | ≥ 43°C | ≥ 118 km/h | — |
| 4 | Emergency | Multi-hazard combinations (IPC escalation rule: ≥2 Tier-2 triggers → +1) |

**IPC multi-hazard escalation rule:**
If two or more independent Tier-2+ triggers fire on the same day, the tier is bumped +1
(capped at 4). For example: heavy rain (100mm) + gale-force wind → both are Tier 2 → bump
to Tier 3.

---

### 4f. Document Schema: `alerts_sent` <a name="alerts-sent"></a>

Collection: `alerts_sent`
No fixed key — auto-generated `_key` on each insert.

```json
{
  "_key":      "auto-generated",
  "location":  "Dhaka",
  "tier":      2,
  "channel":   "push",
  "sent_at":   "2026-05-01T06:00:10+00:00"
}
```

This is a deduplication log. Before dispatching any alert, the notifier checks:

```python
# Suppress duplicate alerts within 12h for the same district + tier
if storage.was_alert_sent(location, tier, within_hours=12):
    return  # suppress
```

**Channel by tier:**
```
Tier 0 → log only
Tier 1 → log only (digest reviewed end-of-day by ops)
Tier 2 → FCM push to /topics/weather_{district}
Tier 3 → FCM push + Twilio SMS
Tier 4 → FCM push + Twilio SMS + voice call + broadcast webhook
```

---

### 4g. Storage Keys and Upsert Strategy <a name="upsert-keys"></a>

All weather collections use **upsert** (replace if key exists, insert if not). This means
at any given time there is **exactly one document per district per source per horizon** in
`weather_forecasts`, and **exactly one per district per horizon** in `risk_assessments`.

```python
def _norm_key(s: str) -> str:
    """Produce a valid ArangoDB _key from an arbitrary string."""
    return (
        s.lower()
        .replace(" ", "_")
        .replace("'", "")
        .replace("-", "_")
        .replace("'", "")       # handle curly apostrophe too
    )

# weather_forecasts key
key = _norm_key(f"{forecast.location}__{forecast.source}__{forecast.horizon}")
# e.g. "dhaka__open_meteo__short"
# e.g. "cox_s_bazar__open_meteo__short"

# risk_assessments key
key = _norm_key(f"{assessment.location}__{assessment.horizon}")
# e.g. "dhaka__short"
```

The upsert logic:
```python
col = self._db.collection("weather_forecasts")
doc = {"_key": key, **forecast.model_dump()}

if col.has(key):
    col.replace(doc)   # overwrite the existing document completely
else:
    col.insert(doc)    # create new document
```

This means the database does **not grow** with each run — it stays at a constant size:
64 districts × 2 (one per horizon if both short + long are stored, currently only `short`)
= 64 documents maximum in `weather_forecasts`.

---

### 4h. AQL Queries Used in Production <a name="aql-queries"></a>

**Get latest forecast for a district (with freshness check):**
```aql
FOR doc IN weather_forecasts
  FILTER doc.location  == "Dhaka"
    AND  doc.horizon   == "short"
    AND  doc.ingested_at >= "2026-05-01T00:00:00+00:00"   // max_age_hours=6 cutoff
  SORT doc.ingested_at DESC
  LIMIT 1
  RETURN doc
```

Python equivalent (from `storage.py`):
```python
stored = storage.get_latest_forecast(
    "Dhaka",
    horizon="short",
    max_age_hours=6,
)
if stored is None:
    # Cache miss — data is stale or absent
```

**Get latest risk for a district:**
```aql
FOR doc IN risk_assessments
  FILTER doc.location == "Dhaka"
    AND  doc.horizon  == "short"
  SORT doc.assessed_at DESC
  LIMIT 1
  RETURN doc
```

**Get all districts currently at Advisory tier or above:**
```aql
FOR doc IN risk_assessments
  FILTER doc.tier >= 1
  COLLECT loc = doc.location INTO grp = doc
  LET latest = FIRST(
    FOR g IN grp SORT g.assessed_at DESC RETURN g
  )
  FILTER latest.tier >= 1
  SORT latest.tier DESC
  RETURN {
    location:   latest.location,
    tier:       latest.tier,
    tier_label: latest.tier_label,
    triggers:   latest.triggers,
    assessed_at: latest.assessed_at
  }
```

**Check if alert was recently sent (deduplication):**
```aql
FOR doc IN alerts_sent
  FILTER doc.location == "Dhaka"
    AND  doc.tier     >= 2
    AND  doc.sent_at  >= "2026-05-01T00:00:00+00:00"   // 12h cutoff
  LIMIT 1
  RETURN 1
```

**Inspect what sources were used in the last run:**
```aql
FOR doc IN weather_forecasts
  FILTER doc.horizon == "short"
  SORT doc.ingested_at DESC
  COLLECT loc = doc.location INTO grp
  LET latest = FIRST(FOR g IN grp SORT g.ingested_at DESC RETURN g)
  RETURN {
    location:            latest.location,
    source:              latest.source,
    fallback_used:       latest.fallback_used,
    sense_check_passed:  latest.sense_check_passed,
    ingested_at:         latest.ingested_at
  }
```

---

## 5. Application Collections <a name="app-collections"></a>

These are owned by the `backend` Node.js service and managed via `database-operations-service.js`.

| Collection | Purpose | Key fields |
|---|---|---|
| `users` | User accounts | `_key`, `username`, `email`, `role`, `password_hash`, `preferences` |
| `sessions` | Active login sessions | `_key`, `user_id`, `token`, `expires_at`, `created_at` |
| `chat_history` | Full message history | `_key`, `user_id`, `session_id`, `messages[]`, `created_at` |
| `service_categories` | Knowledge hierarchy labels used for chunk labeling | `_key`, `name`, `parent`, `description` |
| `ingestion_log` | Per-file ingest status | `_key` = `file_id`, `status`, `chunk_count`, `error_msg` |
| `password_reset` | One-time reset tokens | `_key`, `user_id`, `token`, `expires_at` |

---

## 6. Vector Search Configuration <a name="vector-search"></a>

ArangoDB 3.12 introduced HNSW (Hierarchical Navigable Small World) approximate vector
search. MEWA enables it with the startup flag `--experimental-vector-index=true`.

**Current config:**
```
RETRIEVER_ARANGO_SEARCH_MODE=vector     ← pure vector (no BM25/hybrid)
RETRIEVER_ARANGO_USE_APPROX_SEARCH=false  ← exact cosine search (no approximation)
RETRIEVER_ARANGO_DISTANCE_STRATEGY=COSINE
RETRIEVER_ARANGO_NUM_CENTROIDS=1
RETRIEVER_ARANGO_SCORE_THRESHOLD=0.5    ← discard chunks below 0.5 similarity
RETRIEVER_ARANGO_K=5                    ← final top-K
RETRIEVER_ARANGO_FETCH_K=15             ← candidates before reranking
```

With `USE_APPROX_SEARCH=false`, the retriever does exact cosine similarity over all chunk
vectors — accurate but slower for large collections. Switch to `true` + set up an HNSW
index when the collection grows above ~50k chunks.

**Graph traversal (currently OFF):**
```
RETRIEVER_ARANGO_TRAVERSAL_ENABLED=false
RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH=3
RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED=3
```

When enabled, after finding top-K chunks by vector similarity, the retriever walks the
`belongs_to` edges in the GRAPH_TEST to also fetch neighboring chunks from the same
document. This can recover context that is nearby but not the highest scoring hit (e.g. a
header row that precedes the target data).

---

## 7. Data Lifecycle and Retention <a name="retention"></a>

### RAG chunks

Chunks have **no automatic TTL**. They persist until the document is explicitly retracted
via the UI or API. To remove all chunks for a document:

```aql
// Remove all chunks and edges for a file_id
FOR chunk IN chunk
  FILTER chunk.file_id == "1777579598916_792fbd0b"
  LET edges = (
    FOR e IN belongs_to FILTER e._from == chunk._id RETURN e._id
  )
  FOR eid IN edges REMOVE { _id: eid } IN belongs_to
  REMOVE chunk IN chunk
```

### Weather forecasts

Weather documents are **overwritten each hour**, not accumulated. The collection stays at
≤64 documents. Recommended TTL (not yet enforced): 30 days, in case of pipeline outage.

### Risk assessments

Also overwritten each hour — one per district. Collection stays at ≤64 documents.
Recommended TTL: 90 days.

### Alerts sent

These **do accumulate** (insert-only, no upsert). Each alert dispatch inserts one record.
At Tier 2+ events for 64 districts, and deduplication suppressing duplicates within 12h,
growth is slow. Recommended TTL: 7 days.

**To manually set a TTL on `alerts_sent`** (ArangoDB Web UI or arangosh):
```javascript
db.alerts_sent.ensureIndex({
  type: "ttl",
  fields: ["sent_at"],
  expireAfter: 604800  // 7 days in seconds
});
```

---

## 8. Admin and Maintenance <a name="admin"></a>

### Access the web console

```
http://<server-ip>:8529
Username: root
Password: <ARANGO_PASSWORD from .env>
Database: genie-ai
```

The web UI has a built-in AQL query editor and graph visualizer. Select GRAPH_TEST in the
Graphs view to see the document → chunk relationships.

### Run AQL queries from command line

```bash
# Interactive arangosh
docker exec -it arango-vector-db arangosh \
  --server.endpoint tcp://127.0.0.1:8529 \
  --server.username root \
  --server.password "${ARANGO_PASSWORD}" \
  --server.database genie-ai

# One-shot AQL
docker exec arango-vector-db arangosh \
  --server.endpoint tcp://127.0.0.1:8529 \
  --server.username root \
  --server.password "${ARANGO_PASSWORD}" \
  --server.database genie-ai \
  --javascript.execute-string \
  'db._query("FOR d IN weather_forecasts LIMIT 3 RETURN d").toArray().forEach(d => print(JSON.stringify(d)))'
```

### Back up the database

```bash
# Logical backup (slow but portable)
docker exec arango-vector-db arangodump \
  --server.endpoint tcp://127.0.0.1:8529 \
  --server.username root \
  --server.password "${ARANGO_PASSWORD}" \
  --server.database genie-ai \
  --output-directory /var/lib/arangodb3/dump

# Copy the dump out
docker cp arango-vector-db:/var/lib/arangodb3/dump ./database_backups/$(date +%Y%m%d_%H%M)/
```

Or back up the raw data directory (fast, requires container stop):
```bash
docker compose stop arango-vector-db
cp -r /root/arango_data /root/arango_data.backup.$(date +%Y%m%d)
docker compose start arango-vector-db
```

### Inspect chunks for a specific document

```bash
# From the backend container (inspect-chunks.js)
docker exec genieai_mvp-backend-1 node scripts/new-schema-scripts/inspect-chunks.js
```

Or via AQL in the web console:
```aql
FOR c IN chunk
  FILTER c.file_name == "potatoe_test.md"
  SORT c.chunk_index ASC
  RETURN { idx: c.chunk_index, text: LEFT(c.text, 120), labels: c.labels }
```

### Check weather data freshness

```aql
FOR doc IN weather_forecasts
  FILTER doc.horizon == "short"
  SORT doc.ingested_at DESC
  RETURN {
    location:    doc.location,
    source:      doc.source,
    ingested_at: doc.ingested_at,
    fallback:    doc.fallback_used
  }
```

### Initialise schema on a fresh database

```bash
cd /root/mewa_v2/components/gov-chat-backend
node scripts/new-schema-scripts/arango-schema-creator.js ./arango-schema.json
```

This is an interactive script — it prompts for confirmation before writing.
Collections that already exist are skipped (idempotent).
