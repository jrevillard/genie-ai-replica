# MEWA v2 — Feature Implementation Guide

**Features implemented:** Potato Early Warning System · Crop Alert Banner · Bulletin MCP Tool · Mapbox Map View  
**Stack:** FastAPI (Python) · Node.js/Express · Vue 3 · ArangoDB · Docker Compose · Kong · nginx

---

## Table of Contents

1. [Potato Short-Term Early Warning System (EWS)](#1-potato-short-term-early-warning-system)
2. [Crop Alert Banner (Frontend)](#2-crop-alert-banner)
3. [Bulletin MCP Tool](#3-bulletin-mcp-tool)
4. [Mapbox Map View](#4-mapbox-map-view)
5. [Infrastructure Fixes](#5-infrastructure-fixes)
6. [Full File Reference](#6-full-file-reference)

---

## 1. Potato Short-Term Early Warning System

### What it does
A deterministic (no LLM) pipeline that reads already-ingested weather forecasts from ArangoDB, evaluates them against potato-specific thresholds, and writes a tiered risk assessment. When the risk tier reaches 2 or above the frontend shows a dismissable pop-out alert.

### Architecture

```
Scheduler (hourly)
  └─ run_potato_ews_pipeline()
       └─ PotatoShortTermEWS.evaluate(location)
            ├─ StorageLayer.get_latest_forecast_pair()   ← reads weather_forecasts collection
            ├─ evaluate_potato_day()                      ← threshold checks per day
            ├─ detect_late_blight()                       ← temp+humidity+rain rule
            ├─ _dedup_by_category()                       ← collapses same-type breach across days
            ├─ classify_tier()                            ← 0=Normal … 4=Emergency
            └─ StorageLayer.upsert_crop_assessment()      ← writes risk_assessments collection
```

### Tier classification

| Tier | Label | Condition |
|------|-------|-----------|
| 0 | Normal | No thresholds breached |
| 1 | Advisory | Humidity or disease signal only |
| 2 | Warning | 1 severe trigger (heat, critical rain, wind) |
| 3 | Severe | 2+ distinct severe trigger types |
| 4 | Emergency | Flood confirmed + tier 3 |

### Thresholds (potato_dhaka profile)

Loaded from `components/weather-mcp-service/data/crop_profiles.json`:

| Parameter | Threshold |
|-----------|-----------|
| Max temperature | > 30°C → severe trigger |
| Min temperature | < 10°C → severe trigger |
| Humidity | > 80% → advisory trigger |
| Rainfall medium | ≥ 25 mm → severe trigger |
| Rainfall critical | ≥ 100 mm → severe trigger |
| Wind | > 30 km/h → severe trigger |
| Late blight | temp_mean 16–20°C AND humidity ≥ 90% AND rain ≥ 1 mm |

### Category deduplication
The same threshold breach on two consecutive forecast days would normally double-count the trigger and inflate the tier. `_dedup_by_category()` collapses same-type triggers (e.g. two heat breaches) into one, keeping only the first (more imminent) occurrence.

```python
_TRIGGER_CATEGORIES = ["max temperature", "min temperature", "humidity",
                        "critical rainfall", "high rainfall", "wind"]
```

### ArangoDB storage keys

| Collection | Key format | Example |
|------------|-----------|---------|
| `weather_forecasts` | `{district}__{source}__{horizon}` | `dhaka__open_meteo__short` |
| `risk_assessments` | `{district}__{horizon}__{crop}` | `dhaka__short__potato` |
| `alerts_sent` | insert-only dedup log | — |

### New files

| File | Purpose |
|------|---------|
| `weather-mcp-service/potato_profile.py` | Loads `PotatoThresholds` frozen dataclass from crop_profiles.json |
| `weather-mcp-service/potato_risk_engine.py` | Pure functions: threshold checks, late blight, tier classify, message builder |
| `weather-mcp-service/short_term_potato_ews.py` | Orchestrator: reads forecasts → evaluates → stores assessment |

### Modified files

- `storage.py` — 5 new methods: `get_latest_forecast_pair`, `upsert_crop_assessment`, `get_latest_crop_risk`, `was_crop_alert_sent`, `record_crop_alert_sent`
- `scheduler.py` — `run_potato_ews_pipeline()` added; `run_hourly_pipeline()` and `create_scheduler()` updated to accept `potato_ews` arg
- `main.py` — `GET /potato/risk/latest` and `POST /internal/run-potato-pipeline` endpoints added

### API endpoints

```
GET  /potato/risk/latest?location=Dhaka          → latest assessment dict or tier-0 default
POST /internal/run-potato-pipeline               → background-task trigger (for testing)
```

### Test script
`components/weather-mcp-service/scripts/test_potato_ews.py`

```bash
source .venv/bin/activate
python scripts/test_potato_ews.py --scenario heat      # tier 2 — heat breach
python scripts/test_potato_ews.py --scenario rain      # tier 2 — rainfall breach
python scripts/test_potato_ews.py --scenario combined  # tier 3 — heat + rain
python scripts/test_potato_ews.py --scenario blight    # tier 1 — late blight only
python scripts/test_potato_ews.py --scenario normal    # tier 0 — clears alert
```

The script injects a synthetic forecast into ArangoDB, runs the EWS (via API or locally as fallback), verifies the assessment, and checks the backend proxy route.

---

## 2. Crop Alert Banner

### What it does
A fixed-position pop-out in the authenticated frontend. Polls `GET /api/weather/potato-risk?location=Dhaka` every 30 minutes. Shows when tier ≥ 2. Dismissable for 12 hours via `localStorage`.

### Component
`components/gov-chat-frontend/src/components/CropAlertBanner.vue`

Mounted inside the authenticated template in `App.vue`:
```html
<crop-alert-banner />
```

### Tier colours

| Tier | Background | Border |
|------|-----------|--------|
| 2 | `#fff3cd` | `#f0a500` (amber) |
| 3 | `#fde8e8` | `#dc3545` (red) |
| 4 | `#ede0f7` | `#6f42c1` (purple) |

### Dismiss behaviour
```js
dismiss() {
  this.visible = false;
  localStorage.setItem('crop_alert_dismissed_until', String(Date.now() + 12 * 60 * 60 * 1000));
}
```

### Mobile layout (≤ 600px)
On small screens the banner switches from a bottom-right card to a full-width bottom sheet:
```css
@media screen and (max-width: 600px) {
  .crop-alert-banner {
    left: 0; right: 0; bottom: 0;
    border-radius: 10px 10px 0 0;
    border-left: none;
    border-top: 5px solid ...;
  }
}
```

### Backend route
`components/gov-chat-backend/routes/weather-routes.js`:
```
GET /api/weather/potato-risk?location=Dhaka
  → proxies to weather-mcp-standalone:8000/potato/risk/latest
  → 404 returns safe tier-0 default (never breaks the UI)
```

---

## 3. Bulletin MCP Tool

### What it does
When a user asks about the bulletin in the chat, the system returns the full contents of `bulletin.md` with all images from the `data/` directory appended as markdown image links. The images render inline in the chat.

### Trigger keywords
Detected by the weather router in `query-service.js` (WEATHER_HARD list):
```
bulletin, agrometeorological, agromet, agri advisory,
national bulletin, advisory bulletin
```

### Data flow

```
User: "show me the bulletin"
  → query-service.js detects keyword → isWeatherQuery = true
  → POST weather-mcp /query
  → _BULLETIN_KEYWORDS regex matches
  → _build_bulletin_answer()
       reads bulletin.md
       appends image markdown links
  → returns { answer: "# NATIONAL AGROMETEOROLOGICAL...\n\n![Farm Visualization](/api/weather/bulletin-image/...)" }
  → displayed in chat via marked renderer (images render inline)
```

### Image serving
Images are served publicly (no auth) so browser `<img>` tags can load them:

```
GET /api/weather/bulletin-image/:filename   ← Node.js proxy (no auth)
  → weather-mcp-standalone:8000/bulletin/image/:filename
  → streams file from data/ directory
```

The public route is registered **before** `router.use(authMiddleware.authenticate)` in `weather-routes.js`.

### New endpoints (weather-mcp-service)

```
GET /bulletin/image/{filename}   — serves .png/.jpg/.gif/.webp from data/
```

### Bulletin markdown image format
```markdown
## Field Visualizations

![Farm Visualization](/api/weather/bulletin-image/farm_visualization.png)
![Image](/api/weather/bulletin-image/image.jpg)
```

---

## 4. Mapbox Map View

### What it does
When the user types `show me the map {location}`, the chat intercepts the message before sending to the backend, resolves the location to coordinates, and overlays a full-screen Mapbox satellite map with a red pin. A ← button returns to the chat.

### Trigger format
```
show me the map {free-text location}

Examples:
  show me the map Dhaka
  show me the map Berlin Mitte
  show me the map Brooklyn
```

### Data flow

```
User types: "show me the map Berlin Mitte"
  → ChatBotComponent.sendMessage()
  → /^show me the map\s+(.+)$/i matches
  → httpService.get('weather/geocode', { location: 'Berlin Mitte' })
       → GET /api/weather/geocode?location=Berlin+Mitte  (authenticated)
       → Node.js proxy → weather-mcp-standalone:8000/geocode?location=Berlin+Mitte
       → checks DISTRICT_COORDS (64 Bangladesh districts) — no match
       → Mapbox Geocoding API → { lat: 52.517, lon: 13.403, name: "Mitte, Berlin, Germany" }
  → mapMode = true, mapLocation = { lat, lon, name, zoom }
  → <MapView> overlay renders (z-index 8000, covers entire viewport)
  → Mapbox GL JS initialises satellite map, flies to location, drops red pin
```

### Geocoding priority
1. **DISTRICT_COORDS** — 64 Bangladesh districts (exact + substring match, case-insensitive). Returns zoom 11.
2. **Mapbox Geocoding API** — `api.mapbox.com/geocoding/v5/mapbox.places/{query}.json`. Returns zoom 12.

### Component: `MapView.vue`
```
Props:  lat (Number), lon (Number), name (String), zoom (Number, default 12)
Emits:  back
Style:  mapbox://styles/mapbox/satellite-v12
```

Key lifecycle:
- `mounted()` — initialises `mapboxgl.Map`, adds `NavigationControl`, drops `Marker` with popup
- `beforeUnmount()` — calls `map.remove()` to free WebGL context
- `watch: lat/lon` — calls `map.flyTo()` if props change

### Token wiring (build-time)
The Mapbox token flows from `.env` → docker-compose build arg → Dockerfile ARG/ENV → webpack DefinePlugin → `process.env.VUE_APP_MAPBOX_TOKEN` in the browser bundle.

```
.env:                    MAPBOX_ACCESS_TOKEN=pk.eyJ1...
docker-compose.yaml:     - VUE_APP_MAPBOX_TOKEN=${MAPBOX_ACCESS_TOKEN}
Dockerfile-single-node:  ARG VUE_APP_MAPBOX_TOKEN / ENV VUE_APP_MAPBOX_TOKEN=...
vue.config.js:           VUE_APP_MAPBOX_TOKEN: JSON.stringify(process.env.VUE_APP_MAPBOX_TOKEN)
MapView.vue:             mapboxgl.accessToken = process.env.VUE_APP_MAPBOX_TOKEN
```

### New files

| File | Purpose |
|------|---------|
| `gov-chat-frontend/src/components/MapView.vue` | Mapbox GL map overlay component |

### Modified files

| File | Change |
|------|--------|
| `weather-mcp-service/main.py` | `GET /geocode` endpoint |
| `weather-routes.js` | `GET /api/weather/geocode` proxy |
| `package.json` | `mapbox-gl@^2.15.0` added |
| `ChatBotComponent.vue` | Regex intercept + `mapMode`/`mapLocation` state + `MapView` import |
| `Dockerfile-single-node` | `VUE_APP_MAPBOX_TOKEN` ARG, CSP updated |
| `vue.config.js` | Token in DefinePlugin |
| `docker-compose.yaml` | Token build arg in frontend service |

---

## 5. Infrastructure Fixes

### Port mismatch fix (weather-mcp-standalone)
The Docker Compose port mapping was `8100:8100` but uvicorn was listening on container port 8000. Fixed to `8100:8000`.

```yaml
# Before
ports:
  - "${WEATHER_MCP_PORT}:${WEATHER_MCP_PORT}"

# After
ports:
  - "${WEATHER_MCP_PORT}:8000"
```

### nginx CSP update
`api-gateway-solution/nginx/conf/default.conf` — the hardcoded CSP did not allow Mapbox. Updated to include:

```
img-src    'self' data: blob: https://*.mapbox.com
worker-src blob:
connect-src ... https://*.mapbox.com
font-src   'self' data:
```

Reload with `docker exec nginx nginx -s reload` (no rebuild needed — config is volume-mounted).

---

## 6. Full File Reference

### New files created

| File | Description |
|------|-------------|
| `weather-mcp-service/potato_profile.py` | `PotatoThresholds` dataclass + loader |
| `weather-mcp-service/potato_risk_engine.py` | Pure threshold/classification functions |
| `weather-mcp-service/short_term_potato_ews.py` | EWS orchestrator class |
| `weather-mcp-service/scripts/test_potato_ews.py` | End-to-end test script |
| `gov-chat-frontend/src/components/CropAlertBanner.vue` | Crop risk pop-out alert |
| `gov-chat-frontend/src/components/MapView.vue` | Mapbox satellite map overlay |

### Modified files

| File | What changed |
|------|-------------|
| `weather-mcp-service/storage.py` | 5 new crop-aware storage methods |
| `weather-mcp-service/scheduler.py` | Potato EWS pipeline wired into hourly run |
| `weather-mcp-service/main.py` | `/potato/risk/latest`, `/internal/run-potato-pipeline`, `/bulletin/image/{f}`, `/geocode` endpoints; bulletin query detection |
| `gov-chat-backend/routes/weather-routes.js` | `/potato-risk`, `/bulletin-image/:f`, `/geocode` proxy routes |
| `gov-chat-backend/services/query-service.js` | Bulletin keywords added to WEATHER_HARD list |
| `gov-chat-frontend/src/App.vue` | `<crop-alert-banner />` mounted in authenticated template |
| `gov-chat-frontend/src/components/ChatBotComponent.vue` | Map intent intercept + `mapMode` state + `MapView` registered |
| `gov-chat-frontend/package.json` | `mapbox-gl@^2.15.0` |
| `gov-chat-frontend/vue.config.js` | `VUE_APP_MAPBOX_TOKEN` in DefinePlugin |
| `gov-chat-frontend/Dockerfile-single-node` | Mapbox token ARG + CSP headers |
| `docker-compose.yaml` | Port fix (8100:8000) + frontend Mapbox token build arg |
| `api-gateway-solution/nginx/conf/default.conf` | CSP updated for Mapbox domains |

### Containers to rebuild after any change

| Container | When to rebuild |
|-----------|----------------|
| `weather-mcp-standalone` | Changes to any `.py` file in `weather-mcp-service/` |
| `backend` | Changes to `routes/`, `services/`, `index.js` in `gov-chat-backend/` |
| `frontend` | Changes to any `.vue`, `.js`, `package.json`, `Dockerfile-single-node` |
| `nginx` | Config change only needs `docker exec nginx nginx -s reload` |

```bash
# Typical rebuild commands
docker compose up -d --build weather-mcp-standalone backend
docker compose up -d --build frontend
docker exec nginx nginx -s reload
```
