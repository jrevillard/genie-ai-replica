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
│  │     weather queries        │  /geocode                                │    │
│  │   • MCP tool server        │                                          │    │
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
│  │   • Push / SMS alerts      │                              │  forecasts  │  │
│  └────────────────────────────┘                              │  seasonal_  │  │
│          ▲             ▲                                      │  assessments│  │
│          │             │                                      │  alerts_    │  │
│   Open-Meteo     Copernicus CDS                              │  sent       │  │
│   BMD (BAMIS)    (SEAS5 ECMWF)                               └─────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Key separation:** `weather-mcp-service` only reads risk data from ArangoDB. It never classifies, never schedules, never notifies. All of that belongs to `warning_system_engine`. This prevents duplicate scheduling, ArangoDB race conditions, and double notifications.

---

## File Structure

```
warning_system_engine/
├── main.py                  — Entrypoint; wires up all components, starts scheduler
├── scheduler.py             — APScheduler jobs: daily + weekly pipelines
│
├── risk_engine.py           — Stateless Tier 0–4 general weather classifier
├── short_term_potato_ews.py — Deterministic 48-hour potato risk evaluator
├── long_term_potato_ews.py  — Deterministic 5-month seasonal potato risk evaluator
│
├── copernicus_fetcher.py    — Downloads SEAS5 NetCDF from Copernicus CDS, parses, stores
├── crop_profile_loader.py   — Reads example_crop_profile.json; stage / baseline helpers
│
├── potato_profile.py        — Potato threshold constants (short-term)
├── potato_risk_engine.py    — Per-day potato rule evaluation (short-term)
│
├── notifier.py              — Alert dispatch: log / FCM push / Twilio SMS / voice / webhook
├── storage.py               — ArangoDB persistence layer (all collections)
├── models.py                — Pydantic schemas: UnifiedForecast, RiskAssessment, etc.
│
├── data/
│   ├── example_crop_profile.json  — Weekly baselines + thresholds for potato (Dhaka)
│   └── bamis_metadata.json        — BMD/BAMIS station reference data
│
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Two Pipelines

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

**Standalone mode:** Since `weather-mcp-service` owns data ingestion, the engine reads forecasts already stored in `weather_forecasts` by the Open-Meteo ingestor in `weather-mcp-service`. If the collection is empty or stale (>30 h), the district is skipped for that run.

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

`PotatoShortTermEWS` runs after the general risk pass and writes a separate `risk_assessments` document keyed as `{location}__short__potato`.

It evaluates today + tomorrow against `potato_profile.py` thresholds:

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

## Notification System

`Notifier` dispatches alerts through multiple channels keyed by tier. Each dispatch is deduplicated via a 12-hour window in `alerts_sent`.

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

| Collection           | Document key pattern                     | TTL (recommended) | Written by            | Read by                  |
|----------------------|------------------------------------------|--------------------|----------------------|--------------------------|
| `weather_forecasts`  | `{location}__{source}__short`            | 30 days            | weather-mcp-service  | warning_system_engine    |
| `risk_assessments`   | `{location}__short` or `{location}__short__{crop}` | 90 days | warning_system_engine | weather-mcp-service |
| `alerts_sent`        | auto                                     | 7 days             | warning_system_engine | warning_system_engine    |
| `seasonal_forecasts` | `{location}__copernicus__long`           | 180 days           | warning_system_engine | warning_system_engine    |
| `seasonal_assessments` | `{location}__{crop}__{YYYY_MM}`        | 180 days           | warning_system_engine | weather-mcp-service (future) |

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

// seasonal_assessments — long-term potato
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
  },
  "rag_query_payload": {
    "crop": "potato",
    "keywords": ["potato", "dhaka", "germination", "heat stress", "high temperature"],
    "query_hint": "potato germination vegetative stage management Dhaka 2026-11"
  }
}
```

---

## Scheduler Summary

```
Startup (main.py starts)
        │
        ├── +10 s ──► short-term catch-up (run_daily_pipeline)
        │
        └── +60 s ──► long-term catch-up (run_long_term_pipeline)  ← only if CDS configured
                       (gives short-term time to run first)

Every day   05:00 UTC ──► run_daily_pipeline
Every Mon   06:00 UTC ──► run_long_term_pipeline  ← only if CDS configured
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

`CropProfileLoader` provides typed accessors over this structure — `stages_for_month()`, `baseline_for_month()`, `temp_thresholds()`, etc. — so `LongTermPotatoEWS` never parses JSON directly.

---

## Configuration

All configuration is via environment variables (copy `.env.example` to `.env`).

| Variable                      | Required | Default                                    | Description                                     |
|-------------------------------|----------|--------------------------------------------|------------------------------------------------ |
| `ARANGO_URL`                  | Yes      | `http://arango-vector-db:8529`             | ArangoDB host                                   |
| `ARANGO_DB_NAME`              | Yes      | `genie-ai`                                 | Database name                                   |
| `ARANGO_USER`                 | Yes      | `root`                                     | ArangoDB user                                   |
| `ARANGO_PASSWORD`             | Yes      | `test`                                     | ArangoDB password                               |
| `CDSAPI_URL`                  | No       | `https://cds.climate.copernicus.eu/api`    | Copernicus CDS endpoint                         |
| `CDSAPI_KEY`                  | No       | —                                          | CDS API key — long-term pipeline disabled if absent |
| `COPERNICUS_MONTHS_AHEAD`     | No       | `5`                                        | Months of SEAS5 to fetch (max 6)                |
| `FCM_SERVER_KEY`              | No       | —                                          | Firebase Cloud Messaging server key             |
| `TWILIO_ACCOUNT_SID`          | No       | —                                          | Twilio credentials for SMS                      |
| `TWILIO_AUTH_TOKEN`           | No       | —                                          | Twilio auth token                               |
| `TWILIO_PHONE_FROM`           | No       | —                                          | Twilio sender phone number                      |
| `EMERGENCY_CONTACT_NUMBERS`   | No       | —                                          | Comma-separated numbers for SMS/voice           |
| `BROADCAST_WEBHOOK_URL`       | No       | —                                          | Government alert broadcast endpoint (Tier 4)    |
| `NOTIFICATION_BROADCAST_URL`  | No       | —                                          | Backend notification endpoint (overrides auto)  |
| `BACKEND_API_URL`             | No       | —                                          | Base URL for gov-chat-backend (auto-resolves broadcast URL) |
| `NOTIFICATION_BROADCAST_SECRET` | No    | —                                          | Shared secret for backend broadcast auth        |
| `LOG_LEVEL`                   | No       | `INFO`                                     | Python log level                                |

---

## Running

### With Docker Compose (part of the full stack)

The engine is included in `components/docker-compose.yaml` and shares the `arango-vector-db` network with `weather-mcp-service`.

```bash
cd /root/mewa_v2/components
docker compose up warning_system_engine
```

### Standalone (development)

```bash
cd /root/mewa_v2/components/warning_system_engine
cp .env.example .env
# Edit .env — set ARANGO_URL, ARANGO_PASSWORD
# Optionally set CDSAPI_KEY for long-term pipeline

pip install -r requirements.txt
python -m main
```

---

## Relationship to weather-mcp-service

| Concern                        | warning_system_engine     | weather-mcp-service           |
|-------------------------------|---------------------------|-------------------------------|
| Ingest Open-Meteo / BMD data  | No                        | Yes (data_ingestor.py)        |
| Classify weather risk (tier)  | Yes (risk_engine.py)      | No                            |
| Classify potato risk          | Yes (short + long term)   | No                            |
| Fetch Copernicus SEAS5        | Yes (copernicus_fetcher)  | No                            |
| Schedule jobs                 | Yes (APScheduler)         | No                            |
| Send push / SMS alerts        | Yes (notifier.py)         | No                            |
| Serve HTTP endpoints          | No                        | Yes (FastAPI)                 |
| Answer natural-language queries | No                      | Yes (WeatherAgent + MCP)      |
| Read `risk_assessments`       | Writes                    | Reads via /risk/latest        |
| Read `seasonal_assessments`   | Writes                    | Reads (planned endpoint)      |

The two services communicate exclusively through ArangoDB. There is no direct HTTP dependency between them, so either can restart independently without disrupting the other.
