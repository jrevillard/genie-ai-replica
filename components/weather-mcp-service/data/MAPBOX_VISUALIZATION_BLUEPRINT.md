# Mapbox Visualization — System Analysis & Implementation Blueprint

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Mapbox Feature Breakdown](#2-mapbox-feature-breakdown)
3. [Full Data Flow](#3-full-data-flow-backend--frontend--mapbox)
4. [Minimal Implementation Plan](#4-minimal-implementation-plan)
5. [Suggested File Structure](#5-suggested-file-structure-reusable-components)
6. [Integration Plan for a New Chatbot Application](#6-integration-plan-for-a-new-chatbot-application)

---

## 1. System Overview

The geospatial pipeline is a **chatbot-to-map bridge**. A user sends a natural-language query in a chat panel. The backend classifies intent, calls a Python MCP server for geospatial data, and pushes the result over WebSocket to the browser. The browser dispatches Redux actions that cause a Mapbox GL map (rendered in a sibling component) to update with new layers.

**Five actors:**

| Actor | Role |
|---|---|
| Browser chat panel (`research-chatbot.jsx`) | Sends query, receives WS messages, dispatches Redux |
| Redux store (`explore` slice) | Shared state bus between chat panel and map |
| Mapbox map (`explore-map/component.jsx`) | Reads `geojsonLayers` + `bounds` from store, renders layers |
| Node.js backend (`skillsFirstChatBotFirestore.ts`) | Intent routing, MCP orchestration, WS push |
| Python MCP server (`mcp-service/server.py`) | Geospatial compute — returns GeoJSON over stdio |

---

## 2. Mapbox Feature Breakdown

### 2.1 How the map component is wired

`explore-map/index.js` connects the component to Redux via `react-redux connect`:

```
state.explore.map          →  spread onto props (includes viewport, bounds, geojsonLayers)
state.explore.sidebar      →  spread onto props
exploreMapGetUpdatedLayers →  activeLayers (selector — existing dataset layers)
actions                    →  all dispatch functions bound as props
```

The component merges three layer sources into one `displayedLayers` array:

```js
useEffect(() => {
  setDisplayedLayers([
    ...prevLayers.filter(isAreaOfInterest),  // AOI boundary
    ...activeLayers,                          // existing dataset layers
    ...(geojsonLayers || []),                 // ← MCP / chatbot layers live here
  ]);
}, [activeLayers, aoi, geojsonLayers]);
```

`displayedLayers` is fed to `<LayerManager map={_map} layers={displayedLayers} />` (vizzuality layer manager), which translates the `layerConfig.render.layers` array into Mapbox GL `addLayer` calls.

### 2.2 Redux state shape (map slice)

```js
// initial-state.js
map: {
  geojsonLayers: [],    // array of layer spec objects pushed by chatbot
  bounds: {},           // { bbox: [w,s,e,n], options: { padding } }
  viewport: { ... },
  // ...other map state
}
```

Two actions manage chatbot layers:

```js
addGeojsonLayer(layerSpec)     // push to geojsonLayers[]
removeGeojsonLayer(layerId)    // filter by id
setBounds({ bbox, options })   // fly map to bounding box
```

### 2.3 Layer spec format

Every layer dispatched from the chatbot follows this shape:

```js
{
  id: 'geocatmin-concessions-1715000000000',   // unique, timestamped
  isGeojsonUpload: true,
  name: 'Concesiones mineras — Caravelí',
  layerConfig: {
    type: 'geojson',
    source: { type: 'geojson', data: geojson },   // full GeoJSON inline
    render: {
      layers: [
        { type: 'fill',   source: id, paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.45 } },
        { type: 'line',   source: id, paint: { 'line-color': '#16a34a', 'line-width': 1 } },
        // optional: 'circle' for pins, 'symbol' for labels
      ],
    },
  },
}
```

The layer manager reads `layerConfig.render.layers` and names each sub-layer `${parentId}-${type}-${index}` unless a sub-layer provides its own `id`.

### 2.4 Hover tooltip

The map's `onHover` callback receives `{ features, point, lngLat }`. Interactive layer IDs are computed dynamically from `geojsonLayers`:

```js
const mcpInteractiveLayerIds = useMemo(() =>
  geojsonLayers
    .filter(l => l.id.startsWith('geocatmin-concessions-') || l.id.startsWith('geo-pins-'))
    .flatMap((l) =>
      l.layerConfig.render.layers.map((sl, i) => sl.id || `${l.id}-${sl.type}-${i}`)
    ),
  [geojsonLayers]
);
```

These IDs are passed to `<Map interactiveLayerIds={...}>` so Mapbox fires hover events. The callback stores `{ x, y, type, properties, coords }` in `geocatminTooltip` state; a floating `div` positioned at `(x, y)` renders it.

### 2.5 Map snapshot

After dispatching a new layer the chatbot fires a browser custom event:

```js
window.dispatchEvent(new CustomEvent('polisense:capture_map'));
```

The map component listens for this event, waits for the map to reach `idle`, then calls `map.getCanvas().toDataURL()` and fires `polisense:map_captured` with `{ detail: { dataUrl } }`. The chatbot component catches that event and replaces the loading `map_snapshot` message in the conversation with the real JPEG thumbnail.

---

## 3. Full Data Flow (Backend → Frontend → Mapbox)

```
User types: "concesiones cerca de Caravelí"
      │
      ▼
research-chatbot.jsx
  researchAPI.sendMessage(userMessage)
      │  HTTP POST  →  Node.js backend
      │
      ▼
skillsFirstChatBotFirestore.ts — skillsFirstConversation()
  1. DRAW_POLYGON_TRIGGER regex?  → handleDrawPolygonFromDocument()
  2. OVERLAP_TRIGGER regex?       → handleOverlapAnalysis()
  3. PsRagRouter LLM call         → intent = "geospatial"
  4. handleGeospatialQuery()
       ├─ GeoMCPClient.connect()      ← spawns python3 server.py (stdio)
       ├─ listToolsForClaude()        ← MCP tools/list
       ├─ gpt-4o-mini selects tool    ← tools/call to MCP server
       ├─ Python returns GeoJSON
       └─ wsClientSocket.send({
            type: 'map_concessions',
            data: { geojson, buffer, place, count, radiusKm }
          })
      │
      │  WebSocket message
      ▼
research-chatbot.jsx — handleWebSocketMessage()
  case 'map_concessions':
    dispatch(addGeojsonLayer(layerSpec))   ← push to Redux
    dispatch(addGeojsonLayer(bufferSpec))  ← optional buffer ring
    dispatch(setBounds({ bbox, padding })) ← fly the map
    setMessages([...prev, { messageType: 'map_snapshot', loading: true }])
    window.dispatchEvent('polisense:capture_map')
      │
      │  Redux state update
      ▼
explore-map/component.jsx
  useEffect merges geojsonLayers into displayedLayers
  <LayerManager layers={displayedLayers} />
    Mapbox GL: addSource + addLayer per render.layers entry
  Map flies to setBounds bbox
  'polisense:capture_map' event → map.once('idle', () => getCanvas().toDataURL())
  window.dispatchEvent('polisense:map_captured', { dataUrl })
      │
      ▼
research-chatbot.jsx — 'polisense:map_captured' listener
  replaces loading map_snapshot message with real thumbnail
```

---

## 4. Minimal Implementation Plan

This is the smallest set of pieces needed to reproduce the feature from scratch.

### 4.1 Component inventory

| # | File | Responsibility |
|---|---|---|
| 1 | `store/mapSlice.js` | Redux slice — `geojsonLayers[]`, `bounds`, reducers |
| 2 | `MapView.jsx` | Mapbox map, reads store, renders layers, hover tooltip |
| 3 | `ChatPanel.jsx` | WebSocket connection, handles `map_concessions` message |
| 4 | `ws.js` | Thin WebSocket manager — connect, send, onMessage |
| 5 | `backend/chatbot.ts` | Intent check, MCP client, `ws.send(map_concessions)` |
| 6 | `backend/mcp-service/server.py` | Python — GeoJSON spatial query (unchanged) |

### 4.2 Redux slice (minimal)

```js
// store/mapSlice.js
import { createSlice } from '@reduxjs/toolkit';

const mapSlice = createSlice({
  name: 'map',
  initialState: { geojsonLayers: [], bounds: null },
  reducers: {
    addGeojsonLayer: (state, { payload }) => {
      state.geojsonLayers.push(payload);
    },
    removeGeojsonLayer: (state, { payload }) => {
      state.geojsonLayers = state.geojsonLayers.filter(l => l.id !== payload);
    },
    setBounds: (state, { payload }) => {
      state.bounds = payload;
    },
  },
});

export const { addGeojsonLayer, removeGeojsonLayer, setBounds } = mapSlice.actions;
export default mapSlice.reducer;
```

### 4.3 MapView (minimal)

```jsx
// MapView.jsx
import ReactMapGL from 'react-map-gl';
import { useSelector } from 'react-redux';
import { useEffect, useRef, useState } from 'react';

export default function MapView() {
  const { geojsonLayers, bounds } = useSelector(s => s.map);
  const mapRef = useRef(null);
  const [viewport, setViewport] = useState({ longitude: -75, latitude: -10, zoom: 5 });

  // Fly to bounds when they change
  useEffect(() => {
    if (!bounds || !mapRef.current) return;
    mapRef.current.fitBounds(bounds.bbox, bounds.options);
  }, [bounds]);

  // Add/remove Mapbox sources and layers when geojsonLayers changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Sync geojsonLayers to map.addSource/addLayer — see layerSync.js
  }, [geojsonLayers]);

  return (
    <ReactMapGL
      ref={mapRef}
      {...viewport}
      onMove={e => setViewport(e.viewState)}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
    />
  );
}
```

**Critical pattern:** `geojsonLayers` is the single source of truth. `MapView` reacts to it — it never mutates it.

### 4.4 Layer rendering logic (what LayerManager does, plainly)

For each layer spec in `geojsonLayers`:

```
1. map.addSource(layer.id, layer.layerConfig.source)
2. for each sub-layer in layer.layerConfig.render.layers:
     map.addLayer({
       id: `${layer.id}-${type}-${i}`,
       source: layer.id,
       ...sub-layer
     })
3. On removal:
     map.removeLayer(sub-layer ids)
     map.removeSource(layer.id)
```

The vizzuality `LayerManager` does this reconciliation automatically. For a minimal rebuild, implement this in a `useEffect` that diffs the previous and current `geojsonLayers` arrays.

### 4.5 WebSocket message handler (minimal, chatbot side)

```js
// Inside ChatPanel.jsx handleWebSocketMessage
case 'map_concessions': {
  const { geojson, buffer, place } = message.data;
  if (!geojson?.features?.length) break;

  const layerId = `geocatmin-${Date.now()}`;
  dispatch(addGeojsonLayer({
    id: layerId,
    layerConfig: {
      type: 'geojson',
      source: { type: 'geojson', data: geojson },
      render: {
        layers: [
          { type: 'fill', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.45 } },
          { type: 'line', paint: { 'line-color': '#16a34a', 'line-width': 1 } },
        ],
      },
    },
  }));

  const [w, s, e, n] = computeBbox(geojson);
  dispatch(setBounds({ bbox: [w, s, e, n], options: { padding: 60 } }));
  break;
}
```

`computeBbox` iterates all coordinates in the GeoJSON and returns `[minLng, minLat, maxLng, maxLat]`.

### 4.6 Backend — minimum to emit `map_concessions`

```ts
const result = await geoClient.callTool('query_concessions', { place, radius_km });
if (result?.ok && wsClientSocket) {
  wsClientSocket.send(JSON.stringify({
    type: 'map_concessions',
    data: {
      geojson: { type: 'FeatureCollection', features: result.features },
      buffer: result.buffer,
      place: resolvedPlace,
      count: result.features.length,
      radiusKm: radius,
    },
  }));
}
```

### 4.7 Mapbox initialization checklist

| Requirement | Detail |
|---|---|
| Token | `MAPBOX_ACCESS_TOKEN` env var exposed to frontend |
| Initial viewport | lat/lon centered on target region, zoom ~5 |
| `interactiveLayerIds` | Must include all sub-layer IDs of `geocatmin-*` layers — required for hover events to fire |
| Bounds fly | Use `map.fitBounds([w,s,e,n], { padding })` — not `setViewport` |
| Layer order | Add GeoJSON layers after the base style is loaded (`map.on('load', ...)`) |

---

## 5. Suggested File Structure (Reusable Components)

```
src/
├── store/
│   └── mapSlice.js              ← geojsonLayers[], bounds, 3 reducers
│
├── services/
│   └── ws.js                    ← WebSocket manager (connect, send, onMessage, offMessage)
│
├── components/
│   ├── MapView/
│   │   ├── index.jsx            ← reads geojsonLayers + bounds from store, renders map
│   │   ├── layerSync.js         ← useEffect: diffs geojsonLayers → map.addSource/addLayer
│   │   └── Tooltip.jsx          ← hover tooltip component (pure presentation)
│   │
│   └── ChatPanel/
│       ├── index.jsx            ← message list, input, WS lifecycle
│       ├── useWebSocket.js      ← hook: connect, send, teardown
│       └── mapMessageHandler.js ← handles map_concessions → dispatch
```

**Reusable without change:** `mapSlice.js`, `ws.js`, `layerSync.js`, `Tooltip.jsx`, `mapMessageHandler.js`

**App-specific:** ChatPanel UI, WebSocket URL, MapView layout/controls

---

## 6. Integration Plan for a New Chatbot Application

### 6.1 "Chat → Map mode" trigger

The goal: default to a standard chat background; switch to a full Mapbox view when the response is location-related.

```
User sends message
      │
      ├─ Backend detects geospatial intent
      │   └─ sends map_concessions WS message
      │
ChatPanel receives map_concessions
      │
      ├─ dispatch(addGeojsonLayer(...))   ← map data arrives
      ├─ dispatch(setBounds(...))         ← map flies
      └─ setMapMode(true)                 ← local state toggle
            │
            ▼
      <AppShell mapMode={mapMode}>
        {mapMode
          ? <MapView />            ← full-screen Mapbox
          : <DefaultBackground />  ← standard chat UI
        }
        <ChatPanel />              ← always visible (panel overlay)
      </AppShell>
```

`mapMode` is a local state boolean in `AppShell`. It flips to `true` when any `map_concessions` message arrives and can flip back to `false` with a close/reset button.

### 6.2 Module wiring

```
AppShell.jsx
  ├─ state: mapMode (bool)
  ├─ renders: <MapView /> or <DefaultBackground /> based on mapMode
  └─ renders: <ChatPanel onMapMessage={() => setMapMode(true)} />

ChatPanel.jsx
  ├─ uses: useWebSocket(WS_URL)
  ├─ on map_concessions: dispatch to store + call onMapMessage()
  └─ renders: message list + input

MapView.jsx
  ├─ reads: useSelector(s => s.map.geojsonLayers)
  ├─ reads: useSelector(s => s.map.bounds)
  └─ renders: ReactMapGL + layerSync effect + Tooltip
```

### 6.3 Modules to copy verbatim

| Module | Copy from | Notes |
|---|---|---|
| `mapSlice.js` | `layout/explore/reducers.js` — addGeojsonLayer / removeGeojsonLayer / setBounds cases | Extract into standalone slice |
| `computeGeojsonBbox` | `research-chatbot.jsx:705` | Pure function, no deps |
| `mapMessageHandler.js` | `research-chatbot.jsx:1641–1905` | Extract the `case 'map_concessions'` block |
| `mcp-service/` | Entire directory | Python server is stateless and self-contained |
| `mcpGeoClient.ts` | `backend/src/chatbot/mcpGeoClient.ts` | No changes needed |

### 6.4 Minimal wiring steps

1. **Add Redux store** with `mapSlice` and a provider wrapping the app.
2. **Install** `react-map-gl`, `mapbox-gl`, `@reduxjs/toolkit`.
3. **Create `MapView`** — reads `geojsonLayers` and `bounds` from store, syncs with `layerSync` effect.
4. **Create `ws.js`** — singleton WebSocket manager (copy the pattern from `services/research-api.js` lines 56–160).
5. **In `ChatPanel`** — on `map_concessions` message, call `mapMessageHandler(message, dispatch)` and set `mapMode = true`.
6. **In `AppShell`** — toggle `mapMode` state; conditionally render `<MapView />` vs default background.
7. **Backend** — wire `handleGeospatialQuery` to emit `map_concessions` over the WebSocket socket reference for this client.

### 6.5 Data flow diagram (new app)

```
Browser
┌─────────────────────────────────────────────────────────┐
│  AppShell                                               │
│                                                         │
│  ┌──────────────────┐  mapMode=false  ┌──────────────┐ │
│  │  DefaultBg       │ ◄────────────── │  ChatPanel   │ │
│  └──────────────────┘                 │              │ │
│                       mapMode=true    │  WS msgs     │ │
│  ┌──────────────────┐ ◄────────────── │  dispatch    │ │
│  │  MapView         │                 └──────────────┘ │
│  │  (Mapbox GL)     │                        ▲          │
│  └──────────────────┘                        │          │
│          ▲                             WebSocket        │
│          │                                   │          │
│    Redux store                               │          │
│    geojsonLayers[]                           │          │
│    bounds                                    │          │
└─────────────────────────────────────────────────────────┘
                                               │
                                        Node.js backend
                                        ┌──────────────────┐
                                        │ chatbot.ts       │
                                        │ intent router    │
                                        │ GeoMCPClient     │
                                        └────────┬─────────┘
                                                 │ stdio
                                        ┌────────▼─────────┐
                                        │ server.py (MCP)  │
                                        │ Shapely spatial  │
                                        │ → GeoJSON        │
                                        └──────────────────┘
```

---

**Key takeaway:** The feature is cleanly separable. The backend-to-frontend contract is a single WebSocket message type (`map_concessions`) with a GeoJSON payload. Everything else — the Redux slice, the layer rendering, the hover tooltip, the bbox fly — is frontend plumbing that can be extracted into ~5 files and dropped into any React app.
