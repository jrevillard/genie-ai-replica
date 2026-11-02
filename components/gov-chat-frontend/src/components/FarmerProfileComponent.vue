<!-- FarmerProfileComponent.vue - Farmer Registration & Profile with Map-based Location -->
<template>
  <div
    class="farmer-profile-modal"
    :style="dialogThemeStyles"
    :data-themed="isThemeReady"
  >
    <div class="overlay" @click="close"></div>
    <div class="modal-content">
      <div class="dialog-header">
        <h2 class="header-title" :data-themed="isThemeReady">
          {{ translate("title", "Farmer Profile") }}
        </h2>
        <div class="header-actions">
          <button class="btn-close" @click="close">
            {{ translate("actions.cancel", "Cancel") }}
          </button>
          <button class="btn-save" @click="saveProfile" :disabled="isSaving">
            {{ isSaving ? translate("actions.saving", "Saving...") : translate("actions.save", "Save") }}
          </button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>{{ translate("loading", "Loading farmer profile...") }}</p>
      </div>

      <!-- Error -->
      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="loadFarmerProfile" class="retry-btn">
          {{ translate("retry", "Retry") }}
        </button>
      </div>

      <!-- Form Content -->
      <div v-else class="form-content">

        <!-- Privacy Control -->
        <section class="form-section privacy-section">
          <div class="privacy-toggle">
            <div class="privacy-info">
              <h3 class="section-title">
                <span class="section-icon">🔒</span>
                {{ translate("sections.privacy", "Personalized Advisory") }}
              </h3>
              <p class="privacy-description">
                {{ translate("privacy.description", "When enabled, the AI assistant can use your farm details (crops, livestock, location, farm size) to give you personalized farming advice. Your data is never shared with other users.") }}
              </p>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="formData.shareWithAI" />
              <span class="toggle-slider"></span>
              <span class="toggle-label">
                {{ formData.shareWithAI ? translate("privacy.enabled", "Enabled") : translate("privacy.disabled", "Disabled") }}
              </span>
            </label>
          </div>
        </section>

        <!-- Section: Farm Location Map -->
        <section class="form-section map-section">
          <h3 class="section-title">
            <span class="section-icon">📍</span>
            {{ translate("sections.farmLocation", "Farm Location & Plots") }}
          </h3>

          <p class="section-help">
            {{ translate("help.map", "Click the map to set your farm center. Use the polygon tool to draw your plot boundaries.") }}
          </p>

          <!-- Map Controls -->
          <div class="map-controls">
            <button class="btn-gps" @click="getCurrentLocation" :disabled="isGettingLocation">
              <span v-if="isGettingLocation" class="spinner-small"></span>
              <span v-else>📡</span>
              {{ translate("actions.useGPS", "Use my GPS location") }}
            </button>
            <span v-if="formData.farmLocation.center.lat" class="coords-display">
              {{ formData.farmLocation.center.lat.toFixed(4) }}, {{ formData.farmLocation.center.lng.toFixed(4) }}
            </span>
          </div>

          <!-- Leaflet Map Container -->
          <div ref="mapContainer" class="map-container"></div>

          <!-- Plot List -->
          <div v-if="formData.farmLocation.plots.length > 0" class="plots-list">
            <h4>{{ translate("sections.plots", "Your Plots") }}</h4>
            <div
              v-for="(plot, index) in formData.farmLocation.plots"
              :key="'plot-' + index"
              class="plot-item"
            >
              <input
                v-model="plot.name"
                type="text"
                :placeholder="translate('placeholders.plotName', 'Plot name (e.g. Main field)')"
                class="plot-name-input"
              />
              <span class="plot-area">
                {{ calculatePlotArea(plot.coordinates) }}
              </span>
              <button class="btn-remove" @click="removePlot(index)" :aria-label="translate('actions.removePlot', 'Remove plot')">✕</button>
            </div>
          </div>

          <!-- Manual coordinates fallback -->
          <details class="manual-coords">
            <summary>{{ translate("actions.manualEntry", "Enter coordinates manually") }}</summary>
            <div class="manual-fields">
              <div class="field-group">
                <label>{{ translate("fields.latitude", "Latitude") }}</label>
                <input
                  v-model.number="manualLat"
                  type="number"
                  step="0.000001"
                  min="-90"
                  max="90"
                  :placeholder="translate('placeholders.latitude', '-29.310')"
                />
              </div>
              <div class="field-group">
                <label>{{ translate("fields.longitude", "Longitude") }}</label>
                <input
                  v-model.number="manualLng"
                  type="number"
                  step="0.000001"
                  min="-180"
                  max="180"
                  :placeholder="translate('placeholders.longitude', '28.480')"
                />
              </div>
              <button class="btn-apply" @click="applyManualCoords">
                {{ translate("actions.applyCoords", "Set location") }}
              </button>
            </div>
          </details>

          <!-- District / Village -->
          <div class="location-details">
            <div class="field-group">
              <label>{{ translate("fields.district", "District / Region") }}</label>
              <input
                v-model="formData.farmLocation.district"
                type="text"
                :placeholder="translate('placeholders.district', 'e.g. Maseru')"
              />
            </div>
            <div class="field-group">
              <label>{{ translate("fields.village", "Village / Community") }}</label>
              <input
                v-model="formData.farmLocation.village"
                type="text"
                :placeholder="translate('placeholders.village', 'e.g. Ha Matala')"
              />
            </div>
          </div>
        </section>

        <!-- Section: Weather for Farm Location -->
        <section class="form-section weather-section" v-if="weatherData || weatherLoading">
          <h3 class="section-title">
            <span class="section-icon">🌤️</span>
            {{ translate("sections.weather", "Weather at Your Farm") }}
          </h3>

          <div v-if="weatherLoading" class="weather-loading">
            <span class="spinner-small"></span>
            {{ translate("weather.loading", "Fetching weather...") }}
          </div>

          <div v-else-if="weatherError" class="weather-error">
            <span>⚠️</span> {{ weatherError }}
          </div>

          <div v-else-if="weatherData" class="weather-card">
            <div class="weather-current">
              <div class="weather-temp">
                <span class="temp-value">{{ weatherData.current.temperature }}°C</span>
                <span class="temp-condition">{{ weatherData.current.condition }}</span>
              </div>
              <div class="weather-details">
                <span class="weather-detail">💧 {{ weatherData.current.humidity }}%</span>
                <span class="weather-detail">💨 {{ weatherData.current.windSpeed }} km/h</span>
              </div>
              <div class="weather-location">📍 {{ weatherData.location }}</div>
            </div>

            <div v-if="weatherData.forecast && weatherData.forecast.length > 0" class="weather-forecast">
              <div
                v-for="(day, index) in weatherData.forecast.slice(0, 5)"
                :key="'forecast-' + index"
                class="forecast-day"
              >
                <span class="forecast-date">{{ formatForecastDate(day.date) }}</span>
                <span class="forecast-condition">{{ getWeatherEmoji(day.condition) }}</span>
                <span class="forecast-temps">{{ day.highTemp }}° / {{ day.lowTemp }}°</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Section: Farm Size & Ownership -->
        <section class="form-section">
          <h3 class="section-title">
            <span class="section-icon">🏡</span>
            {{ translate("sections.farmDetails", "Farm Size & Ownership") }}
          </h3>

          <div class="field-group">
            <label>{{ translate("fields.farmSize", "Total Farm Size") }}</label>
            <div class="input-with-unit">
              <input
                v-model="formData.farmDetails.size"
                type="number"
                step="0.1"
                min="0"
                :placeholder="translate('placeholders.farmSize', 'e.g. 5.0')"
              />
              <select v-model="formData.farmDetails.sizeUnit">
                <option value="hectares">{{ translate("units.hectares", "Hectares") }}</option>
                <option value="acres">{{ translate("units.acres", "Acres") }}</option>
                <option value="sqm">{{ translate("units.sqm", "Square Meters") }}</option>
              </select>
            </div>
          </div>

          <div class="field-group">
            <label>{{ translate("fields.ownershipType", "Ownership Type") }}</label>
            <select v-model="formData.farmDetails.ownershipType">
              <option value="">{{ translate("placeholders.select", "-- Select --") }}</option>
              <option value="owned">{{ translate("ownership.owned", "Owned") }}</option>
              <option value="leased">{{ translate("ownership.leased", "Leased") }}</option>
              <option value="communal">{{ translate("ownership.communal", "Communal / Tribal") }}</option>
              <option value="rented">{{ translate("ownership.rented", "Rented") }}</option>
              <option value="sharecropping">{{ translate("ownership.sharecropping", "Sharecropping") }}</option>
            </select>
          </div>

          <div class="field-group">
            <label>{{ translate("fields.farmingType", "Farming Type") }}</label>
            <select v-model="formData.farmDetails.farmingType">
              <option value="">{{ translate("placeholders.select", "-- Select --") }}</option>
              <option value="subsistence">{{ translate("farmingType.subsistence", "Subsistence") }}</option>
              <option value="commercial">{{ translate("farmingType.commercial", "Commercial") }}</option>
              <option value="mixed">{{ translate("farmingType.mixed", "Mixed") }}</option>
            </select>
          </div>

          <div class="field-group">
            <label>{{ translate("fields.irrigationType", "Irrigation") }}</label>
            <select v-model="formData.farmDetails.irrigationType">
              <option value="">{{ translate("placeholders.select", "-- Select --") }}</option>
              <option value="rainfed">{{ translate("irrigation.rainfed", "Rain-fed") }}</option>
              <option value="irrigated">{{ translate("irrigation.irrigated", "Irrigated") }}</option>
              <option value="mixed">{{ translate("irrigation.mixed", "Mixed") }}</option>
            </select>
          </div>
        </section>

        <!-- Section: Crops -->
        <section class="form-section">
          <h3 class="section-title">
            <span class="section-icon">🌾</span>
            {{ translate("sections.crops", "Crop Profiles") }}
          </h3>

          <div class="list-items">
            <div
              v-for="(crop, index) in formData.crops"
              :key="'crop-' + index"
              class="list-item"
            >
              <div class="list-item-fields">
                <input
                  v-model="crop.name"
                  type="text"
                  :placeholder="translate('placeholders.cropName', 'Crop name (e.g. Maize)')"
                  class="flex-input"
                />
                <select v-model="crop.season" class="season-select">
                  <option value="">{{ translate("placeholders.season", "Season") }}</option>
                  <option value="summer">{{ translate("seasons.summer", "Summer") }}</option>
                  <option value="winter">{{ translate("seasons.winter", "Winter") }}</option>
                  <option value="yearRound">{{ translate("seasons.yearRound", "Year-round") }}</option>
                </select>
                <input
                  v-model="crop.area"
                  type="number"
                  step="0.1"
                  min="0"
                  :placeholder="translate('placeholders.area', 'Area (ha)')"
                  class="area-input"
                />
              </div>
              <button class="btn-remove" @click="removeCrop(index)" aria-label="Remove crop">✕</button>
            </div>
          </div>
          <button class="btn-add" @click="addCrop">
            + {{ translate("actions.addCrop", "Add Crop") }}
          </button>
        </section>

        <!-- Section: Livestock -->
        <section class="form-section">
          <h3 class="section-title">
            <span class="section-icon">🐄</span>
            {{ translate("sections.livestock", "Livestock Profiles") }}
          </h3>

          <div class="list-items">
            <div
              v-for="(animal, index) in formData.livestock"
              :key="'livestock-' + index"
              class="list-item"
            >
              <div class="list-item-fields">
                <input
                  v-model="animal.type"
                  type="text"
                  :placeholder="translate('placeholders.livestockType', 'Type (e.g. Cattle)')"
                  class="flex-input"
                />
                <input
                  v-model.number="animal.count"
                  type="number"
                  min="0"
                  :placeholder="translate('placeholders.count', 'Count')"
                  class="count-input"
                />
                <select v-model="animal.purpose" class="purpose-select">
                  <option value="">{{ translate("placeholders.purpose", "Purpose") }}</option>
                  <option value="meat">{{ translate("purpose.meat", "Meat") }}</option>
                  <option value="dairy">{{ translate("purpose.dairy", "Dairy") }}</option>
                  <option value="eggs">{{ translate("purpose.eggs", "Eggs") }}</option>
                  <option value="wool">{{ translate("purpose.wool", "Wool/Fiber") }}</option>
                  <option value="draft">{{ translate("purpose.draft", "Draft/Work") }}</option>
                  <option value="breeding">{{ translate("purpose.breeding", "Breeding") }}</option>
                  <option value="mixed">{{ translate("purpose.mixed", "Mixed") }}</option>
                </select>
              </div>
              <button class="btn-remove" @click="removeLivestock(index)" aria-label="Remove livestock">✕</button>
            </div>
          </div>
          <button class="btn-add" @click="addLivestock">
            + {{ translate("actions.addLivestock", "Add Livestock") }}
          </button>
        </section>

        <!-- Section: Cooperatives / Groups -->
        <section class="form-section">
          <h3 class="section-title">
            <span class="section-icon">👥</span>
            {{ translate("sections.cooperatives", "Farmer Groups & Cooperatives") }}
          </h3>

          <div class="list-items">
            <div
              v-for="(group, index) in formData.cooperatives"
              :key="'coop-' + index"
              class="list-item"
            >
              <div class="list-item-fields">
                <input
                  v-model="group.name"
                  type="text"
                  :placeholder="translate('placeholders.groupName', 'Group / Cooperative name')"
                  class="flex-input"
                />
                <select v-model="group.role" class="role-select">
                  <option value="">{{ translate("placeholders.role", "Your role") }}</option>
                  <option value="member">{{ translate("roles.member", "Member") }}</option>
                  <option value="leader">{{ translate("roles.leader", "Leader") }}</option>
                  <option value="treasurer">{{ translate("roles.treasurer", "Treasurer") }}</option>
                  <option value="secretary">{{ translate("roles.secretary", "Secretary") }}</option>
                </select>
              </div>
              <button class="btn-remove" @click="removeCooperative(index)" aria-label="Remove group">✕</button>
            </div>
          </div>
          <button class="btn-add" @click="addCooperative">
            + {{ translate("actions.addGroup", "Add Group") }}
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<script>
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import httpService from "@/services/httpService";
import weatherService from "@/services/weatherService";
import notificationService from "@/services/notificationService";

// Fix Leaflet default marker icon path issue with webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

export default {
  name: "FarmerProfileComponent",
  data() {
    return {
      isThemeReady: false,
      isLoading: false,
      isSaving: false,
      isGettingLocation: false,
      errorMessage: null,
      map: null,
      centerMarker: null,
      drawnItems: null,
      drawControl: null,
      manualLat: null,
      manualLng: null,
      // Default center: Maseru, Lesotho
      defaultCenter: { lat: -29.3167, lng: 27.4833 },
      // Weather data
      weatherData: null,
      weatherLoading: false,
      weatherError: null,
      formData: {
        shareWithAI: false,
        farmLocation: {
          center: { lat: null, lng: null },
          plots: [],
          district: "",
          village: "",
        },
        farmDetails: {
          size: "",
          sizeUnit: "hectares",
          ownershipType: "",
          farmingType: "",
          irrigationType: "",
        },
        crops: [{ name: "", season: "", area: "" }],
        livestock: [{ type: "", count: "", purpose: "" }],
        cooperatives: [{ name: "", role: "" }],
      },
    };
  },
  computed: {
    isDarkMode() {
      return (
        document.documentElement.getAttribute("data-theme") === "dark" ||
        document.body.getAttribute("data-theme") === "dark"
      );
    },
    dialogThemeStyles() {
      const isDark = this.isDarkMode;
      return {
        "--dialog-background": isDark ? "#2a2a2a" : "#ffffff",
        "--dialog-title-color": isDark ? "#ffffff" : "#333333",
        "--dialog-text-color": isDark ? "rgba(255, 255, 255, 0.8)" : "#666666",
        "--dialog-border-color": isDark ? "#3a3a3a" : "#dcdfe4",
        "--dialog-box-shadow": isDark
          ? "0 4px 12px rgba(0, 0, 0, 0.4)"
          : "0 4px 12px rgba(0, 0, 0, 0.15)",
        "--dialog-overlay-background": isDark
          ? "rgba(0, 0, 0, 0.7)"
          : "rgba(0, 0, 0, 0.5)",
        "--dialog-input-background": isDark ? "#333333" : "#ffffff",
        "--dialog-input-border": isDark ? "#444444" : "#ddd",
        "--dialog-input-text": isDark ? "#f0f0f0" : "#333333",
      };
    },
  },
  methods: {
    translate(key, fallback = "") {
      const fullKey = key.startsWith("farmerProfile.")
        ? key
        : `farmerProfile.${key}`;
      if (this.$te && this.$te(fullKey)) {
        return this.$t(fullKey);
      }
      return fallback || key;
    },
    close() {
      this.$emit("close");
    },
    updateTheme() {
      this.isThemeReady = false;
      this.$nextTick(() => {
        this.isThemeReady = true;
      });
    },

    // ===== MAP METHODS =====
    initMap() {
      const center = this.formData.farmLocation.center.lat
        ? [this.formData.farmLocation.center.lat, this.formData.farmLocation.center.lng]
        : [this.defaultCenter.lat, this.defaultCenter.lng];

      this.map = L.map(this.$refs.mapContainer, {
        center: center,
        zoom: 13,
        zoomControl: true,
      });

      // OpenStreetMap tile layer (free, no API key)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(this.map);

      // Feature group for drawn polygons
      this.drawnItems = new L.FeatureGroup();
      this.map.addLayer(this.drawnItems);

      // Draw controls
      this.drawControl = new L.Control.Draw({
        position: "topright",
        draw: {
          polygon: {
            allowIntersection: false,
            showArea: true,
            shapeOptions: {
              color: "#4e97d1",
              fillColor: "#4e97d1",
              fillOpacity: 0.2,
              weight: 2,
            },
          },
          rectangle: {
            shapeOptions: {
              color: "#4e97d1",
              fillColor: "#4e97d1",
              fillOpacity: 0.2,
              weight: 2,
            },
          },
          marker: false,
          circle: false,
          circlemarker: false,
          polyline: false,
        },
        edit: {
          featureGroup: this.drawnItems,
          remove: true,
        },
      });
      this.map.addControl(this.drawControl);

      // Handle new polygon drawn
      this.map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        this.drawnItems.addLayer(layer);

        // Extract coordinates
        const latlngs = layer.getLatLngs()[0].map((ll) => [ll.lat, ll.lng]);
        this.formData.farmLocation.plots.push({
          name: `Plot ${this.formData.farmLocation.plots.length + 1}`,
          type: "polygon",
          coordinates: latlngs,
          _leafletId: layer._leaflet_id,
        });
      });

      // Handle polygon deleted
      this.map.on(L.Draw.Event.DELETED, (e) => {
        const layers = e.layers;
        layers.eachLayer((layer) => {
          const idx = this.formData.farmLocation.plots.findIndex(
            (p) => p._leafletId === layer._leaflet_id
          );
          if (idx >= 0) {
            this.formData.farmLocation.plots.splice(idx, 1);
          }
        });
      });

      // Handle polygon edited
      this.map.on(L.Draw.Event.EDITED, (e) => {
        const layers = e.layers;
        layers.eachLayer((layer) => {
          const idx = this.formData.farmLocation.plots.findIndex(
            (p) => p._leafletId === layer._leaflet_id
          );
          if (idx >= 0) {
            const latlngs = layer.getLatLngs()[0].map((ll) => [ll.lat, ll.lng]);
            this.formData.farmLocation.plots[idx].coordinates = latlngs;
          }
        });
      });

      // Click map to set center marker
      this.map.on("click", (e) => {
        this.setCenterMarker(e.latlng.lat, e.latlng.lng);
      });

      // If we have a saved center, place marker
      if (this.formData.farmLocation.center.lat) {
        this.setCenterMarker(
          this.formData.farmLocation.center.lat,
          this.formData.farmLocation.center.lng,
          false
        );
      }

      // Restore saved plots
      this.restorePlots();
    },

    setCenterMarker(lat, lng, pan = true) {
      this.formData.farmLocation.center = { lat, lng };

      if (this.centerMarker) {
        this.centerMarker.setLatLng([lat, lng]);
      } else {
        this.centerMarker = L.marker([lat, lng], {
          draggable: true,
          title: "Farm center",
        }).addTo(this.map);

        this.centerMarker.bindPopup("Farm center").openPopup();

        // Update on drag
        this.centerMarker.on("dragend", (e) => {
          const pos = e.target.getLatLng();
          this.formData.farmLocation.center = { lat: pos.lat, lng: pos.lng };
        });
      }

      if (pan) {
        this.map.setView([lat, lng], Math.max(this.map.getZoom(), 14));
      }
    },

    restorePlots() {
      if (!this.formData.farmLocation.plots.length) return;

      this.formData.farmLocation.plots.forEach((plot) => {
        if (plot.coordinates && plot.coordinates.length >= 3) {
          const latlngs = plot.coordinates.map((c) => L.latLng(c[0], c[1]));
          const polygon = L.polygon(latlngs, {
            color: "#4e97d1",
            fillColor: "#4e97d1",
            fillOpacity: 0.2,
            weight: 2,
          });
          this.drawnItems.addLayer(polygon);
          plot._leafletId = polygon._leaflet_id;
        }
      });

      // Fit bounds to show all plots
      if (this.drawnItems.getLayers().length > 0) {
        this.map.fitBounds(this.drawnItems.getBounds().pad(0.1));
      }
    },

    calculatePlotArea(coordinates) {
      if (!coordinates || coordinates.length < 3) return "—";
      // Approximate area calculation using the Shoelace formula on lat/lng
      // Convert to approximate m² then to hectares
      const latlngs = coordinates.map((c) => ({ lat: c[0], lng: c[1] }));
      let area = 0;
      const n = latlngs.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // Convert to meters approximately
        const xi = latlngs[i].lng * 111320 * Math.cos((latlngs[i].lat * Math.PI) / 180);
        const yi = latlngs[i].lat * 110540;
        const xj = latlngs[j].lng * 111320 * Math.cos((latlngs[j].lat * Math.PI) / 180);
        const yj = latlngs[j].lat * 110540;
        area += xi * yj - xj * yi;
      }
      area = Math.abs(area) / 2;
      const hectares = area / 10000;
      if (hectares < 0.01) return `${Math.round(area)} m²`;
      return `~${hectares.toFixed(2)} ha`;
    },

    // ===== GPS =====
    getCurrentLocation() {
      if (!navigator.geolocation) {
        notificationService.error(
          this.translate("errors.gpsNotSupported", "GPS is not supported by your browser")
        );
        return;
      }

      this.isGettingLocation = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          this.setCenterMarker(lat, lng);
          this.isGettingLocation = false;
          notificationService.success(
            this.translate("messages.gpsSuccess", "Location captured successfully")
          );
        },
        (error) => {
          this.isGettingLocation = false;
          let message = this.translate("errors.gpsGeneric", "Could not get location");
          if (error.code === 1) {
            message = this.translate("errors.gpsPermission", "Location permission denied");
          } else if (error.code === 2) {
            message = this.translate("errors.gpsUnavailable", "Location unavailable");
          }
          notificationService.error(message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },

    applyManualCoords() {
      if (
        this.manualLat != null &&
        this.manualLng != null &&
        this.manualLat >= -90 && this.manualLat <= 90 &&
        this.manualLng >= -180 && this.manualLng <= 180
      ) {
        this.setCenterMarker(this.manualLat, this.manualLng);
      } else {
        notificationService.error(
          this.translate("errors.invalidCoords", "Invalid coordinates")
        );
      }
    },

    // ===== WEATHER =====
    async fetchWeather() {
      const lat = this.formData.farmLocation.center.lat || this.defaultCenter.lat;
      const lng = this.formData.farmLocation.center.lng || this.defaultCenter.lng;

      this.weatherLoading = true;
      this.weatherError = null;
      try {
        this.weatherData = await weatherService.getWeather({
          latitude: lat,
          longitude: lng
        });
      } catch (error) {
        console.error("[FARMER PROFILE] Weather fetch failed:", error);
        this.weatherError = this.translate("weather.error", "Unable to load weather data");
      } finally {
        this.weatherLoading = false;
      }
    },

    formatForecastDate(dateStr) {
      const date = new Date(dateStr);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return days[date.getDay()];
    },

    getWeatherEmoji(condition) {
      const map = {
        Clear: "☀️",
        "Partly Cloudy": "⛅",
        Cloudy: "☁️",
        Rain: "🌧️",
        Drizzle: "🌦️",
        Snow: "❄️",
        Thunderstorm: "⛈️",
      };
      return map[condition] || "🌡️";
    },

    // ===== PLOT MANAGEMENT =====
    removePlot(index) {
      const plot = this.formData.farmLocation.plots[index];
      // Remove from map
      if (plot._leafletId && this.drawnItems) {
        this.drawnItems.eachLayer((layer) => {
          if (layer._leaflet_id === plot._leafletId) {
            this.drawnItems.removeLayer(layer);
          }
        });
      }
      this.formData.farmLocation.plots.splice(index, 1);
    },

    // ===== CROP / LIVESTOCK / COOP MANAGEMENT =====
    addCrop() {
      this.formData.crops.push({ name: "", season: "", area: "" });
    },
    removeCrop(index) {
      this.formData.crops.splice(index, 1);
      if (this.formData.crops.length === 0) this.addCrop();
    },
    addLivestock() {
      this.formData.livestock.push({ type: "", count: "", purpose: "" });
    },
    removeLivestock(index) {
      this.formData.livestock.splice(index, 1);
      if (this.formData.livestock.length === 0) this.addLivestock();
    },
    addCooperative() {
      this.formData.cooperatives.push({ name: "", role: "" });
    },
    removeCooperative(index) {
      this.formData.cooperatives.splice(index, 1);
      if (this.formData.cooperatives.length === 0) this.addCooperative();
    },

    // ===== LOAD / SAVE =====
    async loadFarmerProfile() {
      this.isLoading = true;
      this.errorMessage = null;
      try {
        const response = await httpService.get("users/farmer-profile");
        if (response.data && response.data.farmerProfile) {
          const profile = response.data.farmerProfile;
          // Load privacy preference
          if (profile.shareWithAI !== undefined) {
            this.formData.shareWithAI = profile.shareWithAI;
          }
          if (profile.farmLocation) {
            if (profile.farmLocation.center) {
              this.formData.farmLocation.center = profile.farmLocation.center;
            }
            if (profile.farmLocation.plots) {
              this.formData.farmLocation.plots = profile.farmLocation.plots;
            }
            if (profile.farmLocation.district) {
              this.formData.farmLocation.district = profile.farmLocation.district;
            }
            if (profile.farmLocation.village) {
              this.formData.farmLocation.village = profile.farmLocation.village;
            }
          }
          if (profile.farmDetails) {
            this.formData.farmDetails = { ...this.formData.farmDetails, ...profile.farmDetails };
          }
          if (profile.crops && profile.crops.length > 0) {
            this.formData.crops = profile.crops;
          }
          if (profile.livestock && profile.livestock.length > 0) {
            this.formData.livestock = profile.livestock;
          }
          if (profile.cooperatives && profile.cooperatives.length > 0) {
            this.formData.cooperatives = profile.cooperatives;
          }
        }
      } catch (error) {
        if ((error.response && error.response.status === 404) || error.status === 404) {
          // No farmer profile yet — use defaults
        } else {
          console.error("[FARMER PROFILE] Error loading:", error);
          this.errorMessage = this.translate("errors.loadFailed", "Failed to load farmer profile");
        }
      } finally {
        this.isLoading = false;
        // Initialize map after data is loaded
        this.$nextTick(() => {
          if (!this.errorMessage) {
            this.initMap();
            this.fetchWeather();
          }
        });
      }
    },

    async saveProfile() {
      this.isSaving = true;
      try {
        // Clean up _leafletId from plots before saving
        const plots = this.formData.farmLocation.plots.map(({ name, type, coordinates }) => ({
          name,
          type,
          coordinates,
        }));

        const payload = {
          shareWithAI: this.formData.shareWithAI,
          farmLocation: {
            center: this.formData.farmLocation.center,
            plots,
            district: this.formData.farmLocation.district,
            village: this.formData.farmLocation.village,
          },
          farmDetails: { ...this.formData.farmDetails },
          crops: this.formData.crops.filter((c) => c.name.trim() !== ""),
          livestock: this.formData.livestock.filter((l) => l.type.trim() !== ""),
          cooperatives: this.formData.cooperatives.filter((g) => g.name.trim() !== ""),
        };

        await httpService.put("users/farmer-profile", payload);
        notificationService.success(
          this.translate("messages.saved", "Farmer profile saved successfully")
        );
        this.$emit("close");
      } catch (error) {
        console.error("[FARMER PROFILE] Error saving:", error);
        notificationService.error(
          this.translate("errors.saveFailed", "Failed to save farmer profile")
        );
      } finally {
        this.isSaving = false;
      }
    },
  },
  mounted() {
    window.addEventListener("themeChange", this.updateTheme);
    this.$nextTick(() => {
      this.isThemeReady = true;
    });
    this.loadFarmerProfile();
  },
  beforeDestroy() {
    window.removeEventListener("themeChange", this.updateTheme);
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },
};
</script>

<style scoped>
.farmer-profile-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  color: #333333;
}

.farmer-profile-modal[data-themed="true"] {
  color: var(--dialog-text-color, #333333);
}

.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
}

.modal-content {
  position: relative;
  background-color: var(--dialog-background, #ffffff);
  width: 780px;
  max-width: 94%;
  margin: 30px auto;
  padding: 24px;
  border-radius: 8px;
  overflow-y: auto;
  max-height: 90vh;
  box-shadow: var(--dialog-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--dialog-border-color, #dcdfe4);
}

.header-title {
  color: #333333;
  margin: 0;
  font-size: 1.4rem;
}

.header-title[data-themed="true"] {
  color: var(--dialog-title-color, #333333);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-close {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
}

.btn-save {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
  background-color: var(--bg-button-primary, #4e97d1);
  color: var(--text-button-primary, #ffffff);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-save:hover:not(:disabled) {
  background-color: var(--bg-button-primary-hover, #3a7da0);
}

/* Form Sections */
.form-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Privacy Section */
.privacy-section {
  background: linear-gradient(to right, rgba(78, 151, 209, 0.04), rgba(46, 204, 113, 0.04));
}

.privacy-toggle {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.privacy-info {
  flex: 1;
}

.privacy-description {
  font-size: 0.84rem;
  color: var(--dialog-text-color, #666);
  margin: 0;
  line-height: 1.5;
}

.toggle-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  flex-shrink: 0;
  padding-top: 4px;
}

.toggle-switch input {
  display: none;
}

.toggle-slider {
  width: 44px;
  height: 24px;
  background-color: #ccc;
  border-radius: 12px;
  position: relative;
  transition: background-color 0.3s;
}

.toggle-slider::after {
  content: "";
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  top: 2px;
  left: 2px;
  transition: transform 0.3s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.toggle-switch input:checked + .toggle-slider {
  background-color: #2ecc71;
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(20px);
}

.toggle-label {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--dialog-text-color, #666);
  min-width: 60px;
}

.form-section {
  border: 1px solid var(--dialog-border-color, #e8e8e8);
  border-radius: 8px;
  padding: 16px;
}

.map-section {
  background: linear-gradient(to bottom, rgba(78, 151, 209, 0.03) 0%, transparent 80px);
}

.section-title {
  font-size: 1.05rem;
  margin: 0 0 12px 0;
  color: var(--dialog-title-color, #333333);
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon {
  font-size: 1.15rem;
}

.section-help {
  font-size: 0.85rem;
  color: var(--dialog-text-color, #666);
  margin: 0 0 12px 0;
}

/* Map */
.map-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.btn-gps {
  padding: 8px 14px;
  border: 1px solid var(--dialog-input-border, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text, #333333);
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.btn-gps:hover:not(:disabled) {
  background-color: var(--bg-button-primary, #4e97d1);
  color: white;
  border-color: var(--bg-button-primary, #4e97d1);
}

.btn-gps:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.coords-display {
  font-size: 0.82rem;
  color: var(--dialog-text-color, #666);
  font-family: monospace;
  background: rgba(0, 0, 0, 0.04);
  padding: 4px 8px;
  border-radius: 3px;
}

.map-container {
  width: 100%;
  height: 320px;
  border-radius: 6px;
  border: 1px solid var(--dialog-border-color, #ddd);
  margin-bottom: 12px;
  z-index: 1;
}

/* Plots List */
.plots-list {
  margin-bottom: 12px;
}

.plots-list h4 {
  font-size: 0.9rem;
  margin: 0 0 8px 0;
  color: var(--dialog-title-color, #333);
}

.plot-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.plot-name-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--dialog-input-border, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text, #333333);
  font-size: 0.9rem;
}

.plot-area {
  font-size: 0.82rem;
  color: var(--dialog-text-color, #666);
  white-space: nowrap;
  min-width: 80px;
  text-align: right;
}

/* Manual Coordinates */
.manual-coords {
  margin-bottom: 12px;
}

.manual-coords summary {
  font-size: 0.85rem;
  color: var(--bg-button-primary, #4e97d1);
  cursor: pointer;
  margin-bottom: 8px;
}

.manual-fields {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.manual-fields .field-group {
  flex: 1;
  min-width: 120px;
}

.btn-apply {
  padding: 8px 14px;
  border: none;
  border-radius: 4px;
  background-color: var(--bg-button-primary, #4e97d1);
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  height: 36px;
}

/* Location Details */
.location-details {
  display: flex;
  gap: 12px;
}

.location-details .field-group {
  flex: 1;
}

/* Field Groups */
.field-group {
  margin-bottom: 12px;
}

.field-group label {
  display: block;
  font-size: 0.83rem;
  font-weight: 500;
  color: var(--dialog-text-color, #555555);
  margin-bottom: 4px;
}

.field-group input,
.field-group select,
.field-group textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dialog-input-border, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text, #333333);
  font-size: 0.92rem;
  box-sizing: border-box;
}

.field-group input:focus,
.field-group select:focus {
  border-color: var(--bg-button-primary, #4e97d1);
  outline: none;
  box-shadow: 0 0 0 2px rgba(78, 151, 209, 0.15);
}

/* Input with unit */
.input-with-unit {
  display: flex;
  gap: 8px;
}

.input-with-unit input {
  flex: 2;
}

.input-with-unit select {
  flex: 1;
}

/* List Items */
.list-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.list-item-fields {
  display: flex;
  flex: 1;
  gap: 8px;
}

.list-item-fields input,
.list-item-fields select {
  padding: 8px 10px;
  border: 1px solid var(--dialog-input-border, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text, #333333);
  font-size: 0.88rem;
  box-sizing: border-box;
}

.list-item-fields input:focus,
.list-item-fields select:focus {
  border-color: var(--bg-button-primary, #4e97d1);
  outline: none;
}

.flex-input {
  flex: 2;
  min-width: 0;
}

.season-select,
.purpose-select,
.role-select {
  flex: 1;
  min-width: 100px;
}

.area-input,
.count-input {
  flex: 0.7;
  min-width: 70px;
}

.btn-remove {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background-color: #e74c3c;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  flex-shrink: 0;
  transition: background-color 0.2s;
}

.btn-remove:hover {
  background-color: #c0392b;
}

.btn-add {
  padding: 8px 14px;
  border: 1px dashed var(--dialog-border-color, #ccc);
  border-radius: 4px;
  background: transparent;
  color: var(--bg-button-primary, #4e97d1);
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-add:hover {
  background-color: rgba(78, 151, 209, 0.08);
  border-color: var(--bg-button-primary, #4e97d1);
}

/* Loading */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  min-height: 200px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--bg-button-primary, #4e97d1);
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

.spinner-small {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  border-top-color: var(--bg-button-primary, #4e97d1);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error */
.error-container {
  padding: 2rem;
  text-align: center;
}

.error-message {
  color: #dc3545;
  margin-bottom: 1rem;
}

.retry-btn {
  padding: 0.5rem 1.5rem;
  background-color: var(--bg-button-secondary, #cccccc);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #cccccc);
  border-radius: 4px;
  cursor: pointer;
}

/* Dark Mode */
[data-theme="dark"] .farmer-profile-modal,
.dark-mode .farmer-profile-modal {
  color: var(--dialog-text-color, #f0f0f0);
}

[data-theme="dark"] .header-title,
.dark-mode .header-title {
  color: #ffffff !important;
}

[data-theme="dark"] .btn-close {
  background-color: #444444 !important;
  color: #f0f0f0 !important;
}

[data-theme="dark"] .form-section {
  border-color: #3a3a3a;
}

[data-theme="dark"] .map-section {
  background: linear-gradient(to bottom, rgba(78, 151, 209, 0.06) 0%, transparent 80px);
}

[data-theme="dark"] .btn-add {
  border-color: #555;
}

[data-theme="dark"] .coords-display {
  background: rgba(255, 255, 255, 0.06);
}

[data-theme="dark"] .map-container {
  border-color: #444;
}

/* Weather Card */
.weather-section {
  background: linear-gradient(to right, rgba(255, 193, 7, 0.04), rgba(78, 151, 209, 0.04));
}

.weather-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  color: var(--dialog-text-color, #666);
  padding: 8px 0;
}

.weather-error {
  font-size: 0.88rem;
  color: #e67e22;
  padding: 8px 0;
}

.weather-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.weather-current {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.weather-temp {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.temp-value {
  font-size: 1.6rem;
  font-weight: 600;
  color: var(--dialog-title-color, #333);
}

.temp-condition {
  font-size: 0.9rem;
  color: var(--dialog-text-color, #666);
}

.weather-details {
  display: flex;
  gap: 12px;
}

.weather-detail {
  font-size: 0.84rem;
  color: var(--dialog-text-color, #666);
  white-space: nowrap;
}

.weather-location {
  font-size: 0.82rem;
  color: var(--dialog-text-color, #888);
  margin-left: auto;
}

.weather-forecast {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 0;
  border-top: 1px solid var(--dialog-border-color, #eee);
}

.forecast-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 56px;
  padding: 8px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
}

.forecast-date {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--dialog-text-color, #666);
  text-transform: uppercase;
}

.forecast-condition {
  font-size: 1.2rem;
}

.forecast-temps {
  font-size: 0.76rem;
  color: var(--dialog-text-color, #555);
  white-space: nowrap;
}

[data-theme="dark"] .weather-section {
  background: linear-gradient(to right, rgba(255, 193, 7, 0.06), rgba(78, 151, 209, 0.06));
}

[data-theme="dark"] .forecast-day {
  background: rgba(255, 255, 255, 0.04);
}

/* Responsive */
@media (max-width: 640px) {
  .modal-content {
    width: 96%;
    margin: 10px auto;
    padding: 14px;
    max-height: 94vh;
  }

  .map-container {
    height: 240px;
  }

  .list-item-fields {
    flex-wrap: wrap;
  }

  .location-details {
    flex-direction: column;
    gap: 0;
  }

  .manual-fields {
    flex-direction: column;
  }

  .input-with-unit {
    flex-direction: column;
  }

  .map-controls {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
