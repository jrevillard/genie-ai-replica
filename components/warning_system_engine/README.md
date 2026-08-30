# Warning System Engine

Standalone Docker container that owns the full early warning pipeline for the MEWA  platform. It classifies weather and crop risk, writes results to ArangoDB, and dispatches push/SMS notifications. It runs on its own schedule and does not serve HTTP requests.

---

## Position in the MEWA v2 Stack

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              MEWA Platform                                │
│                                                                              │
│  ┌────────────────────────┐          ┌──────────────────────────────────┐   │
│  │   gov-chat-backend     │          │       gov-chat-frontend           │   │
│  │   (FastAPI + RAG)      │◄────────►│       (React / mobile)           │   │
│  └───────────┬────────────┘          └──────────────────────────────────┘   │
│              │ MCP                                                            │
│              ▼                                                                │
│  ┌───────────────────────────┐                                               │
│  │   weather-mcp-service     │  ← READ ONLY from ArangoDB                   │
│  │   (FastAPI + WeatherAgent)│◄──────────────────────────────────────────┐  │
│  │                           │  /risk/latest                             │  │
│  │   • Natural-language      │  /potato/risk/latest                      │  │
│  │     weather queries       │  /seasonal (Copernicus)                   │  │
│  │   • MCP tool server       │                                           │  │
│  │   • Data ingestion        │                                           │  │
│  │     (Open-Meteo / BMD)    │                                           │  │
│  └───────────────────────────┘                                           │  │
│                                                              ┌────────────┴─┐ │
│                                                              │  ArangoDB    │ │
│  ┌───────────────────────────┐     WRITES                   │              │ │
│  │   warning_system_engine   │─────────────────────────────►│ Collections: │ │
│  │   (Pure background worker)│                              │  weather_    │ │
│  │                           │                              │  forecasts   │ │
│  │   • Daily EWS (05:00 UTC) │                              │  risk_       │ │
│  │   • Weekly Copernicus     │                              │  assessments │ │
│  │   • Drought (07:00 UTC)   │                              │  seasonal_   │ │
│  │   • Hourly BAMIS watcher  │                              │  forecasts   │ │
│  │   • Push / SMS alerts     │                              │  seasonal_   │ │
│  └───────────────────────────┘                              │  assessments │ │
│          ▲             ▲                                     │  alerts_sent │ │
│          │             │                                     │  special_    │ │
│  Copernicus CDS   BAMIS special                             │  bulletins   │ │
│  (SEAS5 ECMWF)    bulletins                                 └──────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key separation:** `weather-mcp-service` owns data ingestion (Open-Meteo, BMD scraping) and HTTP endpoints. `warning_system_engine` owns risk classification, EWS logic, scheduling, and alert dispatch. The two services communicate exclusively through ArangoDB — no direct HTTP dependency between them.

---

## Package Structure

```
warning_system_engine/
│
├── app/
│   ├── main.py                          — Entrypoint: wires all components, starts scheduler
│   │
│   ├── core/
│   │   ├── models.py                    — Pydantic schemas: UnifiedForecast, RiskAssessment, …
│   │   ├── storage.py                   — ArangoDB persistence layer (all collections)
│   │   ├── risk_engine.py               — Stateless Tier 0–4 general weather classifier
│   │   ├── notifier.py                  — Alert dispatch: FCM push / Twilio SMS / voice / webhook
│   │   ├── scheduler.py                 — APScheduler jobs: all pipelines and timings
│   │   └── crop_profile_loader.py       — Typed accessors for example_crop_profile.json
│   │
│   ├── integrations/
│   │   ├── copernicus/
│   │   │   └── fetcher.py               — Downloads SEAS5 NetCDF from Copernicus CDS, parses, stores
│   │   └── bamis/
│   │       └── special_bulletin.py      — Hourly scraper for BAMIS special weather bulletins
│   │
│   ├── workflows/
│   │   ├── short_term/
│   │   │   └── potato_ews.py            — Deterministic 48-hour potato risk evaluator
│   │   └── long_term/
│   │       ├── potato_ews.py            — Deterministic 5-month seasonal potato risk evaluator
│   │       └── drought_ews.py           — Reads drought_assessments; dispatches drought alerts
│   │
│   └── crops/
│       └── <crop>/                      — Auto-generated per crop by build_crop_profiles_pipeline.py
│           ├── __init__.py
│           ├── profile.py               — <CropName>Thresholds dataclass + loader
│           └── risk_engine.py           — Per-day threshold evaluator + disease detectors
│
├── data/
│   ├── example_crop_profile.json        — Weekly baselines + thresholds for all crop × region pairs
│   └── bamis_metadata.json              — BAMIS climate records (source for profile generation)
│
├── scripts/
│   ├── parse_bamis_pdfs.py              — Step 1: PDF → structured climate records (pdfplumber)
│   ├── build_crop_profiles_pipeline.py  — Master pipeline: PDF → JSON → Python modules
│   ├── generate_crop_modules.py         — Step 3: JSON → app/crops/<crop>/ Python files
│   ├── enrich_crop_profiles.py          — Step 2: bamis_metadata.json → example_crop_profile.json
│   ├── test_potato_ews.py               — End-to-end smoke test for potato EWS
│   └── POTATO_EWS_TEST_GUIDE.md         — Test scenario reference
│
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Data Pipeline: PDFs → Runtime

Before the EWS pipelines can run, crop knowledge must flow from BAMIS PDFs through to Python modules. The `scripts/build_crop_profiles_pipeline.py` automates this end-to-end.

```
  BAMIS Website
  (bamis.gov.bd)
       │
       │  crawl_bamis.py (weather-mcp-service/scripts)
       │  Downloads: raw/<crop>/<region>/<crop>_<region>.pdf
       ▼
  Raw PDFs
  (one per crop × region, 34 crops × 14 regions)
       │
       │  Step 1 — parse_bamis_pdfs.py
       │  Row-oriented table extraction (pdfplumber)
       │  Infers crop + region from filename
       ▼
  bamis_metadata.json
  [{"crop":"potato","region":"dhaka","week_number":42,
    "crop_stage":"Sprouting","max_temp_c":32.0,...}, ...]
       │
       │  Step 2 — enrich_crop_profiles.py
       │  Aggregates per stage, derives thresholds,
       │  maps disease risk conditions
       ▼
  example_crop_profile.json
  {"potato_dhaka": {"season_span":..., "growth_stages":...,
    "weekly_calendar":..., "crop_rules":..., "disease_risks":...}}
       │
       │  Step 3 — generate_crop_modules.py
       │  Emits Python files for every crop × its disease rules
       ▼
  app/crops/<crop>/
  ├── profile.py       ← <CropName>Thresholds dataclass + load_<crop>_thresholds()
  └── risk_engine.py   ← evaluate_<crop>_day() + detect_<disease>() functions
       │
       │  Imported at runtime by
       ▼
  app/workflows/short_term/<crop>_ews.py
  app/workflows/long_term/<crop>_ews.py
```

### Why row-oriented PDF extraction matters

Standard PDF extractors (PyMuPDF, pdfminer) read tables **column by column**, which destroys the relationship between a growth stage and its month. A BAMIS calendar table like:

```
│ Stage            │ Month    │ Week │ Max Temp │ Min Temp │ Rainfall │
├──────────────────┼──────────┼──────┼──────────┼──────────┼──────────┤
│ Tuber Initiation │ November │  48  │  28.3    │  16.1    │   4.5    │
│ Tuber Bulking    │ December │  51  │  25.5    │  13.5    │   1.0    │
```

…gets extracted as three separate chunks (stage column, month column, temp column), so no single chunk ever contains both the stage name and its month. `parse_bamis_pdfs.py` uses `pdfplumber`'s row-level table API to yield one complete record per row, preserving all relationships.

---

### Running the pipeline

```bash
# Full run — from raw PDFs to Python modules
python scripts/build_crop_profiles_pipeline.py \
    --pdf-dir /data/raw_pdfs

# Skip PDF parsing if bamis_metadata.json is already current
python scripts/build_crop_profiles_pipeline.py \
    --pdf-dir /data/raw_pdfs --skip-parse

# Regenerate Python modules only (JSON already current)
python scripts/build_crop_profiles_pipeline.py \
    --skip-parse --skip-enrich

# Single crop rebuild
python scripts/build_crop_profiles_pipeline.py \
    --pdf-dir /data/raw_pdfs --crop tomato --region dhaka

# Inside the running container
docker exec -it warning-system-engine \
    python /app/scripts/build_crop_profiles_pipeline.py \
    --pdf-dir /data/raw_pdfs
```

Pipeline flags:

| Flag | Effect |
|---|---|
| `--pdf-dir PATH` | Root directory of raw BAMIS PDFs |
| `--data-dir PATH` | Output directory for JSON artefacts (default: `data/`) |
| `--crops-dir PATH` | Output directory for Python modules (default: `app/crops/`) |
| `--crop NAME` | Process only this crop (e.g. `potato`, `tomato`) |
| `--region NAME` | Process only this region (e.g. `dhaka`, `bogura`) |
| `--skip-parse` | Use existing `bamis_metadata.json` |
| `--skip-enrich` | Use existing `example_crop_profile.json` |
| `--skip-generate` | Stop after JSON; do not emit Python files |
| `--no-overwrite` | Skip crops whose module directory already exists |

### What gets generated per crop

For each crop present in `example_crop_profile.json`, the pipeline writes:

**`app/crops/<crop>/profile.py`**
```python
# Example: app/crops/tomato/profile.py  (auto-generated)

@dataclass(frozen=True)
class TomatoThresholds:
    region: str
    temp_min: float      # 10.0 °C  (derived from BAMIS season data)
    temp_max: float      # 35.0 °C
    humidity_min: float  # 60.0 %
    humidity_max: float  # 90.0 %
    rain_medium: float   # 25.0 mm/day  — medium severity
    rain_critical: float # 100.0 mm/day — critical severity
    wind_max: float      # 30.0 km/h

def load_tomato_thresholds(region: str = "dhaka") -> TomatoThresholds:
    # loads from data/example_crop_profile.json
    # falls back to first available region if 'dhaka' not present
    ...
```

**`app/crops/<crop>/risk_engine.py`**
```python
# Example: app/crops/tomato/risk_engine.py  (auto-generated)

def evaluate_tomato_day(day: DailyForecastPoint, t: TomatoThresholds) -> list[str]:
    # checks temp_min, temp_max, humidity range, rain thresholds, wind

def detect_late_blight(day: DailyForecastPoint) -> str | None:
    temp_mean = (day.temp_min + day.temp_max) / 2.0
    if (14 <= temp_mean <= 20) and (day.humidity_max >= 90) and (day.rain_mm >= 1):
        return "Late Blight risk: weather conditions match threshold"
    return None

# Diseases with evaluable_with_current_feeds=false are commented out:
# termite (needs: fog, cloud_cover)
# wire_worm (needs: soil_temperature)

def get_disease_risks(day: DailyForecastPoint) -> list[str]: ...
def classify_tier(triggers, flood_confirmed=False) -> tuple[int, str]: ...
def build_push_message(assessment: dict) -> str: ...
```

---

## Four EWS Pipelines

### 1. Short-Term Pipeline — daily 05:00 UTC

Reads the 48-hour forecast already stored by `weather-mcp-service` and evaluates it for all 20 Bangladesh districts.

```
ArangoDB                     warning_system_engine
weather_forecasts
                             for each of 20 districts:
     ──────────────────►     ┌──────────────────────────────────────┐
                             │ 1. get_latest_forecast_pair()         │
                             │    Open-Meteo (preferred) + BMD       │
                             │    picks the sense-checked source     │
                             └──────────────┬───────────────────────┘
                                            │
                             ┌──────────────▼───────────────────────┐
                             │ 2. RiskEngine.classify()              │
                             │    WMO thresholds: rain / heat / wind │
                             │    multi-day pattern detection        │
                             │    IPC multi-hazard escalation rule   │
                             └──────────────┬───────────────────────┘
                                            │
                             ┌──────────────▼───────────────────────┐
                             │ 3. PotatoShortTermEWS.evaluate()      │
                             │    today + tomorrow against crop rules│
                             │    detect_late_blight()               │
                             │    _dedup_by_category()               │
                             │    classify_tier()                    │
                             └──────────────┬───────────────────────┘
                                            │
                             ┌──────────────▼───────────────────────┐
                             │ 4. StorageLayer.upsert_*assessment()  │──► risk_assessments
                             └──────────────┬───────────────────────┘    (keyed by location)
                                            │ if tier ≥ 2
                             ┌──────────────▼───────────────────────┐
                             │ 5. Notifier.dispatch()                │──► FCM push   (≥ 2)
                             │    12-hour dedup window               │    Twilio SMS  (≥ 3)
                             └──────────────────────────────────────┘    Voice/webhook (4)
```

**General risk tier table**

| Tier | Label     | Rain (mm/day) | Heat (°C) | Wind (km/h) | Action                       |
|------|-----------|---------------|-----------|-------------|------------------------------|
| 0    | Normal    | < 50          | < 38      | < 62        | Monitor                      |
| 1    | Advisory  | ≥ 50          | ≥ 38      | ≥ 62        | Increased monitoring         |
| 2    | Warning   | ≥ 100         | ≥ 40      | ≥ 88        | Take precautions → FCM push  |
| 3    | Severe    | ≥ 200         | ≥ 43      | ≥ 118       | Protective action → SMS      |
| 4    | Emergency | Multi-hazard  | —         | —           | Catastrophic → Voice + gov   |

Multi-hazard escalation (IPC rule): two independent Tier-2+ triggers on the same day → +1 tier (capped at 4).

**Potato-specific short-term example output**

```jsonc
// ArangoDB: risk_assessments / key: "dhaka__short__potato"
{
  "location": "Dhaka",
  "crop": "potato",
  "horizon": "short",
  "forecast_date": "2026-11-10",
  "assessed_at": "2026-11-10T05:00:14Z",
  "tier": 2,
  "tier_label": "Warning",
  "forecast_source": "open_meteo",
  "sense_check_passed": true,
  "fallback_used": false,
  "triggers": [
    "Max temperature 31.2°C exceeds Potato limit 30°C",
    "Humidity 83.0% outside Potato range 65–80%"
  ],
  "disease_risks": [],
  "message": "Potato warning for Dhaka on 2026-11-10: Max temperature 31.2°C exceeds Potato limit 30°C. Take protective action today."
}
```

---

### 2. Long-Term Pipeline — weekly Monday 06:00 UTC

Fetches the ECMWF SEAS5 5-month seasonal outlook and compares it against crop profile baselines.

```
Copernicus CDS                warning_system_engine
(ECMWF SEAS5)
                              1. CopernicusFetcher.fetch_and_store()
     ──────────────────►         Variables: t2m, tp, u10, v10, d2m
                                 Area: Bangladesh bbox [26.5°N, 88°E, 20.5°N, 92.7°E]
                                 Format: NetCDF, 25 ensemble members
                                 Converts:
                                   K → °C  (temperature)
                                   m/day × days_in_month × 1000 → mm/month
                                   √(u²+v²) × 3.6 → km/h
                                   Magnus formula → estimated RH%
                                            │
                                            ▼
                              2. upsert_seasonal_forecast() × 20 districts
                                 nearest-neighbour grid extraction ──────────────► seasonal_forecasts
                                            │
                                            ▼
                              3. LongTermPotatoEWS.evaluate_all()
                                 for each district × each forecast month:
                                   a. stages_for_month()   ← crop_profile_loader
                                   b. baseline_for_month() ← weekly calendar aggregation
                                   c. absolute threshold checks  (temp_max, temp_min)
                                   d. deviation checks (Δ from baseline mean)
                                   e. precipitation ratio checks (×1.5 / ×2.5 / ×0.3)
                                   f. late blight humidity check
                                   g. classify tier 0–3
                                            │
                                            ▼──────────────────────────────────► seasonal_assessments
```

**SEAS5 unit conversions**

| SEAS5 variable | Raw unit | Conversion | Stored as |
|---|---|---|---|
| `t2m` | Kelvin | `− 273.15` | `mean_temp_c` |
| `tp` | m/day | `× 1000 × days_in_month` | `total_precip_mm` |
| `u10`, `v10` | m/s | `√(u²+v²) × 3.6` | `mean_wind_kmh` |
| `d2m` | Kelvin | Magnus formula → RH% | `estimated_rh_pct` |

Magnus formula:
```
RH = 100 × exp(17.625 × Td / (243.04 + Td))
           / exp(17.625 × T  / (243.04 + T ))
```
Tagged `copernicus_partial` in `rule_support` because SEAS5 does not provide RH directly.

**Seasonal tier table**

| Tier | Label    | Condition |
|------|----------|-----------|
| 0    | Normal   | All monthly values within acceptable crop ranges |
| 1    | Advisory | Temp +2–4 °C above baseline, or precip 1.5–2.5× norm |
| 2    | Warning  | Temp approaching/exceeding threshold, or major rainfall anomaly |
| 3    | Severe   | Temp > crop max, critical rainfall ratio, or late blight risk |

Max tier is 3 — seasonal uncertainty is too high to support Tier 4 Emergency.

**Seasonal assessment example output**

```jsonc
// ArangoDB: seasonal_assessments / key: "dhaka__potato__2026_11"
{
  "location": "Dhaka",
  "crop": "potato",
  "target_month": "2026-11",
  "stages": ["Vegetative Growth", "Tuber Set/Initiation"],
  "tier": 1,
  "tier_label": "Advisory",
  "triggers": [
    "Monthly mean temp 28.4°C is +3.0°C above stage baseline 25.4°C"
  ],
  "rule_support": {
    "temperature": "copernicus_ready",
    "precipitation": "copernicus_ready",
    "humidity": "copernicus_partial"
  },
  "assessed_at": "2026-11-04T06:10:22Z"
}
```

**Graceful degradation:** If `CDSAPI_KEY` is not set and `~/.cdsapirc` does not exist, `CopernicusFetcher._cds_configured()` returns `False`, the weekly job is never registered, and short-term continues normally.

**Season filtering:** `CropProfileLoader.stages_for_month()` returns an empty list for months outside the potato season (roughly June–September). The engine skips those months with zero ArangoDB writes, making the off-season pass cost-free.

---

### 3. Drought Pipeline — daily 07:00 UTC

Runs after the short-term pipeline. Calls the `drought_monitoring` container to trigger GEE-based soil moisture and vegetation analysis, then reads the stored results and dispatches alerts.

```
drought_monitoring ──POST /run/all──► ArangoDB drought_assessments
                                              │
  app/workflows/long_term/drought_ews.py ────►│  read + dispatch
                                              │
                                       Notifier.dispatch()
                                       (severity MODERATE+ → FCM push)
```

Requires `DROUGHT_MONITORING_URL` env var. Skipped silently if not set.

---

### 4. BAMIS Special Bulletin Watcher — every hour

`app/integrations/bamis/special_bulletin.py` scrapes the BAMIS special bulletin archive, stores newly detected bulletins in `special_bulletins`, and pushes each new bulletin exactly once.

Controlled by `BAMIS_SPECIAL_BULLETIN_ENABLED=true` (default on). Disable via env var.

---

## Scheduler

```
Container startup (app/main.py)
    │
    ├── +10 s  ─► Short-term catch-up (run_daily_pipeline)
    ├── +30 s  ─► BAMIS bulletin check (first hourly tick)
    ├──  +5 s  ─► Copernicus startup seed           [only if CDS configured]
    │              (skips if seasonal data < 7 days old;
    │               force with COPERNICUS_STARTUP_SEED_FORCE=true)
    └── +120 s ─► Drought catch-up                  [only if DROUGHT_MONITORING_URL set]

Every day  05:00 UTC ─► run_daily_pipeline
Every day  07:00 UTC ─► run_drought_pipeline        [conditional]
Every Mon  06:00 UTC ─► run_long_term_pipeline      [conditional]
Every hour            ─► run_bamis_special_bulletin_pipeline
```

`misfire_grace_time=86400` — if the container was down at the scheduled time, APScheduler reruns the job on restart as long as the miss was under 24 hours.

---

## Notification System

`app/core/notifier.py` routes alerts through multiple channels, with a 12-hour deduplication window per location+crop+tier combination.

```
Tier 0  Normal     ─►  structured log only
Tier 1  Advisory   ─►  log (ops digest)
Tier 2  Warning    ─►  backend broadcast → FCM push to district subscribers
Tier 3  Severe     ─►  broadcast + Twilio SMS to emergency contacts
Tier 4  Emergency  ─►  broadcast + SMS + Twilio Voice IVR + gov webhook
```

All channels are opt-in via env vars. Missing keys are logged and skipped gracefully — the engine always starts.

**Backend broadcast** (`BACKEND_API_URL` / `NOTIFICATION_BROADCAST_URL`): Posts a structured JSON payload to the gov-chat-backend notification endpoint, which fan-outs to device tokens subscribed by district/crop. This is the primary channel; FCM topic is the fallback for legacy deployments.

---

## Crop Profile (`data/example_crop_profile.json`)

Auto-generated by the pipeline. Keyed as `{crop}_{region}` — e.g. `potato_dhaka`, `tomato_bogura`.

```jsonc
{
  "potato_dhaka": {
    "crop": "potato",
    "region": "dhaka",
    "season_span": {
      "weeks": [42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 1, 2, 3, 4],
      "months": ["October", "November", "December", "January"],
      "duration_weeks": 15
    },
    "growth_stages": [
      {
        "stage": "Sprouting",
        "weeks": [42],
        "months": ["October"],
        "week_count": 1,
        "climate_stats": {
          "temp_max_c": { "mean": 32.0, "min": 32.0, "max": 32.0 },
          "temp_min_c": { "mean": 23.8, "min": 23.8, "max": 23.8 },
          "rainfall_mm": { "mean": 40.5, "sum": 40.5 }
        }
      }
      // … 6 more stages
    ],
    "weekly_calendar": [
      {
        "week": 42, "month": "October", "stage": "Sprouting",
        "temp_min_c": 23.8, "temp_max_c": 32.0, "temp_mean_c": 27.9,
        "rainfall_mm": 40.5, "rh_max_pct": 95.0, "rh_min_pct": 60.2
      }
      // … 14 more weeks
    ],
    "crop_rules": {
      "temperature_min": { "min": 10 },
      "temperature_max": { "max": 30 },
      "humidity":        { "min": 65, "max": 80 },
      "rainfall_daily":  [
        { "severity": "medium",   "min": 25 },
        { "severity": "critical", "min": 100 }
      ],
      "wind_speed_kmh":  { "max": 30 }
    },
    "disease_risks": [
      {
        "name": "late_blight",
        "when": {
          "temperature_mean": { "min": 16, "max": 20 },
          "humidity":         { "min": 90 },
          "precipitation":    { "min": 1 }
        },
        "evaluable_with_current_feeds": true
      },
      {
        "name": "potato_wire_worm",
        "when": { "soil_temperature": { "min": 10, "max": 27 } },
        "evaluable_with_current_feeds": false,   // soil_temp not in current feeds
        "requires_additional_variables": ["soil_temperature"]
      }
    ]
  }
}
```

`app/core/crop_profile_loader.py` provides typed accessors so workflows never parse JSON directly:
- `stages_for_month(month)` → list of stage names active that month
- `baseline_for_month(month)` → aggregated climate stats across overlapping weeks
- `temp_thresholds()` → (temp_min, temp_max) tuple from `crop_rules`

---

## ArangoDB Collections

| Collection | Document key pattern | Written by | Read by |
|---|---|---|---|
| `weather_forecasts` | `{location}__{source}__short` | weather-mcp-service | warning_system_engine |
| `risk_assessments` | `{location}__short` or `…__short__{crop}` | warning_system_engine | weather-mcp-service |
| `alerts_sent` | auto | warning_system_engine | warning_system_engine |
| `seasonal_forecasts` | `{location}__copernicus__long` | warning_system_engine | weather-mcp-service |
| `seasonal_assessments` | `{location}__{crop}__{YYYY_MM}` | warning_system_engine | weather-mcp-service |
| `drought_assessments` | `{location}__drought` | drought_monitoring | warning_system_engine |
| `special_bulletins` | hash of bulletin content | warning_system_engine | warning_system_engine |

---

## Configuration

Copy `.env.example` to `.env`. All variables are optional unless marked Required.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ARANGO_URL` | Yes | `http://arango-vector-db:8529` | ArangoDB host |
| `ARANGO_DB_NAME` | Yes | `genie-ai` | Database name |
| `ARANGO_USER` | Yes | `root` | ArangoDB user |
| `ARANGO_PASSWORD` | Yes | — | ArangoDB password |
| `BAMIS_PDF_DIR` | No | `/data/raw_pdfs` | Host path mounted into container for raw BAMIS PDFs |
| `BAMIS_DATA_DIR` | No | `/app/data` | Path inside container for generated JSON artefacts |
| `DROUGHT_MONITORING_URL` | No | — | drought_monitoring container URL; drought pipeline disabled if absent |
| `CDSAPI_URL` | No | `https://cds.climate.copernicus.eu/api` | Copernicus CDS endpoint |
| `CDSAPI_KEY` | No | — | CDS API key — long-term pipeline disabled if absent |
| `COPERNICUS_MONTHS_AHEAD` | No | `5` | Months of SEAS5 to fetch (max 6) |
| `COPERNICUS_STARTUP_SEED_ENABLED` | No | `true` | Fetch Copernicus data at startup when seasonal data is missing |
| `COPERNICUS_STARTUP_SEED_DELAY_SECONDS` | No | `5` | Delay before startup Copernicus seed |
| `COPERNICUS_STARTUP_SEED_FORCE` | No | `false` | Re-fetch at startup even when seasonal data already exists |
| `BAMIS_SPECIAL_BULLETIN_ENABLED` | No | `true` | Enable hourly BAMIS bulletin watcher |
| `FCM_SERVER_KEY` | No | — | Firebase Cloud Messaging server key |
| `TWILIO_ACCOUNT_SID` | No | — | Twilio credentials for SMS / voice |
| `TWILIO_AUTH_TOKEN` | No | — | Twilio auth token |
| `TWILIO_PHONE_FROM` | No | — | Twilio sender number |
| `EMERGENCY_CONTACT_NUMBERS` | No | — | Comma-separated numbers for Tier 3+ SMS/voice |
| `BROADCAST_WEBHOOK_URL` | No | — | Government broadcast endpoint (Tier 4) |
| `NOTIFICATION_BROADCAST_URL` | No | — | Backend notification endpoint (overrides auto-resolve) |
| `BACKEND_API_URL` | No | — | Base URL of gov-chat-backend (auto-resolves broadcast URL) |
| `NOTIFICATION_BROADCAST_SECRET` | No | — | Shared secret for backend broadcast auth header |
| `LOG_LEVEL` | No | `INFO` | Python log level |

---

## Running

### With Docker Compose

The engine attaches to the shared `mewa-net` network alongside `arango-vector-db`.

```bash
# From warning_system_engine/
docker compose up -d --build

# With raw PDFs mounted (for pipeline rebuild)
BAMIS_PDF_DIR=/path/to/raw_pdfs docker compose up -d --build
```

### Standalone (development)

```bash
cd components/warning_system_engine
cp .env.example .env
# Edit .env — set ARANGO_URL, ARANGO_PASSWORD at minimum

pip install -r requirements.txt
python -m app.main
```

### Full data refresh (after BAMIS re-crawl)

```bash
# 1. Crawl all BAMIS PDFs (run from weather-mcp-service side)
cd components/weather-mcp-service/scripts
python crawl_bamis.py
# PDFs land in: mcp_weather/data/agri_data/raw/<crop>/<region>/<crop>_<region>.pdf

# 2. Run the full pipeline inside the container
docker exec -it warning-system-engine python /app/scripts/build_crop_profiles_pipeline.py \
    --pdf-dir /data/raw_pdfs

# Pipeline output:
#   /app/data/bamis_metadata.json          (6000+ climate + advisory records)
#   /app/data/example_crop_profile.json    (one rich profile per crop × region)
#   /app/crops/<crop>/profile.py           (generated thresholds module)
#   /app/crops/<crop>/risk_engine.py       (generated evaluator + disease detectors)
```

### Test the Potato EWS end-to-end

```bash
# Requires ArangoDB reachable (set ARANGO_URL in env if not default)
cd components/warning_system_engine
python3 scripts/test_potato_ews.py --scenario heat --district Dhaka
python3 scripts/test_potato_ews.py --scenario combined

# From inside the container
docker exec -it warning-system-engine \
    python3 /app/scripts/test_potato_ews.py --scenario late_blight
```

See `scripts/POTATO_EWS_TEST_GUIDE.md` for the full scenario reference.

---

## Division of Responsibility

| Concern | warning_system_engine | weather-mcp-service |
|---|---|---|
| Ingest Open-Meteo / BMD data | No | Yes (`data_ingestor.py`, hourly) |
| Classify weather risk (tier 0–4) | Yes (`core/risk_engine.py`) | No |
| Classify crop risk — short-term | Yes (`workflows/short_term/`) | No |
| Classify crop risk — long-term | Yes (`workflows/long_term/`) | No |
| Fetch Copernicus SEAS5 | Yes (`integrations/copernicus/`) | No |
| Watch BAMIS special bulletins | Yes (`integrations/bamis/`) | No |
| Parse BAMIS crop PDFs | Yes (`scripts/parse_bamis_pdfs.py`) | Crawl only |
| Build crop profiles from PDFs | Yes (`scripts/build_crop_profiles_pipeline.py`) | No |
| Generate crop Python modules | Yes (`scripts/generate_crop_modules.py`) | No |
| Schedule all EWS jobs | Yes (`core/scheduler.py`) | No |
| Send push / SMS / voice alerts | Yes (`core/notifier.py`) | No |
| Serve HTTP endpoints | No | Yes (FastAPI) |
| Answer natural-language queries | No | Yes (WeatherAgent + MCP) |
| Write `risk_assessments` | Yes | No |
| Write `seasonal_forecasts` | Yes | No |
| Read `seasonal_forecasts` (chatbot) | No | Yes |
| Read `weather_forecasts` (EWS input) | Yes | Yes (agent context) |
