<template>
  <div :key="$i18n.locale" class="weather-panel" :data-theme="$route.meta.theme || 'light'">
    <div class="weather-header">
      <h3>{{ weatherTitle }}</h3>
      <div class="weather-location">
        {{ location || weatherLocationLoading }}
        <DsButton variant="ghost" class="refresh-btn" :title="weatherRefresh" @click="refreshWeather">
          <RefreshCw :size="14" :class="{ rotating: isLoading }" />
        </DsButton>
      </div>
    </div>

    <div v-if="isLoading" class="weather-loading">
      <Loader2 :size="20" class="animate-spin" />
      {{ weatherLoading }}
    </div>

    <div v-else-if="errorKey" class="weather-error">
      <AlertTriangle :size="20" />
      {{ $t(`sidebar.${errorKey}`) }}
    </div>

    <div v-else class="weather-content">
      <div class="current-weather">
        <div class="current-icon">
          <component :is="getWeatherIcon(currentWeather.condition)" :size="28" />
        </div>
        <div class="current-details">
          <div class="current-temp">{{ currentWeather.temperature }}°C</div>
          <div class="current-condition">{{ getTranslatedCondition(currentWeather.condition) }}</div>
        </div>
        <div class="current-info">
          <div class="info-item"><Droplets :size="14" /> {{ currentWeather.humidity }}%</div>
          <div class="info-item"><Wind :size="14" /> {{ currentWeather.windSpeed }} km/h</div>
        </div>
      </div>

      <div class="forecast-list">
        <div v-for="(day, index) in formattedForecast" :key="index" class="forecast-day">
          <div class="day-name">{{ day.formattedDate }}</div>
          <div class="day-icon">
            <component :is="day.iconName" :size="20" />
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
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Droplets,
  Wind,
  CloudLightning,
  CloudRain,
  Snowflake,
  Cloud,
  CloudSun,
  Sun
} from '@lucide/vue';

import DsButton from '@/components/ds/Button.vue';

export default {
  name: 'WeatherPanel',

  components: {
    DsButton,
    RefreshCw,
    Loader2,
    AlertTriangle,
    Droplets,
    Wind,
    CloudLightning,
    CloudRain,
    Snowflake,
    Cloud,
    CloudSun,
    Sun
  },

  data() {
    return {
      location: null,
      isLoading: true, // Start in loading state until auth is checked
      errorKey: null,
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
    // FIX: Map isAuthenticated and user getters from Vuex store
    ...mapGetters(['isAuthenticated', 'user']),

    weatherTitle() {
      return this.$t('sidebar.weatherTitle');
    },
    weatherLoading() {
      return this.$t('sidebar.weatherLoading');
    },
    weatherLocationLoading() {
      return this.$t('sidebar.weatherLocationLoading');
    },
    weatherRefresh() {
      return this.$t('sidebar.weatherRefresh');
    },
    formattedForecast() {
      return this.forecast.map((day) => ({
        ...day,
        formattedDate: this.formatDay(day.date),
        iconName: this.getWeatherIcon(day.condition),
        translatedCondition: this.getTranslatedCondition(day.condition)
      }));
    }
  },

  watch: {
    '$i18n.locale': {
      handler() {
        // Only refresh if already authenticated
        if (this.isAuthenticated) {
          this.getWeather();
        }
        this.$forceUpdate();
      }
      // Do not use immediate: true here, let the auth watcher handle it
    },

    // FIX: Add a watcher for authentication
    isAuthenticated: {
      handler(isAuthed) {
        if (isAuthed) {
          // User is authenticated, NOW we can get the weather
          this.getWeather();
        } else {
          // User is not authenticated (e.g., logged out)
          this.isLoading = false;
          this.errorKey = 'weatherAuthRequired'; // You may need to add this translation key
          this.location = null;
        }
      },
      immediate: true // Check auth state immediately when component loads
    }
  },

  created() {
    // FIX: Removed this.getWeather() from here.
    // The isAuthenticated watcher will now handle the initial call.
  },

  methods: {
    async getWeather() {
      // Extra safety check
      if (!this.isAuthenticated) {
        this.isLoading = false;
        this.errorKey = 'weatherAuthRequired';
        return;
      }

      this.isLoading = true;
      this.errorKey = null;
      this.location = null;

      try {
        if (navigator.geolocation) {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
          });
          const { latitude, longitude } = position.coords;

          // FIX: Get userId from the Vuex store 'user' object
          const locale = this.$i18n.locale;

          const weatherData = await weatherService.getWeather({ latitude, longitude, locale });
          this.location = weatherData.location;
          this.currentWeather = weatherData.current;
          this.forecast = weatherData.forecast;
        } else {
          this.errorKey = 'weatherGeolocationUnsupported';
        }
      } catch {
        this.errorKey = 'weatherErrorDefault';
      } finally {
        this.isLoading = false;
      }
    },

    async refreshWeather() {
      // The watcher will prevent this from running if not authed,
      // but an explicit check is good practice.
      if (this.isAuthenticated) {
        await this.getWeather();
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
      const c = condition.toLowerCase();
      if (c.includes('thunder')) return 'CloudLightning';
      if (c.includes('rain') || c.includes('shower')) return 'CloudRain';
      if (c.includes('snow')) return 'Snowflake';
      if (c.includes('cloudy') || c.includes('overcast')) return 'Cloud';
      if (c.includes('partly')) return 'CloudSun';
      return 'Sun';
    }
  }
};
</script>

<style scoped>
/* Styles remain unchanged */
.weather-panel {
  margin-top: var(--space-md);
  background-color: var(--bg-sidebar);
  border-radius: var(--radius-lg);
  color: var(--fg);
  padding: var(--space-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  font-size: var(--text-base);
}

.weather-header h4 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.weather-location {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--muted);
}

.refresh-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.2s;
  padding: var(--space-xs);
}

.refresh-btn:hover {
  opacity: 1;
  color: var(--accent-hover);
}

.rotating {
  animation: rotate 1s linear infinite;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.weather-loading,
.weather-error {
  text-align: center;
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  color: var(--muted);
}

.current-weather {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-light);
}

.current-icon {
  font-size: var(--text-xl);
  margin-right: var(--space-sm);
  color: var(--accent);
}

.current-details {
  flex-grow: 1;
}

.current-temp {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--fg);
}

.current-condition {
  color: var(--muted);
}

.current-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--muted);
}

.info-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.info-item i {
  color: var(--accent);
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
  padding: var(--space-xs);
}

.day-name {
  color: var(--muted);
  margin-bottom: var(--space-xs);
}

.day-icon {
  font-size: var(--text-md);
  margin: var(--space-xs) 0;
  color: var(--accent);
}

.day-temp {
  display: flex;
  gap: var(--space-xs);
}

.temp-high {
  font-weight: 600;
  color: var(--fg);
}

.temp-low {
  color: var(--muted);
}

.day-condition {
  color: var(--muted);
  font-size: var(--text-base);
  margin-top: 2px;
}
</style>
