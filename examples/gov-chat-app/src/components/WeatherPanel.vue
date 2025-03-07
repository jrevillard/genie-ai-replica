<template>
  <div class="weather-panel">
    <div class="weather-header">
      <h4>{{ $t('sidebar.weatherTitle', 'Weather Forecast') }}</h4>
      <div class="weather-location">
        {{ location }}
        <button @click="refreshWeather" class="refresh-btn" title="Refresh Weather">
          <i class="fas fa-sync-alt" :class="{ 'rotating': isLoading }"></i>
        </button>
      </div>
    </div>
    
    <div v-if="isLoading" class="weather-loading">
      <i class="fas fa-spinner fa-pulse"></i>
      {{ $t('sidebar.weatherLoading', 'Loading weather data...') }}
    </div>
    
    <div v-else-if="error" class="weather-error">
      <i class="fas fa-exclamation-triangle"></i>
      {{ error }}
    </div>
    
    <div v-else class="weather-content">
      <!-- Current Weather -->
      <div class="current-weather">
        <div class="current-icon">
          <i :class="getWeatherIcon(currentWeather.condition)"></i>
        </div>
        <div class="current-details">
          <div class="current-temp">{{ currentWeather.temperature }}°C</div>
          <div class="current-condition">{{ currentWeather.condition }}</div>
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
      
      <!-- Daily Forecast -->
      <div class="forecast-list">
        <div v-for="(day, index) in forecast" :key="index" class="forecast-day">
          <div class="day-name">{{ formatDay(day.date) }}</div>
          <div class="day-icon">
            <i :class="getWeatherIcon(day.condition)"></i>
          </div>
          <div class="day-temp">
            <span class="temp-high">{{ day.highTemp }}°</span>
            <span class="temp-low">{{ day.lowTemp }}°</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'WeatherPanel',
  
  data() {
    return {
      location: 'Loading location...',
      isLoading: true,
      error: null,
      currentWeather: {
        temperature: 24,
        condition: 'Partly Cloudy',
        humidity: 65,
        windSpeed: 12
      },
      forecast: [
        {
          date: new Date(Date.now() + 86400000), // Tomorrow
          condition: 'Sunny',
          highTemp: 26,
          lowTemp: 18
        },
        {
          date: new Date(Date.now() + 86400000 * 2), // Day after tomorrow
          condition: 'Scattered Showers',
          highTemp: 23,
          lowTemp: 17
        },
        {
          date: new Date(Date.now() + 86400000 * 3), // 3 days from now
          condition: 'Thunderstorm',
          highTemp: 21,
          lowTemp: 16
        }
      ]
    };
  },
  
  created() {
    this.getUserLocation();
  },
  
  methods: {
    getUserLocation() {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          this.handleLocationSuccess,
          this.handleLocationError,
          { timeout: 10000 }
        );
      } else {
        // Fallback to default location
        this.location = 'Nairobi, Kenya';
        this.simulateWeatherData();
      }
    },
    
    handleLocationSuccess(position) {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      
      // Reverse geocoding to get city name (in a real app, use an API)
      this.reverseGeocode(latitude, longitude);
      
      // In a real app, you would use coordinates to get weather data
      this.simulateWeatherData();
    },
    
    handleLocationError(error) {
      console.warn('Geolocation error:', error);
      // Fallback to default location
      this.location = 'Nairobi, Kenya';
      this.simulateWeatherData();
    },
    
    reverseGeocode(latitude, longitude) {
      // Simulate reverse geocoding
      // In a real app, use a geocoding API like Google Maps, OpenStreetMap, etc.
      
      setTimeout(() => {
        // This would normally come from an API
        const cities = [
          'Nairobi, Kenya',
          'Mombasa, Kenya',
          'Kisumu, Kenya',
          'Nakuru, Kenya',
          'Eldoret, Kenya'
        ];
        
        // For demo purposes, select a random city
        this.location = cities[Math.floor(Math.random() * cities.length)];
      }, 500);
    },
    
    simulateWeatherData() {
      // Simulate API loading
      setTimeout(() => {
        this.isLoading = false;
      }, 1000);
    },
    
    refreshWeather() {
      this.isLoading = true;
      
      // Simulate API call
      setTimeout(() => {
        // Randomly vary the weather a bit
        this.currentWeather.temperature = Math.floor(22 + Math.random() * 6);
        this.currentWeather.humidity = Math.floor(60 + Math.random() * 20);
        this.currentWeather.windSpeed = Math.floor(8 + Math.random() * 10);
        
        // Random condition (for demo)
        const conditions = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Thunderstorm'];
        this.currentWeather.condition = conditions[Math.floor(Math.random() * conditions.length)];
        
        // Update forecast (for demo)
        this.forecast.forEach(day => {
          day.highTemp = Math.floor(20 + Math.random() * 8);
          day.lowTemp = Math.floor(15 + Math.random() * 6);
          day.condition = conditions[Math.floor(Math.random() * conditions.length)];
        });
        
        this.isLoading = false;
      }, 1000);
    },
    
    formatDay(date) {
      return new Date(date).toLocaleDateString(undefined, { weekday: 'short' });
    },
    
    getWeatherIcon(condition) {
      // Map weather conditions to Font Awesome icons
      const conditionLower = condition.toLowerCase();
      
      if (conditionLower.includes('thunder')) {
        return 'fas fa-bolt';
      } else if (conditionLower.includes('rain') || conditionLower.includes('shower')) {
        return 'fas fa-cloud-rain';
      } else if (conditionLower.includes('snow')) {
        return 'fas fa-snowflake';
      } else if (conditionLower.includes('cloudy') || conditionLower.includes('overcast')) {
        return 'fas fa-cloud';
      } else if (conditionLower.includes('partly')) {
        return 'fas fa-cloud-sun';
      } else {
        return 'fas fa-sun';
      }
    }
  }
};
</script>

<style scoped>
.weather-panel {
  margin-bottom: 15px;
  background: linear-gradient(135deg, #3a7cb5, #4e97d1);
  border-radius: 10px;
  color: white;
  padding: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
  font-size: 7pt; /* Smaller text size as requested */
}

.weather-header {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}

.weather-header h4 {
  margin: 0 0 5px 0;
  font-size: 0.9rem; /* Keep heading slightly larger */
  font-weight: 600;
}

.weather-location {
  display: flex;
  justify-content: space-between;
  align-items: center;
  opacity: 0.9;
}

.refresh-btn {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.2s;
  padding: 3px;
  font-size: 7pt;
}

.refresh-btn:hover {
  opacity: 1;
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
}

.current-weather {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.current-icon {
  font-size: 1.8rem;
  margin-right: 8px;
  text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.2);
}

.current-details {
  flex-grow: 1;
}

.current-temp {
  font-size: 1.5rem;
  font-weight: 600;
}

.current-condition {
  opacity: 0.9;
}

.current-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  opacity: 0.9;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 4px;
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
  opacity: 0.9;
  margin-bottom: 3px;
}

.day-icon {
  font-size: 1rem;
  margin: 3px 0;
}

.day-temp {
  display: flex;
  gap: 4px;
}

.temp-high {
  font-weight: 600;
}

.temp-low {
  opacity: 0.8;
}
</style>
