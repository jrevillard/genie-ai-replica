# Weather Intelligence + Early Warning System
### Design, Implementation & Reference Guide

> **Status: Implemented.**  All modules described in this document exist as production
> code in `components/weather-mcp-service/`.  This document is the authoritative reference
> for the system — it covers architecture, every implemented file with real code excerpts,
> API contracts, storage schema, and the trade-offs behind each design decision.
>
> **Build on, do not replace**: the new modules are additive.  The existing keyword router,
> `WeatherAgent`, MCP stdio servers, and Gemini explanation pipeline remain the on-demand
> query path.  The early warning layer runs in parallel and enriches every response.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Full Architecture Diagram](#2-full-architecture-diagram)
3. [File Inventory](#3-file-inventory)
4. [Unified Weather Schema — `models.py`](#4-unified-weather-schema--modelspy)
5. [Risk Classification Engine — `risk_engine.py`](#5-risk-classification-engine--risk_enginepy)
6. [Storage Layer — `storage.py`](#6-storage-layer--storagepy)
7. [Notification Dispatch — `notifier.py`](#7-notification-dispatch--notifierpy)
8. [Data Ingestion — `data_ingestor.py`](#8-data-ingestion--data_ingestorpy)
9. [Background Scheduler — `scheduler.py`](#9-background-scheduler--schedulerpy)
10. [Extended WeatherAgent — `agent.py`](#10-extended-weatheragent--agentpy)
11. [FastAPI Service — `main.py`](#11-fastapi-service--mainpy)
12. [Node.js Integration — `query-service.js`](#12-nodejs-integration--query-servicejs)
13. [Daily Pipeline — End-to-End Flow](#13-daily-pipeline--end-to-end-flow)
14. [On-Demand Query Flow — Enhanced](#14-on-demand-query-flow--enhanced)
15. [Risk Classification Logic](#15-risk-classification-logic)
16. [ArangoDB Storage Schema](#16-arangodb-storage-schema)
17. [API Reference](#17-api-reference)
18. [Environment Variables](#18-environment-variables)
19. [Requirements & Dockerfile](#19-requirements--dockerfile)
20. [Trade-offs & Design Decisions](#20-trade-offs--design-decisions)
21. [Extension Path: Agriculture / Crop Baseline](#21-extension-path-agriculture--crop-baseline)

---

## 1. System Overview

The existing system handles **on-demand weather queries** via a keyword router in the
Node.js backend, delegating to a Python FastAPI service that chains Gemini + Mapbox MCP +
BMD BAMIS scraper.  This document describes the extension into a **continuous intelligence
platform** with three operational modes:

| Mode | Trigger | What it does |
|------|---------|-------------|
| **On-demand** | User chat message | Existing path + enriched with stored forecast + risk tier |
| **Daily short-term** | APScheduler 06:00 UTC | Ingest Open-Meteo 0–7 day forecasts for all 64 districts, classify, alert |
| **Long-term** | APScheduler Mon 00:00 UTC | Ingest Copernicus/WeatherNext 8–30 day outlooks, update risk horizon |

**Core additions:**

| Module | Role |
|--------|------|
| `models.py` | Shared Pydantic schemas — unified forecast + risk assessment |
| `risk_engine.py` | Stateless Tier 0–4 classifier (WMO + IPC aligned) |
| `storage.py` | ArangoDB persistence (forecasts, assessments, alert dedup) |
| `notifier.py` | Tier-keyed dispatch: log → FCM push → Twilio SMS → broadcast |
| `data_ingestor.py` | Open-Meteo primary, BMD fallback, Copernicus/WeatherNext long-term |
| `scheduler.py` | APScheduler async jobs wired into FastAPI lifespan |

---

## 2. Full Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║  MEWA Platform                                                                   ║
║                                                                                  ║
║  ┌─────────────────────┐                                                         ║
║  │  Browser / Frontend  │  User: "Will there be flooding in Dhaka?"              ║
║  │  (Vue, port 8090)    │                                                         ║
║  └──────────┬──────────┘                                                         ║
║             │  POST /api/queries                                                  ║
║             ▼                                                                     ║
║  ┌─────────────────────────────────────────────────────┐                         ║
║  │  gov-chat-backend (Node.js, port 3000)              │                         ║
║  │  query-service.js                                   │                         ║
║  │    weather keyword? ──YES──► POST /query (port 8000)│                         ║
║  │                    ──NO───► OPEA ChatQnA (port 8888)│                         ║
║  └──────────────────────────────┬──────────────────────┘                         ║
║                                 │                                                 ║
║  ══════════════════════════════ │ ════════════════════════════════════════════  ║
║  weather-mcp-service (Python/FastAPI, port 8000)       │                         ║
║                                 ▼                                                 ║
║  ┌───────────────────────────────────────────────────────────────────────────┐   ║
║  │  main.py ── routes                                                        │   ║
║  │  POST /query              — on-demand (existing + enhanced)               │   ║
║  │  GET  /risk/latest        — lookup stored risk assessment                 │   ║
║  │  POST /internal/run-daily-pipeline — manual trigger / cron hook          │   ║
║  │  POST /mcp/tools/call     — direct BMD scrape                             │   ║
║  │                                                                           │   ║
║  │  ┌──────────────────────────────────────────────────────────────────────┐ │   ║
║  │  │  WeatherAgent (agent.py)  [EXTENDED]                                 │ │   ║
║  │  │  1. Gemini intent extraction                                         │ │   ║
║  │  │  2. Mapbox geocode (→ BMD fallback)                                  │ │   ║
║  │  │  3. StorageLayer.get_latest_forecast()  ← NEW                        │ │   ║
║  │  │       hit  → use stored (< 6h)                                       │ │   ║
║  │  │       miss → MCPClientManager.call_weather_tool("retrieve_...")      │ │   ║
║  │  │  4. RiskEngine.classify(unified_forecast)  ← NEW                    │ │   ║
║  │  │  5. Gemini explanation (tier-aware prompt)                           │ │   ║
║  │  │  → { answer, risk_tier, risk_label, advisory, triggers, ... }       │ │   ║
║  │  └──────────────────────────────────────────────────────────────────────┘ │   ║
║  │                                                                           │   ║
║  │  ┌────────────────────┐  ┌───────────────────┐  ┌─────────────────────┐  │   ║
║  │  │  DataIngestor      │  │  RiskEngine        │  │  Notifier           │  │   ║
║  │  │  ingest_short_term │  │  classify()        │  │  dispatch()         │  │   ║
║  │  │  ├ Open-Meteo      │  │  → Tier 0–4        │  │  T2 → FCM push      │  │   ║
║  │  │  └ BMD (fallback)  │  │  → triggers list   │  │  T3 → push + SMS    │  │   ║
║  │  │  ingest_long_term  │  │  → reasoning text  │  │  T4 → broadcast     │  │   ║
║  │  │  ├ Copernicus C3S  │  └───────────────────┘  └─────────────────────┘  │   ║
║  │  │  └ WeatherNext     │                                                    │   ║
║  │  └────────────────────┘                                                    │   ║
║  │                                                                           │   ║
║  │  ┌──────────────────────────────┐  ┌────────────────────────────────┐    │   ║
║  │  │  StorageLayer (storage.py)   │  │  APScheduler (scheduler.py)    │    │   ║
║  │  │  ArangoDB port 8529          │  │  daily_short_term  06:00 UTC   │    │   ║
║  │  │  ├ weather_forecasts         │  │  weekly_long_term  Mon 00:00   │    │   ║
║  │  │  ├ risk_assessments          │  └────────────────────────────────┘    │   ║
║  │  │  └ alerts_sent               │                                         │   ║
║  │  └──────────────────────────────┘                                         │   ║
║  └───────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                  ║
║  ┌───────────────────────────────────────────────────────────────────────────┐   ║
║  │  MCP stdio subprocesses (MCPClientManager — unchanged)                    │   ║
║  │  ├ npx @mapbox/mcp-server        → mapbox_geocoding_forward               │   ║
║  │  └ python -m mcp_weather.main    → buffer_point, retrieve_weather_forecast│   ║
║  └───────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                  ║
║  ┌───────────────────────────────────────────────────────────────────────────┐   ║
║  │  External data sources                                                    │   ║
║  │  Short-term  Open-Meteo API      free, no key, 1 km grid, hourly→daily   │   ║
║  │              BMD BAMIS scraper   official BD, existing MCP tool           │   ║
║  │  Long-term   Copernicus C3S      ECMWF seasonal (COPERNICUS_API_KEY)      │   ║
║  │              WeatherNext REST    15-day commercial (WEATHERNEXT_API_KEY)  │   ║
║  └───────────────────────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

---

## 3. File Inventory

### Existing files (unchanged)

| File | Lines | Role |
|------|-------|------|
| `mcp_client.py` | 120 | MCPClientManager — Mapbox + BMD stdio MCP sessions |
| `mcp_weather/main.py` | 40 | FastMCP stdio server — `buffer_point`, `retrieve_weather_forecast` |
| `mcp_weather/tools/weather_forecast.py` | 160 | BMD BAMIS WRF scraper, Bengali→English district map |
| `mcp_weather/tools/buffer_point.py` | 25 | Geodesic buffer (pyproj WGS84) |

### New files

| File | Lines | Role |
|------|-------|------|
| `models.py` | 98 | Pydantic schemas: `UnifiedForecast`, `RiskAssessment`, `DayForecast`, tier maps |
| `risk_engine.py` | 223 | Stateless Tier 0–4 classifier — per-day thresholds + heatwave/drought patterns |
| `storage.py` | 232 | ArangoDB upsert/query — forecasts, risk assessments, alert dedup |
| `notifier.py` | 237 | Tier-keyed dispatch — FCM, Twilio SMS, voice, broadcast webhook |
| `data_ingestor.py` | 518 | Open-Meteo, BMD, Copernicus, WeatherNext; 64-district coordinate table |
| `scheduler.py` | 187 | APScheduler async daily + weekly pipeline jobs |

### Modified files

| File | Change summary |
|------|---------------|
| `agent.py` | 314 lines — extended with `StorageLayer` injection, `RiskEngine` call, `_bmd_to_unified()`, tier-aware Gemini prompt |
| `main.py` | 290 lines — new lifespan (infra init + scheduler), `/risk/latest`, `/internal/run-daily-pipeline`, health reports storage/scheduler state |
| `requirements.txt` | Added `python-arango==7.9.4`, `APScheduler==3.10.4` |
| `query-service.js` | Weather metadata now includes `risk_tier`, `risk_label`, `triggers`, `advisory` |

---

## 4. Unified Weather Schema — `models.py`

Every data source — BMD scraper, Open-Meteo, Copernicus — normalises into
`UnifiedForecast` before classification or storage.  This decouples ingestion from the
risk engine completely.

```python
# models.py  (98 lines)

class TemperatureData(BaseModel):
    min: float
    max: float
    unit: str = "Celsius"

class PrecipitationData(BaseModel):
    value: float        # mm / day
    probability: float  # 0.0 – 1.0
    unit: str = "mm"

class WindData(BaseModel):
    speed: float                       # km/h daily maximum
    direction: Optional[float] = None  # degrees 0–360, optional

class ExtremeFlags(BaseModel):
    heatwave:     bool = False   # set by ingestor or risk_engine pattern detector
    heavy_rain:   bool = False   # precipitation.value >= 50 mm/day
    cyclone_risk: bool = False   # wind.speed >= 88 km/h
    drought_risk: bool = False   # 14+ consecutive dry days (< 1 mm/day)

class DayForecast(BaseModel):
    date:           str               # ISO 8601 "YYYY-MM-DD"
    temperature:    TemperatureData
    precipitation:  PrecipitationData
    wind:           WindData
    humidity:       float             # %
    extreme_flags:  ExtremeFlags = Field(default_factory=ExtremeFlags)

class UnifiedForecast(BaseModel):
    location:    str                   # Canonical English district name
    latitude:    Optional[float] = None
    longitude:   Optional[float] = None
    source:      str                   # "bmd" | "open_meteo" | "copernicus" | "weathernext"
    horizon:     str                   # "short" (0–7 d) | "long" (8–30 d)
    ingested_at: str                   # ISO 8601 UTC
    forecast:    list[DayForecast]

class RiskAssessment(BaseModel):
    location:        str
    assessed_at:     str               # ISO 8601 UTC
    horizon:         str
    tier:            int               # 0–4
    tier_label:      str               # "Normal" … "Emergency"
    triggers:        list[str]         # human-readable trigger descriptions
    reasoning:       str               # paragraph summary
    forecast_source: str
    raw_forecast:    dict              # worst DayForecast.model_dump()

TIER_LABELS  = {0: "Normal", 1: "Advisory", 2: "Warning", 3: "Severe",  4: "Emergency"}
TIER_COLOURS = {0: "green",  1: "yellow",   2: "orange",  3: "red",     4: "purple"}
```

**Why a separate `UnifiedForecast` schema?**  The BMD scraper, Open-Meteo JSON, and
Copernicus NetCDF all have different field names, units, and granularities.  Normalising
to one schema means `RiskEngine`, `StorageLayer`, and `Notifier` never need to know where
the data came from.

---

## 5. Risk Classification Engine — `risk_engine.py`

The engine is **stateless** — it takes a `UnifiedForecast` and returns a `RiskAssessment`
with no side-effects or database access.  This makes it independently testable and
usable from both the on-demand query path and the daily pipeline.

### Threshold constants

```python
# risk_engine.py  (223 lines)

_T = {
    # Precipitation  (mm / day)
    "rain_1": 50.0,   # Advisory
    "rain_2": 100.0,  # Warning
    "rain_3": 200.0,  # Severe

    # Temperature  (°C, daily maximum)
    "heat_1": 38.0,   # Advisory
    "heat_2": 40.0,   # Warning
    "heat_3": 43.0,   # Severe

    # Wind speed  (km/h daily maximum gust)
    "wind_1": 62.0,   # Advisory  — Beaufort 8 gale
    "wind_2": 88.0,   # Warning   — Beaufort 10 cyclone approach
    "wind_3": 118.0,  # Severe    — Beaufort 12 hurricane force

    # Pattern windows
    "heatwave_days": 3,    # ≥ heat_2 for N consecutive days → Tier 2
    "drought_days":  14,   # < 1 mm/day for N consecutive days → Tier 1
}
```

### Single-day scoring

```python
def _score_day(self, day: DayForecast) -> tuple[int, list[str]]:
    tier = 0
    triggers: list[str] = []
    rain  = day.precipitation.value
    max_t = day.temperature.max
    wind  = day.wind.speed

    # Precipitation
    if rain >= _T["rain_3"]:
        tier = max(tier, 3)
        triggers.append(f"Extreme rainfall {rain:.0f} mm/day (≥200 mm — severe flood risk)")
    elif rain >= _T["rain_2"]:
        tier = max(tier, 2)
        triggers.append(f"Heavy rainfall {rain:.0f} mm/day (≥100 mm — warning)")
    elif rain >= _T["rain_1"]:
        tier = max(tier, 1)
        triggers.append(f"Significant rainfall {rain:.0f} mm/day (≥50 mm — advisory)")

    # Temperature  [same pattern for heat_1/2/3]
    # Wind         [same pattern for wind_1/2/3]
    # Explicit cyclone_risk flag from source data → tier 3

    # IPC multi-hazard escalation: ≥2 independent Tier-2+ triggers → +1
    if tier >= 2 and len(triggers) >= 2:
        tier = min(tier + 1, 4)
        triggers.append("Multi-hazard escalation (IPC combined risk +1 tier)")

    return tier, triggers
```

### Multi-day pattern detection

```python
def _score_patterns(self, days: list[DayForecast]) -> tuple[int, list[str]]:
    # Heatwave: N consecutive days ≥ 40°C  → Tier 2
    hot_run = 0
    for day in days:
        if day.temperature.max >= _T["heat_2"]:
            hot_run += 1
            if hot_run >= _T["heatwave_days"]:
                return 2, [f"Heatwave: {hot_run} consecutive days ≥40°C"]
        else:
            hot_run = 0

    # Drought: N consecutive days < 1 mm  → Tier 1
    dry_run = 0
    for day in days:
        if day.precipitation.value < 1.0:
            dry_run += 1
            if dry_run >= _T["drought_days"]:
                return 1, [f"Drought indicator: {dry_run} consecutive dry days (<1 mm/day)"]
        else:
            dry_run = 0

    return 0, []
```

### Public interface

```python
engine = RiskEngine()
assessment = engine.classify(unified_forecast)
# → RiskAssessment(tier=2, tier_label="Warning", triggers=[...], reasoning="...")
```

The final tier is `max(worst_single_day_tier, pattern_tier)`, capped at 4.

---

## 6. Storage Layer — `storage.py`

Uses **ArangoDB** — already running in the `chatqna_default` Docker network — via
`python-arango`.  Three collections are created automatically on first startup.

### Connection & collection bootstrap

```python
# storage.py  (232 lines)

class StorageLayer:
    def __init__(self) -> None:
        arango_url  = os.getenv("ARANGO_URL",      "http://arango-vector-db:8529")
        arango_db   = os.getenv("ARANGO_DB_NAME",  "node-services")
        arango_user = os.getenv("ARANGO_USER",     "root")
        arango_pass = os.getenv("ARANGO_PASSWORD", "")

        client    = ArangoClient(hosts=arango_url)
        self._db  = client.db(arango_db, username=arango_user, password=arango_pass)
        self._ensure_collections()

    def _ensure_collections(self) -> None:
        for name in ("weather_forecasts", "risk_assessments", "alerts_sent"):
            if not self._db.has_collection(name):
                self._db.create_collection(name)
```

### Upsert key strategy

| Collection | `_key` format | Example |
|-----------|--------------|---------|
| `weather_forecasts` | `{location}__{source}__{horizon}` | `dhaka__open_meteo__short` |
| `risk_assessments` | `{location}__{horizon}` | `dhaka__short` |
| `alerts_sent` | auto-generated | — |

All keys are lowercased with spaces→`_`, apostrophes and hyphens stripped.

### Freshness-aware forecast lookup

```python
def get_latest_forecast(
    self,
    location: str,
    horizon: str = "short",
    max_age_hours: int = 6,
) -> UnifiedForecast | None:
    """
    Returns None if no forecast fresher than max_age_hours exists.
    WeatherAgent falls back to live BMD scrape when this returns None.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
    aql = """
        FOR doc IN weather_forecasts
          FILTER doc.location == @location
            AND doc.horizon   == @horizon
            AND doc.ingested_at >= @cutoff
          SORT doc.ingested_at DESC
          LIMIT 1
          RETURN doc
    """
    cursor = self._db.aql.execute(
        aql, bind_vars={"location": location, "horizon": horizon, "cutoff": cutoff}
    )
    docs = list(cursor)
    return UnifiedForecast.model_validate(docs[0]) if docs else None
```

### Alert deduplication

```python
def was_alert_sent(self, location: str, tier: int, within_hours: int = 12) -> bool:
    """
    Suppresses re-sending a same-tier alert within 12 hours.
    Prevents notification spam on repeated pipeline runs.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=within_hours)).isoformat()
    aql = """
        FOR doc IN alerts_sent
          FILTER doc.location == @location
            AND  doc.tier     >= @tier
            AND  doc.sent_at  >= @cutoff
          LIMIT 1
          RETURN 1
    """
    cursor = self._db.aql.execute(
        aql, bind_vars={"location": location, "tier": tier, "cutoff": cutoff}
    )
    return len(list(cursor)) > 0
```

---

## 7. Notification Dispatch — `notifier.py`

Tier-keyed routing with graceful degradation when channels are not configured.

### Channel assignment (WMO colour-code aligned)

| Tier | Label | Channels activated |
|------|-------|-------------------|
| 0 | Normal | structured log only |
| 1 | Advisory | log (ops digest) |
| 2 | Warning | log + FCM push |
| 3 | Severe | log + FCM push + Twilio SMS |
| 4 | Emergency | log + FCM + SMS + voice call + broadcast webhook |

### Dispatch logic

```python
# notifier.py  (237 lines)

def dispatch(self, assessment: RiskAssessment) -> None:
    tier = assessment.tier
    if tier == 0:
        self._log(assessment)
        return

    # 12-hour deduplication — suppress repeat sends
    if self._storage.was_alert_sent(assessment.location, tier, within_hours=12):
        logger.info("[NOTIFY] Suppressed duplicate tier-%d alert for %s",
                    tier, assessment.location)
        return

    self._log(assessment)                      # always log

    if tier >= 2: self._push(assessment)       # FCM push notification
    if tier >= 3: self._sms(assessment)        # Twilio SMS
    if tier >= 4:
        self._voice(assessment)                # Twilio Voice IVR
        self._broadcast(assessment)            # government broadcast webhook

    self._storage.record_alert_sent(
        assessment.location, tier, channel=self._channel_name(tier)
    )
```

### FCM push implementation

```python
def _push(self, a: RiskAssessment) -> None:
    if not self._fcm_key:
        logger.info("[NOTIFY] FCM_SERVER_KEY not set — push skipped for %s", a.location)
        return

    topic_slug = a.location.lower().replace(" ", "_").replace("'", "")
    topic  = f"/topics/weather_{topic_slug}"
    payload = {
        "to": topic,
        "notification": {
            "title": f"Weather {a.tier_label} — {a.location}",
            "body":  a.reasoning[:200],
            "color": TIER_COLOURS[a.tier],
        },
        "data": {
            "tier":       str(a.tier),
            "tier_label": a.tier_label,
            "location":   a.location,
            "triggers":   json.dumps(a.triggers),
            "assessed_at": a.assessed_at,
        },
    }
    resp = _requests.post(
        "https://fcm.googleapis.com/fcm/send",
        headers={"Authorization": f"key={self._fcm_key}",
                 "Content-Type": "application/json"},
        json=payload, timeout=10,
    )
    resp.raise_for_status()
```

**Channel activation**: all channels fail gracefully when their env var is unset —
the absence of `FCM_SERVER_KEY` logs an info message and continues; it does not
crash the pipeline.  Twilio requires the optional `twilio` package (commented out
in `requirements.txt`); missing import is caught and logged.

---

## 8. Data Ingestion — `data_ingestor.py`

The largest module (518 lines).  Covers all four weather data sources and includes
the full 64-district coordinate table for Bangladesh.

### District coordinates table (excerpt)

```python
# data_ingestor.py  (518 lines)

DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    # Dhaka Division
    "Dhaka":        (23.8103,  90.4125),
    "Gazipur":      (23.9999,  90.4272),
    "Narayanganj":  (23.6238,  90.5000),
    "Tangail":      (24.2513,  89.9167),
    "Kishoreganj":  (24.4449,  90.7766),
    "Mymensingh":   (24.7471,  90.4203),
    # ... 58 more districts across all 8 divisions
    "Cox's Bazar":  (21.4272,  92.0058),
    "Sylhet":       (24.8949,  91.8687),
    "Rangpur":      (25.7439,  89.2752),
    "Dinajpur":     (25.6279,  88.6337),
    # full table: Dhaka, Chittagong, Rajshahi, Khulna,
    #             Barishal, Sylhet, Rangpur, Mymensingh divisions
}
```

### Short-term ingestion with fallback chain

```python
def ingest_short_term(
    self,
    districts: list[str] | None = None,
    forecast_days: int = 7,
) -> list[UnifiedForecast]:
    targets = districts if districts is not None else list(DISTRICT_COORDS.keys())
    results: list[UnifiedForecast] = []

    for district in targets:
        coords = DISTRICT_COORDS.get(district)
        if coords:
            try:
                uf = self._from_open_meteo(district, coords, forecast_days)
                results.append(uf)
                continue
            except Exception as exc:
                logger.warning("[INGESTOR] Open-Meteo failed for %s: %s — falling back to BMD",
                               district, exc)

        # BMD fallback (also handles districts without registered coordinates)
        try:
            uf = self._from_bmd(district, forecast_days)
            results.append(uf)
        except Exception as exc:
            logger.error("[INGESTOR] BMD fallback also failed for %s: %s", district, exc)

    return results
```

### Open-Meteo fetch and normalisation

```python
_OM_VARS = (
    "temperature_2m_max,temperature_2m_min,precipitation_sum,"
    "precipitation_probability_max,windspeed_10m_max,"
    "winddirection_10m_dominant,relative_humidity_2m_max"
)

def _from_open_meteo(self, district, coords, forecast_days) -> UnifiedForecast:
    lat, lon = coords
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&daily={_OM_VARS}&timezone=Asia%2FDhaka&forecast_days={forecast_days}"
    )
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    daily = resp.json()["daily"]

    days_list = []
    for i, date in enumerate(daily["time"]):
        max_t    = _safe(daily, "temperature_2m_max",            i, 30.0)
        min_t    = _safe(daily, "temperature_2m_min",            i, 22.0)
        rain     = _safe(daily, "precipitation_sum",             i, 0.0)
        rain_p   = _safe(daily, "precipitation_probability_max", i, 0.0) / 100.0
        wind     = _safe(daily, "windspeed_10m_max",             i, 0.0)
        wdir     = _safe(daily, "winddirection_10m_dominant",    i, None)
        humidity = _safe(daily, "relative_humidity_2m_max",      i, 70.0)

        days_list.append(DayForecast(
            date=date,
            temperature=TemperatureData(min=min_t, max=max_t),
            precipitation=PrecipitationData(value=rain, probability=rain_p),
            wind=WindData(speed=wind, direction=wdir),
            humidity=humidity,
            extreme_flags=ExtremeFlags(
                heavy_rain=rain  >= 50.0,
                heatwave=max_t   >= 40.0,
                cyclone_risk=wind >= 88.0,
            ),
        ))

    return UnifiedForecast(
        location=district, latitude=lat, longitude=lon,
        source="open_meteo", horizon="short",
        ingested_at=datetime.now(timezone.utc).isoformat(),
        forecast=days_list,
    )
```

The helper `_safe(daily, key, i, default)` handles `None` values in Open-Meteo arrays
(which occur when a variable is missing for a particular day).

### BMD scraper wrapper

```python
def _from_bmd(self, district: str, forecast_days: int) -> UnifiedForecast:
    """
    Wraps the existing fetch_forecast_logic() from mcp_weather.tools.weather_forecast.
    BMD provides a single row per district distributed evenly across forecast_days.
    Wind speed is not available from the BMD table — WindData.speed is set to 0.0.
    """
    raw_json = fetch_forecast_logic(district, forecast_days, [])
    raw = json.loads(raw_json)
    if "error" in raw:
        raise ValueError(raw["error"])

    days_list = []
    for day in raw.get("forecast", []):
        p = day["parameters"]
        days_list.append(DayForecast(
            date=day["date"],
            temperature=TemperatureData(min=p["temperature"]["min"],
                                        max=p["temperature"]["max"]),
            precipitation=PrecipitationData(
                value=p["precipitation"]["value"],
                probability=p["precipitation"]["probability"]),
            wind=WindData(speed=0.0),
            humidity=p["humidity"]["value"],
            extreme_flags=ExtremeFlags(
                heavy_rain=p["precipitation"]["value"] >= 50.0,
                heatwave=p["temperature"]["max"]       >= 40.0,
            ),
        ))

    return UnifiedForecast(location=district, source="bmd", horizon="short",
                           ingested_at=datetime.now(timezone.utc).isoformat(),
                           forecast=days_list)
```

### Long-term: Copernicus C3S

```python
def _from_copernicus(self, districts: list[str]) -> list[UnifiedForecast]:
    """
    Downloads ECMWF seasonal forecast (20–27°N, 88–93°E Bangladesh bbox) via cdsapi.
    Requires: pip install cdsapi xarray numpy
    Copernicus downloads are asynchronous (2–10 min) — called only from weekly job.
    """
    import cdsapi, xarray as xr, numpy as np

    c = cdsapi.Client(key=self._copernicus_key, quiet=True)
    c.retrieve(
        "seasonal-original-single-levels",
        {
            "originating_centre": "ecmwf",
            "system":    "51",
            "variable":  ["2m_temperature", "total_precipitation"],
            "year":      str(now.year),
            "month":     f"{now.month:02d}",
            "day":       [f"{d:02d}" for d in range(1, 32)],
            "leadtime_hour": [str(h) for h in range(24, 24 * 31, 24)],
            "area":      [27, 88, 20, 93],   # N W S E
            "format":    "netcdf",
        },
        "/tmp/copernicus_seasonal.nc",
    )
    ds = xr.open_dataset("/tmp/copernicus_seasonal.nc")
    # t2m: Kelvin → °C;  tp: metres → mm
    # nearest-neighbour interpolation to each district centroid
    # returns UnifiedForecast(horizon="long") for each district
```

### Drought flag post-processing

```python
@staticmethod
def enrich_drought_flags(days: list[DayForecast]) -> list[DayForecast]:
    """
    Set extreme_flags.drought_risk=True for any day in a 14+ day dry run.
    Called by the pipeline after ingestion, before classification.
    """
    dry_run_len = 0
    drought_indices: list[int] = []

    for i, day in enumerate(days):
        if day.precipitation.value < 1.0:
            dry_run_len += 1
            if dry_run_len >= 14:
                drought_indices.append(i)
        else:
            dry_run_len = 0

    for idx in drought_indices:
        days[idx].extreme_flags.drought_risk = True
    return days
```

---

## 9. Background Scheduler — `scheduler.py`

APScheduler's `AsyncIOScheduler` is used so scheduled jobs share the FastAPI event
loop and can call async functions without spawning extra threads.  Blocking I/O
(HTTP requests, ArangoDB writes) runs in the default `ThreadPoolExecutor` via
`asyncio.get_event_loop().run_in_executor(None, ...)`.

### Daily pipeline function

```python
# scheduler.py  (187 lines)

async def run_daily_pipeline(storage, ingestor, risk_engine, notifier) -> dict:
    loop = asyncio.get_event_loop()

    # Step 1 — ingestion in thread pool (blocking HTTP)
    forecasts = await loop.run_in_executor(
        None, lambda: ingestor.ingest_short_term(forecast_days=7)
    )

    # Steps 2–5 — per-district: persist, classify, notify
    for fc in forecasts:
        await loop.run_in_executor(None, lambda f=fc: storage.upsert_forecast(f))

        assessment = risk_engine.classify(fc)   # CPU-only, no I/O

        await loop.run_in_executor(None, lambda a=assessment: storage.upsert_risk_assessment(a))

        if assessment.tier >= 2:
            await loop.run_in_executor(None, lambda a=assessment: notifier.dispatch(a))

    return {"status": "ok", "districts_processed": len(forecasts), ...}
```

### Scheduler factory

```python
def create_scheduler(storage, ingestor, risk_engine, notifier) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        run_daily_pipeline,
        trigger=CronTrigger(hour=6, minute=0, timezone="UTC"),
        args=[storage, ingestor, risk_engine, notifier],
        id="daily_short_term",
        misfire_grace_time=3600,   # run up to 1 h late if process was down
    )

    scheduler.add_job(
        run_longterm_pipeline,
        trigger=CronTrigger(day_of_week="mon", hour=0, minute=0, timezone="UTC"),
        args=[storage, ingestor, risk_engine, notifier],
        id="weekly_long_term",
    )
    return scheduler
```

The scheduler is started in `main.py` lifespan and shut down cleanly on exit.
`misfire_grace_time=3600` ensures a missed daily run (e.g. container restart) fires
within the hour rather than being skipped entirely.

---

## 10. Extended WeatherAgent — `agent.py`

The original `WeatherAgent.__init__` accepted only `mcp_manager`.  The new signature
adds an optional `storage` parameter, making the storage enhancement backwards-compatible
(the agent works without storage if ArangoDB is unavailable at startup).

### Initialisation

```python
# agent.py  (314 lines)

class WeatherAgent:
    def __init__(
        self,
        mcp_manager: MCPClientManager,
        storage: Optional["StorageLayer"] = None,
    ) -> None:
        self.mcp         = mcp_manager
        self.storage     = storage
        self.risk_engine = RiskEngine()    # stateless — created here, no args
        # ... Gemini client setup unchanged
```

### Enhanced `run()` pipeline

```python
async def run(self, query: str) -> dict:
    # Steps 1–3 unchanged: Gemini intent, Mapbox geocode, buffer creation

    # Step 4: Forecast — stored first, live BMD scrape as fallback
    forecast_data, unified_forecast = await self._get_forecast(
        geo["district"], intent.forecast_days
    )

    # Step 5 NEW: Risk classification
    risk_assessment = self._classify(unified_forecast, forecast_data, geo["district"])

    # Step 6: Explanation — Gemini now receives tier context
    answer = await self._generate_explanation(
        query, intent, geo, forecast_data, risk_assessment
    )

    return {
        "answer":     answer,
        "risk_tier":  risk_assessment.tier,       # NEW
        "risk_label": risk_assessment.tier_label,  # NEW
        "advisory":   risk_assessment.reasoning,   # NEW
        "triggers":   risk_assessment.triggers,    # NEW
        "buffer":     ...,
        "location":   geo.get("display_name", intent.location),
        "forecast":   forecast_data,
    }
```

### Forecast cache lookup

```python
async def _get_forecast(self, district: str, forecast_days: int):
    if self.storage:
        try:
            stored = self.storage.get_latest_forecast(
                district, horizon="short", max_age_hours=6
            )
            if stored:
                return self._unified_to_legacy(stored), stored
        except Exception:
            pass  # storage failure is non-fatal

    # Live BMD scrape via MCP stdio
    forecast_str = await self.mcp.call_weather_tool("retrieve_weather_forecast", {
        "district_name": district,
        "forecast_days": forecast_days,
        "parameters":    ["temperature", "precipitation", "humidity"],
    })
    forecast_data = json.loads(forecast_str)
    unified = self._bmd_to_unified(forecast_data, district)
    return forecast_data, unified
```

### Tier-aware Gemini prompt

```python
async def _generate_explanation(self, query, intent, geo, forecast_data, risk_assessment):
    risk_context = ""
    if risk_assessment.tier >= 1:
        risk_context = (
            f"\n\nRisk classification: Tier {risk_assessment.tier} "
            f"({risk_assessment.tier_label}). "
            f"Key triggers: {'; '.join(risk_assessment.triggers)}.\n"
            "Include a clear advisory based on the risk tier in your response."
        )

    prompt = (
        f"The user asked: \"{query}\"\n"
        f"They are {ctx} in {geo.get('display_name', intent.location)}.\n"
        f"Here is the official BMD forecast:\n{forecast_json}"
        f"{risk_context}\n\n"
        "Write a clear, concise, helpful weather explanation ..."
    )
    # ... Gemini call + template fallback unchanged
```

### Format conversion helpers

```python
@staticmethod
def _unified_to_legacy(stored: UnifiedForecast) -> dict:
    """UnifiedForecast → BMD legacy dict (used by Gemini prompt)."""
    return {
        "location": {"area_name": stored.location},
        "forecast": [
            {"date": day.date, "parameters": {
                "temperature":  {"min": day.temperature.min, "max": day.temperature.max, ...},
                "precipitation":{"value": day.precipitation.value, ...},
                "humidity":     {"value": day.humidity, ...},
            }} for day in stored.forecast
        ],
    }

@staticmethod
def _bmd_to_unified(forecast_data: dict, district: str) -> UnifiedForecast:
    """BMD legacy dict → UnifiedForecast (for RiskEngine when no stored data)."""
    # converts each day, sets ExtremeFlags, returns UnifiedForecast(source="bmd")
```

---

## 11. FastAPI Service — `main.py`

### Extended lifespan

```python
# main.py  (290 lines)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_manager, weather_agent, storage_layer, data_ingestor, risk_engine, notifier, scheduler

    # MCP sessions (existing — unchanged)
    mcp_manager = MCPClientManager()
    await mcp_manager.start()

    # Early warning infrastructure (new — non-fatal if ArangoDB unreachable)
    try:
        storage_layer = StorageLayer()
        data_ingestor = DataIngestor()
        risk_engine   = RiskEngine()
        notifier      = Notifier(storage_layer)
    except Exception as exc:
        logger.warning("[STARTUP] Early warning infrastructure unavailable: %s", exc)

    # WeatherAgent gets storage injected (falls back to None if unavailable)
    weather_agent = WeatherAgent(mcp_manager, storage=storage_layer)

    # Scheduler
    if storage_layer and data_ingestor:
        scheduler = create_scheduler(storage_layer, data_ingestor, risk_engine, notifier)
        scheduler.start()

    yield

    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
    await mcp_manager.stop()
```

### New endpoints

```python
@app.get("/health")
async def health():
    # Now reports storage and scheduler status
    return {
        "status":    "healthy",
        "storage":   storage_layer is not None,
        "scheduler": scheduler is not None and scheduler.running,
    }

@app.get("/risk/latest")
async def get_latest_risk(
    location: str = Query(...),
    horizon:  str = Query("short"),
):
    """
    Returns stored RiskAssessment if fresh.
    Falls back to live WeatherAgent.run() if no stored data exists.
    """
    assessment = storage_layer.get_latest_risk(location, horizon)
    if assessment:
        return assessment.model_dump()
    # live fallback ...

@app.post("/internal/run-daily-pipeline")
async def trigger_daily_pipeline(background_tasks: BackgroundTasks):
    """
    Manual trigger — returns immediately, pipeline runs in background.
    """
    background_tasks.add_task(
        run_daily_pipeline, storage_layer, data_ingestor, risk_engine, notifier
    )
    return {"status": "pipeline_started"}
```

---

## 12. Node.js Integration — `query-service.js`

The weather metadata object now carries risk fields so the frontend can display a
risk badge without a separate API call:

```javascript
// query-service.js — weather path (updated)
opeaResponseContent = wResp.data.answer;
opeaMetadata = {
  source_documents: [],
  confidence_score: 1.0,
  weather:    true,
  location:   wResp.data.location,
  forecast:   wResp.data.forecast,
  // NEW — early warning fields
  risk_tier:  wResp.data.risk_tier  ?? 0,
  risk_label: wResp.data.risk_label ?? 'Normal',
  triggers:   wResp.data.triggers   ?? [],
  advisory:   wResp.data.advisory   ?? null,
};
```

The `??` null-coalescing fallback ensures the backend stays compatible if the Python
service is still on the old version without these fields (e.g. during a rolling deploy).

**Frontend usage example** (Vue component):

```javascript
if (result.metadata?.risk_tier >= 2) {
  this.riskBanner = {
    tier:    result.metadata.risk_tier,
    label:   result.metadata.risk_label,
    colour:  ['green','yellow','orange','red','purple'][result.metadata.risk_tier],
    triggers: result.metadata.triggers,
  };
}
```

---

## 13. Daily Pipeline — End-to-End Flow

```
APScheduler fires at 06:00 UTC
    │
    ├─ DataIngestor.ingest_short_term(forecast_days=7)   [thread pool]
    │       for each of 64 Bangladesh districts:
    │         GET api.open-meteo.com/v1/forecast?...daily=temperature,precip,wind
    │           → parse 7 DayForecast objects → UnifiedForecast(source="open_meteo")
    │         on failure → fetch_forecast_logic(district, 7, []) [BMD scraper]
    │           → convert to UnifiedForecast(source="bmd")
    │
    ├─ for each UnifiedForecast:
    │     StorageLayer.upsert_forecast(fc)
    │     → ArangoDB weather_forecasts  _key="{district}__open_meteo__short"
    │
    ├─ for each UnifiedForecast:
    │     RiskEngine.classify(fc)
    │       → score each day: rain/temp/wind vs _T thresholds
    │       → detect patterns: heatwave run, drought run
    │       → worst-case tier + triggers list
    │     StorageLayer.upsert_risk_assessment(assessment)
    │     → ArangoDB risk_assessments  _key="{district}__short"
    │
    └─ if assessment.tier >= 2:
          Notifier.dispatch(assessment)
            was_alert_sent(location, tier, 12h)?  YES → skip
                                                  NO  → send
            tier 2 → FCM push to /topics/weather_{district}
            tier 3 → FCM + Twilio SMS
            tier 4 → FCM + SMS + voice + broadcast webhook
          StorageLayer.record_alert_sent(...)
```

**Expected runtime**: ~2–4 minutes for 64 districts
(Open-Meteo rate-limit: ~1 req/s polite limit).

**Error handling**: individual district failures are logged and skipped; the pipeline
continues and reports `{"status": "partial", "errors": N}` rather than aborting.

---

## 14. On-Demand Query Flow — Enhanced

```
User: "Will there be flooding in Sylhet next week?"
    │
    ▼ POST /api/queries → Node.js query-service.js
"flood" matches WEATHER_KW → POST :8000/query { query: "..." }
    │
    ▼ WeatherAgent.run()
    ├─ Gemini flash-lite: extract intent
    │     → { location: "Sylhet", user_context: "CITIZEN", forecast_days: 7 }
    │
    ├─ Mapbox geocode "Sylhet" → lat/lon + district="Sylhet"
    │     (BMD direct fallback if Mapbox token invalid)
    │
    ├─ StorageLayer.get_latest_forecast("Sylhet", "short", max_age_hours=6)
    │     HIT  → use stored Open-Meteo data from 06:00 pipeline run
    │     MISS → MCP call: retrieve_weather_forecast("Sylhet", 7, [...])
    │                       ← existing BMD BAMIS scraper
    │
    ├─ RiskEngine.classify(unified_forecast)
    │     day 4: rain=180mm → Tier 2 "Warning"
    │     len(triggers)=1 → no multi-hazard escalation
    │     → RiskAssessment(tier=2, triggers=["Heavy rainfall 180mm..."])
    │
    ├─ Gemini flash: _generate_explanation(... risk_assessment)
    │     prompt includes: "Risk classification: Tier 2 (Warning). Key triggers: ..."
    │     → "Sylhet is forecast to receive heavy rainfall (180mm) on Thursday..."
    │
    └─ return {
           answer:     "Sylhet is forecast...",
           risk_tier:  2,
           risk_label: "Warning",
           advisory:   "Risk level 2 (Warning) detected for Sylhet...",
           triggers:   ["Heavy rainfall 180mm/day (≥100mm — warning)"],
           location:   "Sylhet, Bangladesh",
           forecast:   { ... }
       }
    │
    ▼ query-service.js
opeaResponseContent = "Sylhet is forecast..."
opeaMetadata = { weather: true, risk_tier: 2, risk_label: "Warning", ... }
    │
    ▼ Frontend
ChatBotComponent.vue renders answer + orange risk banner
```

---

## 15. Risk Classification Logic

### Tier table

| Tier | Label | Precipitation | Temperature | Wind | Notes |
|------|-------|---------------|-------------|------|-------|
| 0 | Normal | < 50 mm/day | < 38°C | < 62 km/h | All params in seasonal range |
| 1 | Advisory | ≥ 50 mm/day | ≥ 38°C | ≥ 62 km/h | OR 14+ consecutive dry days |
| 2 | Warning | ≥ 100 mm/day | ≥ 40°C | ≥ 88 km/h | OR 3+ day heatwave |
| 3 | Severe | ≥ 200 mm/day | ≥ 43°C | ≥ 118 km/h | OR two simultaneous T2+ triggers |
| 4 | Emergency | Multi-hazard T3 | T3 heat + drought | T3 wind + rain | Capped |

### Multi-hazard escalation (IPC alignment)

When two or more independent Tier-2+ triggers fire on the **same day** (e.g. 110mm rain
AND 42°C), the tier is bumped +1 (capped at 4).  This mirrors IPC Phase 3→4 escalation
where compounding hazards have non-linear food-security impact.

### WMO colour code alignment

```
WMO Green   → Tier 0   No significant hazard
WMO Yellow  → Tier 1   Be aware
WMO Orange  → Tier 2   Take action
WMO Red     → Tier 3   Immediate action
(Purple)    → Tier 4   Catastrophic
```

### Decision tree

```
For each forecast day d:
  tier_d = 0, triggers_d = []

  if precip(d) >= 200:  tier_d = max(3, tier_d); add trigger
  elif precip(d) >= 100: tier_d = max(2, tier_d); add trigger
  elif precip(d) >= 50:  tier_d = max(1, tier_d); add trigger

  if max_temp(d) >= 43:  tier_d = max(3, tier_d); add trigger
  elif max_temp(d) >= 40: tier_d = max(2, tier_d); add trigger
  elif max_temp(d) >= 38: tier_d = max(1, tier_d); add trigger

  if wind(d) >= 118: tier_d = max(3, tier_d); add trigger
  elif wind(d) >= 88: tier_d = max(2, tier_d); add trigger
  elif wind(d) >= 62: tier_d = max(1, tier_d); add trigger

  if cyclone_risk_flag(d): tier_d = max(3, tier_d); add trigger

  if tier_d >= 2 AND len(triggers_d) >= 2:
    tier_d = min(tier_d + 1, 4)   ← IPC multi-hazard

Multi-day patterns (scanned across full forecast window):
  if 3+ consecutive days max_temp >= 40: pattern_tier = 2
  if 14+ consecutive days precip < 1mm:  pattern_tier = 1

Final tier = max(max(tier_d for all d), pattern_tier)
```

---

## 16. ArangoDB Storage Schema

### Collection: `weather_forecasts`

```json
{
  "_key":        "dhaka__open_meteo__short",
  "location":    "Dhaka",
  "latitude":    23.8103,
  "longitude":   90.4125,
  "source":      "open_meteo",
  "horizon":     "short",
  "ingested_at": "2026-03-28T06:03:22.145Z",
  "forecast": [
    {
      "date": "2026-03-28",
      "temperature":   { "min": 24.0, "max": 34.5, "unit": "Celsius" },
      "precipitation": { "value": 112.3, "probability": 0.85, "unit": "mm" },
      "wind":          { "speed": 45.0, "direction": 210.0 },
      "humidity":      88.0,
      "extreme_flags": {
        "heatwave": false, "heavy_rain": true,
        "cyclone_risk": false, "drought_risk": false
      }
    }
  ]
}
```

Upsert key: `{location}__{source}__{horizon}` (normalised).
Recommended TTL index: 30 days on `ingested_at`.

### Collection: `risk_assessments`

```json
{
  "_key":            "dhaka__short",
  "location":        "Dhaka",
  "assessed_at":     "2026-03-28T06:04:11.022Z",
  "horizon":         "short",
  "tier":            2,
  "tier_label":      "Warning",
  "triggers":        ["Heavy rainfall 112.3mm/day (≥100mm — warning)"],
  "reasoning":       "Risk level 2 (Warning) detected for Dhaka on 2026-03-28. Key triggers: ...",
  "forecast_source": "open_meteo",
  "raw_forecast":    { "date": "2026-03-28", "temperature": {}, "precipitation": {} }
}
```

Upsert key: `{location}__{horizon}`.
Recommended TTL index: 90 days on `assessed_at`.

### Collection: `alerts_sent`

```json
{
  "location": "Dhaka",
  "tier":     2,
  "channel":  "push",
  "sent_at":  "2026-03-28T06:04:15.300Z"
}
```

Auto-generated `_key`. Used by `Notifier.was_alert_sent()` for 12-hour dedup window.
Recommended TTL index: 7 days on `sent_at`.

---

## 17. API Reference

### `POST /query` — on-demand weather query (enhanced)

**Request:**
```json
{ "query": "Will there be flooding in Sylhet next week?" }
```

**Response (new fields in bold):**
```json
{
  "answer":      "Sylhet is forecast to receive heavy rainfall...",
  "risk_tier":   2,
  "risk_label":  "Warning",
  "advisory":    "Risk level 2 (Warning) detected for Sylhet on 2026-04-02...",
  "triggers":    ["Heavy rainfall 112mm/day (≥100mm — warning)"],
  "buffer":      { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [...] }, "properties": {} },
  "location":    "Sylhet, Bangladesh",
  "forecast":    {
    "location": { "area_name": "Sylhet" },
    "forecast": [
      { "date": "2026-04-01", "parameters": { "temperature": {...}, "precipitation": {...}, "humidity": {...} } }
    ]
  }
}
```

### `GET /risk/latest?location=Dhaka&horizon=short`

**Response (stored assessment):**
```json
{
  "location":        "Dhaka",
  "assessed_at":     "2026-03-28T06:04:11Z",
  "horizon":         "short",
  "tier":            1,
  "tier_label":      "Advisory",
  "triggers":        ["Significant rainfall 55mm/day (≥50mm — advisory)"],
  "reasoning":       "Risk level 1 (Advisory) detected for Dhaka...",
  "forecast_source": "open_meteo",
  "raw_forecast":    { ... }
}
```

**Response (no stored data — live fallback):**
```json
{
  "location":    "Dhaka",
  "assessed_at": null,
  "horizon":     "short",
  "tier":        0,
  "tier_label":  "Normal",
  "triggers":    [],
  "reasoning":   "Weather conditions in Dhaka are within normal seasonal ranges.",
  "source":      "live_query"
}
```

### `POST /internal/run-daily-pipeline`

**Response:**
```json
{
  "status":  "pipeline_started",
  "message": "Daily pipeline running in background"
}
```

Pipeline result (logged, not returned synchronously):
```json
{
  "status":              "ok",
  "districts_processed": 64,
  "errors":              0,
  "alerts_dispatched":   3
}
```

### `GET /health` — enhanced

```json
{
  "status":    "healthy",
  "storage":   true,
  "scheduler": true
}
```

---

## 18. Environment Variables

### `weather-mcp-service/.env`

```env
# ── Existing ──────────────────────────────────────────────────────────────────
GOOGLE_API_KEY=your_gemini_api_key         # Gemini intent extraction + explanation
MAPBOX_ACCESS_TOKEN=your_mapbox_token      # Geocoding (optional — has BMD fallback)
PYTHONUNBUFFERED=1

# ── ArangoDB (shared with rest of MEWA stack) ──────────────────────────────────
ARANGO_URL=http://arango-vector-db:8529
ARANGO_DB_NAME=node-services
ARANGO_USER=root
ARANGO_PASSWORD=your_arango_password

# ── Notification channels (all optional — missing keys skip gracefully) ────────
FCM_SERVER_KEY=                            # Firebase Cloud Messaging (tier 2+)
TWILIO_ACCOUNT_SID=                        # Twilio SMS + voice (tier 3+)
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_FROM=+1234567890
EMERGENCY_CONTACT_NUMBERS=+880...,+880...  # Comma-separated SMS/voice recipients
EMERGENCY_TWIML_URL=                       # TwiML URL for tier-4 voice call
BROADCAST_WEBHOOK_URL=                     # Gov broadcast system (tier 4)

# ── Long-term data sources (both optional) ─────────────────────────────────────
COPERNICUS_API_KEY=                        # Copernicus C3S (https://cds.climate.copernicus.eu)
WEATHERNEXT_API_KEY=                       # WeatherNext 15-day commercial API
```

---

## 19. Requirements & Dockerfile

### `requirements.txt`

```
# Core service (existing)
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

# Early warning system — storage
python-arango==7.9.4

# Early warning system — scheduler
APScheduler==3.10.4

# Optional — Copernicus long-term ingestion:
# cdsapi==0.7.2
# xarray==2024.2.0
# scipy==1.12.0
# numpy>=1.26.0

# Optional — Twilio SMS / voice:
# twilio==9.0.0
```

### Dockerfile additions

The existing Dockerfile requires no structural changes.  `python-arango` and
`APScheduler` are pure Python and install without system dependencies.  The optional
`cdsapi`/`xarray`/`twilio` packages can be uncommented in `requirements.txt` and
the image rebuilt.

---

## 20. Trade-offs & Design Decisions

### Why keyword routing instead of OpenAI tool-calling

OPEA port 9000 (`ChatCompletionRequest`) accepts only `tool_choice: "none"` or a named
tool — not `"auto"`.  Sending `"auto"` returns a Pydantic validation error on all three
of OPEA's union schemas (`LLMParamsDoc`, `ChatCompletionRequest`, `SearchedDoc`).
The keyword router achieves the same routing goal deterministically, with zero LLM
latency overhead.  See `MCP-WEATHER-IMPLEMENTATION-GUIDE.md §3` for full technical
dissection.

### Why a stateless RiskEngine

`RiskEngine.classify()` has no side-effects, no database calls, and no async I/O.
This means it can be:
- called from the async request path without `await`
- unit-tested without a database fixture
- replaced later with a trained ML classifier by swapping one method
- run inline in `WeatherAgent._classify()` without infrastructure

### Why ArangoDB instead of a separate time-series DB

ArangoDB is already running in the `chatqna_default` Docker network and used by the
Node.js backend.  The two new collections (`weather_forecasts`, `risk_assessments`)
fit naturally alongside the existing `queries`, `sessions`, and `weatherRequests`
collections.  The AQL `COLLECT ... INTO groups` pattern handles the "latest per
location" query cleanly.  Adding a second database (InfluxDB, TimescaleDB) would
require new infrastructure, new credentials, and another Docker service.

### Why APScheduler in-process

Running the scheduler inside the FastAPI process avoids the operational complexity
of a separate cron container (`docker run --rm weather-mcp python run_pipeline.py`).
The `AsyncIOScheduler` shares the event loop, so all pipeline tasks use the same
thread pool and do not require separate connection pools.  The
`POST /internal/run-daily-pipeline` endpoint provides a manual override without
shell access.  If independent scheduling is needed for scale or retry logic, the
`run_daily_pipeline` function is importable and callable from any external runner.

### Why Open-Meteo as primary short-term source

| Source | Free | No key | BD coverage | Resolution | Daily limit |
|--------|------|--------|-------------|------------|-------------|
| Open-Meteo | ✓ | ✓ | Good | 1 km / hourly | Generous |
| OpenWeatherMap | Free tier | ✗ | Good | City-level | 60 req/min |
| BMD BAMIS scraper | ✓ | ✓ | Authoritative | District | 1/scrape |

Open-Meteo requires no registration and provides hourly data for the full Bangladesh
bounding box at 1 km resolution, aggregatable to daily statistics.  BMD BAMIS remains
the authoritative source for official district figures and is retained as the fallback.

### Why pipeline I/O runs in `run_in_executor`

`APScheduler`'s `AsyncIOScheduler` runs jobs on the asyncio event loop.  The ingestion
and storage operations are blocking (HTTP requests, ArangoDB TCP calls).  Running them
in `run_in_executor(None, ...)` delegates to the default `ThreadPoolExecutor`, keeping
the event loop free for FastAPI request handling during a pipeline run.  This avoids
`event loop blocked` warnings and ensures `/query` stays responsive during a 64-district
ingestion sweep.

---

## 21. Extension Path: Agriculture / Crop Baseline

The `RiskEngine` is designed to be subclassed.  A future `AgricultureRiskEngine`
would accept a `CropBaseline` model alongside `UnifiedForecast` and escalate the
tier when forecast conditions deviate from crop-specific optima:

```python
class CropBaseline(BaseModel):
    crop_type:    str          # "rice" | "wheat" | "jute" | "potato"
    growth_stage: str          # "planting" | "vegetative" | "flowering" | "harvest"
    district:     str
    optimal_temp_range: tuple[float, float]   # (min, max) °C
    water_req_mm_per_week: float

class AgricultureRiskEngine(RiskEngine):
    def classify_with_crop(
        self,
        forecast: UnifiedForecast,
        baseline: CropBaseline,
    ) -> RiskAssessment:
        base = self.classify(forecast)
        crop_tier, crop_triggers = self._evaluate_crop(forecast, baseline)
        final_tier = max(base.tier, crop_tier)
        return RiskAssessment(
            **{**base.model_dump(),
               "tier":     final_tier,
               "tier_label": TIER_LABELS[final_tier],
               "triggers": base.triggers + crop_triggers}
        )

    def _evaluate_crop(self, forecast, baseline):
        # Example: rice flowering stage is highly sensitive to max_temp > 35°C
        # Example: wheat harvest fails below 10mm/week water
        ...
```

`POST /query` would accept an optional `crop_context` field; `WeatherAgent.run()`
would pass it to `AgricultureRiskEngine.classify_with_crop()` when present.
The `UnifiedForecast` schema requires no changes.

---

## Summary — Implemented File Structure

```
components/weather-mcp-service/
├── Dockerfile                       unchanged (python-arango + APScheduler are pure Python)
├── docker-compose.yml               unchanged
├── requirements.txt                 + python-arango==7.9.4, APScheduler==3.10.4
├── .env                             + ARANGO_*, FCM_*, TWILIO_*, COPERNICUS_*, WEATHERNEXT_*
│
├── main.py              290 lines   MODIFIED: extended lifespan, /risk/latest, /internal/run-daily-pipeline
├── agent.py             314 lines   MODIFIED: StorageLayer injection, RiskEngine, tier-aware prompt
├── mcp_client.py                    UNCHANGED
│
├── models.py             98 lines   NEW — UnifiedForecast, RiskAssessment, DayForecast, tier maps
├── risk_engine.py       223 lines   NEW — stateless Tier 0–4 classifier
├── storage.py           232 lines   NEW — ArangoDB persistence (3 collections)
├── notifier.py          237 lines   NEW — tier-keyed dispatch (FCM, Twilio, broadcast)
├── data_ingestor.py     518 lines   NEW — Open-Meteo, BMD, Copernicus, WeatherNext; 64 district coords
├── scheduler.py         187 lines   NEW — APScheduler daily + weekly pipeline jobs
│
├── mcp_weather/
│   ├── main.py                      UNCHANGED
│   └── tools/
│       ├── weather_forecast.py      UNCHANGED
│       └── buffer_point.py          UNCHANGED
│
├── MCP-WEATHER-IMPLEMENTATION-GUIDE.md   original system guide
└── EARLY-WARNING-SYSTEM-DESIGN.md        THIS FILE
```

**Total new/modified Python**: ~1 900 lines across 8 files.
**Syntax-verified**: all 8 files pass `ast.parse()` with no errors.
