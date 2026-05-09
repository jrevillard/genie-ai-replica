# Long-Term Early Warning System — Implementation Guide

## Overview

This document describes the long-term potato early warning pipeline added to the
`Warning_system_engine` container. It complements the existing short-term engine (which
evaluates today + tomorrow from Open-Meteo / BMD) with a **5-month seasonal outlook** driven
by **Copernicus SEAS5** climate forecasts compared against the enriched crop profile in
`example_crop_profile.json`.

The key design principle throughout is:

> **Copernicus drives the score. RAG explains the answer.**

The deterministic engine decides whether conditions are favorable, risky, or dangerous for
each potato growth stage. The RAG layer is only invoked afterwards to retrieve agronomic
explanation, management guidance, and disease control context.

---

## Short-Term vs Long-Term — Why Both?

| Dimension | Short-term EWS | Long-term EWS |
|---|---|---|
| Data source | Open-Meteo (BMD fallback) | Copernicus SEAS5 |
| Horizon | Today + tomorrow (48 h) | 1 – 5 months ahead |
| Granularity | Daily forecasts | Monthly means |
| Frequency | Daily at 05:00 UTC | Weekly on Monday 06:00 UTC |
| Purpose | Immediate field action, alert dispatch | Seasonal planning, input scheduling |
| Max tier | 4 (Emergency) | 3 (Severe) — seasonal uncertainty too high for 4 |
| Action type | "Protect fields now" | "Adjust crop plan for December" |

Short-term cannot tell a farmer whether to plant next month. Long-term cannot tell a farmer
whether to irrigate tomorrow. Both pipelines run inside the same container but are fully
independent — the short-term pipeline does not depend on Copernicus and vice versa.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Warning_system_engine container                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  APScheduler                                                  │  │
│  │                                                               │  │
│  │  ┌────────────────────────┐  ┌──────────────────────────┐   │  │
│  │  │  daily_pipeline        │  │  long_term_pipeline       │   │  │
│  │  │  every day 05:00 UTC   │  │  every Monday 06:00 UTC  │   │  │
│  │  └──────────┬─────────────┘  └─────────────┬────────────┘   │  │
│  └─────────────┼──────────────────────────────┼────────────────┘  │
│                │                              │                     │
│  ┌─────────────▼─────────────┐  ┌────────────▼────────────────┐   │
│  │  PotatoShortTermEWS       │  │  CopernicusFetcher          │   │
│  │  + RiskEngine             │  │  (downloads SEAS5 NetCDF)   │   │
│  │  reads: weather_forecasts │  └────────────┬────────────────┘   │
│  │  writes: risk_assessments │               │                     │
│  └─────────────┬─────────────┘  ┌────────────▼────────────────┐   │
│                │                │  LongTermPotatoEWS           │   │
│  ┌─────────────▼─────────────┐  │  reads: seasonal_forecasts  │   │
│  │  Notifier                 │  │         crop profile JSON   │   │
│  │  FCM / SMS / voice        │  │  writes: seasonal_assess.   │   │
│  └───────────────────────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                                      │
         ▼                                      ▼
  ArangoDB (shared)                      ArangoDB (shared)
  weather_forecasts                      seasonal_forecasts
  risk_assessments                       seasonal_assessments
  alerts_sent
```

---

## Data Flow — Long-Term Pipeline

```
Monday 06:00 UTC
       │
       ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: CopernicusFetcher.fetch_and_store()         │
│                                                     │
│  cdsapi.Client.retrieve(                            │
│    "seasonal-monthly-single-levels",                │
│    { system: "5",  leadtime_month: [1,2,3,4,5],    │
│      area: [26.5, 88.0, 20.5, 92.7],               │  ← Bangladesh bbox
│      format: "netcdf" }                             │
│  ) → temp.nc (downloaded to /tmp)                   │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Parse NetCDF with xarray                    │
│                                                     │
│  For each of 20 Bangladesh districts:               │
│    • Extract nearest grid point to district centroid│
│    • Ensemble mean across SEAS5 members             │
│    • Convert:                                       │
│        t2m  K → °C                                 │
│        tp   m/day → mm/month                       │
│        u10,v10  m/s → √(u²+v²)×3.6 km/h           │
│        d2m  K → RH% via Magnus formula             │
│  → dict { district: [monthly_record × 5] }         │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: StorageLayer.upsert_seasonal_forecast()     │
│                                                     │
│  ArangoDB collection: seasonal_forecasts            │
│  Key: dhaka__copernicus__long                       │
│  One document per district (20 total)               │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: LongTermPotatoEWS.evaluate_all()            │
│                                                     │
│  For each district × each forecast month:           │
│    a. Map month → ISO weeks → potato stage(s)       │
│       using CropProfileLoader                       │
│    b. Skip if month is outside potato season        │
│    c. Average weekly baseline for those weeks       │
│    d. Compare Copernicus values against:            │
│         • absolute crop_rules thresholds            │
│         • deviation from district weekly baseline   │
│         • RH estimate → late blight signal          │
│    e. Classify tier 0–3                             │
│    f. Build RAG query payload                       │
│  → ArangoDB collection: seasonal_assessments        │
│  Key: dhaka__potato__2026_10                        │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Seasonal alert dispatch (tier ≥ 2)          │
│                                                     │
│  Logs structured WARNING entries.                   │
│  (FCM push can be added when seasonal alert         │
│   channel is configured in Notifier)                │
└─────────────────────────────────────────────────────┘
```

---

## New Files

```
Warning_system_engine/
├── crop_profile_loader.py      ← reads example_crop_profile.json
├── copernicus_fetcher.py       ← downloads + parses SEAS5, stores forecasts
├── long_term_potato_ews.py     ← seasonal assessment engine
├── data/
│   ├── example_crop_profile.json   ← 300 enriched crop profiles (potato × 20 districts)
│   └── bamis_metadata.json         ← 6,596 BAMIS weekly records
```

Updated files:

```
Warning_system_engine/
├── storage.py      ← added seasonal_forecasts + seasonal_assessments collections/methods
├── scheduler.py    ← added run_long_term_pipeline() + weekly cron + create_scheduler() args
├── main.py         ← wires CopernicusFetcher + LongTermPotatoEWS into scheduler
├── requirements.txt ← added cdsapi, xarray, netCDF4, numpy, pandas
├── .env.example    ← added CDSAPI_URL, CDSAPI_KEY, COPERNICUS_MONTHS_AHEAD
```

---

## Component 1 — CropProfileLoader

`crop_profile_loader.py` is a stateless reader for `example_crop_profile.json`. It provides
all the typed lookups the assessment engine needs: thresholds, weekly baselines, stage maps,
and month-to-week resolution.

### Profile key format

```
potato_dhaka      ← f"{crop}_{region}".lower()
potato_rajshahi
potato_chittagong
…
```

### Stage calendar lookup

The weekly calendar entry for Dhaka looks like this:

```json
{
  "week": 48,
  "month": "November",
  "stage": "Tuber Set / Initiation",
  "temp_min_c": 16.1,
  "temp_max_c": 28.3,
  "temp_mean_c": 22.2,
  "rainfall_mm": 4.5,
  "rh_max_pct": 94.3,
  "rh_min_pct": 46.3
}
```

The potato season for Dhaka spans ISO weeks 42–52 and 1–4 (October through January). The
loader uses Python's `date.isocalendar()` to convert a calendar month into overlapping ISO
weeks, then looks up which of those weeks fall inside the season:

```python
def weeks_in_month(self, year: int, month: int) -> list[int]:
    """ISO week numbers that overlap with a given calendar month."""
    seen: set[int] = set()
    d = date(year, month, 1)
    while d.month == month:
        seen.add(d.isocalendar()[1])
        d += timedelta(days=1)
    return sorted(seen)

def stages_for_month(self, crop, region, year, month) -> list[str]:
    season_weeks = set(self.get_season_weeks(crop, region))
    stages = []
    for week in self.weeks_in_month(year, month):
        if week in season_weeks:
            stage = self.get_stage_for_week(crop, region, week)
            if stage and stage not in stages:
                stages.append(stage)
    return stages
```

### Month → stage mapping (Dhaka potato)

```
October   → weeks 40–44  → Sprouting, Seedling
November  → weeks 44–48  → Seedling, Vegetative Growth, Tuber Set / Initiation
December  → weeks 48–52  → Tuber Set / Initiation, Tuber Bulking / Development
January   → weeks 1–4    → Tuber Bulking / Development, Maturity, Harvesting
```

### Baseline aggregation

For a forecast month, the loader averages all weekly baseline entries that fall inside the
season window for that month:

```python
def baseline_for_month(self, crop, region, year, month) -> dict:
    season_weeks = set(self.get_season_weeks(crop, region))
    entries = []
    for week in self.weeks_in_month(year, month):
        if week in season_weeks:
            b = self.get_weekly_baseline(crop, region, week)
            if b:
                entries.append(b)

    if not entries:
        return {}

    keys = ("temp_min_c", "temp_max_c", "temp_mean_c",
            "rainfall_mm", "rh_max_pct", "rh_min_pct")
    result = {"week_count": len(entries), "weeks_in_season": [e["week"] for e in entries]}
    for k in keys:
        vals = [e[k] for e in entries if k in e]
        if vals:
            result[k] = round(sum(vals) / len(vals), 2)
    return result
```

Example output for Dhaka November (weeks 44–48):

```json
{
  "week_count": 4,
  "weeks_in_season": [44, 45, 46, 47],
  "temp_min_c": 18.4,
  "temp_max_c": 29.1,
  "temp_mean_c": 23.8,
  "rainfall_mm": 6.2,
  "rh_max_pct": 94.5,
  "rh_min_pct": 47.1
}
```

### Threshold accessors

The crop rules are read from `crop_rules` inside each profile entry:

```json
{
  "temperature_min": { "min": 10 },
  "temperature_max": { "max": 30 },
  "humidity":        { "min": 65, "max": 80 },
  "rainfall_daily":  [
    { "severity": "medium",   "min": 25  },
    { "severity": "critical", "min": 100 }
  ],
  "wind_speed_kmh":  { "max": 30 }
}
```

The loader exposes typed helpers:

```python
loader.temp_thresholds("potato", "dhaka")
# → {"temp_min": 10.0, "temp_max": 30.0}

loader.rainfall_thresholds("potato", "dhaka")
# → {"rain_medium": 25.0, "rain_critical": 100.0}

loader.wind_threshold("potato", "dhaka")
# → 30.0

loader.humidity_thresholds("potato", "dhaka")
# → {"rh_min": 65.0, "rh_max": 80.0}
```

---

## Component 2 — CopernicusFetcher

`copernicus_fetcher.py` manages the entire Copernicus lifecycle: authentication check,
CDS API request, NetCDF download, parsing, unit conversion, and ArangoDB storage.

### What is Copernicus SEAS5?

SEAS5 (Seasonal Forecast System 5) is ECMWF's operational seasonal prediction system.
It produces monthly-mean atmospheric fields up to 7 months ahead, updated once per month.
SEAS5 runs 25 ensemble members; we take the ensemble mean to get a single best-estimate
value per variable per month.

Key characteristics:

- **Dataset**: `seasonal-monthly-single-levels`
- **System**: `5` (SEAS5) or `51` (SEAS5.1 — available on newer accounts)
- **Update frequency**: Monthly (issued around the 12th of each month)
- **Spatial resolution**: ~1° × 1° (≈ 111 km at the equator)
- **Variables used**: 2m temperature, total precipitation, 10m wind (u/v), 2m dewpoint

### Bangladesh bounding box

```python
_BBOX = [26.5, 88.0, 20.5, 92.7]   # [North, West, South, East]
```

At 1° resolution, Bangladesh fits in roughly a 6 × 5 grid (30 cells). Each district
centroid is matched to its nearest grid cell using xarray's `sel(..., method="nearest")`.

```python
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka":      (23.8103, 90.4125),
    "Chittagong": (22.3569, 91.7832),
    "Sylhet":     (24.8949, 91.8687),
    # … 20 districts total
}
```

### CDS API request

```python
request = {
    "originating_centre": "ecmwf",
    "system":             "5",
    "variable": [
        "2m_temperature",
        "total_precipitation",
        "10m_u_component_of_wind",
        "10m_v_component_of_wind",
        "2m_dewpoint_temperature",
    ],
    "product_type":   "monthly_mean",
    "year":           "2026",
    "month":          "05",           # initialization month
    "leadtime_month": ["1","2","3","4","5"],  # May+1 → May+5
    "area":           [26.5, 88.0, 20.5, 92.7],
    "format":         "netcdf",
}

client.retrieve("seasonal-monthly-single-levels", request, "/tmp/seas5_output.nc")
```

`leadtime_month: ["1","2","3","4","5"]` with initialization month May 2026 produces valid
months June, July, August, September, October 2026. The time coordinate inside the NetCDF
file contains the actual valid months — not the lead times — so no offset arithmetic is
needed during parsing.

### NetCDF parsing and unit conversions

```python
ds = xr.open_dataset(path, engine="netcdf4")

# Locate variables — SEAS5 uses short CF names internally
temp_k   = ds.get("t2m")   # 2m temperature in Kelvin
precip_m = ds.get("tp")    # total precipitation in m/day
u_wind   = ds.get("u10")   # eastward wind component in m/s
v_wind   = ds.get("v10")   # northward wind component in m/s
dewp_k   = ds.get("d2m")   # 2m dewpoint in Kelvin

# Collapse ensemble members → single best-estimate
if "number" in ds.dims:
    temp_k   = temp_k.mean(dim="number")
    precip_m = precip_m.mean(dim="number")
    # … same for all variables

# For each district:
t_val = float(temp_k.isel(time=i).sel(
    latitude=lat, longitude=lon, method="nearest"
).values)

record["mean_temp_c"]    = round(t_val - 273.15, 2)          # K → °C
record["total_precip_mm"] = round(p_val * 1000 * days, 1)    # m/day → mm/month
record["mean_wind_kmh"]  = round(sqrt(u**2 + v**2) * 3.6, 1) # m/s → km/h
```

### Relative humidity estimation

SEAS5 does not provide relative humidity directly. It provides 2m dewpoint temperature
(`d2m`). The Magnus formula converts temperature + dewpoint → RH:

```
RH = 100 × exp(17.625 × Td / (243.04 + Td))
         ÷ exp(17.625 × T  / (243.04 + T))
```

Where T and Td are in degrees Celsius. This is tagged `copernicus_partial` because it is
derived rather than directly measured.

```python
rh = 100 * math.exp(17.625 * td_c / (243.04 + td_c)) / \
         math.exp(17.625 * t_c  / (243.04 + t_c))
record["estimated_rh_pct"] = round(min(max(rh, 0), 100), 1)
```

### Precipitation conversion detail

SEAS5 `total_precipitation` in `monthly_mean` product type is a **daily rate** averaged
over the month (m/day, not m/month). To convert to total rainfall for the month:

```
mm/month = (m/day) × 1000 × (days in month)
```

For October 2026 (31 days), a SEAS5 value of 0.002 m/day becomes:

```
0.002 × 1000 × 31 = 62 mm/month
```

This is the value stored in `total_precip_mm` in ArangoDB and used in all threshold
comparisons.

### ArangoDB document written per district

```json
{
  "_key": "dhaka__copernicus__long",
  "location": "Dhaka",
  "source": "copernicus_seas5",
  "horizon": "long",
  "fetched_at": "2026-05-12T06:03:17Z",
  "issue_month": "2026-05",
  "months_ahead": 5,
  "outlook": [
    {
      "valid_month": "2026-06",
      "mean_temp_c": 29.8,
      "total_precip_mm": 187.4,
      "mean_wind_kmh": 11.2,
      "estimated_rh_pct": 78.3
    },
    {
      "valid_month": "2026-07",
      "mean_temp_c": 30.1,
      "total_precip_mm": 312.6,
      "mean_wind_kmh": 13.7,
      "estimated_rh_pct": 83.1
    }
  ]
}
```

---

## Component 3 — LongTermPotatoEWS

`long_term_potato_ews.py` is the deterministic assessment engine. It reads the stored
Copernicus outlook and the crop profile, then produces one `seasonal_assessment` document
per district × forecast month that overlaps with the potato season.

### Why only potato season months?

The potato season for Dhaka runs October through January (15 weeks). If the forecast window
is June–October and the user is asking about Dhaka potato, only October is relevant. The
engine skips June, July, August, September automatically by calling `stages_for_month()`
which returns an empty list for out-of-season months.

This means at most 4 assessments per district per run (October, November, December,
January), and the engine is naturally zero-cost for off-season months.

### Assessment logic — step by step

```
For each district:
  Load seasonal_forecasts from ArangoDB → outlook[0..4]
  Load crop_rules from example_crop_profile.json
  Load derived_thresholds (seasonal baseline values)

  For each forecast month in outlook:
    1. stages_for_month(crop, region, year, month)
       → ["Sprouting", "Seedling"]   (October for Dhaka)
       → []  skip if outside season

    2. baseline_for_month(crop, region, year, month)
       → average weekly climate values for those weeks
       → {temp_mean_c: 27.9, rainfall_mm: 30.5, …}

    3. Compare Copernicus → thresholds:

       Temperature (copernicus_ready):
         if mean_temp > 30°C          → trigger: "exceeds potato limit"
         if mean_temp > 28°C          → trigger: "approaching heat limit"
         if mean_temp < 10°C          → trigger: "below cold limit"
         if mean_temp > baseline+4°C  → trigger: "+Δ above district baseline"
         if mean_temp > baseline+2°C  → trigger: "warmer than baseline"

       Precipitation (copernicus_ready):
         if total_precip > 3000 mm    → trigger: "critical rainfall"
         if total_precip > 750 mm     → trigger: "high rainfall"
         if ratio > 2.5×baseline      → trigger: "Nx above seasonal baseline"
         if ratio > 1.5×baseline      → trigger: "above seasonal baseline"
         if ratio < 0.3×baseline      → trigger: "drought risk"

       Wind (copernicus_ready):
         if mean_wind > 30 km/h       → trigger: "exceeds potato limit"

       Humidity (copernicus_partial):
         if estimated_rh > 90%        → trigger: "late blight risk elevated"
         if 14°C < temp < 22°C        → trigger: "late blight conducive"
           AND estimated_rh ≥ 85%

    4. classify_tier(triggers) → 0–3

    5. build_rag_payload(location, month, stages, triggers)
       → keywords list for second-pass retrieval

    6. upsert_seasonal_assessment() → ArangoDB
```

### Tier classification

```python
_TEMP_ADVISORY_DELTA = 2.0   # °C above baseline → Advisory
_TEMP_WARNING_DELTA  = 4.0   # °C above baseline → Warning
_PRECIP_HIGH_RATIO   = 1.5   # × baseline → Advisory
_PRECIP_CRIT_RATIO   = 2.5   # × baseline → Warning
_PRECIP_DRY_RATIO    = 0.3   # × baseline → Advisory (drought)
```

```
Triggers
  │
  ├─ severe triggers:
  │   "exceeds potato limit" (temp)
  │   "critical rainfall"
  │   "drought risk"
  │   rainfall ≥ 2.5× baseline
  │
  └─ advisory triggers:
      "approaching", "warmer than baseline"
      "high rainfall", "late blight"
      rainfall 1.5–2.5× baseline
      deviation +2–4°C

Tier 0  No triggers at all
Tier 1  1+ advisory triggers, 0 severe
Tier 2  1 severe trigger
Tier 3  2+ severe triggers
```

The cap at Tier 3 is intentional. Seasonal forecasts carry inherent ensemble uncertainty
(SEAS5 has a skill score that degrades with lead time). Declaring a Tier 4 Emergency five
months ahead would be misleading and would erode farmer trust in the system.

### Rule support classification

Every rule is tagged with its current evaluability:

| Tag | Meaning | Examples |
|---|---|---|
| `copernicus_ready` | Fully evaluable from SEAS5 | temperature, precipitation, wind |
| `copernicus_partial` | Derived or incomplete variable | humidity (from dewpoint), late blight (missing cloudiness) |
| `rag_only` | Valuable for explanation but not scoreable | fog-driven pests, nuanced cloudiness warnings |
| `not_evaluable_yet` | Missing required variable entirely | soil temperature rules, wet-spell duration |

```python
rule_support = {
    "temperature":          "copernicus_ready",
    "precipitation":        "copernicus_ready",
    "wind":                 "copernicus_ready",
    "humidity":             "copernicus_partial",
    "late_blight":          "copernicus_partial",
    "fog_driven_diseases":  "rag_only",
    "soil_temperature_rules": "not_evaluable_yet",
}
```

This tagging means the assessment is honest about what it knows. The `rag_query_payload`
is built from the tags — only `copernicus_ready` triggers feed into the score; `rag_only`
triggers become keywords for the RAG retrieval step.

### Example seasonal assessment document

```json
{
  "_key": "dhaka__potato__2026_10",
  "location": "Dhaka",
  "crop": "potato",
  "target_month": "2026-10",
  "assessed_at": "2026-05-12T06:04:33Z",
  "stages": ["Sprouting", "Seedling"],
  "tier": 2,
  "tier_label": "Warning",
  "copernicus_values": {
    "valid_month": "2026-10",
    "mean_temp_c": 31.4,
    "total_precip_mm": 58.7,
    "mean_wind_kmh": 10.3,
    "estimated_rh_pct": 88.1
  },
  "baseline_values": {
    "week_count": 3,
    "weeks_in_season": [42, 43, 44],
    "temp_mean_c": 27.9,
    "rainfall_mm": 30.5,
    "rh_max_pct": 94.6,
    "rh_min_pct": 54.3
  },
  "triggers": [
    "Monthly mean temp 31.4°C exceeds potato limit 30°C",
    "Temperature +3.5°C above district potato baseline (31.4°C vs normal 27.9°C)",
    "Late blight conducive conditions: cool temperature + high humidity"
  ],
  "supported_rules":   ["temperature", "precipitation", "wind", "humidity"],
  "unsupported_rules": ["fog_driven_diseases", "soil_temperature_rules"],
  "rule_support": {
    "temperature":           "copernicus_ready",
    "precipitation":         "copernicus_ready",
    "wind":                  "copernicus_ready",
    "humidity":              "copernicus_partial",
    "late_blight":           "copernicus_partial",
    "fog_driven_diseases":   "rag_only",
    "soil_temperature_rules": "not_evaluable_yet"
  },
  "deterministic_reasoning": "Seasonal Warning for Dhaka in 2026-10 (potato stage: Sprouting / Seedling). Key signals: Monthly mean temp 31.4°C exceeds potato limit 30°C; Temperature +3.5°C above district potato baseline. Review crop management plan and monitor field conditions.",
  "rag_query_payload": {
    "crop":      "potato",
    "location":  "Dhaka",
    "month":     "2026-10",
    "stages":    ["Sprouting", "Seedling"],
    "triggers":  ["Monthly mean temp 31.4°C exceeds potato limit 30°C", "…"],
    "keywords":  ["potato", "dhaka", "sprouting", "seedling", "heat stress", "high temperature", "late blight", "fungicide", "disease management"],
    "query_hint": "potato Sprouting Seedling stage management Dhaka 2026-10"
  }
}
```

---

## Component 4 — Scheduler

`scheduler.py` manages both pipelines from a single APScheduler instance.

### Job schedule

```
Container start
       │
       ├── +10 s  → startup_pipeline     (short-term catch-up)
       │
       ├── +60 s  → startup_long_term    (long-term catch-up)
       │
       ├── daily 05:00 UTC → daily_pipeline
       │     RiskEngine + PotatoShortTermEWS for all districts
       │
       └── every Monday 06:00 UTC → long_term_pipeline
             CopernicusFetcher → LongTermPotatoEWS → seasonal alerts
```

The 60-second delay for the long-term catch-up gives the short-term pipeline time to
complete first so the shared ArangoDB connection pool is not saturated on startup.

### Scheduler wiring

```python
def create_scheduler(
    storage,
    ingestor,        # None in standalone mode
    risk_engine,
    notifier,
    potato_ews   = None,
    copernicus   = None,   # CopernicusFetcher — None if CDS not configured
    long_term_ews = None,  # LongTermPotatoEWS  — None if CDS not configured
) -> AsyncIOScheduler:

    scheduler = AsyncIOScheduler()

    # Short-term: runs every day
    scheduler.add_job(
        run_daily_pipeline,
        trigger=CronTrigger(hour=5, minute=0, timezone="UTC"),
        args=[storage, ingestor, risk_engine, notifier, potato_ews],
        id="daily_pipeline",
        misfire_grace_time=86400,   # run even if missed by up to 24 h
        max_instances=1,
    )

    # Long-term: only registered when CDS is configured
    if copernicus is not None and long_term_ews is not None:
        scheduler.add_job(
            run_long_term_pipeline,
            trigger=CronTrigger(day_of_week="mon", hour=6, minute=0, timezone="UTC"),
            args=[storage, copernicus, long_term_ews, notifier],
            id="long_term_pipeline",
            misfire_grace_time=86400,
            max_instances=1,
        )
```

`max_instances=1` prevents overlap if a CDS request takes longer than expected (CDS queue
times can reach 30+ minutes during peak load).

### Graceful degradation

The long-term pipeline is entirely optional. In `main.py`:

```python
try:
    from copernicus_fetcher import CopernicusFetcher
    from long_term_potato_ews import LongTermPotatoEWS

    copernicus    = CopernicusFetcher()
    long_term_ews = LongTermPotatoEWS(storage, profile_loader)
    logger.info("[MAIN] Long-term EWS ready — Copernicus pipeline enabled")
except ImportError as exc:
    logger.warning("[MAIN] Long-term deps missing (%s) — install cdsapi xarray netCDF4", exc)
    # copernicus and long_term_ews remain None
```

If `CDSAPI_KEY` is not set, `CopernicusFetcher.fetch_and_store()` returns immediately with
`{"error": "cds_not_configured"}` and the scheduler skips the rest of the pipeline. The
short-term engine is never affected.

---

## ArangoDB Collections

### New collections

Two new collections are auto-created by `StorageLayer._ensure_collections()` on first run:

```python
_COLLECTIONS = (
    "weather_forecasts",     # existing — short-term daily forecasts
    "risk_assessments",      # existing — short-term + potato EWS results
    "alerts_sent",           # existing — deduplication log
    "seasonal_forecasts",    # NEW — Copernicus SEAS5 monthly outlook per district
    "seasonal_assessments",  # NEW — long-term potato risk per district per month
)
```

### Document key patterns

```
seasonal_forecasts
  Key: {location}__copernicus__long
  e.g. dhaka__copernicus__long
       chittagong__copernicus__long
  → One document per district. Replaced on each weekly fetch.

seasonal_assessments
  Key: {location}__{crop}__{YYYY_MM}
  e.g. dhaka__potato__2026_10
       rajshahi__potato__2026_11
  → One document per district × crop × month.
    Replaced on each weekly run (same month key = upsert).
```

### Storage methods added

```python
# Write Copernicus forecast for one district
storage.upsert_seasonal_forecast(doc: dict) → str

# Read Copernicus forecast for one district
storage.get_seasonal_forecast(location: str) → dict | None

# Write long-term assessment for one district × month
storage.upsert_seasonal_assessment(assessment: dict) → str

# Read one assessment
storage.get_seasonal_assessment(location, crop, target_month) → dict | None

# Query all active seasonal warnings for a district
storage.get_active_seasonal_assessments(location, crop, min_tier=1) → list[dict]
```

The last method is useful for the API layer (e.g., a `/potato/seasonal/risk` endpoint in
weather-mcp-service) to retrieve all upcoming warning months for a district in one query.

---

## Configuration Reference

All settings are environment variables. Copy `.env.example` to `.env` and fill in your
values.

| Variable | Default | Description |
|---|---|---|
| `CDSAPI_URL` | `https://cds.climate.copernicus.eu/api` | Copernicus CDS API endpoint |
| `CDSAPI_KEY` | _(empty)_ | Your CDS API key. Leave blank to disable long-term. |
| `COPERNICUS_MONTHS_AHEAD` | `5` | How many months to fetch (max 6). |
| `ARANGO_URL` | `http://arango-vector-db:8529` | ArangoDB host |
| `ARANGO_DB_NAME` | `genie-ai` | ArangoDB database name |
| `ARANGO_USER` | `root` | ArangoDB username |
| `ARANGO_PASSWORD` | `test` | ArangoDB password |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `FCM_SERVER_KEY` | _(empty)_ | Firebase Cloud Messaging key (optional) |
| `TWILIO_ACCOUNT_SID` | _(empty)_ | Twilio SID for SMS (optional) |

### Getting a Copernicus CDS API key

1. Register at [https://cds.climate.copernicus.eu](https://cds.climate.copernicus.eu)
2. Go to your profile → API key
3. Copy the key in the format `<uid>:<api-key>` (old format) or just `<api-key>` (new format)
4. Set `CDSAPI_KEY=<your-key>` in `.env`

Alternatively, create `~/.cdsapirc`:

```ini
url: https://cds.climate.copernicus.eu/api
key: <your-api-key>
```

---

## Installation

### Python dependencies

```bash
pip install cdsapi>=0.7.0 xarray>=2024.1.0 netCDF4>=1.6.5 numpy>=1.26.0 pandas>=2.0.0
```

The full `requirements.txt` inside `Warning_system_engine/`:

```
pydantic>=2.11.0
python-arango==7.9.1
APScheduler==3.10.4
requests==2.31.0
python-dotenv==1.0.1
cdsapi>=0.7.0
xarray>=2024.1.0
netCDF4>=1.6.5
numpy>=1.26.0
pandas>=2.0.0
```

### Docker build

The `Dockerfile` installs all requirements and copies both Python sources and data:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./
COPY data/ ./data/

ENV PYTHONUNBUFFERED=1 LOG_LEVEL=INFO

CMD ["python", "-m", "main"]
```

```bash
cd Warning_system_engine/
docker build -t warning-system-engine .
docker run --env-file .env warning-system-engine
```

---

## How Deterministic Score + RAG Work Together

The `rag_query_payload` stored in every `seasonal_assessment` is the bridge between the
deterministic engine and the RAG explanation layer.

```
Seasonal assessment produced by LongTermPotatoEWS
         │
         │  rag_query_payload:
         │    crop: "potato"
         │    location: "Dhaka"
         │    month: "2026-10"
         │    stages: ["Sprouting", "Seedling"]
         │    triggers: ["temp 31.4°C exceeds 30°C", …]
         │    keywords: ["potato", "dhaka", "sprouting",
         │               "heat stress", "late blight", …]
         │    query_hint: "potato Sprouting Seedling stage management Dhaka 2026-10"
         │
         ▼
   RAG retrieval (genie-ai-retriever)
         │
         │  vector search using query_hint
         │  BM25 rerank using keywords
         │
         ▼
   Retrieved chunks from vector store:
     • "Potato sprouting stage requires 15–20°C soil temperature…"
     • "Heat stress during early growth can reduce stand establishment…"
     • "Late blight management: apply preventive fungicide when…"
         │
         ▼
   LLM explanation layer
         │  Receives: deterministic reasoning + RAG chunks
         │  Produces: farmer-facing advisory in Bangla / English
         ▼
   "In Dhaka, October 2026 is expected to be warmer than normal
    (31.4°C mean, above the 30°C potato limit) during the critical
    Sprouting and Seedling stages. We recommend…"
```

The deterministic layer decides the severity. The RAG layer decides what to say about it.
Neither substitutes for the other.

---

## Comparison: Before and After

### Before (no long-term EWS)

- System only knew about today + tomorrow's weather
- Seasonal planning required the farmer to consult extension workers
- No automated signal when the next potato season was expected to be anomalously warm or
  wet at the district level
- RAG was the sole source of seasonal guidance (hallucination-prone for specific dates)

### After (long-term EWS implemented)

- System produces a 5-month stage-aware climate outlook updated every Monday
- Tier classifications (0–3) give a structured severity signal per district per month
- District-specific baseline comparison (not just global potato thresholds) makes warnings
  locally meaningful — a October mean of 28°C is normal in Dhaka but anomalous in Dinajpur
- RAG is narrowed to targeted retrieval using structured keywords from the assessment, not
  open-ended free-text queries
- `rule_support` field makes the system's confidence explicit — the farmer advisory can say
  "we know the temperature will be too high; we cannot yet assess fog-related pest risk"
- All assessments stored in ArangoDB are queryable — the API layer can serve
  `/potato/seasonal/risk?location=Dhaka` returning all upcoming warning months at once

---

## Limitations and Next Steps

### Current limitations

| Limitation | Impact | Path forward |
|---|---|---|
| SEAS5 resolution is ~1° (≈111 km) | District centroid may not represent local micro-climate | Downscale with CMIP6 or use sub-district station data |
| Humidity is estimated, not measured | Late blight signal is `copernicus_partial` | Use ERA5 reanalysis as bias correction baseline |
| No soil temperature | Soil-temp rules are `not_evaluable_yet` | Add Copernicus `soil_temperature_level_1` variable |
| Only potato implemented | 32 crops in BAMIS dataset | Extend `LongTermPotatoEWS` pattern to rice, wheat, jute |
| Seasonal alerts are log-only | Farmers don't receive seasonal push notifications | Wire `Notifier._push()` for tier ≥ 2 seasonal events |
| No inter-annual trend | Single-season snapshot | Compare with previous season's assessment to detect multi-year trends |

### Suggested next deliverables

1. Add a `/potato/seasonal/risk` API endpoint in `weather-mcp-service` that reads from
   `seasonal_assessments` and returns the full 5-month outlook for a district
2. Extend `LongTermPotatoEWS` pattern to cover rice (Boro, Aus, Aman seasons)
3. Add Copernicus `soil_temperature_level_1` to the CDS request to unlock soil-temp rules
4. Build a Grafana dashboard reading from `seasonal_assessments` for district-level
   seasonal risk visualization
5. Connect `rag_query_payload` directly to the retriever in the query pipeline so that
   seasonal advisories automatically pull relevant BAMIS knowledge chunks
