# Warning System Engine

Standalone Docker container that owns the full early warning pipeline for the MEWA v2 platform. It classifies weather and crop risk, writes results to ArangoDB, and dispatches push/SMS notifications. It runs on its own schedule and does not serve HTTP requests.

---

## Position in the Stack

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              MEWA v2 Platform                                 │
│                                                                               │
│  ┌─────────────────────────┐          ┌────────────────────────────────────┐  │
│  │   gov-chat-backend      │          │         gov-chat-frontend          │  │
│  │   (FastAPI + RAG)       │◄────────►│         (React / mobile)          │  │
│  └────────────┬────────────┘          └────────────────────────────────────┘  │
│               │ MCP                                                            │
│               ▼                                                                │
│  ┌────────────────────────────┐                                               │
│  │   weather-mcp-service      │  READ ONLY from ArangoDB                      │
│  │   (FastAPI + WeatherAgent) │◄─────────────────────────────────────────┐    │
│  │                            │  /risk/latest                            │    │
│  │   • Natural-language       │  /potato/risk/latest                     │    │
│  │     weather queries        │  /seasonal (Copernicus)                  │    │
│  │   • MCP tool server        │                                          │    │
│  │   • Data ingestion         │                                          │    │
│  │     (Open-Meteo / BMD)     │                                          │    │
│  └────────────────────────────┘                                          │    │
│                                                               ┌──────────┴──┐  │
│                                                               │  ArangoDB   │  │
│                                                               │             │  │
│  ┌────────────────────────────┐     WRITES                   │ Collections:│  │
│  │   warning_system_engine    │─────────────────────────────►│  weather_   │  │
│  │   (Pure background worker) │                              │  forecasts  │  │
│  │                            │                              │  risk_      │  │
│  │   • Daily EWS pipeline     │                              │  assessments│  │
│  │   • Weekly Copernicus      │                              │  seasonal_  │  │
│  │   • Hourly BAMIS watcher   │                              │  forecasts  │  │
│  │   • Push / SMS alerts      │                              │  seasonal_  │  │
│  └────────────────────────────┘                              │  assessments│  │
│          ▲             ▲                                      │  alerts_    │  │
│          │             │                                      │  sent       │  │
│   Copernicus CDS   BAMIS special                             │  special_   │  │
│   (SEAS5 ECMWF)    bulletins                                 │  bulletins  │  │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Key separation:** `weather-mcp-service` owns data ingestion (Open-Meteo, BMD/BAMIS scraping) and HTTP endpoints. `warning_system_engine` owns risk classification, EWS logic, scheduling, and alert dispatch. The two services communicate exclusively through ArangoDB — no direct HTTP dependency between them.

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
│   │   └── crop_profile_loader.py       — Reads example_crop_profile.json; stage/baseline helpers
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
│       └── potato/
│           ├── profile.py               — Potato threshold constants and dataclass
│           └── risk_engine.py           — Per-day potato rule evaluation (short-term)
│
├── data/
│   ├── example_crop_profile.json        — Weekly baselines + thresholds for potato (Dhaka)
│   └── bamis_metadata.json              — BMD/BAMIS station reference data
│
├── scripts/
│   ├── test_potato_ews.py               — End-to-end smoke test for potato EWS + frontend pop-out
│   ├── POTATO_EWS_TEST_GUIDE.md         — Guide for running the test script
│   ├── enrich_crop_profile.py           — Builds crop profiles from BAMIS metadata (one profile)
│   └── enrich_crop_profiles.py          — Builds all crop × region profiles from BAMIS metadata
│
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Four Pipelines

### 1. Short-Term Pipeline (daily, 05:00 UTC)

Evaluates the 7-day forecast window for all 20 Bangladesh districts.

```
                    ┌─────────────────────────────────────────────┐
                    │            Daily Pipeline (05:00 UTC)        │
                    │                                              │
  ArangoDB          │                                              │
  weather_forecasts │  for each district:                          │
         ──────────►│  ┌──────────────────────────────┐           │
                    │  │ 1. read stored forecast       │           │
                    │  │    (open_meteo + bmd pair)    │           │
                    │  └──────────────┬───────────────┘           │
                    │                 │                             │
                    │  ┌──────────────▼───────────────┐           │
                    │  │ 2. RiskEngine.classify()      │           │
                    │  │    tier 0–4, WMO thresholds   │           │
                    │  │    multi-day pattern detection │           │
                    │  └──────────────┬───────────────┘           │
                    │                 │                             │
                    │  ┌──────────────▼───────────────┐           │
                    │  │ 3. store RiskAssessment       │           │──► ArangoDB
                    │  │    risk_assessments           │           │    risk_assessments
                    │  └──────────────┬───────────────┘           │
                    │                 │ if tier ≥ 2                │
                    │  ┌──────────────▼───────────────┐           │
                    │  │ 4. Notifier.dispatch()        │           │──► FCM push
                    │  │    dedup check (12 h window)  │           │    Twilio SMS
                    │  └──────────────────────────────┘           │    (tier ≥ 3)
                    │                                              │
                    │  ┌──────────────────────────────┐           │
                    │  │ 5. PotatoShortTermEWS         │           │
                    │  │    per-district potato check  │           │──► ArangoDB
                    │  │    detect late blight         │           │    risk_assessments
                    │  └──────────────────────────────┘           │    (crop-keyed)
                    └─────────────────────────────────────────────┘
```

**Standalone mode:** The engine reads forecasts already stored in `weather_forecasts` by the Open-Meteo ingestor running inside `weather-mcp-service`. If the collection is empty or stale (>30 h), the district is skipped for that run.

#### General Risk Tier Table

| Tier | Label     | Rain (mm/day) | Heat (°C) | Wind (km/h) | Notes                          |
|------|-----------|---------------|-----------|-------------|--------------------------------|
| 0    | Normal    | < 50          | < 38      | < 62        | All within seasonal norms      |
| 1    | Advisory  | ≥ 50          | ≥ 38      | ≥ 62        | Monitor conditions             |
| 2    | Warning   | ≥ 100         | ≥ 40      | ≥ 88        | Take precautions               |
| 3    | Severe    | ≥ 200         | ≥ 43      | ≥ 118       | Immediate protective action    |
| 4    | Emergency | Multi-hazard  | —         | —           | Catastrophic combined risk     |

Multi-hazard escalation (IPC rule): two independent Tier-2+ triggers on the same day → +1 tier (capped at 4).

#### Potato-Specific Short-Term Check

`app/workflows/short_term/potato_ews.py` runs after the general risk pass and writes a separate `risk_assessments` document keyed as `{location}__short__potato`.

It evaluates today + tomorrow against thresholds in `app/crops/potato/profile.py`:

- Max temperature, min temperature
- Late blight detection: humidity > 80 % + temperature 15–22 °C
- High and critical daily rainfall thresholds
- Wind speed limit

Source selection uses the sense-check result already stored by `weather-mcp-service`: Open-Meteo is preferred when it passed the BMD cross-check; BMD is used as fallback.

---

### 2. Long-Term Pipeline (weekly, Monday 06:00 UTC)

Fetches the ECMWF SEAS5 5-month seasonal outlook for all districts, compares it against the crop profile, and stores monthly risk assessments.

```
                    ┌─────────────────────────────────────────────────────┐
                    │         Weekly Copernicus Pipeline (Mon 06:00 UTC)  │
                    │                                                      │
  Copernicus CDS    │                                                      │
  (ECMWF SEAS5)     │  1. CopernicusFetcher.fetch_and_store()             │
         ──────────►│     Request: seasonal-monthly-single-levels          │
                    │     Variables: t2m, tp, u10, v10, d2m               │
                    │     Area: Bangladesh bbox [26.5, 88.0, 20.5, 92.7]  │
                    │     Format: NetCDF                                    │
                    │                                                      │
                    │  2. _parse_netcdf()                                  │
                    │     • ensemble mean (25 members → 1 value)           │
                    │     • K → °C temperature                             │
                    │     • m/day → mm/month precipitation                 │
                    │     • √(u²+v²) × 3.6 → km/h wind                   │
                    │     • Magnus formula → estimated RH%                 │
                    │     • nearest-neighbour extraction per district       │
                    │                                                      │──► ArangoDB
                    │  3. upsert_seasonal_forecast() per district          │    seasonal_forecasts
                    │                                                      │
                    │  4. LongTermPotatoEWS.evaluate_all()                 │
                    │     for each district × each forecast month:         │
                    │       a. map month → potato season weeks             │
                    │       b. compute district baseline from profile      │
                    │       c. check absolute thresholds                   │
                    │       d. check deviation from baseline               │
                    │       e. check precipitation ratio                   │
                    │       f. check humidity / late blight conditions     │
                    │       g. classify tier 0–3                           │
                    │       h. build RAG query payload                     │
                    │                                                      │──► ArangoDB
                    │  5. upsert_seasonal_assessment() per month           │    seasonal_assessments
                    │                                                      │
                    │  6. Log seasonal advisory alerts for tier ≥ 2        │
                    └─────────────────────────────────────────────────────┘
```

The stored `seasonal_forecasts` documents are read by `weather-mcp-service` to answer chatbot queries like "how will the weather be over the next 4 months?" — attributed to Copernicus, never to BAMIS or Open-Meteo.

**Graceful degradation:** If `CDSAPI_KEY` is not set and `~/.cdsapirc` does not exist, `CopernicusFetcher._cds_configured()` returns `False`. `fetch_and_store()` returns `{"error": "cds_not_configured"}` immediately and the scheduler never registers the long-term jobs. Short-term continues normally.

**Season filtering:** `CropProfileLoader.stages_for_month()` returns an empty list for months outside the potato growing season (roughly June–September in Bangladesh). The engine skips those months with zero ArangoDB writes, making the off-season pass cost-free.

#### Seasonal Tier Table

| Tier | Label    | Meaning                                                             |
|------|----------|---------------------------------------------------------------------|
| 0    | Normal   | All monthly values within acceptable crop ranges                    |
| 1    | Advisory | Minor deviation: temp +2–4 °C above baseline, precip 1.5–2.5× norm |
| 2    | Warning  | Significant: temp approaching limit, major rainfall anomaly         |
| 3    | Severe   | Clearly outside tolerance: temp > crop max, critical rainfall       |

Max seasonal tier is 3 — seasonal uncertainty is too high to support Tier 4 Emergency.

#### Unit Conversions from SEAS5

| Raw SEAS5 variable | Unit    | Conversion                                          | Stored field         |
|--------------------|---------|-----------------------------------------------------|----------------------|
| `t2m`              | K       | `− 273.15`                                          | `mean_temp_c`        |
| `tp`               | m/day   | `× 1000 × days_in_month`                            | `total_precip_mm`    |
| `u10`, `v10`       | m/s     | `√(u²+v²) × 3.6`                                   | `mean_wind_kmh`      |
| `d2m`              | K       | Magnus formula → RH%                               | `estimated_rh_pct`   |

Magnus formula for relative humidity from dewpoint:
```
RH = 100 × exp(17.625 × Td / (243.04 + Td))
         / exp(17.625 × T  / (243.04 + T ))
```
where `T` and `Td` are in °C. Tagged `copernicus_partial` in `rule_support` because SEAS5 does not provide RH directly.

---

### 3. Drought Pipeline (daily, 07:00 UTC)

Runs after the short-term pipeline. Calls `drought_monitoring` (a separate container) to trigger GEE-based soil moisture and vegetation analysis, then reads the stored results and dispatches alerts for assessments at severity MODERATE or above.

```
  drought_monitoring  ──POST /run/all──►  ArangoDB drought_assessments
                                                        │
  app/workflows/long_term/drought_ews.py ──────────────►│ read + dispatch
                                                        │
                                               Notifier.dispatch()
                                               (tier ≥ 2 → FCM push)
```

Requires `DROUGHT_MONITORING_URL` env var. Skipped silently if not set.

---

### 4. BAMIS Special Bulletin Watcher (hourly)

`app/integrations/bamis/special_bulletin.py` scrapes the BAMIS special bulletin archive every hour, stores newly detected bulletins in `special_bulletins`, and pushes each new bulletin exactly once via the notifier.

Requires `BAMIS_SPECIAL_BULLETIN_ENABLED=true` (default). Can be disabled via env var.

---

## Notification System

`app/core/notifier.py` dispatches alerts through multiple channels keyed by tier. Each dispatch is deduplicated via a 12-hour window in `alerts_sent`.

```
Tier 0  Normal     →  structured log only
Tier 1  Advisory   →  log (ops digest)
Tier 2  Warning    →  backend broadcast (FCM topic fallback)
Tier 3  Severe     →  broadcast + Twilio SMS to emergency contacts
Tier 4  Emergency  →  broadcast + SMS + Twilio Voice IVR + gov webhook
```

**Backend broadcast** (`NOTIFICATION_BROADCAST_URL` / `BACKEND_API_URL`): Posts a structured JSON payload to the gov-chat-backend notification endpoint, which matches device tokens per district/crop subscription. This is the primary channel; FCM topic messaging is the fallback for legacy deployments.

All channels are opt-in via env vars. Missing keys are logged and skipped gracefully — the engine starts regardless.

---

## ArangoDB Collections

The engine creates these collections on first run if they do not exist.

| Collection             | Document key pattern                       | TTL (recommended) | Written by              | Read by                       |
|------------------------|--------------------------------------------|-------------------|-------------------------|-------------------------------|
| `weather_forecasts`    | `{location}__{source}__short`              | 30 days           | weather-mcp-service     | warning_system_engine         |
| `risk_assessments`     | `{location}__short` or `…__short__{crop}`  | 90 days           | warning_system_engine   | weather-mcp-service           |
| `alerts_sent`          | auto                                       | 7 days            | warning_system_engine   | warning_system_engine         |
| `seasonal_forecasts`   | `{location}__copernicus__long`             | 180 days          | warning_system_engine   | weather-mcp-service (chatbot) |
| `seasonal_assessments` | `{location}__{crop}__{YYYY_MM}`            | 180 days          | warning_system_engine   | weather-mcp-service           |
| `drought_assessments`  | `{location}__drought`                      | 30 days           | drought_monitoring      | warning_system_engine         |
| `special_bulletins`    | hash of bulletin content                   | 90 days           | warning_system_engine   | warning_system_engine         |

Example documents:

```jsonc
// risk_assessments — general short-term
{
  "_key": "dhaka__short",
  "location": "Dhaka",
  "horizon": "short",
  "tier": 2,
  "tier_label": "Warning",
  "triggers": ["Heavy rainfall 112 mm/day (≥100 mm — warning)"],
  "assessed_at": "2026-05-09T05:00:12Z"
}

// risk_assessments — potato-specific short-term
{
  "_key": "dhaka__short__potato",
  "location": "Dhaka",
  "crop": "potato",
  "horizon": "short",
  "tier": 1,
  "tier_label": "Advisory",
  "triggers": ["Max temperature 29.4°C approaching potato heat limit"],
  "disease_risks": [],
  "forecast_source": "open_meteo"
}

// seasonal_forecasts — Copernicus SEAS5 monthly outlook
{
  "_key": "dhaka__copernicus__long",
  "location": "Dhaka",
  "issue_month": "2026-05",
  "months_ahead": 5,
  "fetched_at": "2026-05-05T06:00:00Z",
  "outlook": [
    {
      "valid_month": "2026-06",
      "mean_temp_c": 31.2,
      "total_precip_mm": 285.0,
      "mean_wind_kmh": 12.3,
      "estimated_rh_pct": 82.4
    }
  ]
}

// seasonal_assessments — long-term potato risk
{
  "_key": "dhaka__potato__2026_11",
  "location": "Dhaka",
  "crop": "potato",
  "target_month": "2026-11",
  "stages": ["germination", "vegetative"],
  "tier": 2,
  "tier_label": "Warning",
  "triggers": ["Monthly mean temp 32.4°C exceeds potato limit 30°C"],
  "rule_support": {
    "temperature": "copernicus_ready",
    "precipitation": "copernicus_ready",
    "humidity": "copernicus_partial"
  }
}
```

---

## Scheduler Summary

```
Startup (app/main.py starts)
        │
        ├── +10 s  ──► short-term catch-up    (run_daily_pipeline)
        ├── +30 s  ──► BAMIS bulletin check   (run_bamis_special_bulletin_pipeline)
        ├── +60 s  ──► long-term catch-up     (run_long_term_pipeline)    ← only if CDS configured
        └── +120 s ──► drought catch-up       (run_drought_pipeline)      ← only if DROUGHT_MONITORING_URL set

Every day        05:00 UTC ──► run_daily_pipeline
Every day        07:00 UTC ──► run_drought_pipeline        ← only if DROUGHT_MONITORING_URL set
Every Mon        06:00 UTC ──► run_long_term_pipeline      ← only if CDS configured
Every hour                 ──► run_bamis_special_bulletin_pipeline
```

`misfire_grace_time=86400` means if the container was down at the scheduled time, APScheduler will still run the job when it comes back up, as long as it missed by less than 24 hours.

---

## Crop Profile (`data/example_crop_profile.json`)

The profile drives both EWS engines. It is keyed as `potato_dhaka` (crop + region in lowercase).

Top-level structure:
```jsonc
{
  "potato_dhaka": {
    "season_span": { "weeks": [44, 45, ..., 10] },  // ISO weeks potato is in-season
    "growth_stages": [
      { "stage": "germination", "start_week": 44, "end_week": 46 },
      ...
    ],
    "weekly_calendar": [
      {
        "week": 44,
        "stage": "germination",
        "temp_min_c": 15, "temp_max_c": 25, "temp_mean_c": 20,
        "rainfall_mm": 12,
        "rh_max_pct": 80, "rh_min_pct": 65
      },
      ...
    ],
    "crop_rules": {
      "temperature_min": { "min": 10 },
      "temperature_max": { "max": 30 },
      "rainfall_daily": [
        { "severity": "medium",   "min": 25 },
        { "severity": "critical", "min": 100 }
      ],
      "wind_speed_kmh": { "max": 30 },
      "humidity": { "min": 65, "max": 80 }
    }
  }
}
```

`app/core/crop_profile_loader.py` provides typed accessors — `stages_for_month()`, `baseline_for_month()`, `temp_thresholds()` — so `app/workflows/long_term/potato_ews.py` never parses JSON directly.

To regenerate the profile from raw BAMIS data:
```bash
cd warning_system_engine
python3 scripts/enrich_crop_profiles.py --crop potato --region dhaka
```

---

## Configuration

All configuration is via environment variables (copy `.env.example` to `.env`).

| Variable                        | Required | Default                                 | Description                                          |
|---------------------------------|----------|-----------------------------------------|------------------------------------------------------|
| `ARANGO_URL`                    | Yes      | `http://arango-vector-db:8529`          | ArangoDB host                                        |
| `ARANGO_DB_NAME`                | Yes      | `genie-ai`                              | Database name                                        |
| `ARANGO_USER`                   | Yes      | `root`                                  | ArangoDB user                                        |
| `ARANGO_PASSWORD`               | Yes      | —                                       | ArangoDB password                                    |
| `DROUGHT_MONITORING_URL`        | No       | —                                       | URL of drought_monitoring container; drought pipeline disabled if absent |
| `CDSAPI_URL`                    | No       | `https://cds.climate.copernicus.eu/api` | Copernicus CDS endpoint                              |
| `CDSAPI_KEY`                    | No       | —                                       | CDS API key — long-term pipeline disabled if absent  |
| `COPERNICUS_MONTHS_AHEAD`       | No       | `5`                                     | Months of SEAS5 to fetch (max 6)                     |
| `BAMIS_SPECIAL_BULLETIN_ENABLED`| No       | `true`                                  | Enable/disable hourly BAMIS bulletin watcher         |
| `FCM_SERVER_KEY`                | No       | —                                       | Firebase Cloud Messaging server key                  |
| `TWILIO_ACCOUNT_SID`            | No       | —                                       | Twilio credentials for SMS                           |
| `TWILIO_AUTH_TOKEN`             | No       | —                                       | Twilio auth token                                    |
| `TWILIO_PHONE_FROM`             | No       | —                                       | Twilio sender phone number                           |
| `EMERGENCY_CONTACT_NUMBERS`     | No       | —                                       | Comma-separated numbers for SMS/voice                |
| `BROADCAST_WEBHOOK_URL`         | No       | —                                       | Government alert broadcast endpoint (Tier 4)         |
| `NOTIFICATION_BROADCAST_URL`    | No       | —                                       | Backend notification endpoint (overrides auto)       |
| `BACKEND_API_URL`               | No       | —                                       | Base URL for gov-chat-backend (auto-resolves broadcast URL) |
| `NOTIFICATION_BROADCAST_SECRET` | No       | —                                       | Shared secret for backend broadcast auth             |
| `LOG_LEVEL`                     | No       | `INFO`                                  | Python log level                                     |

---

## Running

### With Docker Compose (full stack)

The engine is included in the root `docker-compose.yaml` and shares the `genieai_network` with `weather-mcp-service` and `arango-vector-db`.

```bash
# From the repo root
docker compose up -d --build warning-system-engine
```

### Standalone (development)

```bash
cd /root/mewa_v2/components/warning_system_engine
cp .env.example .env
# Edit .env — set ARANGO_URL, ARANGO_PASSWORD
# Optionally set CDSAPI_KEY for long-term pipeline
# Optionally set DROUGHT_MONITORING_URL for drought pipeline

pip install -r requirements.txt
python -m app.main
```

### Test the Potato EWS end-to-end

```bash
# From the host (requires ArangoDB reachable at localhost:8529)
cd components/warning_system_engine
python3 scripts/test_potato_ews.py --scenario heat --district Dhaka

# Or from inside the container
docker exec -it warning-system-engine python3 /app/scripts/test_potato_ews.py --scenario combined
```

See `scripts/POTATO_EWS_TEST_GUIDE.md` for full scenario reference.

---

## Relationship to weather-mcp-service

| Concern                          | warning_system_engine                          | weather-mcp-service                      |
|----------------------------------|------------------------------------------------|------------------------------------------|
| Ingest Open-Meteo / BMD data     | No                                             | Yes (`data_ingestor.py`, hourly)         |
| Classify weather risk (tier)     | Yes (`app/core/risk_engine.py`)                | No                                       |
| Classify potato risk (short)     | Yes (`app/workflows/short_term/potato_ews.py`) | No                                       |
| Classify potato risk (long)      | Yes (`app/workflows/long_term/potato_ews.py`)  | No                                       |
| Fetch Copernicus SEAS5           | Yes (`app/integrations/copernicus/fetcher.py`) | No                                       |
| Watch BAMIS special bulletins    | Yes (`app/integrations/bamis/special_bulletin.py`) | No                                   |
| Schedule jobs                    | Yes (`app/core/scheduler.py`)                  | No                                       |
| Send push / SMS alerts           | Yes (`app/core/notifier.py`)                   | No                                       |
| Serve HTTP endpoints             | No                                             | Yes (FastAPI)                            |
| Answer natural-language queries  | No                                             | Yes (WeatherAgent + MCP)                 |
| Write `risk_assessments`         | Yes                                            | No                                       |
| Write `seasonal_forecasts`       | Yes                                            | No                                       |
| Read `seasonal_forecasts`        | No                                             | Yes (chatbot seasonal queries)           |
| Read `weather_forecasts`         | Yes (EWS input)                                | Yes (agent context)                      |
