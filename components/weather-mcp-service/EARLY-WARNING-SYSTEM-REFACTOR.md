# Early Warning System — Simplified Refactor
### Design & Implementation Reference

---

## 1. High-Level Overview

The original system had three operational modes — on-demand queries, a daily pipeline
(06:00 UTC cron), and a weekly long-term pipeline — pulling from four data sources:
Open-Meteo, BMD BAMIS, Copernicus C3S, and WeatherNext.

This refactor removes the long-term pipeline and its two external dependencies entirely,
leaving a simpler two-source, single-schedule system.

### New operational modes

| Mode | Trigger | What it does |
|------|---------|-------------|
| **On-demand** | User chat message | Unchanged — Gemini + Mapbox + BMD forecast + risk classification |
| **Hourly pipeline** | APScheduler every 1 hour | Open-Meteo → classify → store → notify |

### Architecture diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║  MEWA Platform                                                        ║
║                                                                       ║
║  Browser → gov-chat-backend (Node.js)                                 ║
║               │ weather keyword?                                       ║
║               └─YES─► POST /query → weather-mcp-service (port 8000)  ║
║                                                                       ║
║  weather-mcp-service (FastAPI)                                        ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │  WeatherAgent         — on-demand query path (unchanged)     │    ║
║  │  DataIngestor         — Open-Meteo primary, BMD fallback      │    ║
║  │  RiskEngine           — Tier 0–4 fixed thresholds (unchanged) │    ║
║  │  StorageLayer         — ArangoDB (unchanged)                  │    ║
║  │  Notifier             — tier-keyed dispatch (unchanged)       │    ║
║  │  APScheduler          — IntervalTrigger(hours=1)              │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                       ║
║  External sources                                                     ║
║    Open-Meteo API   — free, no key, daily aggregated (primary)       ║
║    BMD BAMIS        — Bangladesh official scraper (fallback)          ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 2. Data Flow

### Hourly pipeline

```
APScheduler IntervalTrigger(hours=1)
    │
    ├─ DataIngestor.ingest_short_term(forecast_days=7)
    │      for each of 64 Bangladesh districts:
    │        Open-Meteo GET /v1/forecast?daily=precip,temp,wind,...
    │          → 7 × DayForecast → UnifiedForecast(source="open_meteo")
    │        on failure → BMD BAMIS scraper (fetch_forecast_logic)
    │          → UnifiedForecast(source="bmd")
    │
    ├─ for each UnifiedForecast:
    │      StorageLayer.upsert_forecast(fc)
    │      RiskEngine.classify(fc)  — fixed _T thresholds, no change
    │      StorageLayer.upsert_risk_assessment(assessment)
    │      if assessment.tier >= 2:
    │          Notifier.dispatch(assessment)  — 12-hour dedup applies
    │
    └─ { status, districts_processed, alerts_dispatched, errors }
```

### On-demand query flow (unchanged)

```
POST /query { query: "Will there be flooding in Sylhet?" }
    │
    └─ WeatherAgent.run(query)
         Gemini intent → Mapbox geocode → forecast (stored or live BMD)
         RiskEngine.classify(unified_forecast)
         Gemini explanation with tier context
         → { answer, risk_tier, risk_label, advisory, triggers, forecast }
```

---

## 3. File Structure

```
components/weather-mcp-service/
│
├── main.py            endpoint /internal/run-pipeline (was /internal/run-daily-pipeline)
├── agent.py           NO CHANGE
├── models.py          NO CHANGE
├── risk_engine.py     NO CHANGE
├── storage.py         NO CHANGE
├── notifier.py        NO CHANGE
│
├── data_ingestor.py   SIMPLIFIED — removed ingest_long_term, _from_copernicus,
│                                   _from_weathernext, enrich_drought_flags, __init__
│
├── scheduler.py       SIMPLIFIED — removed run_longterm_pipeline and weekly_long_term
│                                   job; CronTrigger(06:00) → IntervalTrigger(hours=1);
│                                   run_daily_pipeline → run_hourly_pipeline
│
├── requirements.txt   removed commented-out cdsapi / xarray / scipy / numpy block
│
└── mcp_weather/       NO CHANGE
```

---

## 4. What Was Removed

| Removed | File | Reason |
|---------|------|--------|
| `ingest_long_term()` | `data_ingestor.py` | Only fed the weekly job |
| `_from_copernicus()` | `data_ingestor.py` | Requires paid ECMWF key, `cdsapi`/`xarray`, 2–10 min async download |
| `_from_weathernext()` | `data_ingestor.py` | Requires paid commercial key |
| `enrich_drought_flags()` | `data_ingestor.py` | Only called from long-term pipeline |
| `DataIngestor.__init__` | `data_ingestor.py` | Only held `_copernicus_key` and `_weathernext_key` |
| `run_longterm_pipeline()` | `scheduler.py` | Long-term pipeline removed |
| `weekly_long_term` scheduler job | `scheduler.py` | Long-term pipeline removed |
| `CronTrigger` import | `scheduler.py` | Replaced by `IntervalTrigger` |
| `timedelta` import | `data_ingestor.py` | Was only used in `_from_copernicus` |
| cdsapi/xarray/scipy/numpy comment block | `requirements.txt` | No longer relevant |

---

## 5. What Was Changed

| Changed | Before | After |
|---------|--------|-------|
| Scheduler trigger | `CronTrigger(hour=6, minute=0, timezone="UTC")` | `IntervalTrigger(hours=1)` |
| Pipeline function name | `run_daily_pipeline` | `run_hourly_pipeline` |
| Manual trigger endpoint | `POST /internal/run-daily-pipeline` | `POST /internal/run-pipeline` |
| Scheduler job count | 2 (`daily_short_term` + `weekly_long_term`) | 1 (`hourly_pipeline`) |
| Data sources | 4 (Open-Meteo, BMD, Copernicus, WeatherNext) | 2 (Open-Meteo, BMD) |

---

## 6. What Was Not Changed

- `risk_engine.py` — fixed `_T` thresholds unchanged (rain/temp/wind tiers)
- `storage.py` — ArangoDB collections and upsert logic unchanged
- `notifier.py` — tier-keyed dispatch and 12-hour deduplication unchanged
- `models.py` — all Pydantic schemas unchanged
- `agent.py` — on-demand query path unchanged
- `mcp_weather/` — BMD BAMIS scraper and spatial tools unchanged
- `Dockerfile` — unchanged
- `query-service.js` — Node.js weather routing unchanged

---

## 7. Risk Classification (unchanged)

The `RiskEngine` uses fixed universal thresholds — no dynamic BAMIS percentiles in
this phase. Future work could introduce district-specific seasonal bands, but the
current system uses the same constants for all districts:

| Tier | Label | Rain (mm/day) | Temp (°C max) | Wind (km/h) |
|------|-------|--------------|---------------|-------------|
| 0 | Normal | < 50 | < 38 | < 62 |
| 1 | Advisory | ≥ 50 | ≥ 38 | ≥ 62 |
| 2 | Warning | ≥ 100 | ≥ 40 | ≥ 88 |
| 3 | Severe | ≥ 200 | ≥ 43 | ≥ 118 |
| 4 | Emergency | multi-hazard escalation from Tier 3 |

Multi-hazard rule: if two or more independent Tier-2+ triggers fire on the same day,
tier is bumped +1 (capped at 4). Multi-day patterns: heatwave (3+ days ≥ 40°C → Tier 2),
drought (14+ days < 1 mm/day → Tier 1).
