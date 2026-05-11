# Geo Inference Worker — Technical Reference

The `geo-inference-worker` is a self-hosted geospatial AI service that performs two tasks:

1. **Field boundary delineation** — given a lat/lon, downloads Sentinel-2 satellite imagery from Google Earth Engine and segments agricultural field polygons using SAM (Segment Anything Model).
2. **Flood detection** — given a lat/lon, downloads a recent Sentinel-2 composite and runs Prithvi-EO-2.0, IBM/NASA's foundation model for Earth Observation, to produce a flood-extent map.

Both tasks return a GeoJSON FeatureCollection which is rendered as a Mapbox overlay in the browser.

---

## Position in the Stack

```
Browser (HTTPS)
     │
     ▼
┌─────────────────────┐
│  nginx (port 443)   │  SSL termination, proxy_read_timeout 660s
│  nginx/1.29.7       │
└──────────┬──────────┘
           │ /api/  →  Kong
           ▼
┌─────────────────────┐
│  Kong API Gateway   │  JWT auth, rate limiting, read_timeout 660s
│  (port 8000)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  gov-chat-backend (Node.js/Express) │  query-service.js — routes query
│  (port 3000, internal)              │  WEATHER_HARD tier matches keywords
└──────────┬──────────────────────────┘
           │ POST /query  (11-min axios timeout)
           ▼
┌─────────────────────────────────────┐
│  weather-mcp-standalone (FastAPI)   │  keyword regex → dispatches to
│  (port 8080, internal)              │  geo-inference-worker or met APIs
└──────────┬──────────────────────────┘
           │ POST /delineate or /flood-segment  (10-min requests timeout)
           ▼
┌──────────────────────────────────────────────────┐
│  geo-inference-worker (FastAPI, port 8001)        │
│  GPU: nvidia runtime, CUDA 12.1                   │
│                                                   │
│  ┌────────────────────┐  ┌─────────────────────┐  │
│  │   agri_engine/     │  │   flood_engine/     │  │
│  │   processor.py     │  │   sentinel_gee.py   │  │
│  │   utils.py         │  │   prithvi_inference │  │
│  └────────────────────┘  │   vectorize.py      │  │
│                           └─────────────────────┘  │
└──────────────────────────────────────────────────┘
           │ (both pipelines call Google Earth Engine)
           ▼
    Google Earth Engine API
    Sentinel-2 L2A imagery (COPERNICUS/S2_SR_HARMONIZED)
```

### Docker Compose Service Definition

```yaml
# docker-compose.yaml
geo-inference-worker:
  build:
    context: ./components/geo-inference-worker
    dockerfile: Dockerfile
  container_name: geo-inference-worker
  runtime: nvidia                         # GPU passthrough
  volumes:
    - ./secrets:/app/secrets:ro           # GEE service-account JSON (read-only)
    - geo_inference_models:/app/models    # SAM + Prithvi model cache (~3.8 GB)
  environment:
    - GEE_PROJECT_ID=${GEE_PROJECT_ID:-mewa-493916}
    - GPU_INFERENCE=true
    - NVIDIA_VISIBLE_DEVICES=all
    - SAM_CHECKPOINT=/app/models/sam_vit_h_4b8939.pth
    - HF_HOME=/app/models/huggingface     # Prithvi model cached here
  networks:
    - genieai_network
  restart: unless-stopped
  # No exposed ports — internal to genieai_network only
```

`weather-mcp-standalone` depends on and discovers it via:
```
GEO_INFERENCE_URL=http://geo-inference-worker:8001
```

---

## HTTP API

```
GET  /health            → {"status": "healthy"}
POST /delineate         → field boundaries GeoJSON
POST /flood-segment     → flood-extent GeoJSON + statistics
```

### Request / Response shapes

```python
# POST /delineate
{ "latitude": 23.5, "longitude": 90.3 }

# Response
{
  "field_count": 38,
  "source": "gee+sam",           # or "gee+delineate-anything"
  "fields_geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [[...]]},
        "properties": {"value": 255}
      },
      ...  # one feature per field boundary
    ]
  }
}

# POST /flood-segment
{ "latitude": 23.5, "longitude": 90.3, "lookback_days": 30 }

# Response
{
  "flood_geojson": { "type": "FeatureCollection", "features": [...] },
  "flood_fraction": 0.142,
  "flood_pixel_count": 4820,
  "valid_pixel_count": 33920
}
```

All coordinates are **EPSG:4326 (WGS84)** — [longitude, latitude] order, ready for Mapbox.

---

## Pipeline 1 — Field Boundary Delineation

### Trigger

The `weather-mcp-standalone` `/query` endpoint detects delineation intent via:

```python
# weather-mcp-service/main.py
_DELINEATION_KEYWORDS = re.compile(
    r'delineat|field.boundar|farm.boundar|parcel.map', re.I
)
_LAT_LON_RE = re.compile(r'lat(?:itude)?\s+([\-\d.]+).*?lon(?:gitude)?\s+([\-\d.]+)', re.I)
```

If matched, it extracts coordinates and calls:

```python
resp = requests.post(
    f"{_GEO_INFERENCE_URL}/delineate",
    json={"latitude": lat, "longitude": lon},
    timeout=600,    # 10-minute synchronous block
)
```

### Step-by-step pipeline

```
POST /delineate
    │
    ▼
AgriProcessor.process_field(lat, lon)
    │
    ├─── 1. Authenticate GEE (service account JSON)
    │         ee.ServiceAccountCredentials + ee.Initialize()
    │
    ├─── 2. Try: agribound.delineate(engine="delineate-anything")
    │         Uses FTW (Field-to-World) neural network
    │         Writes /tmp/field_boundaries.geojson
    │         → If success AND file non-empty → return (source="gee+delineate-anything")
    │
    └─── 3. Fallback: GEE + SAM pipeline
              │
              ├─ Download Sentinel-2 RGB from GEE
              │     ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
              │     .filterDate("2023-01-01", "2025-12-31")
              │     .filter(lt("CLOUDY_PIXEL_PERCENTAGE", 20))
              │     .select(["B4","B3","B2"]).median() × 0.0001
              │     geemap.download_ee_image(scale=10m, crs="EPSG:4326")
              │     → s2_rgb.tif  (float32, 3 bands, ~447×446 px)
              │
              ├─ Preprocess raster → uint8 RGB
              │     Per-band percentile stretch (p2–p98)
              │     Replace non-finite with 0
              │     → s2_uint8.tif
              │
              ├─ SAM auto-segmentation (SamGeo vit_h)
              │     sam.generate(batch=True, foreground=True, erosion_kernel=(3,3))
              │     → sam_mask.tif  (uint8, one mask-ID per segment)
              │
              ├─ Vectorize mask → GeoJSON
              │     sam.tiff_to_vector(sam_mask.tif, boundaries.geojson)
              │     gdf = gpd.read_file(boundaries.geojson)
              │
              ├─ Filter noise: geometry.area > 1e-8 (sq-degrees)
              │
              └─ Serialize: json.loads(gdf.to_json())
                    → fields_geojson (FeatureCollection, EPSG:4326)
```

### Key code — GEE download

```python
# agri_engine/processor.py
def _download_s2_rgb(lat: float, lon: float, out_tif: str) -> None:
    region = ee.Geometry.BBox(
        lon - 0.02, lat - 0.02,   # ~2.2 km half-width AOI
        lon + 0.02, lat + 0.02,
    )
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate("2023-01-01", "2025-12-31")
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .filterBounds(region)
        .select(["B4", "B3", "B2"])     # Red, Green, Blue
        .median()
        .multiply(0.0001)               # Scale to [0, 1] reflectance
        .toFloat()
    )
    geemap.download_ee_image(s2, out_tif, region=region, scale=10, crs="EPSG:4326")
```

### Key code — SAM segmentation

```python
# agri_engine/processor.py
def _segment_with_sam(rgb_tif, sam_checkpoint, device, tmpdir):
    sam = SamGeo(
        model_type="vit_h",             # ViT-H (largest, best quality)
        checkpoint=sam_checkpoint,      # /app/models/sam_vit_h_4b8939.pth
        device=device,                  # "cuda" or "cpu"
        automatic=True,                 # SamAutomaticMaskGenerator mode
    )
    sam.generate(
        uint8_tif,
        output=mask_tif,
        batch=True,
        foreground=True,
        erosion_kernel=(3, 3),          # Remove 1-pixel boundary artefacts
        mask_multiplier=255,
    )
    sam.tiff_to_vector(mask_tif, vector_out)   # Preserves CRS from raster
    return vector_out
```

### AOI geometry

```python
# agri_engine/utils.py  — the bounding box written to /tmp/aoi.geojson
def create_aoi_file(lat, lon, buffer=0.02):
    bbox = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [lon - buffer, lat - buffer],
                    [lon + buffer, lat - buffer],
                    [lon + buffer, lat + buffer],
                    [lon - buffer, lat + buffer],
                    [lon - buffer, lat - buffer],
                ]],
            },
            "properties": {"name": "AOI"},
        }],
    }
```

A `buffer=0.02°` ≈ 2.2 km half-width, giving a ~4.4 km × 4.4 km analysis window.

---

## Pipeline 2 — Satellite Flood Detection

### Trigger

```python
# weather-mcp-service/main.py
_FLOOD_DETECTION_KEYWORDS = re.compile(
    r'flood.detect|flood.map|flood.extent|inundation|prithvi|satellite.flood', re.I
)
```

Accepts a district name (looked up in a coordinate table) or explicit lat/lon.

### Step-by-step pipeline

```
POST /flood-segment
    │
    ▼
_init_gee_for_flood()      # Same service-account auth as agri pipeline
    │
    ▼
download_sentinel2(lat, lon, s2_tif, lookback_days=30)
    │  ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    │  6 bands: B2, B3, B4, B8A, B11, B12  (Prithvi's expected input)
    │  SCL-based cloud/shadow masking
    │  scale=20m, crs=EPSG:4326
    │  → s2_input.tif  (float32, 6 bands, values ×10000)
    │
    ▼
run_flood_inference(s2_tif, mask_tif, device="cpu")
    │  Download Prithvi-EO-2.0-300M-TL-Sen1Floods11 from HuggingFace
    │  (first call only; ~1.3 GB, cached in /app/models/huggingface)
    │  Normalize: divide by 10000 if max > 2.0
    │  Pad to 512-px tile multiples
    │  Tiled inference with LightningInferenceModel (terratorch)
    │  argmax → class: 0=land, 1=flood, 255=nodata
    │  → flood_mask.tif  (uint8)
    │
    ▼
vectorize_flood_mask(mask_tif)
    │  rasterio.features.shapes() on the binary flood layer
    │  Filter to class==1 polygons only
    │  Attach properties: {"class": "flood"}
    │  Compute statistics: flood_fraction, pixel counts
    │  → GeoJSON FeatureCollection (EPSG:4326)
```

### Key code — Prithvi-EO inference

```python
# flood_engine/prithvi_inference.py
def run_flood_inference(input_tif, output_tif, device="cpu"):
    config_path, ckpt_path = _download_model()   # HuggingFace hub
    dev = _choose_device(device)

    image, nodata_mask, profile = _load_geotiff(input_tif)
    # image shape: (1, 6, 1, H, W) — Prithvi temporal dim = 1

    pred = _run_model(config_path, ckpt_path, image, dev)
    # pred: uint8 array — 0=land, 1=flood, 255=nodata

    pred[nodata_mask] = 255
    with rasterio.open(output_tif, "w", **profile) as dst:
        dst.write(pred, 1)
```

```python
# Tiled inference (512×512 patches to fit GPU/CPU memory)
def _run_model(config_path, ckpt_path, image, device, tile_size=512):
    lm    = LightningInferenceModel.from_config(config_path, ckpt_path)
    model = lm.model.to(device).eval()

    image = rearrange(image, "b c t h w -> b h w (c t)")
    # Pad, unfold into tiles, run, reassemble
    ...
    preds = torch.cat(preds, dim=0).argmax(dim=1)   # land / flood class
    return preds[:H, :W].numpy().astype("uint8")
```

### Flood vectorization

```python
# flood_engine/vectorize.py
def vectorize_flood_mask(mask_tif):
    with rasterio.open(mask_tif) as src:
        data, transform = src.read(1), src.transform

    flood_binary = (data == 1).astype(np.uint8)
    features = [
        {"type": "Feature", "geometry": geom, "properties": {"class": "flood"}}
        for geom, value in shapes(flood_binary, transform=transform)
        if value == 1
    ]
    return {
        "type": "FeatureCollection",
        "features": features,
        "flood_fraction": round(flood_px / valid_px, 4),
        "flood_pixel_count": flood_px,
        "valid_pixel_count": valid_px,
    }
```

---

## Query Routing in query-service.js

Before the geo-inference-worker is ever called, `query-service.js` must route the query to the weather/geo tier. Two mechanisms work together:

```javascript
// components/gov-chat-backend/services/query-service.js

// Tier 1 — hard-coded keyword match (checked before any LLM call)
const WEATHER_HARD = [
  'weather', 'rain', 'temperature', 'forecast', 'humidity',
  'delineat', 'field boundar', 'farm boundar',   // ← geo keywords
  'flood', 'inundation', 'prithvi',
  // ...
];

// GEO queries get an extended axios timeout
const GEO_KEYWORDS = [
  'delineat', 'field boundar', 'farm boundar',
  'flood detection', 'flood map', 'flood extent',
  'satellite flood', 'inundation', 'prithvi'
];
const wxTimeout = GEO_KEYWORDS.some(kw => query.includes(kw))
  ? 660000   // 11 minutes — pipeline can take 70–157 s
  : 30000;   // 30 seconds — normal weather query

const wResp = await axios.post(`${weatherMcpUrl}/query`, { query }, { timeout: wxTimeout });

// Store field_delineation / flood_analysis in opeaMetadata
opeaMetadata = {
  source_documents: [],
  confidence_score: 1.0,
  weather: true,
  field_delineation: wResp.data.field_delineation ?? null,
  flood_analysis:    wResp.data.flood_analysis    ?? null,
  // ...
};
```

---

## Timeout Chain

Every layer has its own timeout. All must be ≥ worst-case pipeline time (~160 s):

```
nginx            proxy_read_timeout  660s   ← fixed: nginx/conf/default.conf
Kong             read_timeout        660s   ← fixed: Kong Admin API PATCH
backend axios    timeout             660s   ← wxTimeout for GEO_KEYWORDS
weather-mcp      requests.post       600s   ← to geo-inference-worker
geo-inference    GEE download        ~15–128s (variable, network-dependent)
                 SAM inference       ~14s (GPU) / ~60s (CPU)
```

---

## Mapbox Integration

### Data flow from backend to browser

```
geo-inference-worker
  └─ fields_geojson: FeatureCollection (EPSG:4326)
        │
        ▼  weather-mcp wraps it
  field_delineation: { field_count, fields_geojson, source }
        │
        ▼  query-service.js stores in opeaMetadata
  result.metadata.field_delineation
        │
        ▼  ChatBotComponent.vue extracts it
  geoLayers: [{ id, geojson, fillColor, lineColor, fillOpacity, label }]
  mapMode = true  →  <MapView> mounts
        │
        ▼  MapView.vue renders it
  mapboxgl.Map + addSource + addLayer
```

### ChatBotComponent.vue — building the layer

```javascript
// components/gov-chat-frontend/src/components/ChatBotComponent.vue
const fd = result.metadata.field_delineation;
if (fd?.fields_geojson?.features?.length) {
  layers.push({
    id:          'field-boundaries',
    geojson:     fd.fields_geojson,
    fillColor:   '#22c55e',    // green fill
    lineColor:   '#16a34a',
    fillOpacity: 0.4,
    label: `Field boundaries (${fd.field_count ?? fd.fields_geojson.features.length})`,
  });
}

// Compute centroid from all feature bboxes, then open the map
const bbox = this._computeGeojsonBbox({ features: allFeatures });
const centerLon = (bbox[0] + bbox[2]) / 2;
const centerLat = (bbox[1] + bbox[3]) / 2;
this.mapLocation = { lat: centerLat, lon: centerLon, name: layers.map(l => l.label).join(' · '), zoom: 12 };
this.geoLayers = layers;
this.mapMode = true;     // triggers <MapView v-if="mapMode && mapLocation">
```

### MapView.vue — rendering the GeoJSON

```javascript
// components/gov-chat-frontend/src/components/MapView.vue
mounted() {
  mapboxgl.accessToken = process.env.VUE_APP_MAPBOX_TOKEN || '';
  this.map = new mapboxgl.Map({
    container: this.$refs.mapContainer,
    style: 'mapbox://styles/mapbox/satellite-streets-v12',  // ← must be valid
    center: [this.lon, this.lat],
    zoom: this.zoom,
  });
  this.map.on('load', () => {
    this._renderGeoJsonLayers(this.geojsonLayers);
  });
},

_renderGeoJsonLayers(layers) {
  layers.forEach(({ id, geojson, fillColor, lineColor, fillOpacity }) => {
    // Strip Vue reactive proxies — required for Mapbox's structured-clone worker
    const plainGeojson = JSON.parse(JSON.stringify(geojson));

    this.map.addSource(id, { type: 'geojson', data: plainGeojson });
    this.map.addLayer({ id: `${id}-fill`, type: 'fill', source: id,
      paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity } });
    this.map.addLayer({ id: `${id}-line`, type: 'line', source: id,
      paint: { 'line-color': lineColor, 'line-width': 1.5 } });
  });

  // Fit the viewport to the union of all polygon bboxes
  const combined = bboxes.reduce((acc, b) => [
    Math.min(acc[0], b[0]), Math.min(acc[1], b[1]),
    Math.max(acc[2], b[2]), Math.max(acc[3], b[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  this.map.fitBounds([[combined[0], combined[1]], [combined[2], combined[3]]], { padding: 48 });
},
```

**Critical implementation notes:**
- `JSON.parse(JSON.stringify(geojson))` is mandatory. Without it, Vue 3's reactive `Proxy` wrapper on the object causes Mapbox's web-worker `structuredClone` to throw.
- The Mapbox style must be `satellite-streets-v12` (not `satellite-v12` — that 404s).
- The Mapbox token is baked into the bundle at Docker build time via `VUE_APP_MAPBOX_TOKEN` build-arg. Runtime env vars are not read by Vue's compiled bundle.

---

## Docker Image Layers

The Dockerfile splits dependencies into 4 cached layers to keep rebuild times short:

```dockerfile
# Layer 1 — PyTorch (CUDA 12.1 wheels, ~2 GB)
COPY requirements-torch.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cu121 -r requirements-torch.txt

# Layer 2 — Geospatial stack (GDAL, GEE, geemap, samgeo, agribound)
COPY requirements-geo.txt .
RUN pip install -r requirements-geo.txt
RUN pip install --force-reinstall opencv-python-headless  # headless for server

# Layer 3 — Prithvi inference stack (mmcv, mmsegmentation, terratorch)
# mmcv 1.7.2 needs --no-build-isolation (non-standard setup.py)
COPY requirements-inference.txt .
RUN pip install "setuptools<70" wheel && \
    pip install --no-build-isolation mmcv==1.7.2 mmsegmentation==0.30.0 && \
    pip install -r requirements-inference.txt

# Layer 4 — App (FastAPI, uvicorn, pydantic)
COPY requirements.txt .
RUN pip install -r requirements.txt
```

The service exposes **port 8001** and runs with:
```
uvicorn main:app --host 0.0.0.0 --port 8001
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `GEE_PROJECT_ID` | `mewa-493916` | Google Earth Engine project for billing/quota |
| `GPU_INFERENCE` | `false` | Set `true` to use CUDA for SAM |
| `SAM_CHECKPOINT` | `/app/models/sam_vit_h_4b8939.pth` | Path to SAM ViT-H weights (~2.5 GB) |
| `HF_HOME` | `/app/models/huggingface` | HuggingFace cache (Prithvi ~1.3 GB) |
| `PRITHVI2_MODEL_REPO` | `ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11` | HF model repo |
| `LOG_LEVEL` | `INFO` | Python logging level |
| `GEO_INFERENCE_URL` | _(set in weather-mcp)_ | `http://geo-inference-worker:8001` |

### GEE Authentication

The service expects a GEE service account JSON at `/app/secrets/credentials.json` (or `/app/secrets/service-account.json`). It is mounted read-only from `./secrets/` on the host:

```python
credentials = ee.ServiceAccountCredentials(client_email, sa_path)
ee.Initialize(credentials=credentials, project=project_id)
```

---

## Model Storage

Both AI models are large and downloaded on first use. They are stored in the `geo_inference_models` Docker named volume so they survive container restarts.

```
/app/models/
├── sam_vit_h_4b8939.pth          # SAM ViT-H (~2.5 GB), downloaded once
└── huggingface/
    └── hub/
        └── models--ibm-nasa-geospatial--Prithvi-EO-2.0-300M-TL-Sen1Floods11/
            ├── config.yaml
            └── Prithvi-EO-V2-300M-TL-Sen1Floods11.pt   # (~1.3 GB)
```

First delineation request: 5–15 minutes (SAM download + GEE).  
Subsequent requests: 1–3 minutes (GEE only, model already cached).

---

## End-to-End Request Trace

Example: *"Delineate my fields at lat 23.5 lon 90.3"*

```
00:00  User submits query in browser
00:00  nginx receives HTTPS POST /api/chat → forwards to Kong
00:00  Kong validates JWT → forwards to gov-chat-backend :3000
00:00  query-service.js: WEATHER_HARD match on "delineat"
00:00  Tier 1 routing → POST weather-mcp :8080/query (timeout=660s)
00:00  weather-mcp: _DELINEATION_KEYWORDS matched, lat/lon extracted
00:00  weather-mcp: POST geo-inference-worker :8001/delineate (timeout=600s)
00:00  geo-inference-worker: GEE auth, agribound attempt → fails (no ftw-tools)
00:05  GEE Sentinel-2 download starts (15–128s depending on GEE load)
01:25  GEE download complete → s2_rgb.tif (float32, 447×446 px)
01:25  _to_uint8_rgb: percentile stretch → s2_uint8.tif
01:25  SamGeo: auto-segmentation (vit_h, batch, ~14s on GPU)
01:39  sam.tiff_to_vector → boundaries.geojson
01:39  geopandas filter area>1e-8 → 38 valid field polygons
01:39  geo-inference-worker: return {"field_count":38,"fields_geojson":{...},"source":"gee+sam"}
01:39  weather-mcp: build response with field_delineation payload
01:39  query-service.js: store in opeaMetadata, return to frontend
01:39  ChatBotComponent: result.metadata.field_delineation extracted
01:39  geoLayers built, mapMode=true, <MapView> mounts
01:39  MapView: mapboxgl.Map init with satellite-streets-v12
01:40  Mapbox style loads → map.on('load') fires
01:40  addSource("field-boundaries", { type: "geojson", data: plainGeojson })
01:40  addLayer fill (green) + line
01:40  fitBounds to polygon extent, padding=48px
01:40  User sees 38 green field polygons on satellite imagery
```

Total time: ~99 seconds (GEE-dominated).
