# Potato EWS Test Guide

This document explains the potato Early Warning System (EWS) test script:

```text
components/warning_system_engine/scripts/test_potato_ews.py
```

The script is not just a unit test. It is an end-to-end smoke test for the full path from weather data to the frontend pop-out alert.

## What This System Does

The potato EWS checks short-term weather forecasts for conditions that can harm potato crops. It looks for risks such as:

- high temperature,
- heavy rainfall,
- combined heat and rain stress,
- cool, humid, wet conditions that can indicate late blight risk.

The output is a risk assessment with a tier:

| Tier | Meaning | Frontend banner |
| --- | --- | --- |
| `0` | Normal | No |
| `1` | Advisory | No |
| `2` | Warning | Yes |
| `3` | Severe | Yes |
| `4` | Emergency | Yes |

The frontend pop-out appears only when:

```text
tier >= 2
```

## The Engine Behind It

The actual risk logic is in `components/warning_system_engine`.

Main pieces:

```text
short_term_potato_ews.py
potato_profile.py
storage.py
scheduler.py
main.py
```

At a high level:

1. `potato_profile.py` loads the potato thresholds.
2. `short_term_potato_ews.py` evaluates the forecast against those thresholds.
3. `storage.py` reads and writes data in ArangoDB.
4. `scheduler.py` runs the potato EWS pipeline.
5. `main.py` triggers the pipeline via `POST /internal/run-potato-pipeline`.

The test script does not invent the result itself. It injects fake weather data, then asks the real potato EWS engine to process it.

## End-to-End Flow

```text
test_potato_ews.py
  |
  | writes fake forecast
  v
ArangoDB weather_forecasts
  |
  | POST /internal/run-potato-pipeline
  v
weather-mcp-standalone
  |
  | evaluates potato risk
  v
ArangoDB risk assessment storage
  |
  | GET /potato/risk/latest?location=Dhaka
  v
weather MCP API
  |
  | GET /api/weather/potato-risk?location=Dhaka
  v
Node.js backend
  |
  | frontend polls this endpoint
  v
CropAlertBanner.vue
```

## What The Test Script Does

`test_potato_ews.py` performs these checks:

1. Creates a fake two-day weather forecast for a district.
2. Writes that forecast into ArangoDB.
3. Triggers the potato EWS pipeline through the weather MCP API.
4. Reads the latest potato risk from the weather MCP API.
5. Calls the Node.js backend endpoint that the frontend uses.
6. Prints the message that should appear in the frontend pop-out.

If the weather MCP API is not reachable, the script can run the EWS locally as a fallback. That is useful for debugging the risk engine, but the full frontend path still needs the API and backend to work.

## Environment File

The script loads this file:

```text
components/warning_system_engine/.env
```

It uses:

```python
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")
```

So the `.env` file is loaded from the `warning_system_engine/` directory, even when the script is started from another directory or from inside Docker.

Example:

```env
ARANGO_URL=http://164.52.194.143:8529
ARANGO_PASSWORD=test
WEATHER_MCP_URL=http://164.52.194.143:8100
BACKEND_URL=http://164.52.194.143
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `ARANGO_URL` | ArangoDB URL. The test writes fake forecasts here. |
| `ARANGO_PASSWORD` | Password for ArangoDB. |
| `WEATHER_MCP_URL` | Base URL for the weather MCP service. |
| `BACKEND_URL` | Base URL for the Node.js backend or public app host. |

Default values in the script:

```text
ARANGO_URL=http://localhost:8529
ARANGO_PASSWORD=test
WEATHER_MCP_URL=http://localhost:8100
BACKEND_URL=http://localhost:3000
```

## Data Written To ArangoDB

The test writes a synthetic forecast into:

```text
weather_forecasts
```

For Dhaka, the document key is:

```text
dhaka__open_meteo__short
```

The forecast contains temperature, rainfall, humidity, wind, and weather flags. The EWS engine reads this forecast and calculates the potato risk.

## Weather MCP Endpoints

### Trigger Potato Pipeline

```http
POST /internal/run-potato-pipeline
```

This starts the potato EWS pipeline in the background.

Example:

```bash
curl -X POST http://164.52.194.143:8100/internal/run-potato-pipeline
```

Expected response:

```json
{
  "status": "potato_pipeline_started"
}
```

### Read Latest Potato Risk

```http
GET /potato/risk/latest?location=Dhaka
```

Example:

```bash
curl "http://164.52.194.143:8100/potato/risk/latest?location=Dhaka"
```

Example response:

```json
{
  "location": "Dhaka",
  "crop": "potato",
  "tier": 2,
  "tier_label": "Warning",
  "triggers": [
    "Max temperature 33.0C exceeds potato limit 30C"
  ],
  "disease_risks": [],
  "message": "Potato warning for Dhaka: Take protective action today."
}
```

## Node.js Backend Endpoint

The frontend does not call the weather MCP service directly. It calls the Node.js backend:

```http
GET /api/weather/potato-risk?location=Dhaka
```

Example:

```bash
curl "http://164.52.194.143:3000/api/weather/potato-risk?location=Dhaka"
```

The backend route proxies the request to:

```text
WEATHER_MCP_URL + /potato/risk/latest
```

This route is important because the frontend already talks to the backend API, not directly to internal Python services.

## Frontend Behavior

The pop-out is implemented in:

```text
components/gov-chat-frontend/src/components/CropAlertBanner.vue
```

It polls:

```text
/api/weather/potato-risk?location=Dhaka
```

The banner appears when the response has `tier >= 2`.

If the user dismisses the banner, the frontend stores:

```text
crop_alert_dismissed_until
```

in browser localStorage. Delete this key during testing if the banner should appear but does not.

## Scenarios

The script supports these scenarios:

| Scenario | Meaning | Expected result |
| --- | --- | --- |
| `heat` | High max temperature | Tier 2 Warning |
| `rain` | High rainfall | Tier 2 Warning |
| `combined` | Heat and rain together | Tier 3 Severe |
| `blight` | Cool, humid, wet conditions | Tier 1 Advisory |
| `normal` | Safe weather values | Tier 0 Normal |

Examples:

```bash
docker exec -it warning-system-engine python3 /app/scripts/test_potato_ews.py --scenario heat
docker exec -it warning-system-engine python3 /app/scripts/test_potato_ews.py --scenario combined
docker exec -it warning-system-engine python3 /app/scripts/test_potato_ews.py --scenario normal
```

## Docker URL Behavior

When running inside the `weather-mcp-standalone` container, `localhost` means the weather container itself.

For backend checks, the script tries:

```text
BACKEND_URL
BACKEND_URL with :3000
http://backend:3000
http://gov-chat-backend:3000
http://kong:8010
```

This helps when `BACKEND_URL=http://164.52.194.143` points to the public frontend instead of the backend API.

## Run The Test

From the host (recommended):

```bash
cd components/warning_system_engine
python3 scripts/test_potato_ews.py
```

Or from inside the container:

```bash
docker exec -it warning-system-engine python3 /app/scripts/test_potato_ews.py
```
