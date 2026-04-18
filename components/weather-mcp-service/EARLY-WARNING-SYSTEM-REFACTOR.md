# Weather Intelligence + Early Warning System
### Design, Implementation & Reference Guide

This document is the single source of truth for the `weather-mcp-service` architecture.
It covers every module, runtime flow, schema, API contract, and environment variable
needed to understand and operate the system without reading any other guide.

---

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. Architecture Diagram](#2-architecture-diagram)
- [3. File Structure](#3-file-structure)
- [4. Shared Schema — `models.py`](#4-shared-schema--modelspy)
- [5. Data Ingestion — `data_ingestor.py`](#5-data-ingestion--data_ingestorpy)
- [6. Risk Engine — `risk_engine.py`](#6-risk-engine--risk_enginepy)
- [7. Storage Layer — `storage.py`](#7-storage-layer--storagepy)
- [8. Notification Dispatch — `notifier.py`](#8-notification-dispatch--notifierpy)
- [9. Background Scheduler — `scheduler.py`](#9-background-scheduler--schedulerpy)
- [10. WeatherAgent — `agent.py`](#10-weatheragent--agentpy)
- [11. FastAPI Service — `main.py`](#11-fastapi-service--mainpy)
- [12. Node.js Integration — `query-service.js`](#12-nodejs-integration--query-servicejs)
- [13. Hourly Pipeline — End-to-End Flow](#13-hourly-pipeline--end-to-end-flow)
- [14. On-Demand Query Flow](#14-on-demand-query-flow)
- [15. ArangoDB Storage Schema](#15-arangodb-storage-schema)
- [16. API Reference](#16-api-reference)
- [17. Environment Variables](#17-environment-variables)
- [18. Requirements](#18-requirements)
- [19. Testing the Pipeline](#19-testing-the-pipeline)

---

## 1. System Overview

The service has two operational modes:

| Mode | Trigger | What it does |
|------|---------|-------------|
| **On-demand** | User chat message | Gemini intent → Mapbox geocode → BMD/stored forecast → risk classification → Gemini explanation |
| **Hourly pipeline** | APScheduler every 1 hour | Open-Meteo forecast for all 64 districts → classify → store in ArangoDB → notify if elevated |

The on-demand path serves the chatbot in real time. The hourly pipeline runs in the
background, keeps ArangoDB populated with fresh forecasts and risk assessments, and
dispatches alerts when risk exceeds Tier 1. Both paths share the same `RiskEngine`,
`StorageLayer`, and `UnifiedForecast` schema.

### Data sources

| Source | Role | Requires |
|--------|------|---------|
| Open-Meteo API | Primary — hourly pipeline forecast | Nothing (free, no key) |
| BMD BAMIS scraper | Fallback — when Open-Meteo fails; also used by on-demand path | Nothing (web scraper) |

---

## 2. Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  MEWA Platform                                                               ║
║                                                                              ║
║  ┌──────────────────────┐                                                    ║
║  │  Browser / Frontend   │  User: "Will there be flooding in Dhaka?"         ║
║  │  (Vue, port 8090)     │                                                   ║
║  └──────────┬───────────┘                                                    ║
║             │  POST /api/queries                                              ║
║             ▼                                                                 ║
║  ┌──────────────────────────────────────────────────────────────┐            ║
║  │  gov-chat-backend (Node.js, port 3000)                       │            ║
║  │  query-service.js                                            │            ║
║  │    weather keyword? ──YES──► POST /query (port 8000)         │            ║
║  │                    ──NO───► OPEA ChatQnA (port 8888)         │            ║
║  └──────────────────────────────┬───────────────────────────────┘            ║
║                                 │                                             ║
║  ══════════════════════════════ │ ═════════════════════════════════════════ ║
║  weather-mcp-service (Python / FastAPI, port 8000)                           ║
║                                 ▼                                             ║
║  ┌───────────────────────────────────────────────────────────────────────┐   ║
║  │  main.py — routes                                                     │   ║
║  │  POST /query               — on-demand weather query                  │   ║
║  │  GET  /risk/latest         — stored risk assessment lookup            │   ║
║  │  POST /internal/run-pipeline — manual pipeline trigger               │   ║
║  │  POST /mcp/tools/call      — direct BMD scrape                        │   ║
║  │                                                                       │   ║
║  │  ┌────────────────────────────────────────────────────────────────┐   │   ║
║  │  │  WeatherAgent (agent.py)                                       │   │   ║
║  │  │  1. Gemini intent extraction                                   │   │   ║
║  │  │  2. Mapbox geocode (→ BMD fallback)                            │   │   ║
║  │  │  3. StorageLayer.get_latest_forecast() — 6h cache check       │   │   ║
║  │  │       HIT  → use stored forecast                               │   │   ║
║  │  │       MISS → BMD BAMIS scrape via MCP stdio                   │   │   ║
║  │  │  4. RiskEngine.classify(unified_forecast)                      │   │   ║
║  │  │  5. Gemini explanation (tier-aware prompt)                     │   │   ║
║  │  │  → { answer, risk_tier, risk_label, advisory, triggers }      │   │   ║
║  │  └────────────────────────────────────────────────────────────────┘   │   ║
║  │                                                                       │   ║
║  │  ┌───────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │   ║
║  │  │  DataIngestor     │  │  RiskEngine      │  │  Notifier        │    │   ║
║  │  │  _from_open_meteo │  │  classify()      │  │  dispatch()      │    │   ║
║  │  │  _from_bmd        │  │  Tier 0–4        │  │  T2 → FCM push   │    │   ║
║  │  │  (fallback)       │  │  fixed _T consts │  │  T3 → SMS        │    │   ║
║  │  └───────────────────┘  └─────────────────┘  │  T4 → broadcast  │    │   ║
║  │                                               └──────────────────┘    │   ║
║  │  ┌─────────────────────────────┐  ┌──────────────────────────────┐    │   ║
║  │  │  StorageLayer (storage.py)  │  │  APScheduler (scheduler.py)  │    │   ║
║  │  │  ArangoDB port 8529         │  │  IntervalTrigger(hours=1)    │    │   ║
║  │  │  weather_forecasts          │  │  max_instances=1             │    │   ║
║  │  │  risk_assessments           │  └──────────────────────────────┘    │   ║
║  │  │  alerts_sent                │                                        │   ║
║  │  └─────────────────────────────┘                                        │   ║
║  └───────────────────────────────────────────────────────────────────────┘   ║
║                                                                              ║
║  ┌───────────────────────────────────────────────────────────────────────┐   ║
║  │  MCP stdio subprocesses (MCPClientManager)                            │   ║
║  │  ├ npx @mapbox/mcp-server       → mapbox_geocoding_forward            │   ║
║  │  └ python -m mcp_weather.main   → buffer_point, retrieve_weather_forecast│ ║
║  └───────────────────────────────────────────────────────────────────────┘   ║
║                                                                              ║
║  External data sources                                                       ║
║    Open-Meteo API   api.open-meteo.com   free, no key, 1 km grid, daily     ║
║    BMD BAMIS        web scraper          official Bangladesh stations         ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 3. File Structure

```
components/weather-mcp-service/
│
├── main.py             FastAPI app, lifespan, all HTTP endpoints
├── agent.py            WeatherAgent — on-demand query handler
├── models.py           Pydantic schemas shared by all modules
├── risk_engine.py      Stateless Tier 0–4 classifier
├── data_ingestor.py    Open-Meteo fetch + BMD fallback, 64-district coords
├── scheduler.py        APScheduler hourly pipeline job
├── storage.py          ArangoDB persistence (3 collections)
├── notifier.py         Tier-keyed alert dispatch (FCM, SMS, webhook)
├── mcp_client.py       MCPClientManager — stdio subprocess wrapper
│
├── mcp_weather/
│   ├── main.py         MCP stdio server entry point
│   └── tools/
│       ├── weather_forecast.py   BMD BAMIS scraper (fetch_forecast_logic)
│       └── spatial_tools.py      buffer_point geo helper
│
├── scripts/
│   └── test_pipeline.py   Smoke test: Open-Meteo → ArangoDB (3 batches)
│
├── requirements.txt
└── Dockerfile
```

---

## 4. Shared Schema — `models.py`

Every data source normalises into `UnifiedForecast` before reaching the risk engine
or storage layer. This decouples ingestion from classification completely — neither
`RiskEngine`, `StorageLayer`, nor `Notifier` knows or cares whether data came from
Open-Meteo or BMD.

```python
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
    direction: Optional[float] = None  # degrees 0–360

class ExtremeFlags(BaseModel):
    heatwave:     bool = False   # temperature.max >= 40°C
    heavy_rain:   bool = False   # precipitation.value >= 50 mm/day
    cyclone_risk: bool = False   # wind.speed >= 88 km/h
    drought_risk: bool = False   # 14+ consecutive dry days (< 1 mm/day)

class DayForecast(BaseModel):
    date:          str               # ISO 8601 "YYYY-MM-DD"
    temperature:   TemperatureData
    precipitation: PrecipitationData
    wind:          WindData
    humidity:      float             # %
    extreme_flags: ExtremeFlags = Field(default_factory=ExtremeFlags)

class UnifiedForecast(BaseModel):
    location:    str                   # Canonical English district name
    latitude:    Optional[float] = None
    longitude:   Optional[float] = None
    source:      str                   # "open_meteo" | "bmd"
    horizon:     str                   # "short" (0–7 d)
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

---

## 5. Data Ingestion — `data_ingestor.py`

Fetches weather forecasts and normalises them to `UnifiedForecast`. Contains the full
64-district coordinate table for Bangladesh.

### District coordinates

```python
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    # Dhaka Division
    "Dhaka":       (23.8103, 90.4125),
    "Gazipur":     (23.9999, 90.4272),
    "Mymensingh":  (24.7471, 90.4203),
    # Chittagong Division
    "Chattogram":  (22.3569, 91.7832),
    "Cox's Bazar": (21.4272, 92.0058),
    "Sylhet":      (24.8949, 91.8687),
    # Rangpur Division
    "Rangpur":     (25.7439, 89.2752),
    "Dinajpur":    (25.6279, 88.6337),
    # Rajshahi Division
    "Rajshahi":    (24.3636, 88.6241),
    # ... all 64 districts across 8 divisions
}
```

### Short-term ingestion with fallback

```python
def ingest_short_term(
    self,
    districts: list[str] | None = None,
    forecast_days: int = 7,
) -> list[UnifiedForecast]:
    """
    Primary:  Open-Meteo (free, no key, 1 km grid)
    Fallback: BMD BAMIS scraper if Open-Meteo fails for a district
    Districts that fail both are logged and skipped — pipeline continues.
    """
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

`_safe(daily, key, i, default)` handles `None` values in Open-Meteo arrays — these
occur when a variable is unavailable for a specific day.

### BMD scraper wrapper

```python
def _from_bmd(self, district: str, forecast_days: int) -> UnifiedForecast:
    """
    Wraps fetch_forecast_logic() from mcp_weather.tools.weather_forecast.
    BMD provides a single observation row per district spread across forecast_days.
    Wind speed is not available from the BMD table — set to 0.0.
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

    return UnifiedForecast(
        location=district, source="bmd", horizon="short",
        ingested_at=datetime.now(timezone.utc).isoformat(),
        forecast=days_list,
    )
```

---

## 6. Risk Engine — `risk_engine.py`

Stateless — takes a `UnifiedForecast`, returns a `RiskAssessment` with no database
access or side-effects. Used by both the hourly pipeline and the on-demand agent.

### Threshold constants

```python
_T = {
    # Precipitation  (mm / day)
    "rain_1": 50.0,    # Advisory
    "rain_2": 100.0,   # Warning
    "rain_3": 200.0,   # Severe

    # Temperature  (°C, daily maximum)
    "heat_1": 38.0,    # Advisory
    "heat_2": 40.0,    # Warning
    "heat_3": 43.0,    # Severe

    # Wind speed  (km/h, daily maximum gust)
    "wind_1": 62.0,    # Advisory  — Beaufort 8 gale
    "wind_2": 88.0,    # Warning   — Beaufort 10 cyclone approach
    "wind_3": 118.0,   # Severe    — Beaufort 12 hurricane force

    # Pattern windows
    "heatwave_days": 3,   # >= heat_2 for N consecutive days → Tier 2
    "drought_days":  14,  # < 1 mm/day for N consecutive days → Tier 1
}
```

### Tier table

| Tier | Label | Precipitation | Temperature | Wind | Pattern |
|------|-------|--------------|-------------|------|---------|
| 0 | Normal | < 50 mm/day | < 38°C | < 62 km/h | — |
| 1 | Advisory | ≥ 50 mm/day | ≥ 38°C | ≥ 62 km/h | 14+ dry days |
| 2 | Warning | ≥ 100 mm/day | ≥ 40°C | ≥ 88 km/h | 3+ day heatwave |
| 3 | Severe | ≥ 200 mm/day | ≥ 43°C | ≥ 118 km/h | Two simultaneous T2+ |
| 4 | Emergency | multi-hazard escalation from Tier 3 | | | |

### WMO colour alignment

```
WMO Green  → Tier 0   No significant hazard
WMO Yellow → Tier 1   Be aware
WMO Orange → Tier 2   Take action
WMO Red    → Tier 3   Immediate action
(Purple)   → Tier 4   Catastrophic
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

    # Temperature  (same pattern for heat_1/2/3)
    # Wind         (same pattern for wind_1/2/3)
    # Explicit cyclone_risk flag from source data → Tier 3

    # IPC multi-hazard: ≥2 independent Tier-2+ triggers on same day → +1
    if tier >= 2 and len(triggers) >= 2:
        tier = min(tier + 1, 4)
        triggers.append("Multi-hazard escalation (IPC combined risk +1 tier)")

    return tier, triggers
```

### Multi-day pattern detection

```python
def _score_patterns(self, days: list[DayForecast]) -> tuple[int, list[str]]:
    # Heatwave: N consecutive days >= 40°C → Tier 2
    hot_run = 0
    for day in days:
        if day.temperature.max >= _T["heat_2"]:
            hot_run += 1
            if hot_run >= _T["heatwave_days"]:
                return 2, [f"Heatwave: {hot_run} consecutive days ≥40°C"]
        else:
            hot_run = 0

    # Drought: N consecutive days < 1 mm → Tier 1
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

### Decision logic summary

```
For each forecast day d:
  Score rain/temp/wind against _T thresholds → tier_d, triggers_d
  If tier_d >= 2 and len(triggers_d) >= 2: tier_d = min(tier_d + 1, 4)

Scan all days for multi-day patterns → pattern_tier

Final tier = max(worst daily tier, pattern_tier), capped at 4
```

### Public interface

```python
engine = RiskEngine()
assessment = engine.classify(unified_forecast)
# → RiskAssessment(tier=2, tier_label="Warning", triggers=[...], reasoning="...")
```

---

## 7. Storage Layer — `storage.py`

ArangoDB persistence via `python-arango`. Three collections are created automatically
on first startup. All public methods are synchronous — call from async code via
`asyncio.get_event_loop().run_in_executor(None, ...)` to avoid blocking the event loop.

### Connection

```python
class StorageLayer:
    def __init__(self) -> None:
        arango_url  = os.getenv("ARANGO_URL",      "http://arango-vector-db:8529")
        arango_db   = os.getenv("ARANGO_DB_NAME",  "genie-ai")
        arango_user = os.getenv("ARANGO_USER",     "root")
        arango_pass = os.getenv("ARANGO_PASSWORD", "test")

        client   = ArangoClient(hosts=arango_url)
        self._db = client.db(arango_db, username=arango_user, password=arango_pass)
        self._ensure_collections()
```

### Upsert key strategy

| Collection | `_key` format | Example |
|-----------|--------------|---------|
| `weather_forecasts` | `{location}__{source}__{horizon}` | `dhaka__open_meteo__short` |
| `risk_assessments` | `{location}__{horizon}` | `dhaka__short` |
| `alerts_sent` | auto-generated | — |

Keys are lowercased with spaces→`_`, apostrophes and hyphens stripped.

One document per `location + source + horizon` exists at any time — each pipeline
run replaces the previous one rather than accumulating duplicates.

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
```

### Alert deduplication

```python
def was_alert_sent(self, location: str, tier: int, within_hours: int = 12) -> bool:
    """
    True if an alert of this tier or higher was already sent for this location
    within the last 12 hours. Prevents notification spam on each hourly run.
    """
```

---

## 8. Notification Dispatch — `notifier.py`

Tier-keyed routing with graceful degradation — all channels fail silently when their
env var is unset, so the service runs correctly with no notification keys configured.

### Channel assignment (WMO colour-code aligned)

| Tier | Label | Channels |
|------|-------|---------|
| 0 | Normal | structured log only |
| 1 | Advisory | log |
| 2 | Warning | log + FCM push |
| 3 | Severe | log + FCM push + Twilio SMS |
| 4 | Emergency | log + FCM + SMS + voice call + broadcast webhook |

### Dispatch logic

```python
def dispatch(self, assessment: RiskAssessment) -> None:
    tier = assessment.tier
    if tier == 0:
        self._log(assessment)
        return

    # 12-hour deduplication — suppress repeat sends
    if self._storage.was_alert_sent(assessment.location, tier, within_hours=12):
        logger.info("[NOTIFY] Suppressed duplicate tier-%d alert for %s", tier, assessment.location)
        return

    self._log(assessment)

    if tier >= 2: self._push(assessment)     # FCM push
    if tier >= 3: self._sms(assessment)      # Twilio SMS
    if tier >= 4:
        self._voice(assessment)              # Twilio Voice IVR
        self._broadcast(assessment)          # government webhook

    self._storage.record_alert_sent(assessment.location, tier, channel=self._channel_name(tier))
```

### FCM push topic convention

```python
topic_slug = location.lower().replace(" ", "_").replace("'", "")
topic = f"/topics/weather_{topic_slug}"
# e.g. /topics/weather_dhaka, /topics/weather_coxs_bazar
```

Payload includes `tier`, `tier_label`, `location`, `triggers` (JSON string), and
`assessed_at` in the `data` block so the app can render a risk banner without an
additional API call.

---

## 9. Background Scheduler — `scheduler.py`

APScheduler's `AsyncIOScheduler` shares the FastAPI event loop. Blocking I/O
(HTTP requests, ArangoDB writes) runs in a `ThreadPoolExecutor` via
`asyncio.get_event_loop().run_in_executor(None, ...)`.

### Hourly pipeline function

```python
async def run_hourly_pipeline(storage, ingestor, risk_engine, notifier) -> dict:
    # Step 1 — ingestion (thread pool, blocking HTTP)
    forecasts = await loop.run_in_executor(
        None, lambda: ingestor.ingest_short_term(forecast_days=7)
    )

    # Steps 2–5 — per district: persist, classify, notify
    for fc in forecasts:
        await loop.run_in_executor(None, lambda f=fc: storage.upsert_forecast(f))

        assessment = risk_engine.classify(fc)   # CPU-only

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
        run_hourly_pipeline,
        trigger=IntervalTrigger(hours=1),
        args=[storage, ingestor, risk_engine, notifier],
        id="hourly_pipeline",
        misfire_grace_time=3600,  # run up to 1 h late if container was down
        max_instances=1,          # never overlap if a run is slow
    )
    return scheduler
```

The scheduler starts in `main.py` lifespan and shuts down cleanly on exit.
`misfire_grace_time=3600` ensures a missed run fires within the hour rather than
being skipped when the container restarts. `max_instances=1` prevents a slow run
from stacking a second one on top of itself.

---

## 10. WeatherAgent — `agent.py`

Handles on-demand queries. Accepts an optional `storage` parameter — if ArangoDB is
unavailable at startup the agent still works, falling back to live BMD scrapes only.

### Initialisation

```python
class WeatherAgent:
    def __init__(
        self,
        mcp_manager: MCPClientManager,
        storage: Optional["StorageLayer"] = None,
    ) -> None:
        self.mcp         = mcp_manager
        self.storage     = storage
        self.risk_engine = RiskEngine()   # stateless, no args needed
        # Gemini client setup ...
```

### `run()` pipeline

```python
async def run(self, query: str) -> dict:
    # 1. Gemini intent extraction
    # 2. Mapbox geocode → district + lat/lon  (BMD direct fallback)
    # 3. Buffer polygon creation (spatial_tools)

    # 4. Forecast — stored cache first, live BMD scrape as fallback
    forecast_data, unified_forecast = await self._get_forecast(
        geo["district"], intent.forecast_days
    )

    # 5. Risk classification
    risk_assessment = self.risk_engine.classify(unified_forecast)

    # 6. Tier-aware Gemini explanation
    answer = await self._generate_explanation(
        query, intent, geo, forecast_data, risk_assessment
    )

    return {
        "answer":     answer,
        "risk_tier":  risk_assessment.tier,
        "risk_label": risk_assessment.tier_label,
        "advisory":   risk_assessment.reasoning,
        "triggers":   risk_assessment.triggers,
        "buffer":     ...,
        "location":   geo.get("display_name", intent.location),
        "forecast":   forecast_data,
    }
```

### Forecast cache lookup

```python
async def _get_forecast(self, district: str, forecast_days: int):
    if self.storage:
        stored = self.storage.get_latest_forecast(district, horizon="short", max_age_hours=6)
        if stored:
            return self._unified_to_legacy(stored), stored   # use pipeline data

    # Live BMD scrape via MCP stdio subprocess
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

When `risk_assessment.tier >= 1`, the prompt includes:

```
Risk classification: Tier {tier} ({label}).
Key triggers: {triggers}.
Include a clear advisory based on the risk tier in your response.
```

This makes Gemini's explanation reflect the actual hazard level rather than giving
a generic weather description.

---

## 11. FastAPI Service — `main.py`

### Lifespan startup order

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. MCP stdio sessions (Mapbox + BMD) — non-fatal if unavailable
    mcp_manager = MCPClientManager()
    await mcp_manager.start()

    # 2. Early warning infrastructure — non-fatal if ArangoDB unreachable
    try:
        storage_layer = StorageLayer()
        data_ingestor = DataIngestor()
        risk_engine   = RiskEngine()
        notifier      = Notifier(storage_layer)
    except Exception as exc:
        logger.warning("[STARTUP] Early warning infrastructure unavailable: %s", exc)

    # 3. WeatherAgent — skipped if MCP unavailable
    weather_agent = WeatherAgent(mcp_manager, storage=storage_layer)

    # 4. Scheduler — only starts if storage + ingestor are both available
    if storage_layer and data_ingestor:
        scheduler = create_scheduler(storage_layer, data_ingestor, risk_engine, notifier)
        scheduler.start()

    yield

    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
    await mcp_manager.stop()
```

The non-fatal pattern means the service starts even when ArangoDB is temporarily
down — on-demand queries still work via live BMD scrapes; the scheduler and storage
features become available once ArangoDB recovers (requires container restart).

---

## 12. Node.js Integration — `query-service.js`

The weather path in `gov-chat-backend` passes risk fields through to the frontend:

```javascript
// query-service.js — weather routing
const WEATHER_KW = ['weather', 'forecast', 'rain', 'rainfall', 'temperature',
                    'humid', 'storm', 'flood', 'cyclone', 'monsoon', 'climate'];

const isWeatherQuery = weatherEnabled && WEATHER_KW.some(kw =>
    lastUserMsg.toLowerCase().includes(kw)
);

if (isWeatherQuery) {
    const wResp = await axios.post(`${weatherMcpUrl}/query`, { query: lastUserMsg }, { timeout: 30000 });
    opeaResponseContent = wResp.data.answer;
    opeaMetadata = {
        source_documents: [],
        confidence_score: 1.0,
        weather:    true,
        location:   wResp.data.location,
        forecast:   wResp.data.forecast,
        risk_tier:  wResp.data.risk_tier  ?? 0,
        risk_label: wResp.data.risk_label ?? 'Normal',
        triggers:   wResp.data.triggers   ?? [],
        advisory:   wResp.data.advisory   ?? null,
    };
}
```

The `??` null-coalescing fallbacks keep the backend compatible if the Python service
is temporarily on a build without these fields.

**Frontend risk banner example** (Vue component):

```javascript
if (result.metadata?.risk_tier >= 2) {
    this.riskBanner = {
        tier:     result.metadata.risk_tier,
        label:    result.metadata.risk_label,
        colour:   ['green','yellow','orange','red','purple'][result.metadata.risk_tier],
        triggers: result.metadata.triggers,
    };
}
```

---

## 13. Hourly Pipeline — End-to-End Flow

```
APScheduler IntervalTrigger(hours=1) fires
    │
    ├─ DataIngestor.ingest_short_term(forecast_days=7)  [thread pool]
    │      for each of 64 Bangladesh districts:
    │        GET api.open-meteo.com/v1/forecast
    │              ?daily=temperature,precip,wind,...
    │              &timezone=Asia/Dhaka
    │              &forecast_days=7
    │          → parse 7 × DayForecast → UnifiedForecast(source="open_meteo")
    │        on failure → fetch_forecast_logic(district, 7, [])  [BMD scraper]
    │          → UnifiedForecast(source="bmd")
    │
    ├─ for each UnifiedForecast:
    │      StorageLayer.upsert_forecast(fc)
    │        → ArangoDB weather_forecasts  _key="dhaka__open_meteo__short"
    │
    │      RiskEngine.classify(fc)
    │        → score each day: rain/temp/wind vs _T thresholds
    │        → detect patterns: heatwave run, drought run
    │        → worst-case tier + triggers list
    │        → RiskAssessment(tier, tier_label, triggers, reasoning)
    │
    │      StorageLayer.upsert_risk_assessment(assessment)
    │        → ArangoDB risk_assessments  _key="dhaka__short"
    │
    └─ if assessment.tier >= 2:
           Notifier.dispatch(assessment)
             was_alert_sent(location, tier, 12h)?  YES → skip (dedup)
                                                   NO  → send
             tier 2 → FCM push to /topics/weather_dhaka
             tier 3 → FCM + Twilio SMS
             tier 4 → FCM + SMS + voice + broadcast webhook
           StorageLayer.record_alert_sent(...)

Result: { status, districts_processed, alerts_dispatched, errors }
```

**Expected runtime:** 2–4 minutes for 64 districts (Open-Meteo ~1 req/s polite limit).

**Error handling:** individual district failures are logged and skipped; the pipeline
reports `{"status": "partial", "errors": N}` rather than aborting.

---

## 14. On-Demand Query Flow

```
User: "Will there be flooding in Sylhet next week?"
    │
    ▼ POST /api/queries → gov-chat-backend query-service.js
"flood" matches WEATHER_KW → POST :8000/query { query: "..." }
    │
    ▼ WeatherAgent.run()
    ├─ Gemini flash-lite: extract intent
    │     → { location: "Sylhet", user_context: "CITIZEN", forecast_days: 7 }
    │
    ├─ Mapbox geocode "Sylhet" → lat/lon + district="Sylhet"
    │     (BMD district list fallback if Mapbox token invalid)
    │
    ├─ StorageLayer.get_latest_forecast("Sylhet", "short", max_age_hours=6)
    │     HIT  → use stored Open-Meteo data from last pipeline run
    │     MISS → MCP stdio: retrieve_weather_forecast("Sylhet", 7, [...])
    │                        ← BMD BAMIS scraper
    │
    ├─ RiskEngine.classify(unified_forecast)
    │     day 4: rain=180mm → Tier 2 "Warning"
    │     → RiskAssessment(tier=2, triggers=["Heavy rainfall 180mm..."])
    │
    ├─ Gemini flash: _generate_explanation(... risk_assessment)
    │     prompt: "Risk classification: Tier 2 (Warning). Key triggers: ..."
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
    ▼ query-service.js → opeaMetadata = { weather: true, risk_tier: 2, ... }
    ▼ Frontend: renders answer + orange risk banner
```

---

## 15. ArangoDB Storage Schema

### Collection: `weather_forecasts`

```json
{
  "_key":        "dhaka__open_meteo__short",
  "location":    "Dhaka",
  "latitude":    23.8103,
  "longitude":   90.4125,
  "source":      "open_meteo",
  "horizon":     "short",
  "ingested_at": "2026-04-08T06:03:22.145Z",
  "forecast": [
    {
      "date": "2026-04-08",
      "temperature":   { "min": 24.0, "max": 34.5, "unit": "Celsius" },
      "precipitation": { "value": 112.3, "probability": 0.85, "unit": "mm" },
      "wind":          { "speed": 45.0, "direction": 210.0 },
      "humidity":      88.0,
      "extreme_flags": { "heatwave": false, "heavy_rain": true,
                         "cyclone_risk": false, "drought_risk": false }
    }
    // ... 6 more days
  ]
}
```

- Upsert key: `{location}__{source}__{horizon}` — one live document per district
- Recommended TTL index: 30 days on `ingested_at`

### Collection: `risk_assessments`

```json
{
  "_key":            "dhaka__short",
  "location":        "Dhaka",
  "assessed_at":     "2026-04-08T06:04:11.022Z",
  "horizon":         "short",
  "tier":            2,
  "tier_label":      "Warning",
  "triggers":        ["Heavy rainfall 112.3mm/day (≥100mm — warning)"],
  "reasoning":       "Risk level 2 (Warning) detected for Dhaka on 2026-04-08. Key triggers: ...",
  "forecast_source": "open_meteo",
  "raw_forecast":    { "date": "2026-04-08", "temperature": {}, "precipitation": {} }
}
```

- Upsert key: `{location}__{horizon}` — replaced on every pipeline run
- Recommended TTL index: 90 days on `assessed_at`

### Collection: `alerts_sent`

```json
{
  "location": "Dhaka",
  "tier":     2,
  "channel":  "push",
  "sent_at":  "2026-04-08T06:04:15.300Z"
}
```

- Auto-generated `_key`, used only for 12-hour deduplication lookups
- Recommended TTL index: 7 days on `sent_at`

---

## 16. API Reference

### `POST /query`

```json
// Request
{ "query": "Will there be flooding in Sylhet next week?" }

// Response
{
  "answer":     "Sylhet is forecast to receive heavy rainfall...",
  "risk_tier":  2,
  "risk_label": "Warning",
  "advisory":   "Risk level 2 (Warning) detected for Sylhet on 2026-04-12...",
  "triggers":   ["Heavy rainfall 112mm/day (≥100mm — warning)"],
  "buffer":     { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [...] } },
  "location":   "Sylhet, Bangladesh",
  "forecast":   { "location": { "area_name": "Sylhet" }, "forecast": [ ... ] }
}
```

### `GET /risk/latest?location=Dhaka&horizon=short`

```json
// Stored assessment available
{
  "location":        "Dhaka",
  "assessed_at":     "2026-04-08T06:04:11Z",
  "horizon":         "short",
  "tier":            1,
  "tier_label":      "Advisory",
  "triggers":        ["Significant rainfall 55mm/day (≥50mm — advisory)"],
  "reasoning":       "Risk level 1 (Advisory) detected for Dhaka...",
  "forecast_source": "open_meteo",
  "raw_forecast":    { ... }
}

// No stored data — live fallback used
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

### `POST /internal/run-pipeline`

Manual trigger — returns immediately, pipeline runs in background.

```json
// Response
{ "status": "pipeline_started", "message": "Hourly pipeline running in background" }

// Pipeline result (logged, not returned synchronously)
{ "status": "ok", "districts_processed": 64, "errors": 0, "alerts_dispatched": 3 }
```

### `GET /health`

```json
{ "status": "healthy", "storage": true, "scheduler": true }
```

### `POST /mcp/tools/call`

Direct BMD scrape (used by Node.js tool registry):

```json
// Request
{ "name": "retrieve_weather_forecast", "arguments": { "district_name": "Pabna", "forecast_days": 3 } }

// Response
{ "content": [{ "type": "text", "text": "{ \"location\": ..., \"forecast\": [...] }" }] }
```

---

## 17. Environment Variables

All variables are read at startup. Missing optional vars log an info message and
the associated feature is skipped — the service does not crash.

```env
# ── LLM / Geocoding ──────────────────────────────────────────────────────────
GOOGLE_API_KEY=your_gemini_api_key         # Gemini intent extraction + explanation
MAPBOX_ACCESS_TOKEN=your_mapbox_token      # Geocoding (optional — BMD fallback exists)

# ── ArangoDB (shared with rest of MEWA stack) ─────────────────────────────────
ARANGO_URL=http://arango-vector-db:8529    # Container DNS name inside chatqna_default network
ARANGO_DB_NAME=genie-ai
ARANGO_USER=root
ARANGO_PASSWORD=your_arango_password

# ── Python runtime ────────────────────────────────────────────────────────────
PYTHONUNBUFFERED=1

# ── Notification channels (all optional) ──────────────────────────────────────
FCM_SERVER_KEY=                            # Firebase Cloud Messaging (tier 2+)
TWILIO_ACCOUNT_SID=                        # Twilio (tier 3+)
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_FROM=+1234567890
EMERGENCY_CONTACT_NUMBERS=+880...,+880...  # comma-separated SMS/voice recipients
EMERGENCY_TWIML_URL=                       # TwiML URL for tier-4 voice call
BROADCAST_WEBHOOK_URL=                     # government broadcast webhook (tier 4)
```

---

## 18. Requirements

```
# Core service
fastapi==0.110.0
uvicorn==0.29.0
python-multipart==0.0.6

# LLM / agent
google-genai==0.8.0

# MCP protocol
mcp>=1.0.0

# Geo / spatial
shapely==2.0.3
pyproj==3.6.1
geojson==3.1.0

# Web scraping (BMD BAMIS)
requests==2.31.0
beautifulsoup4==4.12.3

# Schema validation
pydantic>=2.11.0

# Storage
python-arango==7.9.1

# Scheduler
APScheduler==3.10.4

# Optional — Twilio SMS / voice (install if TWILIO_ACCOUNT_SID is set):
# twilio==9.0.0
```

The Dockerfile requires no changes — `python-arango` and `APScheduler` are pure Python
and install without system dependencies.

---

## 19. Testing the Pipeline

`scripts/test_pipeline.py` runs 3 batches of Open-Meteo ingestion for a small set of
districts and verifies that documents land in ArangoDB after each batch.

### Run inside the container

```bash
docker exec -it weather-mcp-standalone bash
python scripts/test_pipeline.py
```

### Optional overrides

```bash
# Test only 2 districts, 2 batches
TEST_DISTRICTS="Dhaka,Sylhet" BATCHES=2 python scripts/test_pipeline.py
```

### What it does

1. Calls `DataIngestor.ingest_short_term()` for 5 districts (default: Dhaka, Sylhet,
   Rangpur, Chattogram, Rajshahi) — same Open-Meteo path as the real pipeline
2. Calls `StorageLayer.upsert_forecast()` + `RiskEngine.classify()` +
   `upsert_risk_assessment()` for each district
3. Queries ArangoDB back immediately to verify documents landed
4. Waits 3 seconds between batches
5. Prints a verification table per batch showing source, days stored, and risk tier
6. Prints collection counts before and after
7. Exits with code `0` (all OK) or `1` (any errors)

### Expected output (healthy system)

```
────────────────────────────────────────────────────────────
  Setup
────────────────────────────────────────────────────────────
  Districts : Dhaka, Sylhet, Rangpur, Chattogram, Rajshahi
  Batches   : 3
  ArangoDB  : http://arango-vector-db:8529

  Batch 1 verification — 5/5 districts fully stored

  District           Forecast     Source       Days   Risk      Tier
  ────────────────── ────────── ──────────── ────── ──────── ────────────
  Dhaka                  OK      open_meteo     7      OK    0 (Normal)
  Sylhet                 OK      open_meteo     7      OK    0 (Normal)
  ...

────────────────────────────────────────────────────────────
  Final summary
────────────────────────────────────────────────────────────
  Batch 1  [  OK   ]  stored=5  errors=0  time=4.2s  T0=5
  Batch 2  [  OK   ]  stored=5  errors=0  time=3.9s  T0=5
  Batch 3  [  OK   ]  stored=5  errors=0  time=4.1s  T0=5

  RESULT: ALL BATCHES PASSED — data is reaching ArangoDB correctly.
```
