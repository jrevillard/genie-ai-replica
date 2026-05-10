# Drought Monitoring — Architecture & Implementation Guide

## Overview

`drought_monitoring` is a stateless FastAPI microservice that fetches NASA satellite data via Google Earth Engine (GEE), classifies drought conditions across 20 Bangladesh districts, generates PDF reports, and writes assessments to ArangoDB. It does **not** schedule itself or send notifications — those responsibilities belong to `warning_system_engine`.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          MEWA v2 Stack                              │
│                                                                     │
│  ┌─────────────────────────┐                                        │
│  │  warning_system_engine  │  ← daily cron 07:00 UTC               │
│  │  (scheduler.py)         │                                        │
│  │                         │──POST /run/all──────────────────────┐  │
│  │  DroughtEWS             │                                     ▼  │
│  │  dispatch_alerts()      │  ┌─────────────────────────────────┐   │
│  └────────────┬────────────┘  │   drought_monitoring            │   │
│               │               │   (FastAPI :8001)               │   │
│               │               │                                 │   │
│               │  reads        │  1. GEE → SMAP + NDVI (30 min) │   │
│               ▼               │  2. classify_drought()          │   │
│  ┌────────────────────────┐   │  3. generate_pdf_report()       │   │
│  │       ArangoDB         │◄──│  4. upsert drought_assessments  │   │
│  │  drought_assessments   │   └─────────────────────────────────┘   │
│  └────────────┬───────────┘         │ writes PDF                    │
│               │                     ▼                               │
│               │           ┌──────────────────┐                      │
│               │           │  drought_reports  │  (named volume)     │
│               │           │  (Docker volume)  │                     │
│               │           └────────┬─────────┘                      │
│               │                    │ mounted :ro                     │
│               ▼                    ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │              weather_mcp_standalone (:8000)                │     │
│  │                                                            │     │
│  │  GET /drought/risk/latest   → reads ArangoDB              │     │
│  │  GET /drought/report/{file} → serves PDF from volume      │     │
│  │  POST /query                → chatbot drought routing      │     │
│  └────────────────────────────┬───────────────────────────────┘     │
│                               │                                      │
│                               ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │              gov_chat_backend (:3000)                      │     │
│  │                                                            │     │
│  │  GET /api/weather/drought-risk     → proxies to mcp       │     │
│  │  GET /api/weather/drought-report   → streams PDF          │     │
│  └────────────────────────────┬───────────────────────────────┘     │
│                               │                                      │
│               ┌───────────────┴──────────────────┐                  │
│               ▼                                  ▼                  │
│  ┌─────────────────────────┐   ┌─────────────────────────────┐      │
│  │  CropAlertBanner.vue    │   │  Chatbot (/query)           │      │
│  │  (polls every 60s)      │   │  "drought risk next month?" │      │
│  │  shows tier ≥ 2 alerts  │   │  returns markdown + PDF link│      │
│  └─────────────────────────┘   └─────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Container Details

### `drought_monitoring` (port 8001, internal only)

```
components/drought_monitoring/
├── dockerfile
├── pyproject.toml
└── src/
    ├── api.py                     ← FastAPI entrypoint
    ├── runner.py                  ← district loop + GEE orchestration
    ├── storage.py                 ← ArangoDB writes
    ├── drought_classify/
    │   └── classify_drought.py   ← band flagging + severity scoring
    ├── drought_report/
    │   ├── generate_report.py    ← PDF generation (ReportLab)
    │   └── drought_charts.py     ← matplotlib charts for PDF
    ├── fetch_dataset/
    │   └── fetch_data.py         ← GEE SMAP + NDVI fetch
    └── utils/
        ├── utils.py              ← thresholds, BandResult dataclass
        └── helper_functions.py   ← GEE geometry, feature extraction
```

**Key design principle:** the container is **stateless and passive**. It never calls external services or schedules itself. It waits for `warning_system_engine` to POST `/run/all`, runs the assessment, writes to ArangoDB, and returns.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{status, gee_configured, reports_dir}` |
| `POST` | `/run/all` | Runs all 20 districts (blocking, ~30 min with GEE) |
| `POST` | `/run/district` | Runs one district on-demand `{location, lat, lon, days}` |

`/run/district` is used by `weather_mcp_standalone` when a user asks the chatbot for a drought forecast with a specific time window.

---

## Classification Logic

### Data Sources (GEE)

| Band | GEE Collection | What it measures |
|------|----------------|-----------------|
| `sm_surface` | `NASA/SMAP/SPL4SMGP/008` | Surface soil moisture (m³/m³) |
| `land_evapotranspiration_flux` | `NASA/SMAP/SPL4SMGP/008` | Water lost through plants (mm/day) |
| `overland_runoff_flux` | `NASA/SMAP/SPL4SMGP/008` | Surface water runoff (mm/day) |
| `NDVI` | `NOAA/CDR/VIIRS/NDVI/V1` | Vegetation greenness index |

### Thresholds (from `utils/utils.py`)

| Band | Good mean | Alert threshold | Drought mean |
|------|-----------|-----------------|--------------|
| Soil moisture | 0.306 m³/m³ | **0.259 m³/m³** | 0.096 m³/m³ |
| Evapotranspiration | 3.93 mm/day | **3.15 mm/day** | 1.68 mm/day |
| Surface runoff | 1.67 mm/day | **0.87 mm/day** | 0.06 mm/day |
| NDVI | 0.433 | **0.401** | 0.369 |

A band is **flagged** when its 7-day average falls below the alert threshold. `pct_of_threshold` shows how far below (e.g. 68% means the value is at 68% of the safe floor).

### Severity Scoring

```
score = count of flagged bands (0 – 4)

score = 0  →  NORMAL   (tier 0)  — no alert, no banner
score = 1  →  NORMAL   (tier 0)  — one stressed band, not classified as watch
score = 2  →  WATCH    (tier 1)  — Advisory, no banner
score = 3  →  MODERATE (tier 2)  — Warning banner + push notification
score = 4  →  SEVERE   (tier 3)  — Severe banner + push notification
```

> Note: `classify_drought()` maps score ≥ 2 → WATCH, ≥ 3 → MODERATE, ≥ 4 → SEVERE.  
> The tier mapping then maps WATCH → tier 1, MODERATE → tier 2, SEVERE → tier 3.

### Assessment Flow (single district)

```
fetch_recent_data(bbox, days=7)
        │
        ├── GEE SMAP: daily means → 7-day average for sm_surface, ET, runoff
        └── GEE NDVI: daily means → 7-day average

classify_band(band, value)  ×4
        │
        └── flag = (value < alert_thresh) → score += 1

classify_drought(score) → drought_level (NORMAL/WATCH/MODERATE/SEVERE)

analyse_trend(daily_df)
        │
        └── WORSENING / STABLE / IMPROVING + consecutive run days

generate_pdf_report() → /app/reports/drought_{district}_{YYYYMMDD}.pdf

storage.upsert_drought_assessment()
        │
        └── drought_assessments/{location}__drought  (ArangoDB upsert)
```

---

## GEE Credentials Setup

This is the **only external dependency** that requires manual setup. Without credentials the service starts and serves `/health` but all `/run/*` calls return `{"error": "gee_not_configured"}`.

### Step 1 — Authenticate on the host

```bash
# Install the CLI (if not already installed)
pip install earthengine-api

# Authenticate — opens a browser, paste the token back
earthengine authenticate

# Verify it worked
ls ~/.config/earthengine/
# credentials  (this file must exist)
```

### Step 2 — Credentials are auto-mounted

The credentials directory is volume-mounted read-only into the container:

```yaml
# docker-compose.yaml (root)
drought-monitoring:
  volumes:
    - ${HOME}/.config/earthengine:/root/.config/earthengine:ro
```

No env var, no copy — just mount. The container checks `~/.config/earthengine/credentials` on every `/run/all` call via `gee_configured()`:

```python
# runner.py
def gee_configured() -> bool:
    creds = Path.home() / ".config" / "earthengine" / "credentials"
    return creds.exists() or bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))
```

### Step 3 — Set GEE project

The project ID is already set as a default:

```yaml
environment:
  - GEE_PROJECT=${GEE_PROJECT:-mewa-493916}
```

Override in `.env` at repo root if you use a different project:

```env
GEE_PROJECT=your-gee-project-id
```

### Alternative: Service Account (non-interactive, CI/CD)

```bash
# Create a service account key in GCP console, then:
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

Mount it into the container and set the env var in docker-compose instead of the earthengine credentials dir.

---

## Testing Without GEE

The test script injects synthetic assessments directly into ArangoDB, bypassing GEE entirely. This allows you to test the full pipeline — banner, chatbot response, PDF link — without credentials.

```bash
# From repo root — moderate drought in Dhaka (triggers banner)
python3 components/weather-mcp-service/scripts/test_drought_alert_flow.py --scenario moderate

# Severe drought in Rajshahi
python3 components/weather-mcp-service/scripts/test_drought_alert_flow.py --scenario severe --district Rajshahi

# Clear the alert (tier 0)
python3 components/weather-mcp-service/scripts/test_drought_alert_flow.py --scenario normal --district Rajshahi
```

Scenarios:

| Scenario | Tier | Banner | Notification |
|----------|------|--------|--------------|
| `normal` | 0 | No | No |
| `watch` | 1 | No | No |
| `moderate` | 2 | Yes (orange) | Yes |
| `severe` | 3 | Yes (red) | Yes |

---

## Scheduling — `warning_system_engine`

`drought_monitoring` has no internal scheduler. All scheduling is owned by `warning_system_engine/scheduler.py`.

```
Daily schedule (UTC):
  05:00  →  Short-term weather pipeline (BMD 7-day forecast)
  06:00  →  Long-term potato EWS (Copernicus 30-day)
  07:00  →  Drought pipeline  ← drought_monitoring triggered here
  +120s  →  Startup catch-up run (on container start)
```

### Drought Pipeline Steps (`scheduler.py → run_drought_pipeline`)

```
1. POST http://drought-monitoring:8001/run/all
   │    timeout: 1800 s (30 min for 20 districts via GEE)
   │
   ├── if "gee_not_configured" → log warning, skip alerts, done
   │
   └── success → fetch_result: {stored: N, skipped: M, errors: K}

2. DroughtEWS.dispatch_alerts(notifier)
   │
   ├── read drought_assessments where tier >= 2 (ArangoDB)
   │
   ├── for each assessment:
   │     was_drought_alert_sent(location, tier, within_hours=12)?
   │     ├── yes → suppress (dedup)
   │     └── no  → notifier.dispatch_drought_alert(assessment)
   │                └── POST /api/notifications/broadcast (backend)
   │                    └── FCM → user devices
   │
   └── returns {dispatched, suppressed, total}
```

### Deduplication

Alerts are deduplicated using the `alerts_sent` ArangoDB collection with `alert_type: "drought"`. An alert for the same district at the same tier within 12 hours is suppressed.

---

## PDF Reports

### Generation

`drought_report/generate_report.py` (ReportLab + matplotlib) generates a multi-page PDF per district including:
- Summary table: tier, trend, district, date range
- Band-by-band bar charts showing value vs threshold
- Daily time-series chart (score over the window)
- Trigger summary

### Storage

PDFs are written to a shared Docker named volume:

```yaml
volumes:
  drought_reports: {}      # declared in docker-compose

drought-monitoring:
  volumes:
    - drought_reports:/app/reports        # read-write

weather-mcp-standalone:
  volumes:
    - drought_reports:/app/drought_reports:ro   # read-only
```

### Filename Pattern

```
drought_{district_slug}_{YYYYMMDD}.pdf

Examples:
  drought_dhaka_20260510.pdf
  drought_cox_s_bazar_20260510.pdf
```

The filename is stored in `drought_assessments.report_filename` in ArangoDB.

### Serving

`weather_mcp_standalone` serves PDFs via:

```
GET /drought/report/{filename}
    └── FileResponse from /app/drought_reports/{filename}
        validated: must end in .pdf, must exist on volume
```

`gov_chat_backend` proxies it:

```
GET /api/weather/drought-report/:filename
    └── axios stream → weather-mcp-standalone → client
```

---

## Frontend Integration

### CropAlertBanner — Automatic Alert Banner

`gov-chat-frontend/src/components/CropAlertBanner.vue` polls both potato and drought risk endpoints every 60 seconds.

```
Browser poll (every 60s):
  Promise.allSettled([
    GET /api/weather/potato-risk?location=Dhaka,
    GET /api/weather/drought-risk?location=Dhaka
  ])
  │
  ├── filter: tier >= 2 AND not dismissed recently
  │
  ├── sort: highest tier first; drought preferred on tie
  │
  └── show banner for winner
```

**Banner appearance by tier and type:**

| Type | Tier | Background | Border | Icon |
|------|------|------------|--------|------|
| Drought | 2 (Warning) | `#fff8e1` | `#ef6c00` orange | ☀️ |
| Drought | 3 (Severe) | `#fbe9e7` | `#b71c1c` red | ⚠️ |
| Potato | 2 | `#fff3cd` | `#f0a500` | ⚠️ |
| Potato | 3 | `#fde8e8` | `#dc3545` | ⚠️ |

**Dismiss behaviour:** clicking X stores `drought_alert_dismissed_until` in `localStorage` (12-hour suppression). Potato and drought dismissals are tracked independently.

**PDF link:** when `alert.report_filename` is set, a "View Drought Report" link appears in the banner:

```html
<a :href="`/api/weather/drought-report/${alert.report_filename}`" target="_blank">
  View Drought Report
</a>
```

### Chatbot Drought Queries

`weather_mcp_standalone/main.py` intercepts drought-related chatbot queries before they reach the weather agent:

```
POST /query  { "query": "is there drought risk next month in Rajshahi?" }
      │
      ├── _DROUGHT_KEYWORDS regex match ("drought", "soil moisture", etc.)
      │
      ├── _find_drought_district() → Rajshahi (24.37°N, 88.60°E)
      │
      ├── _parse_horizon_days()   → 30 (seasonal = next month)
      │
      ├── Path 1: on-demand GEE (if DROUGHT_MONITORING_URL set)
      │     POST drought-monitoring:8001/run/district {days: 30}
      │     ├── success → format markdown + PDF link → return
      │     └── gee_not_configured → try Path 2
      │
      ├── Path 2: stored ArangoDB assessment (instant)
      │     storage_layer.get_drought_assessment("Rajshahi")
      │     ├── found → format markdown + PDF link → return
      │     └── not found → Path 3
      │
      └── Path 3: clear message explaining GEE setup requirement
```

**Horizon parsing from natural language:**

| User says | `horizon_days` | Label in response |
|-----------|---------------|-------------------|
| "next week" / "7 days" | 7 | next week |
| "next two weeks" / "14 days" | 14 | next 2 weeks |
| "next three weeks" | 21 | next 3 weeks |
| "next month" / "30 days" / (default) | 30 | next month |

**Example chatbot response:**

```markdown
## Drought Outlook — Rajshahi (next month)

**Status:** 🟠 **MODERATE** (Warning)
**Trend:** 📈 WORSENING for 3 consecutive days

Moderate drought — 3 of 4 sensors stressed. Crops may be affected soon.

**Stressed indicators:**
- Soil moisture at 68% of safe level
- Evapotranspiration at 61% of safe level
- Crop greenness (NDVI) at 82% of safe level

⚠️ **Warning level** — consider water conservation and crop protection.

📄 [View Full Drought Report](/api/weather/drought-report/drought_rajshahi_20260510.pdf)

*Based on 7-day satellite assessment. Updated daily.*
```

The drought forecast is also exposed as an MCP tool (`assess_drought_forecast`) so the gov-chat-backend LLM can call it directly as a structured tool call.

---

## Environment Variables

### `drought_monitoring` container

| Variable | Default | Description |
|----------|---------|-------------|
| `GEE_PROJECT` | `mewa-493916` | GEE cloud project ID |
| `DROUGHT_REPORTS_DIR` | `/app/reports` | Where PDFs are written |
| `ARANGO_URL` | `http://arango-vector-db:8529` | ArangoDB host |
| `ARANGO_DB_NAME` | `genie-ai` | Database name |
| `ARANGO_USER` | `root` | ArangoDB user |
| `ARANGO_PASSWORD` | *(required)* | Set in root `.env` |
| `LOG_LEVEL` | `INFO` | Python logging level |

### `warning_system_engine` container

| Variable | Description |
|----------|-------------|
| `DROUGHT_MONITORING_URL` | Must be `http://drought-monitoring:8001` |

### `weather_mcp_standalone` container

| Variable | Description |
|----------|-------------|
| `DROUGHT_MONITORING_URL` | `http://drought-monitoring:8001` — enables on-demand chatbot assessments |
| `DROUGHT_REPORTS_DIR` | `/app/drought_reports` — volume mount point for PDF serving |

---

## ArangoDB Schema

### Collection: `drought_assessments`

Document key: `{location_slug}__drought` (e.g. `rajshahi__drought`)

```json
{
  "_key":            "rajshahi__drought",
  "location":        "Rajshahi",
  "lat":             24.3745,
  "lon":             88.6042,
  "assessed_at":     "2026-05-10T07:15:00+00:00",
  "window_days":     7,
  "drought_level":   "MODERATE",
  "drought_score":   3,
  "tier":            2,
  "tier_label":      "Warning",
  "trend":           "WORSENING",
  "trend_run_days":  3,
  "trend_warning":   true,
  "triggers": [
    "Soil moisture at 68% of safe level",
    "Evapotranspiration at 61% of safe level",
    "Crop greenness (NDVI) at 82% of safe level"
  ],
  "message":         "Moderate drought — 3 of 4 sensors stressed. Crops may be affected soon.",
  "report_filename": "drought_rajshahi_20260510.pdf",
  "band_results": {
    "sm_surface":                   {"value": 0.177, "flag": 1, "status": "BELOW THRESHOLD", "pct_of_threshold": 68.4},
    "land_evapotranspiration_flux": {"value": 1.929, "flag": 1, "status": "BELOW THRESHOLD", "pct_of_threshold": 61.2},
    "overland_runoff_flux":         {"value": 1.043, "flag": 0, "status": "✓ NORMAL",        "pct_of_threshold": 120.4},
    "NDVI":                         {"value": 0.329, "flag": 1, "status": "BELOW THRESHOLD", "pct_of_threshold": 82.0}
  }
}
```

One document per district — upserted (replaced) on each assessment run. There is no history; only the latest assessment is kept.

### Collection: `alerts_sent` (drought entries)

```json
{
  "location":    "Rajshahi",
  "tier":        2,
  "channel":     "push",
  "alert_type":  "drought",
  "sent_at":     "2026-05-10T07:18:42+00:00"
}
```

Used by `DroughtEWS.dispatch_alerts()` to suppress duplicate notifications within 12 hours.

---

## Supported Districts

20 Bangladesh districts with pre-configured centroids (used for GEE bbox construction ±0.3°):

```
Dhaka, Chittagong, Sylhet, Rajshahi, Khulna, Barisal, Rangpur,
Mymensingh, Comilla, Jessore, Bogra, Dinajpur, Pabna, Tangail,
Faridpur, Noakhali, Brahmanbaria, Cox's Bazar, Chandpur, Narsingdi
```

Nominatim is not used — bbox is built directly from centroid coordinates to avoid rate limits during batch runs.

---

## Startup & Operational Notes

### Container startup order

```
arango-vector-db  →  drought-monitoring  →  warning-system-engine
                  →  weather-mcp-standalone
```

`warning-system-engine` waits for both `arango-vector-db` and `drought-monitoring` to be ready.

### First run after GEE authentication

On first start after `earthengine authenticate`, the startup catch-up job fires at +120 seconds:

```
warning_system_engine starts
  +120s → run_drought_pipeline()
      → POST drought-monitoring:8001/run/all
      → GEE fetches all 20 districts (~30 min)
      → assessments stored in ArangoDB
      → tier ≥ 2 alerts dispatched
```

After that, the daily 07:00 UTC cron keeps data fresh.

### Checking service health

```bash
# drought-monitoring GEE status
curl http://localhost:8001/health
# {"status":"healthy","gee_configured":true,"reports_dir":"/app/reports"}

# weather-mcp drought endpoint
curl "http://localhost:8000/drought/risk/latest?location=Dhaka"

# backend proxy
curl "http://localhost:3000/api/weather/drought-risk?location=Dhaka"
```

### Logs

```bash
docker logs drought-monitoring --tail 50 -f
docker logs warning-system-engine --tail 50 -f | grep DROUGHT
docker logs weather-mcp-standalone --tail 50 -f | grep DROUGHT
```
