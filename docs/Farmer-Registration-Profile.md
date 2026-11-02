# Farmer Registration & Profile Management

**Project:** BDT 9LES25007 — Open-Source AI Agriculture Advisory Service for Lesotho  
**Feature:** Farmer Profile with Map-based Farm Location & Plot Management  
**Status:** ✅ Implemented  
**Last Updated:** August 26, 2026

---

## Overview

The Farmer Registration & Profile Management module enables smallholder farmers to register their farm details, including GPS-located farm plots drawn on an interactive map, crop profiles, livestock inventories, and cooperative memberships. This data is stored per-user and can be used to personalize agricultural advisory responses, weather alerts, and extension service routing.

The implementation is a **standalone modal** accessible from the navigation bar, keeping the simplified user profile (Keycloak-managed identity) separate from the editable agricultural data.

---

## Features

### 1. Interactive Map with GPS & Polygon Drawing

- **Leaflet + OpenStreetMap** map (no API key required, works offline with tile caching)
- **GPS auto-detect** via browser Geolocation API (one-tap location capture)
- **Center point** — click or drag to set the farm's primary location (used for weather, advisory routing)
- **Polygon drawing** — draw multiple farm plot boundaries on the map
- **Rectangle tool** — quick rectangular plot selection
- **Edit & Delete** — modify or remove existing plot boundaries
- **Automatic area calculation** per plot (approximate hectares using Shoelace formula)
- **Plot naming** — label each plot (e.g., "Main field", "River plot", "Communal garden")
- **Manual coordinate entry** — fallback for low-connectivity environments
- **Draggable center marker** — fine-tune position after placement

### 2. Farm Size & Ownership Details

| Field | Options |
|-------|---------|
| Total Farm Size | Number + unit (hectares, acres, m²) |
| Ownership Type | Owned, Leased, Communal/Tribal, Rented, Sharecropping |
| Farming Type | Subsistence, Commercial, Mixed |
| Irrigation | Rain-fed, Irrigated, Mixed |

### 3. Crop Profiles

Dynamic list of crops with:
- Crop name (free text — e.g., Maize, Sorghum, Beans)
- Growing season (Summer, Winter, Year-round)
- Area allocated (hectares)

### 4. Livestock Profiles

Dynamic list of livestock with:
- Animal type (free text — e.g., Cattle, Sheep, Poultry)
- Head count
- Purpose (Meat, Dairy, Eggs, Wool/Fiber, Draft/Work, Breeding, Mixed)

### 5. Farmer Groups & Cooperatives

Dynamic list of memberships:
- Group/cooperative name
- Role (Member, Leader, Treasurer, Secretary)

### 6. Weather at Farm Location

A weather card displayed within the Farmer Profile modal showing real-time conditions at the farmer's mapped location:

**Current Conditions:**
- Temperature (°C)
- Weather condition description with emoji icon
- Humidity (%)
- Wind speed (km/h)

**5-Day Forecast Strip:**
- Day name, weather emoji, and high/low temperature for each of the next 5 days

**Behavior:**
- Uses the farm center coordinates (`farmLocation.center`) to fetch location-specific weather
- Falls back to default Maseru coordinates (`WEATHER_DEFAULT_LATITUDE` / `WEATHER_DEFAULT_LONGITUDE`) if no farm location is set
- Data is fetched from the backend WeatherService on profile load
- WeatherService sources data from the Open-Meteo API (free, no API key required)

---

## Architecture

### Frontend

**Component:** `components/gov-chat-frontend/src/components/FarmerProfileComponent.vue`

- Vue.js modal component with Leaflet map integration
- Leaflet Draw plugin for polygon creation/editing
- GPS via `navigator.geolocation.getCurrentPosition()`
- Dark mode support with theme-aware styling
- Mobile responsive (touch-friendly map controls)
- Accessible from NavBar (both desktop and mobile)

**Dependencies added:**
- `leaflet@^1.9.4` (~40KB gzipped)
- `leaflet-draw@^1.0.4` (~22KB gzipped)

### Backend

**Route:** `GET/PUT /api/users/farmer-profile` (in `routes/user-routes.js`)

- JWT-authenticated (Keycloak token required)
- Validation: GPS coordinates bounds (-90/+90 lat, -180/+180 lng)
- Polygon coordinate validation (each point must be valid lat/lng)
- Stored as `farmerProfile` nested object on the user document in ArangoDB

### Data Model

```json
{
  "_key": "user-uuid",
  "farmerProfile": {
    "shareWithAI": true,
    "farmLocation": {
      "center": { "lat": -29.3167, "lng": 27.4833 },
      "plots": [
        {
          "name": "Main field",
          "type": "polygon",
          "coordinates": [
            [-29.310, 28.470],
            [-29.310, 28.490],
            [-29.320, 28.490],
            [-29.320, 28.470]
          ]
        },
        {
          "name": "River plot",
          "type": "polygon",
          "coordinates": [...]
        }
      ],
      "district": "Maseru",
      "village": "Ha Matala"
    },
    "farmDetails": {
      "size": 5.0,
      "sizeUnit": "hectares",
      "ownershipType": "communal",
      "farmingType": "subsistence",
      "irrigationType": "rainfed"
    },
    "crops": [
      { "name": "Maize", "season": "summer", "area": 2.5 },
      { "name": "Beans", "season": "summer", "area": 1.0 }
    ],
    "livestock": [
      { "type": "Cattle", "count": 12, "purpose": "mixed" },
      { "type": "Sheep", "count": 30, "purpose": "wool" }
    ],
    "cooperatives": [
      { "name": "Maseru Farmers Union", "role": "member" }
    ],
    "updatedAt": "2026-06-15T12:00:00.000Z"
  }
}
```

### Privacy & AI Integration

The farmer profile includes a `shareWithAI` privacy toggle (default: **disabled**). When enabled:

1. The `/api/users/:userId/context` endpoint includes farmer profile data in the AI context
2. The ChatQnA pipeline's `UserContextBuilder` automatically flattens it into the LLM prompt
3. The LLM receives context like:
   ```
   - district: Maseru
   - village: Ha Matala
   - farmSize: 5.0 hectares
   - ownershipType: communal
   - farmingType: subsistence
   - irrigationType: rainfed
   - crops: Maize (summer) 2.5ha, Beans (summer) 1.0ha
   - livestock: 12× Cattle (mixed), 30× Sheep (wool)
   - cooperatives: Maseru Farmers Union [member]
   ```

4. This enables personalized answers: *"For your rain-fed maize in Maseru, plant between October-November..."*

**Privacy controls:**
- Toggle is per-user, stored in their profile
- Default is OFF — user must explicitly opt in
- Exact GPS coordinates are rounded for the AI context
- Sensitive fields (email, password, exact polygon coordinates) are never sent to the LLM
- Data is never shared with other users

---

## Data Privacy & Sensitive Information

### Principle: Opt-in Only, Minimal Disclosure

The system is designed with **privacy by default**. No farmer data is shared with the AI advisory unless the farmer explicitly enables the "Personalized Advisory" toggle.

### What IS shared with the AI (when opted in)

Only non-sensitive agricultural context needed for personalized advice:

| Data | Example | Purpose |
|------|---------|---------|
| District / Village | Maseru, Ha Matala | Regional advisory relevance |
| Farm coordinates (approx.) | -29.32, 27.48 | Weather correlation |
| Number of plots | 3 | Scale context |
| Farm size + unit | 5.0 hectares | Scale context |
| Ownership type | Communal | Tenure-relevant advice |
| Farming type | Subsistence | Appropriate recommendations |
| Irrigation type | Rain-fed | Water management advice |
| Crop names, seasons, areas | Maize (summer) 2.5ha | Crop-specific guidance |
| Livestock types, counts, purposes | 12× Cattle (mixed) | Livestock management |
| Cooperative memberships | Maseru Farmers Union [member] | Group services routing |

### What is NEVER shared with the AI

The following sensitive data is excluded from the AI context at the server level, regardless of the toggle setting:

| Excluded Data | Reason |
|---------------|--------|
| Email address | Personal identifiable information (PII) |
| Password / encPassword / salt | Authentication credentials |
| Access tokens / refresh tokens | Security credentials |
| Exact polygon coordinates | Precise land boundaries are sensitive |
| Phone number | PII |
| Date of birth (raw) | Converted to age only if general profile shared |
| IP address | PII |
| SSN / national ID numbers | PII |
| ArangoDB internal keys (_key, _rev, _id) | System internals |
| Bank accounts / financial info | Financial PII |
| Other users' data | Strict user isolation |

### How it works (server-side enforcement)

1. **Privacy check is server-side**: The `/api/users/:userId/context` endpoint checks `farmerProfile.shareWithAI === true` before including any farm data. This cannot be bypassed from the frontend or by modifying client requests.

2. **Sensitive field stripping**: The ChatQnA service's `UserContextBuilder._sanitize_data()` method removes fields matching `SENSITIVE_KEYS` (configurable via environment variable) before building the prompt — this is a second layer of defense even if new fields are accidentally added.

3. **No polygon coordinates sent**: Only the center point (farm location) is shared for weather relevance. The detailed polygon boundaries (plot shapes) are never included in the AI context.

4. **Data isolation**: Each user's farmer profile is only accessible via their own authenticated JWT. The AI context endpoint requires a valid service token and only returns data for the requested user ID.

5. **No data persistence in the AI**: The farmer context is injected per-request into the LLM prompt. It is not stored in any RAG knowledge base, vector index, or training dataset. The LLM has no memory between sessions.

### Database

- **Collection:** `users` (existing ArangoDB collection)
- **Schema validation level:** `none` (flexible document model — no migration needed)
- **No new collections or indexes required**

---

## API Reference

### GET `/api/users/farmer-profile`

Returns the authenticated user's farmer profile.

**Headers:** `Authorization: Bearer <jwt>`

**Response 200:**
```json
{
  "farmerProfile": { ... }
}
```

**Response 404:** No farmer profile exists yet (first-time user).

---

### PUT `/api/users/farmer-profile`

Creates or updates the authenticated user's farmer profile.

**Headers:** `Authorization: Bearer <jwt>`, `Content-Type: application/json`

**Request Body:** (all fields optional)
```json
{
  "farmLocation": {
    "center": { "lat": -29.31, "lng": 28.48 },
    "plots": [...],
    "district": "Maseru",
    "village": "Ha Matala"
  },
  "farmDetails": { ... },
  "crops": [...],
  "livestock": [...],
  "cooperatives": [...]
}
```

**Response 200:**
```json
{ "success": true, "message": "Farmer profile saved successfully" }
```

**Response 400:** Invalid coordinates.  
**Response 401:** Unauthorized.

---

## Deployment

No changes to `docker-compose-t4.yaml` or environment variables are needed. The feature is included in the existing `frontend` and `backend` service builds.

```bash
# Rebuild both services to include the feature
docker compose -f docker-compose-t4.yaml up -d --build frontend backend
```

---

## Future Enhancements

- **Personalized advisory:** ~~Use crop/livestock profiles to filter RAG results~~ ✅ Implemented — farmer profile injected into LLM prompt when `shareWithAI` is enabled
- **Weather alerts by location:** Use farm center coordinates for location-specific weather warnings
- **Extension service routing:** Match farmer cooperatives with government extension officers
- **Satellite imagery overlay:** Add NDVI/vegetation layer on the map for crop health monitoring
- **Offline map tiles:** Pre-cache Lesotho region tiles for low-connectivity areas
- **Plot history:** Track seasonal changes (what was planted where, yields)
- **Admin view:** Aggregate farmer data for district-level planning dashboards

---

## Related Documentation

- [Lesotho Deployment Summary](Lesotho-Deployment-Optimizations-Summary.md)
- [Weather RAG Integration Plan](weather-rag-integration-plan.md)
- [User Roles](users.md)
- [Backend Routes README](../components/gov-chat-backend/routes/README.md)
