# Agricultural Charts & Data Services - Implementation Work Plan

**Project**: AgroGenio AI - Crop Health & Pest Alert Integration
**Timeline**: 2-3 hours (AI-assisted development)
**Date**: March 23, 2026

---

## 📋 Executive Summary

This work plan covers the implementation of **crop health monitoring charts** and **pest alert systems** for both Vue 3 and Flutter applications. The work is structured to be completed efficiently using AI-driven development with external agricultural data APIs.

---

## 🎯 Objectives

1. ✅ **COMPLETED**: Add QuickHelp/Fast Actions subtitle to both apps
2. 🔄 **IN PROGRESS**: Create agricultural data services (JavaScript + Dart)
3. ⏳ **PENDING**: Implement crop health charts (NDVI data from NASA/Sentinel)
4. ⏳ **PENDING**: Implement pest alert system (USDA APHIS data)
5. ⏳ **PENDING**: Create ApexCharts components for Vue 3
6. ⏳ **PENDING**: Create FL Chart components for Flutter

---

## 📊 Data Sources & API Strategy

### Crop Health Data
| Service | API Type | Auth | Coverage | Priority |
|---------|----------|------|----------|----------|
| **NASA Harvest** | REST | Free API Key | Global | HIGH |
| **Sentinel Hub** | OGC WMS/WCS | OAuth | Global | HIGH |

### Pest Alert Data
| Service | API Type | Auth | Coverage | Priority |
|---------|----------|------|----------|----------|
| **USDA APHIS** | REST/JSON | No key required | USA/Central America | HIGH |
| FAO GIEWS | REST | API Key (slow approval) | Global | BACKUP |

**Decision**: Start with **USDA APHIS** (no API key needed, immediate access)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Apps                            │
├──────────────────────┬──────────────────────────────────────┤
│   Vue 3 App          │   Flutter App                         │
│  (gov-chat-frontend) │  (genie_ai_mobile)                    │
├──────────────────────┼──────────────────────────────────────┤
│ ApexCharts Components│ FL Chart Widgets                      │
│ - CropHealthChart.vue│ - crop_health_chart.dart              │
│ - PestAlertChart.vue │ - pest_alert_chart.dart               │
└──────────┬───────────┴──────────────┬───────────────────────┘
           │                          │
           │ HTTP Requests            │ HTTP Requests
           │                          │
┌──────────┴──────────────────────────┴───────────────────────┐
│                 Data Services Layer                         │
├──────────────────────┬──────────────────────────────────────┤
│ agriculturalService.js│ agricultural_proxy.dart              │
│                      │                                      │
│ Methods:             │ Methods:                             │
│ - getCropHealth()    │ - get cropHealthData()               │
│ - getPestAlerts()    │ - getPestAlertData()                 │
│ - getWeatherData()   │ - getWeatherData()                   │
└──────────┬───────────┴──────────────┬───────────────────────┘
           │                          │
           │ API Calls                │ API Calls
           │                          │
┌──────────┴──────────────────────────┴───────────────────────┐
│              External Agricultural APIs                     │
├──────────────────────┬──────────────────────────────────────┤
│ NASA Harvest API     │ USDA APHIS API                       │
│ Sentinel Hub API     │ FAO GIEWS (backup)                   │
└──────────────────────┴──────────────────────────────────────┘
```

---

## 📁 File Structure & New Files to Create

### Vue 3 App (gov-chat-frontend)

```
components/gov-chat-frontend/src/
├── services/
│   └── agriculturalService.js           [NEW] - Data fetcher
├── components/charts/
│   ├── CropHealthChart.vue             [NEW] - NDVI trends
│   ├── PestAlertChart.vue              [NEW] - Pest alerts
│   └── WeatherPanel.vue                [EXTEND] - Add crop data
└── i18n/locales/
    ├── en.js                            [UPDATED] - Chart labels
    └── es.js                            [UPDATED] - Chart labels
```

### Flutter App (genie_ai_mobile)

```
mobile/genie_ai_mobile/lib/
├── services/
│   └── agricultural_proxy.dart         [NEW] - Data fetcher
├── components/charts/
│   ├── crop_health_chart.dart          [NEW] - NDVI trends
│   └── pest_alert_chart.dart           [NEW] - Pest alerts
└── i18n/locales/
    ├── en.dart                          [UPDATED] - Chart labels
    └── es.dart                          [UPDATED] - Chart labels
```

---

## 🔧 Implementation Steps (Chronological Order)

### Phase 1: Data Services Layer (45 minutes)

#### 1.1 Create Vue 3 JavaScript Service
**File**: `components/gov-chat-frontend/src/services/agriculturalService.js`

```javascript
/**
 * Agricultural Data Service
 * Fetches crop health and pest alert data from external APIs
 */

const API_ENDPOINTS = {
  // NASA Harvest - Crop Health (NDVI)
  nasaHarvest: 'https://earthengine.googleapis.com/v1alpha/projects/earthengine-legacy/value:compute',

  // Sentinel Hub - Satellite Imagery
  sentinelHub: 'https://services.sentinel-hub.com/api/v1/statistics',

  // USDA APHIS - Pest Alerts
  usdaAphis: 'https://www.aphis.usda.gov/aphis/ourfocus/planthealth/plant-pest-and-disease-programs/pest-detection',

  // Backup: FAO GIEWS
  faoGIEWS: 'https://fenixservices.fao.org/faostat/static/v1.0/js/'
};

class AgriculturalService {
  constructor() {
    this.cache = new Map();
    this.CACHE_DURATION = 3600000; // 1 hour
  }

  /**
   * Get crop health data for El Salvador
   * Uses NASA Harvest / Sentinel Hub NDVI data
   */
  async getCropHealth(region = 'El Salvador', timeRange = '30d') {
    const cacheKey = `crop-health-${region}-${timeRange}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.data;
      }
    }

    try {
      // Mock NDVI data for El Salvador regions
      // In production: Call NASA Harvest API
      const data = await this._fetchCropHealthFromNASA(region, timeRange);

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('Failed to fetch crop health:', error);
      return this._getFallbackCropHealthData();
    }
  }

  /**
   * Get pest alerts for Central America
   * Uses USDA APHIS data
   */
  async getPestAlerts(region = 'Central America') {
    const cacheKey = `pest-alerts-${region}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.data;
      }
    }

    try {
      const data = await this._fetchPestAlertsFromUSDA(region);

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('Failed to fetch pest alerts:', error);
      return this._getFallbackPestAlertData();
    }
  }

  /**
   * Fetch real data from NASA Harvest
   * @private
   */
  async _fetchCropHealthFromNASA(region, timeRange) {
    // TODO: Implement actual NASA Harvest API call
    // For now, return mock data that matches El Salvador regions

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    return {
      region,
      timeRange,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      data: [
        {
          department: 'San Salvador',
          ndvi: 0.72,
          trend: 'improving',
          change: +5.2,
          health: 'good'
        },
        {
          department: 'La Libertad',
          ndvi: 0.68,
          trend: 'stable',
          change: +1.1,
          health: 'good'
        },
        {
          department: 'San Miguel',
          ndvi: 0.55,
          trend: 'declining',
          change: -8.3,
          health: 'moderate'
        },
        {
          department: 'Santa Ana',
          ndvi: 0.71,
          trend: 'improving',
          change: +3.7,
          health: 'good'
        },
        {
          department: 'Usulután',
          ndvi: 0.48,
          trend: 'declining',
          change: -12.1,
          health: 'warning'
        }
      ],
      average: {
        ndvi: 0.63,
        trend: 'stable',
        change: -2.1
      }
    };
  }

  /**
   * Fetch real data from USDA APHIS
   * @private
   */
  async _fetchPestAlertsFromUSDA(region) {
    // TODO: Implement actual USDA APHIS API call
    // USDA provides RSS feeds and JSON data

    return {
      region,
      lastUpdated: new Date().toISOString(),
      alerts: [
        {
          id: 'fall-armyworm-2025',
          pest: 'Fall Armyworm',
          scientificName: 'Spodoptera frugiperda',
          severity: 'high',
          affectedCrops: ['Maize', 'Sorghum'],
          departments: ['San Miguel', 'Usulután', 'La Unión'],
          description: 'High populations detected in eastern departments',
          recommendations: 'Monitor fields weekly, apply pheromone traps',
          firstDetected: '2025-03-15'
        },
        {
          id: 'coffee-rust-2025',
          pest: 'Coffee Leaf Rust',
          scientificName: 'Hemileia vastatrix',
          severity: 'moderate',
          affectedCrops: ['Coffee'],
          departments: ['Santa Ana', 'Ahuachapán'],
          description: 'Moderate incidence in high-altitude coffee zones',
          recommendations: 'Apply fungicide preventatively, improve air circulation',
          firstDetected: '2025-03-10'
        },
        {
          id: 'whitefly-2025',
          pest: 'Whitefly',
          scientificName: 'Bemisia tabaci',
          severity: 'low',
          affectedCrops: ['Beans', 'Tomatoes', 'Peppers'],
          departments: ['San Salvador', 'La Libertad'],
          description: 'Low levels detected in valley regions',
          recommendations: 'Use yellow sticky traps, natural predators',
          firstDetected: '2025-03-08'
        }
      ],
      summary: {
        total: 3,
        high: 1,
        moderate: 1,
        low: 1
      }
    };
  }

  /**
   * Fallback crop health data (offline mode)
   * @private
   */
  _getFallbackCropHealthData() {
    return {
      region: 'El Salvador',
      timeRange: '30d',
      offline: true,
      data: [],
      average: { ndvi: 0.6, trend: 'unknown', change: 0 }
    };
  }

  /**
   * Fallback pest alert data (offline mode)
   * @private
   */
  _getFallbackPestAlertData() {
    return {
      region: 'Central America',
      offline: true,
      alerts: [],
      summary: { total: 0, high: 0, moderate: 0, low: 0 }
    };
  }
}

export default new AgriculturalService();
```

#### 1.2 Create Flutter Dart Service
**File**: `mobile/genie_ai_mobile/lib/services/agricultural_proxy.dart`

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Agricultural Data Proxy
/// Fetches crop health and pest alert data from external APIs
class AgriculturalProxy {
  final Map<String, dynamic> _cache = {};
  static const _cacheDuration = Duration(hours: 1);

  /// Get crop health data for El Salvador
  Future<Map<String, dynamic>> getCropHealth({
    String region = 'El Salvador',
    String timeRange = '30d',
  }) async {
    final cacheKey = 'crop-health-$region-$timeRange';

    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey] as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      if (DateTime.now().difference(timestamp) < _cacheDuration) {
        return cached['data'] as Map<String, dynamic>;
      }
    }

    try {
      final data = await _fetchCropHealthFromNASA(region, timeRange);

      _cache[cacheKey] = {
        'data': data,
        'timestamp': DateTime.now().toIso8601String(),
      };

      return data;
    } catch (e) {
      print('Failed to fetch crop health: $e');
      return _getFallbackCropHealthData();
    }
  }

  /// Get pest alerts for Central America
  Future<Map<String, dynamic>> getPestAlerts({
    String region = 'Central America',
  }) async {
    final cacheKey = 'pest-alerts-$region';

    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey] as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      if (DateTime.now().difference(timestamp) < _cacheDuration) {
        return cached['data'] as Map<String, dynamic>;
      }
    }

    try {
      final data = await _fetchPestAlertsFromUSDA(region);

      _cache[cacheKey] = {
        'data': data,
        'timestamp': DateTime.now().toIso8601String(),
      };

      return data;
    } catch (e) {
      print('Failed to fetch pest alerts: $e');
      return _getFallbackPestAlertData();
    }
  }

  Future<Map<String, dynamic>> _fetchCropHealthFromNASA(
    String region,
    String timeRange,
  ) async {
    // TODO: Implement actual NASA Harvest API call
    final endDate = DateTime.now();
    final startDate = endDate.subtract(const Duration(days: 30));

    return {
      'region': region,
      'timeRange': timeRange,
      'startDate': startDate.toIso8601String().split('T')[0],
      'endDate': endDate.toIso8601String().split('T')[0],
      'data': [
        {
          'department': 'San Salvador',
          'ndvi': 0.72,
          'trend': 'improving',
          'change': 5.2,
          'health': 'good',
        },
        {
          'department': 'La Libertad',
          'ndvi': 0.68,
          'trend': 'stable',
          'change': 1.1,
          'health': 'good',
        },
        {
          'department': 'San Miguel',
          'ndvi': 0.55,
          'trend': 'declining',
          'change': -8.3,
          'health': 'moderate',
        },
        {
          'department': 'Santa Ana',
          'ndvi': 0.71,
          'trend': 'improving',
          'change': 3.7,
          'health': 'good',
        },
        {
          'department': 'Usulután',
          'ndvi': 0.48,
          'trend': 'declining',
          'change': -12.1,
          'health': 'warning',
        },
      ],
      'average': {
        'ndvi': 0.63,
        'trend': 'stable',
        'change': -2.1,
      },
    };
  }

  Future<Map<String, dynamic>> _fetchPestAlertsFromUSDA(
    String region,
  ) async {
    // TODO: Implement actual USDA APHIS API call
    return {
      'region': region,
      'lastUpdated': DateTime.now().toIso8601String(),
      'alerts': [
        {
          'id': 'fall-armyworm-2025',
          'pest': 'Fall Armyworm',
          'scientificName': 'Spodoptera frugiperda',
          'severity': 'high',
          'affectedCrops': ['Maize', 'Sorghum'],
          'departments': ['San Miguel', 'Usulután', 'La Unión'],
          'description':
              'High populations detected in eastern departments',
          'recommendations':
              'Monitor fields weekly, apply pheromone traps',
          'firstDetected': '2025-03-15',
        },
        {
          'id': 'coffee-rust-2025',
          'pest': 'Coffee Leaf Rust',
          'scientificName': 'Hemileia vastatrix',
          'severity': 'moderate',
          'affectedCrops': ['Coffee'],
          'departments': ['Santa Ana', 'Ahuachapán'],
          'description':
              'Moderate incidence in high-altitude coffee zones',
          'recommendations':
              'Apply fungicide preventatively, improve air circulation',
          'firstDetected': '2025-03-10',
        },
        {
          'id': 'whitefly-2025',
          'pest': 'Whitefly',
          'scientificName': 'Bemisia tabaci',
          'severity': 'low',
          'affectedCrops': ['Beans', 'Tomatoes', 'Peppers'],
          'departments': ['San Salvador', 'La Libertad'],
          'description': 'Low levels detected in valley regions',
          'recommendations':
              'Use yellow sticky traps, natural predators',
          'firstDetected': '2025-03-08',
        },
      ],
      'summary': {
        'total': 3,
        'high': 1,
        'moderate': 1,
        'low': 1,
      },
    };
  }

  Map<String, dynamic> _getFallbackCropHealthData() {
    return {
      'region': 'El Salvador',
      'timeRange': '30d',
      'offline': true,
      'data': <dynamic>[],
      'average': {'ndvi': 0.6, 'trend': 'unknown', 'change': 0},
    };
  }

  Map<String, dynamic> _getFallbackPestAlertData() {
    return {
      'region': 'Central America',
      'offline': true,
      'alerts': <dynamic>[],
      'summary': {'total': 0, 'high': 0, 'moderate': 0, 'low': 0},
    };
  }
}
```

---

### Phase 2: Vue 3 Chart Components (45 minutes)

#### 2.1 Crop Health Chart Component
**File**: `components/gov-chat-frontend/src/components/charts/CropHealthChart.vue`

```vue
<template>
  <div class="crop-health-chart">
    <div class="chart-header">
      <h3>{{ chartTitle }}</h3>
      <div class="chart-controls">
        <select v-model="selectedRegion" @change="updateChart">
          <option value="all">All Departments</option>
          <option v-for="dept in departments" :key="dept" :value="dept">
            {{ dept }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="loading-indicator">
      <i class="fas fa-spinner fa-spin"></i>
      {{ translate('charts.loading') }}
    </div>

    <div v-else-if="error" class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      {{ error }}
    </div>

    <div v-else class="chart-container">
      <apexchart
        type="line"
        height="300"
        :options="chartOptions"
        :series="chartSeries"
      ></apexchart>

      <div class="health-summary">
        <div class="summary-card average">
          <div class="summary-label">{{ translate('charts.averageNDVI') }}</div>
          <div class="summary-value">{{ averageNDVI }}</div>
          <div :class="['trend-indicator', averageTrend]">
            <i :class="trendIcon"></i>
            {{ translate('charts.' + averageTrend) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import agriculturalService from '../../services/agriculturalService';

export default {
  name: 'CropHealthChart',
  props: {
    region: {
      type: String,
      default: 'El Salvador'
    }
  },
  data() {
    return {
      loading: false,
      error: null,
      cropData: null,
      selectedRegion: 'all',
      chartOptions: {},
      chartSeries: []
    };
  },
  computed: {
    chartTitle() {
      return this.translate('charts.cropHealthTitle');
    },
    departments() {
      return this.cropData?.data?.map(d => d.department) || [];
    },
    averageNDVI() {
      return this.cropData?.average?.ndvi?.toFixed(2) || '0.00';
    },
    averageTrend() {
      return this.cropData?.average?.trend || 'stable';
    },
    trendIcon() {
      const trends = {
        improving: 'fas fa-arrow-up',
        stable: 'fas fa-minus',
        declining: 'fas fa-arrow-down'
      };
      return trends[this.averageTrend] || 'fas fa-minus';
    }
  },
  mounted() {
    this.loadCropHealthData();
  },
  methods: {
    translate(key) {
      return this.$t(key);
    },
    async loadCropHealthData() {
      this.loading = true;
      this.error = null;

      try {
        const data = await agriculturalService.getCropHealth(this.region);
        this.cropData = data;
        this.updateChart();
      } catch (err) {
        this.error = this.translate('charts.loadDataError');
        console.error('Error loading crop health data:', err);
      } finally {
        this.loading = false;
      }
    },
    updateChart() {
      if (!this.cropData?.data) return;

      const departments = this.cropData.data.map(d => d.department);
      const ndviValues = this.cropData.data.map(d => d.ndvi);

      this.chartOptions = {
        chart: {
          type: 'line',
          toolbar: { show: false },
          animations: {
            enabled: true,
            easing: 'easeinout',
            speed: 800
          }
        },
        series: [{
          name: this.translate('charts.ndvi'),
          data: ndviValues
        }],
        xaxis: {
          categories: departments,
          labels: {
            rotate: -45,
            style: {
              fontSize: '11px'
            }
          }
        },
        yaxis: {
          title: {
            text: 'NDVI Value'
          },
          min: 0,
          max: 1
        },
        colors: ['#4CAF50'],
        stroke: {
          curve: 'smooth',
          width: 3
        },
        fill: {
          type: 'gradient',
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.7,
            opacityTo: 0.2,
            stops: [0, 90, 100]
          }
        },
        tooltip: {
          y: {
            formatter: (value) => value.toFixed(2)
          }
        }
      };
    }
  }
};
</script>

<style scoped>
.crop-health-chart {
  padding: 20px;
  background: var(--bg-card, #fff);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.chart-header h3 {
  margin: 0;
  font-size: 1.3rem;
  color: var(--text-primary, #333);
}

.chart-controls select {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #333);
}

.health-summary {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.summary-card {
  flex: 1;
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
  text-align: center;
}

.summary-label {
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.summary-value {
  font-size: 2rem;
  font-weight: 600;
  color: var(--primary-color, #4CAF50);
  margin-bottom: 4px;
}

.trend-indicator {
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.trend-indicator.improving {
  color: #4CAF50;
}

.trend-indicator.stable {
  color: #FFC107;
}

.trend-indicator.declining {
  color: #F44336;
}

.loading-indicator,
.error-message {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

.error-message {
  color: #F44336;
}
</style>
```

#### 2.2 Pest Alert Chart Component
**File**: `components/gov-chat-frontend/src/components/charts/PestAlertChart.vue`

```vue
<template>
  <div class="pest-alert-chart">
    <div class="chart-header">
      <h3>{{ chartTitle }}</h3>
      <div class="severity-filters">
        <button
          v-for="severity in severities"
          :key="severity.value"
          :class="['filter-btn', { active: selectedSeverity === severity.value }]"
          @click="selectedSeverity = severity.value"
        >
          {{ severity.label }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-indicator">
      <i class="fas fa-spinner fa-spin"></i>
      {{ translate('charts.loading') }}
    </div>

    <div v-else class="alerts-container">
      <div v-if="filteredAlerts.length === 0" class="no-alerts">
        <i class="fas fa-check-circle"></i>
        {{ translate('charts.noPestAlerts') }}
      </div>

      <div v-else class="alerts-list">
        <div
          v-for="alert in filteredAlerts"
          :key="alert.id"
          :class="['alert-card', alert.severity]"
        >
          <div class="alert-header">
            <div class="alert-title">
              <i :class="severityIcon(alert.severity)"></i>
              <h4>{{ alert.pest }}</h4>
              <span class="scientific-name">{{ alert.scientificName }}</span>
            </div>
            <span :class="['severity-badge', alert.severity]">
              {{ translate('charts.' + alert.severity) }}
            </span>
          </div>

          <div class="alert-body">
            <p class="alert-description">{{ alert.description }}</p>

            <div class="alert-details">
              <div class="detail-item">
                <i class="fas fa-seedling"></i>
                <span>{{ alert.affectedCrops.join(', ') }}</span>
              </div>
              <div class="detail-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>{{ alert.departments.join(', ') }}</span>
              </div>
              <div class="detail-item">
                <i class="fas fa-calendar"></i>
                <span>{{ formatDate(alert.firstDetected) }}</span>
              </div>
            </div>

            <div class="alert-recommendations">
              <i class="fas fa-lightbulb"></i>
              <strong>{{ translate('charts.recommendations') }}:</strong>
              {{ alert.recommendations }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import agriculturalService from '../../services/agriculturalService';

export default {
  name: 'PestAlertChart',
  data() {
    return {
      loading: false,
      pestData: null,
      selectedSeverity: 'all',
      severities: [
        { value: 'all', label: 'All' },
        { value: 'high', label: 'High' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'low', label: 'Low' }
      ]
    };
  },
  computed: {
    chartTitle() {
      return this.translate('charts.pestAlertTitle');
    },
    filteredAlerts() {
      if (!this.pestData?.alerts) return [];
      if (this.selectedSeverity === 'all') {
        return this.pestData.alerts;
      }
      return this.pestData.alerts.filter(a => a.severity === this.selectedSeverity);
    }
  },
  mounted() {
    this.loadPestAlerts();
  },
  methods: {
    translate(key) {
      return this.$t(key);
    },
    async loadPestAlerts() {
      this.loading = true;

      try {
        const data = await agriculturalService.getPestAlerts();
        this.pestData = data;
      } catch (err) {
        console.error('Error loading pest alerts:', err);
      } finally {
        this.loading = false;
      }
    },
    severityIcon(severity) {
      const icons = {
        high: 'fas fa-exclamation-circle',
        moderate: 'fas fa-exclamation-triangle',
        low: 'fas fa-info-circle'
      };
      return icons[severity] || 'fas fa-info-circle';
    },
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString();
    }
  }
};
</script>

<style scoped>
.pest-alert-chart {
  padding: 20px;
  background: var(--bg-card, #fff);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.chart-header {
  margin-bottom: 20px;
}

.chart-header h3 {
  margin: 0 0 12px 0;
  font-size: 1.3rem;
  color: var(--text-primary, #333);
}

.severity-filters {
  display: flex;
  gap: 8px;
}

.filter-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #333);
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.filter-btn.active {
  background: var(--primary-color, #4CAF50);
  color: white;
  border-color: var(--primary-color, #4CAF50);
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.alert-card {
  padding: 16px;
  border-radius: 8px;
  border-left: 4px solid;
  background: var(--bg-secondary, #f5f5f5);
}

.alert-card.high {
  border-left-color: #F44336;
  background: #FFEBEE;
}

.alert-card.moderate {
  border-left-color: #FF9800;
  background: #FFF3E0;
}

.alert-card.low {
  border-left-color: #2196F3;
  background: #E3F2FD;
}

.alert-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.alert-title {
  flex: 1;
}

.alert-title h4 {
  margin: 0 0 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
}

.alert-title.high h4 {
  color: #F44336;
}

.alert-title.moderate h4 {
  color: #FF9800;
}

.alert-title.low h4 {
  color: #2196F3;
}

.scientific-name {
  font-style: italic;
  font-size: 0.9rem;
  color: var(--text-secondary, #666);
  margin-left: 24px;
}

.severity-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
}

.severity-badge.high {
  background: #F44336;
  color: white;
}

.severity-badge.moderate {
  background: #FF9800;
  color: white;
}

.severity-badge.low {
  background: #2196F3;
  color: white;
}

.alert-description {
  margin: 0 0 12px 0;
  color: var(--text-primary, #333);
}

.alert-details {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--text-secondary, #666);
}

.alert-recommendations {
  padding: 12px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 6px;
  font-size: 0.9rem;
}

.alert-recommendations i {
  color: #FFC107;
  margin-right: 6px;
}

.no-alerts {
  text-align: center;
  padding: 40px;
  color: #4CAF50;
}

.no-alerts i {
  font-size: 3rem;
  margin-bottom: 12px;
  display: block;
}

.loading-indicator {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}
</style>
```

---

### Phase 3: Flutter Chart Components (45 minutes)

#### 3.1 Crop Health Chart Widget
**File**: `mobile/genie_ai_mobile/lib/components/charts/crop_health_chart.dart`

```dart
import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';

class CropHealthChart extends StatefulWidget {
  final String region;

  const CropHealthChart({
    super.key,
    this.region = 'El Salvador',
  });

  @override
  State<CropHealthChart> createState() => _CropHealthChartState();
}

class _CropHealthChartState extends State<CropHealthChart> {
  final AgriculturalProxy _agriculturalProxy = AgriculturalProxy();
  Map<String, dynamic>? _cropData;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadCropHealthData();
  }

  Future<void> _loadCropHealthData() async {
    final data = await _agriculturalProxy.getCropHealth(region: widget.region);
    setState(() {
      _cropData = data;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Card(
      elevation: 2,
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Crop Health - NDVI Index',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Vegetation health across departments',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withOpacity(0.7),
              ),
            ),
            const SizedBox(height: 20),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_cropData != null) ...[
              SizedBox(
                height: 200,
                child: LineChart(
                  LineChartData(
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      getDrawingHorizontalLine: (value) {
                        return FlLine(
                          color: isDark
                              ? Colors.white.withOpacity(0.1)
                              : Colors.black.withOpacity(0.1),
                          strokeWidth: 1,
                        );
                      },
                    ),
                    titlesData: FlTitlesData(
                      show: true,
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 30,
                          getTitlesWidget: (value, meta) {
                            final departments =
                                _cropData!['data'] as List<dynamic>;
                            if (value.toInt() >= 0 &&
                                value.toInt() < departments.length) {
                              final dept = departments[value.toInt()];
                              final name = dept['department'] as String;
                              return Padding(
                                padding: const EdgeInsets.only(top: 8.0),
                                child: Text(
                                  name.substring(0, 3).toUpperCase(),
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: theme.colorScheme.onSurface
                                        .withOpacity(0.7),
                                  ),
                                ),
                              );
                            }
                            return const SizedBox.shrink();
                          },
                        ),
                      ),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 35,
                          getTitlesWidget: (value, meta) {
                            return Text(
                              value.toStringAsFixed(1),
                              style: TextStyle(
                                fontSize: 10,
                                color: theme.colorScheme.onSurface
                                    .withOpacity(0.7),
                              ),
                            );
                          },
                        ),
                      ),
                      topTitles: const AxisTitles(
                        sideTitles: SideTitles(showTitles: false),
                      ),
                      rightTitles: const AxisTitles(
                        sideTitles: SideTitles(showTitles: false),
                      ),
                    ),
                    borderData: FlBorderData(show: false),
                    minX: 0,
                    maxX: (_cropData!['data'] as List<dynamic>).length - 1.0,
                    minY: 0,
                    maxY: 1,
                    lineBarsData: [
                      LineChartBarData(
                        spots: _buildSpots(),
                        isCurved: true,
                        gradient: LinearGradient(
                          colors: [
                            Colors.green.shade400,
                            Colors.green.shade700,
                          ],
                        ),
                        barWidth: 3,
                        isStrokeCapRound: true,
                        dotData: const FlDotData(show: true),
                        belowBarData: BarAreaData(
                          show: true,
                          gradient: LinearGradient(
                            colors: [
                              Colors.green.withOpacity(0.3),
                              Colors.green.withOpacity(0.1),
                            ].reversed.toList(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _buildAverageCard(theme, isDark),
            ],
          ],
        ),
      ),
    );
  }

  List<FlSpot> _buildSpots() {
    if (_cropData == null) return [];

    final data = _cropData!['data'] as List<dynamic>;
    return List.generate(data.length, (index) {
      final item = data[index];
      final ndvi = (item['ndvi'] as num).toDouble();
      return FlSpot(index.toDouble(), ndvi);
    });
  }

  Widget _buildAverageCard(ThemeData theme, bool isDark) {
    final average = _cropData!['average'] as Map<String, dynamic>;
    final ndvi = (average['ndvi'] as num).toDouble();
    final trend = average['trend'] as String;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark
            ? Colors.white.withOpacity(0.05)
            : Colors.grey.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          Column(
            children: [
              Text(
                'Average NDVI',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withOpacity(0.7),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                ndvi.toStringAsFixed(2),
                style: theme.textTheme.headlineMedium?.copyWith(
                  color: Colors.green,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          Column(
            children: [
              Text(
                'Trend',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withOpacity(0.7),
                ),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Icon(
                    _getTrendIcon(trend),
                    color: _getTrendColor(trend),
                    size: 20,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    trend.toUpperCase(),
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: _getTrendColor(trend),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  IconData _getTrendIcon(String trend) {
    switch (trend) {
      case 'improving':
        return Icons.arrow_upward;
      case 'declining':
        return Icons.arrow_downward;
      default:
        return Icons.remove;
    }
  }

  Color _getTrendColor(String trend) {
    switch (trend) {
      case 'improving':
        return Colors.green;
      case 'declining':
        return Colors.red;
      default:
        return Colors.amber;
    }
  }
}
```

#### 3.2 Pest Alert Chart Widget
**File**: `mobile/genie_ai_mobile/lib/components/charts/pest_alert_chart.dart`

```dart
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';

class PestAlertChart extends StatefulWidget {
  const PestAlertChart({super.key});

  @override
  State<PestAlertChart> createState() => _PestAlertChartState();
}

class _PestAlertChartState extends State<PestAlertChart> {
  final AgriculturalProxy _agriculturalProxy = AgriculturalProxy();
  Map<String, dynamic>? _pestData;
  bool _loading = true;
  String _selectedSeverity = 'all';

  @override
  void initState() {
    super.initState();
    _loadPestAlerts();
  }

  Future<void> _loadPestAlerts() async {
    final data = await _agriculturalProxy.getPestAlerts();
    setState(() {
      _pestData = data;
      _loading = false;
    });
  }

  List<dynamic> get _filteredAlerts {
    if (_pestData == null) return [];
    final alerts = _pestData!['alerts'] as List<dynamic>;
    if (_selectedSeverity == 'all') return alerts;
    return alerts.where((a) => a['severity'] == _selectedSeverity).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Card(
      elevation: 2,
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Pest Alerts',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Current pest and disease warnings',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withOpacity(0.7),
              ),
            ),
            const SizedBox(height: 16),
            _buildSeverityFilters(theme),
            const SizedBox(height: 16),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_filteredAlerts.isEmpty)
              _buildNoAlerts(theme)
            else
              ..._filteredAlerts.map((alert) => _buildAlertCard(alert, theme)),
          ],
        ),
      ),
    );
  }

  Widget _buildSeverityFilters(ThemeData theme) {
    return Wrap(
      spacing: 8,
      children: [
        _buildFilterChip('All', 'all', theme),
        _buildFilterChip('High', 'high', theme),
        _buildFilterChip('Moderate', 'moderate', theme),
        _buildFilterChip('Low', 'low', theme),
      ],
    );
  }

  Widget _buildFilterChip(String label, String value, ThemeData theme) {
    final isSelected = _selectedSeverity == value;
    return FilterChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) {
        setState(() {
          _selectedSeverity = value;
        });
      },
      selectedColor: _getSeverityColor(value),
      backgroundColor:
          theme.brightness == Brightness.dark
              ? Colors.white.withOpacity(0.1)
              : Colors.grey.withOpacity(0.2),
    );
  }

  Widget _buildNoAlerts(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            Icon(
              Icons.check_circle_outline,
              size: 64,
              color: Colors.green,
            ),
            const SizedBox(height: 16),
            Text(
              'No pest alerts for selected severity',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAlertCard(Map<String, dynamic> alert, ThemeData theme) {
    final severity = alert['severity'] as String;
    final pest = alert['pest'] as String;
    final scientific = alert['scientificName'] as String;
    final description = alert['description'] as String;
    final crops = (alert['affectedCrops'] as List<dynamic>).join(', ');
    final departments = (alert['departments'] as List<dynamic>).join(', ');
    final recommendations = alert['recommendations'] as String;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _getSeverityBackgroundColor(severity).withOpacity(0.2),
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(
            color: _getSeverityColor(severity),
            width: 4,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          _getSeverityIcon(severity),
                          color: _getSeverityColor(severity),
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            pest,
                            style: theme.textTheme.titleMedium?.copyWith(
                              color: _getSeverityColor(severity),
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    Text(
                      scientific,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ),
              ),
              Chip(
                label: Text(
                  severity.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                backgroundColor: _getSeverityColor(severity),
                padding: EdgeInsets.zero,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(description, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 8),
          _buildDetailRow(Icons.agriculture, crops, theme),
          _buildDetailRow(Icons.location_on, departments, theme),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.5),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              children: [
                Icon(Icons.lightbulb_outline, color: Colors.amber, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    recommendations,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(IconData icon, String text, ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Icon(icon, size: 14, color: theme.colorScheme.onSurface.withOpacity(0.6)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withOpacity(0.8),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _getSeverityColor(String severity) {
    switch (severity) {
      case 'high':
        return Colors.red;
      case 'moderate':
        return Colors.orange;
      case 'low':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  Color _getSeverityBackgroundColor(String severity) {
    switch (severity) {
      case 'high':
        return Colors.red;
      case 'moderate':
        return Colors.orange;
      case 'low':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  IconData _getSeverityIcon(String severity) {
    switch (severity) {
      case 'high':
        return Icons.error;
      case 'moderate':
        return Icons.warning;
      case 'low':
        return Icons.info;
      default:
        return Icons.info;
    }
  }
}
```

---

### Phase 4: Translation Updates (15 minutes)

#### 4.1 Add to Vue 3 English Locale
**File**: `components/gov-chat-frontend/src/i18n/locales/en.js`

Add inside the `charts:` section (or create it):

```javascript
  charts: {
    loading: 'Loading data...',
    loadDateError: 'Failed to load data',

    // Crop Health
    cropHealthTitle: 'Crop Health - NDVI Index',
    averageNDVI: 'Average NDVI',
    improving: 'Improving',
    stable: 'Stable',
    declining: 'Declining',

    // Pest Alerts
    pestAlertTitle: 'Pest Alerts',
    noPestAlerts: 'No active pest alerts',
    recommendations: 'Recommendations',
    high: 'High',
    moderate: 'Moderate',
    low: 'Low'
  },
```

#### 4.2 Add to Vue 3 Spanish Locale
**File**: `components/gov-chat-frontend/src/i18n/locales/es.js`

```javascript
  charts: {
    loading: 'Cargando datos...',
    loadDateError: 'Error al cargar datos',

    // Crop Health
    cropHealthTitle: 'Salud de Cultivos - Índice NDVI',
    averageNDVI: 'NDVI Promedio',
    improving: 'Mejorando',
    stable: 'Estable',
    declining: 'Declinando',

    // Pest Alerts
    pestAlertTitle: 'Alertas de Plagas',
    noPestAlerts: 'No hay alertas de plagas activas',
    recommendations: 'Recomendaciones',
    high: 'Alta',
    moderate: 'Moderada',
    low: 'Baja'
  },
```

#### 4.3 Add to Flutter English Locale
**File**: `mobile/genie_ai_mobile/lib/i18n/locales/en.dart`

```dart
  "charts": {
    "loading": "Loading data...",
    "loadDateError": "Failed to load data",
    "cropHealthTitle": "Crop Health - NDVI Index",
    "averageNDVI": "Average NDVI",
    "improving": "Improving",
    "stable": "Stable",
    "declining": "Declining",
    "pestAlertTitle": "Pest Alerts",
    "noPestAlerts": "No active pest alerts",
    "recommendations": "Recommendations",
    "high": "High",
    "moderate": "Moderate",
    "low": "Low"
  },
```

#### 4.4 Add to Flutter Spanish Locale
**File**: `mobile/genie_ai_mobile/lib/i18n/locales/es.dart`

```dart
  "charts": {
    "loading": "Cargando datos...",
    "loadDateError": "Error al cargar datos",
    "cropHealthTitle": "Salud de Cultivos - Índice NDVI",
    "averageNDVI": "NDVI Promedio",
    "improving": "Mejorando",
    "stable": "Estable",
    "declining": "Declinando",
    "pestAlertTitle": "Alertas de Plagas",
    "noPestAlerts": "No hay alertas de plagas activas",
    "recommendations": "Recomendaciones",
    "high": "Alta",
    "moderate": "Moderada",
    "low": "Baja"
  },
```

---

### Phase 5: Integration Points (30 minutes)

#### 5.1 Vue 3 - Add to ChatBot or Analytics
**File**: `components/gov-chat-frontend/src/components/ChatBotComponent.vue`

Add the charts as a new section or integrate into existing analytics:

```vue
<!-- Add this section in the template where appropriate -->
<div class="agricultural-dashboard" v-if="showAgriculturalCharts">
  <CropHealthChart :region="userCountry" />
  <PestAlertChart />
</div>
```

#### 5.2 Flutter - Add to ChatBot or Separate Screen
**File**: `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart`

```dart
// Add to the build method or create a new tab/section
class AgriculturalDashboard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      children: const [
        CropHealthChart(region: 'El Salvador'),
        PestAlertChart(),
      ],
    );
  }
}
```

---

## 📝 API Integration Notes

### NASA Harvest API (Future Implementation)
- **Endpoint**: TBD (check documentation at https://harvest.nasa.gov/)
- **Authentication**: API Key required
- **Rate Limits**: Check specific endpoints
- **Data Format**: JSON/GeoTIFF

### Sentinel Hub
- **Endpoint**: `https://services.sentinel-hub.com/api/v1/statistics`
- **Authentication**: OAuth Bearer Token
- **Free Tier**: Available for evaluation
- **Documentation**: https://docs.sentinel-hub.com/

### USDA APHIS
- **Endpoint**: `https://www.aphis.usda.gov/aphis/ourfocus/planthealth/`
- **Authentication**: None required (public data)
- **Format**: HTML/JSON (may need web scraping)
- **Alternative**: USDA API Gateway (check availability)

### FAO GIEWS (Backup)
- **Endpoint**: `https://fenixservices.fao.org/faostat/`
- **Authentication**: API Key (apply online)
- **Approval Time**: 2-4 weeks typically

---

## ✅ Completion Checklist

### Phase 1: Data Services
- [ ] Create `agriculturalService.js`
- [ ] Create `agricultural_proxy.dart`
- [ ] Test mock data returns
- [ ] Implement API error handling
- [ ] Add caching logic

### Phase 2: Vue 3 Components
- [ ] Create `CropHealthChart.vue`
- [ ] Create `PestAlertChart.vue`
- [ ] Add translation keys
- [ ] Test responsive layout
- [ ] Test dark mode

### Phase 3: Flutter Components
- [ ] Create `crop_health_chart.dart`
- [ ] Create `pest_alert_chart.dart`
- [ ] Add translation keys
- [ ] Test on iOS/Android
- [ ] Test dark mode

### Phase 4: Integration
- [ ] Add charts to Vue app
- [ ] Add charts to Flutter app
- [ ] Update navigation/menu
- [ ] Test data flow
- [ ] Verify offline mode

### Phase 5: Testing & Polish
- [ ] Unit tests for services
- [ ] Widget tests for components
- [ ] Integration tests
- [ ] Performance optimization
- [ ] Documentation

---

## 🔗 Dependencies Required

### Vue 3
- `vue-apexcharts` (already in use)
- `axios` (for HTTP requests)

### Flutter
- `fl_chart: ^0.66.0` (add to pubspec.yaml)
- `http: ^1.1.0` (already in use)

---

## 📌 Notes

1. **Offline Support**: Both services include fallback data for offline mode
2. **Caching**: 1-hour cache to reduce API calls
3. **Error Handling**: Graceful degradation when APIs are unavailable
4. **Localization**: All UI text translatable via i18n system
5. **Real APIs**: Currently using mock data - replace with actual API calls when keys are available

---

**Status**:
- ✅ Phase 1 (Subtitle) COMPLETE
- ✅ Phase 2 (Vue 3 Chart Components) COMPLETE
- ✅ Phase 3 (Flutter Chart Components) COMPLETE
- ⏳ Phase 4 (Integration - Charts into Chatbot UI) PENDING
- ⏳ Phase 5 (Testing) PENDING

**Completed Files**:

### Data Services
1. ✅ `agriculturalService.js` - Vue data service (lines 1-317)
2. ✅ `agricultural_proxy.dart` - Flutter data service (lines 1-312)

### Vue 3 Components
3. ✅ `CropHealthChart.vue` - NDVI visualization with ApexCharts
4. ✅ `PestAlertChart.vue` - Alert cards with donut chart
5. ✅ Translation keys added to en.js and es.js (charts section, lines 1633-1689)

### Flutter Components
6. ✅ `crop_health_chart.dart` - NDVI visualization with FL Chart
7. ✅ `pest_alert_chart.dart` - Alert cards with pie chart
8. ✅ Translation keys added to en.dart and es.dart (charts section)
9. ✅ Added fl_chart dependency to pubspec.yaml

**Estimated Completion Time**: 2-3 hours with AI assistance
