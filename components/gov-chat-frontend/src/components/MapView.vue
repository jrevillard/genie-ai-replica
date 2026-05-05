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
  },
  emits: ['back'],

  data() {
    return { map: null };
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
