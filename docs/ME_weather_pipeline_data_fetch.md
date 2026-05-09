# Weather Data Pipeline — Daily Fetch, Validation & Storage

> **Covers:** APScheduler daily cron, Open-Meteo ingestion, BAMIS sense-check validation, BMD fallback, data normalisation, risk classification, ArangoDB persistence, and the notification system.  
> **Files:** `scheduler.py` · `data_ingestor.py` · `models.py` · `risk_engine.py` · `storage.py` · `notifier.py` · `main.py`

---

## Table of Contents

1. [Big Picture](#1-big-picture)
2. [The Scheduler — How the Cron Works](#2-the-scheduler--how-the-cron-works)
3. [Step 1 — Fetching from Open-Meteo (Primary Source)](#3-step-1--fetching-from-open-meteo-primary-source)
4. [Step 2 — Fetching BAMIS for Sense-Check](#4-step-2--fetching-bamis-for-sense-check)
5. [Step 3 — Sense-Check Validation](#5-step-3--sense-check-validation)
6. [Step 4 — BMD Fallback](#6-step-4--bmd-fallback)
7. [Data Normalisation — UnifiedForecast](#7-data-normalisation--unifiedforecast)
8. [Step 5 — Risk Classification](#8-step-5--risk-classification)
9. [Step 6 — ArangoDB Storage](#9-step-6--arangodb-storage)
10. [Step 7 — Notification Dispatch](#10-step-7--notification-dispatch)
11. [Staleness Window](#11-staleness-window)
12. [Manual Trigger](#12-manual-trigger)
13. [Environment Variables Reference](#13-environment-variables-reference)

---

## 1. Big Picture

The pipeline runs automatically once per day. Its job is to ensure ArangoDB always holds a fresh, validated 7-day weather forecast for every Bangladesh district, with a risk tier attached so the chatbot and frontend can answer questions without making live API calls.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   DAILY PIPELINE (05:00 UTC)                        │
│                                                                     │
│  APScheduler (in-process, FastAPI lifespan)                         │
│       │                                                             │
│       ▼                                                             │
│  DataIngestor.ingest_short_term()   — for all 64 districts          │
│       │                                                             │
│       ├─ 1. Fetch Open-Meteo 7-day forecast  ──────────────────┐   │
│       │                                                         │   │
│       ├─ 2. Fetch BAMIS (1 bulk HTTP req, all districts)        │   │
│       │                                                         │   │
│       ├─ 3. sense_check: compare OM day-0 vs BAMIS bounds       │   │
│       │       │                                                 │   │
│       │       ├── PASS  → use Open-Meteo ──────────────────────►│   │
│       │       │                                                 │   │
│       │       └── FAIL  → fetch BMD per-district ──────────────►│   │
│       │                                                         │   │
│       ▼                                                         │   │
│  UnifiedForecast (normalised schema)  ◄─────────────────────────┘   │
│       │                                                             │
│       ├─ StorageLayer.upsert_forecast()  → weather_forecasts        │
│       │                                                             │
│       ├─ RiskEngine.classify()           → RiskAssessment           │
│       │                                                             │
│       ├─ StorageLayer.upsert_risk_assessment() → risk_assessments   │
│       │                                                             │
│       └─ Notifier.dispatch()  (only if tier ≥ 2)                   │
│               │                                                     │
│               ├── Tier 2 → FCM push                                │
│               ├── Tier 3 → FCM push + Twilio SMS                   │
│               └── Tier 4 → FCM + SMS + voice + broadcast webhook   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. The Scheduler — How the Cron Works

### Why APScheduler instead of a system cron

The pipeline runs **inside the FastAPI process** using [APScheduler](https://apscheduler.readthedocs.io/). This means:

- No external cron daemon or Docker entrypoint script is needed
- The scheduler shares the same asyncio event loop as the FastAPI app
- It starts automatically when the container starts (via FastAPI's `lifespan` context)
- If it hasn't started (e.g. ArangoDB was unreachable at boot), the pipeline simply doesn't run — it fails gracefully rather than crashing the container

### Job registration (`scheduler.py`)

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()

# ── Main daily job ────────────────────────────────────────────────────
scheduler.add_job(
    run_daily_pipeline,
    trigger=CronTrigger(hour=5, minute=0, timezone="UTC"),  # 05:00 UTC every day
    args=[storage, ingestor, risk_engine, notifier, potato_ews],
    id="daily_pipeline",
    misfire_grace_time=86400,  # if container was down, still run when it comes back
    max_instances=1,           # never run two pipeline instances in parallel
)

# ── Startup catch-up run ──────────────────────────────────────────────
# Fires 10 seconds after container start so ArangoDB is always populated
# immediately — no need to wait until 05:00.
startup_time = datetime.now(timezone.utc) + timedelta(seconds=10)
scheduler.add_job(
    run_daily_pipeline,
    trigger="date",
    run_date=startup_time,
    args=args,
    id="startup_pipeline",
    max_instances=1,
)
```

### Two jobs, not one

| Job | When it fires | Purpose |
|---|---|---|
| `daily_pipeline` | 05:00 UTC every day | Keeps ArangoDB fresh on a predictable schedule |
| `startup_pipeline` | 10 s after container boot | Fills ArangoDB immediately after any restart without waiting for 05:00 |

### `misfire_grace_time=86400`

If the container was offline during the 05:00 window (e.g. a nightly restart or crash), APScheduler marks the job as "misfired". With `misfire_grace_time=86400` (24 hours), it will **still execute** that missed run as soon as the container comes back up, rather than skipping it. This ensures we never go more than one day without a refresh.

### `max_instances=1`

Prevents two pipeline runs from overlapping. If one run takes longer than expected (slow BAMIS scrape, large district count), APScheduler will not start a second instance on top of it.

### How the scheduler is started (`main.py`)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ... initialise storage, ingestor, risk_engine, notifier ...

    if storage_layer and data_ingestor:
        from scheduler import create_scheduler
        scheduler = create_scheduler(storage_layer, data_ingestor, risk_engine, notifier, potato_ews)
        scheduler.start()   # ← starts both jobs; the startup_pipeline fires in 10 s

    yield  # app runs here

    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
```

The scheduler is only started if both `storage_layer` and `data_ingestor` initialised successfully. If ArangoDB is unreachable at startup, the scheduler is simply not created — the container still serves HTTP requests but without the pipeline.

---

## 3. Step 1 — Fetching from Open-Meteo (Primary Source)

### What is Open-Meteo?

[Open-Meteo](https://open-meteo.com/) is a free, open-source weather API that aggregates multiple global NWP (numerical weather prediction) models — GFS (USA), ICON (Germany), ERA5 (ECMWF reanalysis). It requires no API key and provides a 1 km grid resolution. For Bangladesh it uses a combination of ICON-D2 and GFS.

### What we request

For each district we send one HTTP GET request:

```
https://api.open-meteo.com/v1/forecast
  ?latitude={lat}&longitude={lon}
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,
         precipitation_probability_max,windspeed_10m_max,
         winddirection_10m_dominant,relative_humidity_2m_max
  &hourly=soil_moisture_0_to_1cm
  &timezone=Asia/Dhaka
  &forecast_days=7
```

| Parameter | Why we need it |
|---|---|
| `temperature_2m_max/min` | Heatwave detection, crop threshold checks |
| `precipitation_sum` | Flood tier classification, drought run detection |
| `precipitation_probability_max` | Shown to users as rain likelihood |
| `windspeed_10m_max` | Cyclone / gale risk tiers |
| `winddirection_10m_dominant` | Displayed in forecasts |
| `relative_humidity_2m_max` | Sense-check against BAMIS, crop disease risk |
| `soil_moisture_0_to_1cm` | Hourly only — averaged to daily for potato EWS |

### District coordinates

All 64 Bangladesh districts have a hard-coded lat/lon centroid in `DISTRICT_COORDS`. This avoids any geocoding API dependency and ensures stable, reproducible grid lookups:

```python
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka":      (23.8103, 90.4125),
    "Chittagong": (22.3569, 91.7832),
    "Sylhet":     (24.8949, 91.8687),
    # ... all 64 districts
}
```

### What we do with soil moisture

Soil moisture from Open-Meteo is **hourly** (24 values per day), but the rest of the data is daily. We average the 24 hourly values for each day before storing:

```python
def _daily_soil_moisture(day_index: int) -> float | None:
    start = day_index * 24
    vals = [v for v in sm_hourly[start:start + 24] if v is not None]
    return round(sum(vals) / len(vals), 4) if vals else None
```

### Extreme flags set at ingestion time

While parsing each day's data, three boolean flags are set directly from raw values, before any risk classification:

```python
ExtremeFlags(
    heavy_rain   = rain  >= 50.0,   # mm/day
    heatwave     = max_t >= 40.0,   # °C
    cyclone_risk = wind  >= 88.0,   # km/h — Beaufort 10
)
```

These are stored in the forecast document and can be queried directly without re-running the risk engine.

---

## 4. Step 2 — Fetching BAMIS for Sense-Check

### What is BAMIS?

BAMIS (Bangladesh Agro-Meteorological Information System, `bamis.gov.bd`) is the official weather portal of the Bangladesh Meteorological Department (BMD). It publishes WRF (Weather Research and Forecasting) model output for all districts in an HTML table.

### One request for all districts

BAMIS is fetched **once per pipeline run**, not once per district. This is intentional — it minimises load on the government server and keeps the pipeline fast.

```python
url = "https://www.bamis.gov.bd/en/bmd/wrf/table/all/1/"
# days=1 → fetch today's WRF bounds (1-day period)

resp = requests.get(url, headers={
    "User-Agent": "Mozilla/5.0 ...",   # polite browser header
    "Accept": "text/html,...",
}, timeout=15)
```

The response is an HTML page with a table. We parse it with BeautifulSoup:

```python
soup = BeautifulSoup(resp.text, "html.parser")

result: dict[str, dict] = {}
for row in soup.select("table tbody tr"):
    cells = row.find_all("td")
    raw_name = cells[0].get_text(strip=True)          # district name (may be Bengali)
    bamis_name = BENGALI_TO_ENGLISH.get(raw_name, raw_name)  # translate if Bengali
    canonical = _BAMIS_NAME_MAP.get(bamis_name, bamis_name)  # fix spelling differences

    result[canonical] = {
        "t_min":    float(cells[1].text),   # min temperature °C
        "t_max":    float(cells[3].text),   # max temperature °C
        "humidity": float(cells[5].text),   # relative humidity %
        "rain":     float(cells[10].text),  # total rainfall mm
    }
```

### Name normalisation

BAMIS uses different spellings from our canonical district names. Two layers of mapping handle this:

1. **`BENGALI_TO_ENGLISH`** — translates Bengali-script district names (e.g. `ঢাকা → Dhaka`) for pages that serve Bengali text
2. **`_BAMIS_NAME_MAP`** — corrects English spelling differences:

```python
_BAMIS_NAME_MAP = {
    "Chattogram":       "Chittagong",       # official new vs colonial spelling
    "Cumilla":          "Comilla",           # Bengali romanisation vs old spelling
    "Khagrachari":      "Khagrachhari",      # missing 'h'
    "Chapai Nawabganj": "Chapainawabganj",   # space + different romanisation
    "Barishal":         "Barisal",           # official new vs old spelling
    "Jhalokati":        "Jhalokathi",        # missing 'h'
}
```

### If BAMIS is unreachable

Network failures are caught and logged. The function returns an empty dict, and the pipeline continues **without** sense-checking — it uses Open-Meteo data as-is and marks `sense_check_passed=None` (not `False`) so the fallback is not incorrectly triggered.

```python
except Exception as exc:
    logger.warning("[INGESTOR] BAMIS fetch failed: %s — sense_check will be skipped", exc)
    return {}
```

---

## 5. Step 3 — Sense-Check Validation

### What is a sense-check?

A **sense-check** is a plausibility test. Open-Meteo gives a precise model-derived forecast. BAMIS gives the BMD's own WRF output for the same day. If the two sources agree within a tolerance, Open-Meteo is trusted. If they disagree significantly, something is wrong — either the Open-Meteo grid point hit an anomaly, or there was a data quality issue — and we fall back to the official BMD data.

### The three checks

Only day-0 (today) is checked — it is the most reliable comparison point, as both sources are computing conditions for the same current day.

```
┌────────────────────────────────────────────────────────────────────┐
│  SENSE-CHECK LOGIC  (tolerance = ±20%)                             │
│                                                                    │
│  1. TEMPERATURE                                                    │
│     lower = BAMIS_t_min × (1 - 0.20)                             │
│     upper = BAMIS_t_max × (1 + 0.20)                             │
│     VIOLATION if OM_t_max > upper OR OM_t_max < lower            │
│                                                                    │
│  2. PRECIPITATION  (upper-bound only)                              │
│     upper = max(BAMIS_rain × 1.20,  BAMIS_rain + 10)             │
│     VIOLATION if OM_rain > upper                                  │
│     (OM reporting less rain than BMD is always acceptable)         │
│                                                                    │
│  3. HUMIDITY                                                       │
│     lower = max(BAMIS_hum × 0.80, 0)                             │
│     upper = min(BAMIS_hum × 1.20, 100)                           │
│     VIOLATION if OM_hum > upper OR OM_hum < lower                │
│                                                                    │
│  violation_rate = violations / total_checked                       │
│  RESULT: PASS if violation_rate < 0.50  (less than half fail)     │
│          FAIL if violation_rate ≥ 0.50  (majority fail)           │
└────────────────────────────────────────────────────────────────────┘
```

### Why majority threshold (0.5), not all-or-nothing?

A single variable can mismatch for legitimate reasons — e.g. the OM grid point catches a localised rain event that the coarser BMD WRF grid misses. Requiring a majority (≥2 of 3 variables) to fail before triggering a fallback avoids excessive false positives while still catching genuinely unreliable OM data.

### The sense-check result in code

```python
@staticmethod
def _sense_check(om_day: DayForecast, bmd_bounds: dict, tolerance: float = 0.2):
    violations = 0
    total_checked = 0

    # --- Temperature ---
    if bmd_bounds["t_max"] > 0:
        upper = bmd_bounds["t_max"] * (1 + tolerance)
        lower = bmd_bounds["t_min"] * (1 - tolerance)
        violated = om_day.temperature.max > upper or om_day.temperature.max < lower
        total_checked += 1
        if violated:
            violations += 1

    # --- Precipitation (upper only) ---
    upper_rain = max(bmd_bounds["rain"] * (1 + tolerance), bmd_bounds["rain"] + 10.0)
    violated = om_day.precipitation.value > upper_rain
    total_checked += 1
    if violated:
        violations += 1

    # --- Humidity ---
    if bmd_bounds["humidity"] > 0:
        upper_hum = min(bmd_bounds["humidity"] * (1 + tolerance), 100.0)
        lower_hum = max(bmd_bounds["humidity"] * (1 - tolerance), 0.0)
        violated = om_day.humidity > upper_hum or om_day.humidity < lower_hum
        total_checked += 1
        if violated:
            violations += 1

    violation_rate = violations / total_checked
    return violation_rate < 0.5, {
        "total_checked": total_checked,
        "violations": violations,
        "violation_rate": round(violation_rate, 3),
    }
```

### What gets stored

The result of the sense-check is stored on the `UnifiedForecast` object before it goes to ArangoDB:

| `sense_check_passed` | Meaning |
|---|---|
| `True` | OM passed — data is from Open-Meteo |
| `False` | OM failed — data was replaced by BMD fallback |
| `None` | BAMIS was unavailable — sense-check was skipped, OM used as-is |

---

## 6. Step 4 — BMD Fallback

If the sense-check fails, the ingestor discards the Open-Meteo data and fetches the full per-district forecast from the BMD BAMIS scraper instead.

```python
if not reliable:
    bmd_fc = self._from_bmd(district, forecast_days)
    bmd_fc.fallback_used = True
    bmd_fc.sense_check_passed = False
    results.append(bmd_fc)
    continue   # ← skips OM entirely for this district
```

The BMD scraper (`fetch_forecast_logic` from `mcp_weather/tools/weather_forecast.py`) hits the same BAMIS endpoint but with `days=forecast_days` (up to 7) and extracts a full multi-day forecast table for the specific district.

**Limitation:** BMD BAMIS does not publish wind speed. The `_from_bmd` method stores `wind_speed=0.0` for BMD-sourced forecasts. Wind-based tier triggers will not fire for districts on BMD fallback.

### Complete per-district decision tree

```
For each district:
│
├─ Open-Meteo fetch succeeds?
│   ├─ YES
│   │   ├─ BAMIS bounds available for this district?
│   │   │   ├─ YES → run sense_check
│   │   │   │   ├─ PASS  → store OM forecast  (sense_check_passed=True)
│   │   │   │   └─ FAIL  → fetch BMD          (fallback_used=True, sense_check_passed=False)
│   │   │   │       └─ BMD fails? → keep OM anyway + log error
│   │   │   └─ NO  → store OM forecast        (sense_check_passed=None)
│   └─ NO
│       └─ fetch BMD directly                 (fallback_used=True)
│           └─ BMD also fails? → log error, skip district
```

---

## 7. Data Normalisation — UnifiedForecast

Regardless of whether the data came from Open-Meteo or BMD, it is stored in the same Pydantic schema. This means all downstream code (risk engine, storage, chatbot) is source-agnostic.

```python
class UnifiedForecast(BaseModel):
    location:          str               # canonical English district name
    latitude:          Optional[float]   # None for BMD (no coordinates)
    longitude:         Optional[float]
    source:            str               # "open_meteo" | "bmd"
    horizon:           str               # "short" (0–7 days)
    ingested_at:       str               # ISO 8601 UTC timestamp
    forecast:          list[DayForecast] # one entry per day
    fallback_used:     bool = False
    sense_check_passed: Optional[bool] = None

class DayForecast(BaseModel):
    date:          str               # "YYYY-MM-DD"
    temperature:   TemperatureData   # min, max (°C)
    precipitation: PrecipitationData # value (mm), probability (0–1)
    wind:          WindData          # speed (km/h), direction (°)
    humidity:      float             # % (daily max)
    soil_moisture: Optional[float]   # m³/m³ — Open-Meteo only
    extreme_flags: ExtremeFlags      # heavy_rain, heatwave, cyclone_risk
```

---

## 8. Step 5 — Risk Classification

After fetching and normalising the forecast, `RiskEngine.classify()` is called to assign a **Tier 0–4** risk level. This is a stateless operation — it takes a `UnifiedForecast` and returns a `RiskAssessment` with no database access.

### Tier table

| Tier | Label | Colour | Meaning |
|---|---|---|---|
| 0 | Normal | Green | All parameters within seasonal norms |
| 1 | Advisory | Yellow | Elevated conditions, awareness needed |
| 2 | Warning | Orange | Significant hazard, take precautions |
| 3 | Severe | Red | Dangerous conditions, protective action required |
| 4 | Emergency | Purple | Catastrophic multi-hazard event |

### Single-day thresholds

```
Rain (mm/day):   ≥50 → Tier 1 | ≥100 → Tier 2 | ≥200 → Tier 3
Temperature (°C): ≥38 → Tier 1 | ≥40  → Tier 2 | ≥43  → Tier 3
Wind (km/h):      ≥62 → Tier 1 | ≥88  → Tier 2 | ≥118 → Tier 3
```

### Multi-day patterns

The risk engine also scans the full 7-day window for patterns that a single-day check would miss:

- **Heatwave:** 3+ consecutive days ≥ 40°C → Tier 2
- **Drought indicator:** 14+ consecutive days < 1 mm/day → Tier 1

### Multi-hazard escalation (IPC rule)

If a single day triggers two or more independent Tier-2+ conditions simultaneously (e.g. heavy rain AND high wind), the IPC (Integrated Food security Phase Classification) multi-hazard rule applies: **+1 tier, capped at 4**.

```python
if tier >= 2 and len(triggers) >= 2:
    tier = min(tier + 1, 4)
    triggers.append("Multi-hazard escalation (IPC combined risk +1 tier)")
```

### How the worst day is selected

The engine evaluates every day in the 7-day window and keeps the **worst single day**. The final tier is the maximum of:
- worst single-day tier
- multi-day pattern tier

---

## 9. Step 6 — ArangoDB Storage

### Collections

Three ArangoDB collections are created automatically on first run if they don't exist:

| Collection | Content | Recommended TTL |
|---|---|---|
| `weather_forecasts` | `UnifiedForecast` documents | 30 days |
| `risk_assessments` | `RiskAssessment` documents | 90 days |
| `alerts_sent` | Deduplication log for notifications | 7 days |

### Upsert keys

Documents are stored with deterministic `_key` values so repeated pipeline runs replace existing data rather than accumulating duplicates:

```python
# weather_forecasts key
key = f"{location}__{source}__{horizon}"
# e.g. "dhaka__open_meteo__short"

# risk_assessments key
key = f"{location}__{horizon}"
# e.g. "dhaka__short"
```

Keys are normalised (lowercased, spaces → underscores, apostrophes stripped):

```python
def _norm_key(s: str) -> str:
    return s.lower().replace(" ", "_").replace("'", "").replace("-", "_")
```

So `"Cox's Bazar"` becomes `"cox_s_bazar__open_meteo__short"`.

### Upsert logic

```python
def upsert_forecast(self, forecast: UnifiedForecast) -> str:
    key = _norm_key(f"{forecast.location}__{forecast.source}__{forecast.horizon}")
    col = self._db.collection("weather_forecasts")
    doc = {"_key": key, **forecast.model_dump()}

    if col.has(key):
        col.replace(doc)   # full replace, not partial update
    else:
        col.insert(doc)
```

### Staleness window

When the chatbot or frontend requests a forecast, `get_latest_forecast()` checks how old the stored document is before serving it:

```python
def get_latest_forecast(self, location, horizon="short", max_age_hours=30):
    cutoff = (datetime.now(UTC) - timedelta(hours=max_age_hours)).isoformat()

    aql = """
        FOR doc IN weather_forecasts
          FILTER doc.location == @location
            AND  doc.horizon   == @horizon
            AND  doc.ingested_at >= @cutoff   ← must be fresher than 30 h
          SORT doc.ingested_at DESC
          LIMIT 1
          RETURN doc
    """
```

**Why 30 hours?** The pipeline runs at 05:00 UTC. A request at 08:00 UTC the next morning (27 hours later) should still get the stored data — not trigger a live API call. 30h gives a full 24h cycle plus a 6h buffer for delays. Documents older than 30h cause a live fetch instead.

---

## 10. Step 7 — Notification Dispatch

After the risk assessment is stored, `Notifier.dispatch()` is called **only for tier ≥ 2** districts. Tier 0 and 1 are logged but never trigger external channels.

### Channel assignment

```
Tier 0  Normal     → structured log only
Tier 1  Advisory   → log only (ops team reviews daily digest)
Tier 2  Warning    → FCM push notification to district topic subscribers
Tier 3  Severe     → FCM push  +  Twilio SMS
Tier 4  Emergency  → FCM push  +  Twilio SMS  +  Twilio voice call  +  government webhook
```

### Deduplication (12-hour window)

To avoid spamming the same alert multiple times (the pipeline runs daily, but manually-triggered runs are also possible), the notifier checks the `alerts_sent` collection before dispatching:

```python
def was_alert_sent(self, location, tier, within_hours=12) -> bool:
    # returns True if a same-tier (or higher) alert was already sent
    # for this location in the last 12 hours
```

If a duplicate is detected, the alert is suppressed and logged. The 12-hour window covers both the daily run and any manual reruns within the same day.

### FCM push (Tier 2+)

Pushes to Firebase topic `/topics/weather_{district}`. Users who enabled notifications in the frontend app are subscribed to their district's topic.

```python
topic = f"/topics/weather_{location.lower().replace(' ', '_')}"
payload = {
    "to": topic,
    "notification": {
        "title": f"Weather {tier_label} — {location}",
        "body":  reasoning[:200],
        "color": tier_colour,     # "orange" | "red" | "purple"
    },
    "data": {
        "tier":      str(tier),
        "triggers":  json.dumps(triggers),
        "assessed_at": assessed_at,
    }
}
```

### SMS (Tier 3+)

Sent via Twilio to emergency contact numbers configured in `EMERGENCY_CONTACT_NUMBERS`. In production these should be fetched from an `emergency_contacts` ArangoDB collection per district.

### Voice call (Tier 4 only)

Triggers a Twilio IVR call using a pre-recorded TwiML message URL (`EMERGENCY_TWIML_URL`). Used only for catastrophic multi-hazard events.

### Government webhook (Tier 4 only)

Posts a structured JSON payload to `BROADCAST_WEBHOOK_URL` for integration with national alert platforms or emergency management systems.

---

## 11. Staleness Window

The interaction between the pipeline schedule and the staleness window determines when a live API call is made versus when stored data is served:

```
Timeline (daily pipeline runs at 05:00 UTC):

  05:00 UTC  → pipeline runs → ArangoDB updated
      │
      │  ← stored data is fresh, all requests served from ArangoDB
      │
  11:00 UTC  → 6 hours since last run
      │  ← still fresh (30h window)
      │
  Next day 05:00 UTC  → pipeline runs again → ArangoDB updated (24h since last run)
      │
  Next day 11:00 UTC  → 30h since yesterday's 05:00 run
      │  ← threshold crossed: data now considered stale
      │  ← if pipeline missed yesterday, this triggers a live fetch
      │
  Next day 12:00 UTC  → 31h since yesterday's 05:00 run → STALE
                         live fetch fallback kicks in
```

If the pipeline ran successfully, the data is always within 24h, well inside the 30h window. The 6h buffer handles cases where the 05:00 job was delayed or ran slightly late.

---

## 12. Manual Trigger

The pipeline can be triggered manually via HTTP — useful for ops, testing, or forcing a refresh after a long outage:

```bash
curl -X POST http://localhost:5200/internal/run-pipeline
# → {"status": "pipeline_started", "message": "Daily pipeline running in background"}
```

The pipeline runs in a FastAPI `BackgroundTask` — the HTTP response returns immediately and the pipeline runs asynchronously. Check the container logs for progress:

```bash
docker logs weather-mcp-service --follow | grep "\[PIPELINE\]\|\[INGESTOR\]\|\[SCHEDULER\]"
```

Expected log output for a healthy run:

```
[SCHEDULER] Jobs registered: daily_pipeline (05:00 UTC) + startup catch-up in 10 s
[PIPELINE]  Daily pipeline started
[INGESTOR]  BAMIS sense_check reference loaded: 64 districts
[INGESTOR]  sense_check OK for Dhaka (violations=0/3 rate=0.000)
[INGESTOR]  sense_check FAILED for Sylhet (violations=2/3 rate=0.667) — switching to BMD
[INGESTOR]  Short-term ingestion complete: 64 / 64 districts (sense_check_failed=3)
[PIPELINE]  Daily pipeline complete: {districts_processed: 64, errors: 0, alerts_dispatched: 1}
```

---

## 13. Environment Variables Reference

| Variable | Default | Purpose |
|---|---|---|
| `ARANGO_URL` | `http://arango-vector-db:8529` | ArangoDB connection URL |
| `ARANGO_DB_NAME` | `genie-ai` | Database name |
| `ARANGO_USER` | `root` | ArangoDB username |
| `ARANGO_PASSWORD` | `test` | ArangoDB password |
| `FCM_SERVER_KEY` | _(empty)_ | Firebase Cloud Messaging server key — push disabled if unset |
| `TWILIO_ACCOUNT_SID` | _(empty)_ | Twilio SID — SMS/voice disabled if unset |
| `TWILIO_AUTH_TOKEN` | _(empty)_ | Twilio auth token |
| `TWILIO_PHONE_FROM` | _(empty)_ | Twilio sender number |
| `EMERGENCY_CONTACT_NUMBERS` | _(empty)_ | Comma-separated phone numbers for SMS/voice alerts |
| `EMERGENCY_TWIML_URL` | Twilio demo | TwiML URL for voice call message |
| `BROADCAST_WEBHOOK_URL` | _(empty)_ | Government alert platform URL — broadcast disabled if unset |
| `LOG_LEVEL` | `INFO` | Set to `DEBUG` to see sense-check metric details per district |
