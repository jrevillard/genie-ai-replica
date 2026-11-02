<template>
  <div class="weather-panel" :data-theme="$route.meta.theme || 'light'" :key="$i18n.locale">
    <div class="weather-header">
      <h4>{{ $t('sidebar.weatherTitle') }}</h4>
      <div class="weather-location-selector">
        <select
          v-model="selectedLocationId"
          @change="onLocationChange"
          class="location-select"
          :disabled="isLoading"
        >
          <option
            v-for="loc in availableLocations"
            :key="loc.id"
            :value="loc.id"
          >
            {{ loc.name }}
          </option>
        </select>
        <button
          @click="useMyLocation"
          class="location-btn"
          :title="$t('sidebar.weatherUseMyLocation')"
          :disabled="isLoading"
        >
          <i class="fas fa-crosshairs" :class="{ 'rotating': isGeolocating }"></i>
        </button>
        <button
          @click="refreshWeather"
          class="refresh-btn"
          :title="$t('sidebar.weatherRefresh')"
          :disabled="isLoading"
        >
          <i class="fas fa-sync-alt" :class="{ 'rotating': isLoading }"></i>
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="weather-loading">
      <i class="fas fa-spinner fa-pulse"></i>
      {{ $t('sidebar.weatherLoading') }}
    </div>

    <div v-else-if="errorKey" class="weather-error">
      <i class="fas fa-exclamation-triangle"></i>
      {{ $t(`sidebar.${errorKey}`) }}
    </div>

    <div v-else class="weather-content">
      <div class="current-weather">
        <div class="current-icon">
          <i :class="getWeatherIcon(currentWeather.condition)"></i>
        </div>
        <div class="current-details">
          <div class="current-temp">{{ currentWeather.temperature }}°C</div>
          <div class="current-condition">{{ getTranslatedCondition(currentWeather.condition) }}</div>
        </div>
        <div class="current-info">
          <div class="info-item">
            <i class="fas fa-tint"></i> {{ currentWeather.humidity }}%
          </div>
          <div class="info-item">
            <i class="fas fa-wind"></i> {{ currentWeather.windSpeed }} km/h
          </div>
        </div>
      </div>

      <div class="forecast-list">
        <div v-for="(day, index) in formattedForecast" :key="index" class="forecast-day">
          <div class="day-name">{{ day.formattedDate }}</div>
          <div class="day-icon">
            <i :class="day.iconClass"></i>
          </div>
          <div class="day-temp">
            <span class="temp-high">{{ day.highTemp }}°</span>
            <span class="temp-low">{{ day.lowTemp }}°</span>
          </div>
          <div class="day-condition">{{ day.translatedCondition }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import weatherService from '@/services/weatherService';

const STORAGE_KEY = 'genie-ai-weather-location';

export default {
  name: 'WeatherPanel',

  data() {
    return {
      location: null,
      isLoading: true,
      isGeolocating: false,
      errorKey: null,
      selectedLocationId: null,
      availableLocations: [],
      defaultLocationId: 'maseru',
      currentWeather: {
        temperature: 0,
        condition: '',
        humidity: 0,
        windSpeed: 0
      },
      forecast: []
    };
  },

  computed: {
    ...mapGetters(['isAuthenticated', 'user']),

    formattedForecast() {
      return this.forecast.map(day => ({
        ...day,
        formattedDate: this.formatDay(day.date),
        iconClass: this.getWeatherIcon(day.condition),
        translatedCondition: this.getTranslatedCondition(day.condition)
      }));
    },

    selectedLocation() {
      return this.availableLocations.find(l => l.id === this.selectedLocationId) || null;
    }
  },

  watch: {
    '$i18n.locale': {
      handler() {
        if (this.isAuthenticated && this.selectedLocationId) {
          this.fetchWeatherForSelected();
        }
        this.$forceUpdate();
      }
    },

    isAuthenticated: {
      handler(isAuthed) {
        if (isAuthed && this.selectedLocationId) {
          this.fetchWeatherForSelected();
        } else if (!isAuthed) {
          this.isLoading = false;
          this.errorKey = 'weatherAuthRequired';
          this.location = null;
        }
      }
    }
  },

  async created() {
    await this.loadConfig();
    // Now that config is loaded, check auth and fetch
    if (this.isAuthenticated) {
      this.fetchWeatherForSelected();
    } else {
      this.isLoading = false;
      this.errorKey = 'weatherAuthRequired';
    }
  },

  methods: {
    async loadConfig() {
      try {
        const { loadConfig } = await import('../main.js');
        const config = await loadConfig();
        const weatherConfig = config?.weather || {};

        this.availableLocations = weatherConfig.locations || [
          { id: 'maseru', name: 'Maseru', latitude: -29.3167, longitude: 27.4833 }
        ];
        this.defaultLocationId = weatherConfig.defaultLocation || 'maseru';

        // Restore saved location or use default
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && this.availableLocations.find(l => l.id === saved)) {
          this.selectedLocationId = saved;
        } else {
          this.selectedLocationId = this.defaultLocationId;
        }
      } catch (error) {
        console.warn('Failed to load weather config, using defaults:', error);
        this.availableLocations = [
          { id: 'maseru', name: 'Maseru', latitude: -29.3167, longitude: 27.4833 }
        ];
        this.selectedLocationId = 'maseru';
      }
    },

    onLocationChange() {
      localStorage.setItem(STORAGE_KEY, this.selectedLocationId);
      if (this.isAuthenticated) {
        this.fetchWeatherForSelected();
      }
    },

    async fetchWeatherForSelected() {
      if (!this.isAuthenticated) {
        this.isLoading = false;
        this.errorKey = 'weatherAuthRequired';
        return;
      }

      const loc = this.selectedLocation;
      if (!loc || !loc.latitude || !loc.longitude) {
        this.isLoading = false;
        this.errorKey = 'weatherErrorDefault';
        return;
      }

      this.isLoading = true;
      this.errorKey = null;

      try {
        const userId = this.user?._key || null;
        const locale = this.$i18n.locale;

        const weatherData = await weatherService.getWeather({
          latitude: loc.latitude,
          longitude: loc.longitude,
          userId,
          locale
        });

        this.location = weatherData.location;
        this.currentWeather = weatherData.current;
        this.forecast = weatherData.forecast;
      } catch (error) {
        console.warn('Weather fetch error:', error);
        this.errorKey = 'weatherErrorDefault';
      } finally {
        this.isLoading = false;
      }
    },

    async useMyLocation() {
      if (!this.isAuthenticated || !navigator.geolocation) {
        this.errorKey = 'weatherGeolocationUnsupported';
        return;
      }

      this.isGeolocating = true;
      this.isLoading = true;
      this.errorKey = null;

      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
        });

        const { latitude, longitude } = position.coords;
        const userId = this.user?._key || null;
        const locale = this.$i18n.locale;

        const weatherData = await weatherService.getWeather({ latitude, longitude, userId, locale });

        this.location = weatherData.location;
        this.currentWeather = weatherData.current;
        this.forecast = weatherData.forecast;

        // Set dropdown to show we're using custom location
        // Find nearest district or keep current selection
        const nearest = this.findNearestLocation(latitude, longitude);
        if (nearest) {
          this.selectedLocationId = nearest.id;
          localStorage.setItem(STORAGE_KEY, nearest.id);
        }
      } catch (error) {
        console.warn('Geolocation error:', error);
        this.errorKey = 'weatherGeolocationDenied';
      } finally {
        this.isGeolocating = false;
        this.isLoading = false;
      }
    },

    findNearestLocation(lat, lon) {
      let nearest = null;
      let minDist = Infinity;

      for (const loc of this.availableLocations) {
        const dist = Math.sqrt(
          Math.pow(lat - loc.latitude, 2) + Math.pow(lon - loc.longitude, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          nearest = loc;
        }
      }
      return nearest;
    },

    async refreshWeather() {
      if (this.isAuthenticated) {
        await this.fetchWeatherForSelected();
      }
    },

    formatDay(date) {
      return new Date(date).toLocaleDateString(this.$i18n.locale, { weekday: 'short' });
    },

    getTranslatedCondition(condition) {
      if (!condition) return '';
      const conditionLower = condition.toLowerCase();
      const key = this.getConditionKey(conditionLower);
      const translationKey = `sidebar.weatherConditions.${key}`;
      return this.$te(translationKey) ? this.$t(translationKey) : condition;
    },

    getConditionKey(conditionLower) {
      if (conditionLower.includes('thunder')) return 'thunderstorm';
      if (conditionLower.includes('shower')) return 'shower';
      if (conditionLower.includes('rain')) return 'rain';
      if (conditionLower.includes('snow')) return 'snow';
      if (conditionLower.includes('overcast')) return 'overcast';
      if (conditionLower.includes('cloudy')) return 'cloudy';
      if (conditionLower.includes('partly')) return 'partlycloudy';
      return 'clear';
    },

    getWeatherIcon(condition) {
      const conditionLower = (condition || '').toLowerCase();

      if (conditionLower.includes('thunder')) return 'fas fa-bolt';
      if (conditionLower.includes('rain') || conditionLower.includes('shower')) return 'fas fa-cloud-rain';
      if (conditionLower.includes('snow')) return 'fas fa-snowflake';
      if (conditionLower.includes('cloudy') || conditionLower.includes('overcast')) return 'fas fa-cloud';
      if (conditionLower.includes('partly')) return 'fas fa-cloud-sun';
      return 'fas fa-sun';
    }
  }
};
</script>

<style scoped>
.weather-panel {
  margin-top: 15px;
  background-color: var(--bg-card);
  border-radius: 10px;
  color: var(--text-primary);
  padding: 12px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  font-size: 0.9rem;
}

.weather-header h4 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

[data-theme="dark"] .weather-header h4,
html[data-theme="dark"] .weather-header h4 {
  color: rgba(255, 255, 255, 0.7) !important;
}

.weather-location-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.location-select {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.8rem;
  cursor: pointer;
  outline: none;
  min-width: 0;
}

.location-select:focus {
  border-color: var(--accent-color);
}

.location-btn,
.refresh-btn {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.2s;
  padding: 4px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.location-btn:hover,
.refresh-btn:hover {
  opacity: 1;
  color: var(--accent-hover);
}

.location-btn:disabled,
.refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.weather-loading, .weather-error {
  text-align: center;
  padding: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.current-weather {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-light);
}

.current-icon {
  font-size: 1.8rem;
  margin-right: 8px;
  color: var(--accent-color);
}

.current-details {
  flex-grow: 1;
}

.current-temp {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.current-condition {
  color: var(--text-secondary);
}

.current-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text-secondary);
}

.info-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.info-item i {
  color: var(--accent-color);
}

.forecast-list {
  display: flex;
  justify-content: space-between;
}

.forecast-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  flex: 1;
  padding: 3px;
}

.day-name {
  color: var(--text-secondary);
  margin-bottom: 3px;
}

.day-icon {
  font-size: 1rem;
  margin: 3px 0;
  color: var(--accent-color);
}

.day-temp {
  display: flex;
  gap: 4px;
}

.temp-high {
  font-weight: 600;
  color: var(--text-primary);
}

.temp-low {
  color: var(--text-secondary);
}

.day-condition {
  color: var(--text-secondary);
  font-size: 0.8rem;
  margin-top: 2px;
}
</style>
