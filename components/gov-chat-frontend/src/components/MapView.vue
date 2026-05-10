<template>
  <div class="map-overlay-container">
    <button class="map-back-btn" @click="$emit('back')">
      <i class="fas fa-arrow-left"></i> Back to Chat
    </button>
    <div class="map-location-label" v-if="name">{{ name }}</div>
    <div ref="mapContainer" class="map-container"></div>
  </div>
</template>

<script>
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

export default {
  name: 'MapView',
  props: {
    lat:  { type: Number, required: true },
    lon:  { type: Number, required: true },
    name: { type: String, default: '' },
    zoom: { type: Number, default: 12 },
    // Array of { id, geojson, fillColor, lineColor, fillOpacity, label }
    geojsonLayers: { type: Array, default: () => [] },
  },
  emits: ['back'],

  data() {
    return { map: null, _renderedLayerIds: [] };
  },

  mounted() {
    mapboxgl.accessToken = process.env.VUE_APP_MAPBOX_TOKEN || '';
    this.map = new mapboxgl.Map({
      container: this.$refs.mapContainer,
      style: 'mapbox://styles/mapbox/satellite-v12',
      center: [this.lon, this.lat],
      zoom: this.zoom,
    });

    this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    new mapboxgl.Marker({ color: '#ef4444' })
      .setLngLat([this.lon, this.lat])
      .setPopup(new mapboxgl.Popup().setText(this.name))
      .addTo(this.map);

    this.map.on('load', () => {
      this._renderGeoJsonLayers(this.geojsonLayers);
    });
  },

  beforeUnmount() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },

  watch: {
    lat(v) { this.map?.flyTo({ center: [this.lon, v], zoom: this.zoom }); },
    lon(v) { this.map?.flyTo({ center: [v, this.lat], zoom: this.zoom }); },
    geojsonLayers(layers) {
      if (this.map?.isStyleLoaded()) this._renderGeoJsonLayers(layers);
    },
  },

  methods: {
    _computeBbox(geojson) {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      const visit = (coords) => {
        if (typeof coords[0] === 'number') {
          if (coords[0] < minLng) minLng = coords[0];
          if (coords[0] > maxLng) maxLng = coords[0];
          if (coords[1] < minLat) minLat = coords[1];
          if (coords[1] > maxLat) maxLat = coords[1];
        } else { coords.forEach(visit); }
      };
      (geojson.features || []).forEach(f => { if (f.geometry?.coordinates) visit(f.geometry.coordinates); });
      return isFinite(minLng) ? [minLng, minLat, maxLng, maxLat] : null;
    },

    _clearRenderedLayers() {
      if (!this.map) return;
      this._renderedLayerIds.forEach(id => {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      });
      // Deduplicate source ids before removal (each source backs two layers)
      const sourceIds = [...new Set(this._renderedLayerIds.map(id => id.replace(/-fill$|-line$/, '')))];
      sourceIds.forEach(srcId => {
        if (this.map.getSource(srcId)) this.map.removeSource(srcId);
      });
      this._renderedLayerIds = [];
    },

    _renderGeoJsonLayers(layers) {
      if (!this.map || !layers?.length) return;
      this._clearRenderedLayers();

      const bboxes = [];

      layers.forEach(layer => {
        const { id, geojson, fillColor = '#3b82f6', lineColor = '#1d4ed8', fillOpacity = 0.45 } = layer;
        if (!id || !geojson) return;

        const fillId = `${id}-fill`;
        const lineId = `${id}-line`;

        if (!this.map.getSource(id)) {
          this.map.addSource(id, { type: 'geojson', data: geojson });
        }
        if (!this.map.getLayer(fillId)) {
          this.map.addLayer({ id: fillId, type: 'fill', source: id,
            paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity } });
        }
        if (!this.map.getLayer(lineId)) {
          this.map.addLayer({ id: lineId, type: 'line', source: id,
            paint: { 'line-color': lineColor, 'line-width': 1.5 } });
        }

        this._renderedLayerIds.push(fillId, lineId);

        const bbox = this._computeBbox(geojson);
        if (bbox) bboxes.push(bbox);
      });

      if (bboxes.length) {
        const combined = bboxes.reduce(
          (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]),
                       Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
          [Infinity, Infinity, -Infinity, -Infinity]
        );
        this.map.fitBounds([[combined[0], combined[1]], [combined[2], combined[3]]], { padding: 48 });
      }
    },
  },
};
</script>

<style scoped>
.map-overlay-container {
  position: fixed;
  inset: 0;
  z-index: 8000;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
}

.map-back-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  transition: background 0.15s;
}
.map-back-btn:hover { background: #f0f0f0; }

.map-location-label {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  background: rgba(0,0,0,0.7);
  color: #fff;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 0.85rem;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.map-container {
  flex: 1;
  width: 100%;
}
</style>
