# Drought Monitoring Service

`drought_monitoring` is the MEWA v2 drought assessment container. It can be
used as a FastAPI microservice in the full stack or as the `drought-alert`
command-line tool from this package.

The service fetches satellite data through Google Earth Engine (GEE), evaluates
soil moisture and vegetation indicators, generates drought PDF reports, and
writes the latest assessment for each district to ArangoDB. It is intentionally
passive: it does not schedule itself and it does not send notifications. Those
responsibilities belong to `warning_system_engine`.

## Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Container Layout](#container-layout)
- [API Endpoints](#api-endpoints)
- [Data Sources](#data-sources)
- [Classification Logic](#classification-logic)
- [GEE Credentials](#gee-credentials)
- [Running Locally](#running-locally)
- [Docker Usage](#docker-usage)
- [Scheduling](#scheduling)
- [PDF Reports](#pdf-reports)
- [Frontend and Chatbot Integration](#frontend-and-chatbot-integration)
- [Environment Variables](#environment-variables)
- [ArangoDB Schema](#arangodb-schema)
- [Testing Without GEE](#testing-without-gee)
- [Operations](#operations)

## Overview

For a Bangladesh district or coordinate, the drought pipeline:

1. Builds a district bounding box from configured centroids or supplied
   latitude/longitude.
2. Fetches recent SMAP and VIIRS NDVI data through GEE.
3. Computes spatial and temporal means for each indicator.
4. Compares observed values with calibrated alert thresholds.
5. Converts the number of stressed indicators into drought severity.
6. Generates a PDF report.
7. Upserts the latest assessment into ArangoDB.

The active severity levels are:

| Score | Level | Tier | Meaning |
|---:|---|---:|---|
| 0 | NORMAL | 0 | All indicators are within range |
| 1 | NORMAL | 0 | One stressed indicator; no alert |
| 2 | WATCH | 1 | Advisory drought watch |
| 3 | MODERATE | 2 | Warning; banner and push notification |
| 4 | SEVERE | 3 | Severe warning; banner and push notification |

## System Architecture

```text
warning_system_engine
  daily cron 07:00 UTC
  POST /run/all
        |
        v
drought_monitoring (:8001, internal)
  1. GEE fetch: SMAP + NDVI
  2. classify_drought()
  3. generate_pdf_report()
  4. upsert drought_assessments
        |
        +--> ArangoDB: drought_assessments
        |
        +--> Docker volume: drought_reports

weather-mcp-standalone (:8000)
  GET /drought/risk/latest
  GET /drought/report/{filename}
  POST /query drought routing
        |
        v
gov-chat-backend (:3000)
  GET /api/weather/drought-risk
  GET /api/weather/drought-report/:filename
        |
        v
frontend CropAlertBanner + chatbot
```

Key design principle: `drought_monitoring` is stateless and passive. It waits
for `/run/all` or `/run/district`, performs the assessment, writes outputs, and
returns a result.

## Container Layout

```text
components/drought_monitoring/
├── dockerfile
├── docker-compose.yml
├── pyproject.toml
├── README.md
└── src/
    ├── api.py                         # FastAPI entrypoint
    ├── drought_alert.py               # CLI entrypoint
    ├── runner.py                      # district loop + GEE orchestration
    ├── storage.py                     # ArangoDB writes
    ├── drought_classify/
    │   └── classify_drought.py        # band flagging + severity scoring
    ├── drought_report/
    │   ├── generate_report.py         # PDF generation
    │   └── drought_charts.py          # report charts
    ├── fetch_dataset/
    │   └── fetch_data.py              # GEE SMAP + NDVI fetch
    └── utils/
        ├── gee_auth.py                # GEE initialization
        ├── helper_functions.py        # GEE geometry/extraction helpers
        └── utils.py                   # thresholds and dataclasses
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns service health, GEE credential status, and reports directory |
| `POST` | `/run/all` | Runs all supported districts; blocking and may take several minutes |
| `POST` | `/run/district` | Runs one district on demand with `{location, lat, lon, days}` |

Example on-demand request:

```bash
curl -X POST http://localhost:8001/run/district \
  -H 'Content-Type: application/json' \
  -d '{"location":"Dhaka","lat":23.8103,"lon":90.4125,"days":7}'
```

`/run/district` is used by `weather-mcp-standalone` for chatbot requests that
ask for a specific drought forecast window.

## Data Sources

| Indicator | GEE Collection | Band | Unit |
|---|---|---|---|
| Surface soil moisture | `NASA/SMAP/SPL4SMGP/008` | `sm_surface` | m3/m3 |
| Evapotranspiration | `NASA/SMAP/SPL4SMGP/008` | `land_evapotranspiration_flux` | kg/m2/s converted to mm/day |
| Surface runoff | `NASA/SMAP/SPL4SMGP/008` | `overland_runoff_flux` | kg/m2/s converted to mm/day |
| Vegetation greenness | `NOAA/CDR/VIIRS/NDVI/V1` | `NDVI` | index |

SMAP flux bands are multiplied by `86400` to convert from kg/m2/s to mm/day.

## Classification Logic

### Assessment Flow

```text
fetch_recent_data(bbox, days)
        |
        +--> GEE SMAP daily means for soil moisture, ET, runoff
        +--> GEE VIIRS NDVI daily means
        |
        v
average each band across the window
        |
        v
classify_band(band, value) x 4
        |
        v
score = count of bands below alert threshold
        |
        v
classify_drought(score) -> NORMAL / WATCH / MODERATE / SEVERE
        |
        v
analyse_trend(daily_df)
        |
        v
generate_pdf_report()
        |
        v
storage.upsert_drought_assessment()
```

### Active Thresholds

The active classifier thresholds are defined in `src/utils/utils.py`.

| Band | Good mean | Drought mean | Alert threshold |
|---|---:|---:|---:|
| `sm_surface` | 0.3058 | 0.0955 | 0.2585 |
| `land_evapotranspiration_flux` | 3.9307 | 1.6765 | 3.1528 |
| `overland_runoff_flux` | 1.6691 | 0.0636 | 0.8663 |
| `NDVI` | 0.4331 | 0.3691 | 0.4011 |

A band is flagged when its observed average is below `alert_thresh`.
`pct_of_threshold` shows how close the value is to the safe floor.

If thresholds are recalibrated, keep `src/utils/utils.py` and the PDF report
threshold display in `src/drought_report/generate_report.py` aligned.

## GEE Credentials

GEE is the only external dependency that requires manual setup. Without
credentials, the service still starts and `/health` works, but `/run/*` returns
`gee_not_configured`.

### Container Authentication

The FastAPI container uses a service account JSON file. Place the key at one of
these paths inside the container:

```text
/app/secrets/credentials.json
/app/secrets/service-account.json
```

The root full-stack compose mounts `./secrets` read-only:

```yaml
drought-monitoring:
  volumes:
    - ./secrets:/app/secrets:ro
```

So the usual host path is:

```text
./secrets/credentials.json
```

### GEE Project

The default project is:

```env
GEE_PROJECT=mewa-493916
```

Override it in the root `.env` if you use another GEE-enabled project.

### Local CLI Authentication

The `drought-alert` command-line entrypoint uses normal Earth Engine local
credentials. For local CLI use, authenticate once on the host:

```bash
pip install earthengine-api
earthengine authenticate
ls ~/.config/earthengine/
# credentials
```

## Running Locally

Install the package from `components/drought_monitoring`:

```bash
cd components/drought_monitoring
pip install -e .
drought-alert --help
```

CLI usage:

```bash
drought-alert --lat <latitude> --lon <longitude> --days <N> --project <gee-project-id>
```

Example:

```bash
drought-alert --lat 23.8 --lon 90.4 --days 7 --project my-gee-project
```

Arguments:

| Argument | Required | Default | Description |
|---|---|---|---|
| `--lat` | Yes | - | Target latitude |
| `--lon` | Yes | - | Target longitude |
| `--days` | No | `7` | Number of recent days to analyze |
| `--project` | Yes | - | Google Earth Engine project ID |

## Docker Usage

Build:

```bash
docker compose build drought-monitoring
```

Run the service in the full stack:

```bash
docker compose up drought-monitoring
```

Run the CLI command through the image:

```bash
docker compose run --rm drought-monitoring drought-alert \
  --lat 23.8 --lon 90.4 --days 7 --project my-gee-project
```

## Scheduling

`drought_monitoring` has no internal scheduler. Scheduling is owned by
`warning_system_engine/app/core/scheduler.py`.

```text
Daily schedule (UTC):
  05:00  short-term weather pipeline
  06:00  long-term potato EWS
  07:00  drought pipeline -> POST drought-monitoring:8001/run/all
  +120s  startup drought catch-up after warning_system_engine starts
```

Pipeline steps in `run_drought_pipeline`:

1. `POST http://drought-monitoring:8001/run/all` with a 30-minute timeout.
2. If GEE is not configured, log and skip alerts.
3. Read stored `drought_assessments` with `tier >= 2`.
4. Deduplicate using `alerts_sent` for 12 hours.
5. Dispatch drought alerts through the shared notifier.

## PDF Reports

`src/drought_report/generate_report.py` creates a PDF per assessment with:

- Summary table: tier, trend, district, date range.
- Band-by-band value vs threshold charts.
- Daily time-series chart.
- Trigger summary and farmer-facing explanation.

PDFs are written to a shared Docker volume:

```yaml
volumes:
  drought_reports: {}

drought-monitoring:
  volumes:
    - drought_reports:/app/reports

weather-mcp-standalone:
  volumes:
    - drought_reports:/app/drought_reports:ro
```

Filename pattern:

```text
drought_{district_slug}_{YYYYMMDD}.pdf
```

Examples:

```text
drought_dhaka_20260510.pdf
drought_cox_s_bazar_20260510.pdf
```

`weather-mcp-standalone` serves reports with:

```text
GET /drought/report/{filename}
```

`gov-chat-backend` proxies them with:

```text
GET /api/weather/drought-report/:filename
```

## Frontend and Chatbot Integration

### Alert Banner

`gov-chat-frontend/src/components/CropAlertBanner.vue` polls drought and potato
risk every 60 seconds:

```text
GET /api/weather/potato-risk?location=Dhaka
GET /api/weather/drought-risk?location=Dhaka
```

It shows only tier >= 2 alerts, sorts highest tier first, and links to the PDF
report when `report_filename` exists. Dismissals are stored in `localStorage`
for 12 hours.

### Chatbot Queries

`weather-mcp-standalone/main.py` intercepts drought queries before the regular
weather agent:

```text
POST /query {"query": "is there drought risk next month in Rajshahi?"}
        |
        +--> drought keyword match
        +--> district resolution
        +--> horizon parsing
        +--> on-demand /run/district if DROUGHT_MONITORING_URL is set
        +--> fallback to stored ArangoDB assessment
        +--> markdown response with optional PDF link
```

Horizon parsing:

| User phrase | Days | Response label |
|---|---:|---|
| `next week`, `7 days` | 7 | next week |
| `next two weeks`, `14 days` | 14 | next 2 weeks |
| `next three weeks`, `21 days` | 21 | next 3 weeks |
| `next month`, `30 days`, default | 30 | next month |

The drought forecast is also exposed as an MCP tool named
`assess_drought_forecast`.

## Environment Variables

### `drought_monitoring`

| Variable | Default | Description |
|---|---|---|
| `GEE_PROJECT` | `mewa-493916` | GEE cloud project ID |
| `DROUGHT_REPORTS_DIR` | `/app/reports` | PDF output directory |
| `ARANGO_URL` | `http://arango-vector-db:8529` | ArangoDB host |
| `ARANGO_DB_NAME` | `genie-ai` | Database name |
| `ARANGO_USER` | `root` | ArangoDB user |
| `ARANGO_PASSWORD` | required | ArangoDB password |
| `LOG_LEVEL` | `INFO` | Python logging level |

### `warning_system_engine`

| Variable | Description |
|---|---|
| `DROUGHT_MONITORING_URL` | Must point to `http://drought-monitoring:8001` to enable scheduled drought runs |

### `weather-mcp-standalone`

| Variable | Description |
|---|---|
| `DROUGHT_MONITORING_URL` | Enables on-demand chatbot assessments |
| `DROUGHT_REPORTS_DIR` | Read-only mount point for served PDFs, usually `/app/drought_reports` |

## ArangoDB Schema

### `drought_assessments`

One latest document per district. Document key:

```text
{location_slug}__drought
```

Example:

```json
{
  "_key": "rajshahi__drought",
  "location": "Rajshahi",
  "lat": 24.3745,
  "lon": 88.6042,
  "assessed_at": "2026-05-10T07:15:00+00:00",
  "window_days": 7,
  "drought_level": "MODERATE",
  "drought_score": 3,
  "tier": 2,
  "tier_label": "Warning",
  "trend": "WORSENING",
  "trend_run_days": 3,
  "trend_warning": true,
  "triggers": [
    "Soil moisture at 68% of safe level",
    "Evapotranspiration at 61% of safe level",
    "Crop greenness (NDVI) at 82% of safe level"
  ],
  "message": "Moderate drought - 3 of 4 sensors stressed. Crops may be affected soon.",
  "report_filename": "drought_rajshahi_20260510.pdf",
  "band_results": {
    "sm_surface": {
      "value": 0.177,
      "flag": 1,
      "status": "BELOW THRESHOLD",
      "pct_of_threshold": 68.4
    }
  }
}
```

### `alerts_sent`

Drought notification deduplication entries:

```json
{
  "location": "Rajshahi",
  "tier": 2,
  "channel": "push",
  "alert_type": "drought",
  "sent_at": "2026-05-10T07:18:42+00:00"
}
```

## Supported Districts

Batch runs cover 20 Bangladesh districts:

```text
Dhaka, Chittagong, Sylhet, Rajshahi, Khulna, Barisal, Rangpur,
Mymensingh, Comilla, Jessore, Bogra, Dinajpur, Pabna, Tangail,
Faridpur, Noakhali, Brahmanbaria, Cox's Bazar, Chandpur, Narsingdi
```

Batch mode does not use Nominatim. It builds bounding boxes directly from
configured district centroids to avoid rate limits.

## Testing Without GEE

The weather MCP test script injects synthetic drought assessments directly into
ArangoDB, bypassing GEE:

```bash
# Moderate drought in Dhaka; triggers banner
python3 components/weather-mcp-service/scripts/test_drought_alert_flow.py --scenario moderate

# Severe drought in Rajshahi
python3 components/weather-mcp-service/scripts/test_drought_alert_flow.py --scenario severe --district Rajshahi

# Clear the alert
python3 components/weather-mcp-service/scripts/test_drought_alert_flow.py --scenario normal --district Rajshahi
```

Scenarios:

| Scenario | Tier | Banner | Notification |
|---|---:|---|---|
| `normal` | 0 | No | No |
| `watch` | 1 | No | No |
| `moderate` | 2 | Yes | Yes |
| `severe` | 3 | Yes | Yes |

## Operations

Startup order in the full stack:

```text
arango-vector-db -> drought-monitoring -> warning-system-engine
                 -> weather-mcp-standalone
```

First run after GEE authentication:

```text
warning_system_engine starts
  +120s -> run_drought_pipeline()
      -> POST drought-monitoring:8001/run/all
      -> GEE fetches all 20 districts
      -> assessments stored in ArangoDB
      -> tier >= 2 alerts dispatched
```

Health checks:

```bash
curl http://localhost:8001/health
curl "http://localhost:8000/drought/risk/latest?location=Dhaka"
curl "http://localhost:3000/api/weather/drought-risk?location=Dhaka"
```

Logs:

```bash
docker logs drought-monitoring --tail 50 -f
docker logs warning-system-engine --tail 50 -f | grep DROUGHT
docker logs weather-mcp-standalone --tail 50 -f | grep DROUGHT
```
