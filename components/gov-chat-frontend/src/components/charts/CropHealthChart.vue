<template>
  <div class="crop-health-chart">
    <div class="chart-header">
      <div>
        <h3>{{ $t('charts.cropHealthTitle', 'Crop Health - NDVI Index') }}</h3>
        <p class="chart-subtitle">{{ $t('charts.cropHealthSubtitle', 'Vegetation health across departments') }}</p>
      </div>
      <DsSelect v-model="selectedRegion" input-id="region-select">
        <option value="all">{{ $t('charts.allDepartments', 'All Departments') }}</option>
        <option v-for="dept in departments" :key="dept" :value="dept">{{ dept }}</option>
      </DsSelect>
    </div>

    <DsSpinner v-if="loading" overlay>
      <span>{{ $t('charts.loading', 'Loading data...') }}</span>
    </DsSpinner>

    <DsStateDisplay v-else-if="error" type="error" :message="error" />

    <DsStateDisplay v-else-if="!cropData" type="empty">
      {{ $t('charts.noData', 'No crop health data available') }}
    </DsStateDisplay>

    <div v-else class="chart-content">
      <!-- NDVI Line Chart -->
      <DsCard variant="elevated" padding="lg">
        <apexchart type="line" height="300" :options="chartOptions" :series="chartSeries" />
      </DsCard>

      <!-- Health Summary Cards -->
      <div class="summary-grid">
        <DsCard variant="elevated">
          <div class="summary-item">
            <span class="summary-label">{{ $t('charts.averageNDVI', 'Average NDVI') }}</span>
            <strong class="summary-value">{{ averageNDVI }}</strong>
            <DsPill :variant="averageTrend === 'improving' ? 'success' : averageTrend === 'declining' ? 'danger' : 'warning'">
              {{ translateTrend(averageTrend) }}
              <span v-if="averageChange !== 0">({{ averageChange > 0 ? '+' : '' }}{{ averageChange }}%)</span>
            </DsPill>
          </div>
        </DsCard>

        <DsCard variant="elevated">
          <div class="summary-item">
            <span class="summary-label">{{ $t('charts.overallHealth', 'Overall Health') }}</span>
            <strong class="summary-value">{{ translateHealthStatus(overallHealth) }}</strong>
            <DsPill :variant="overallHealth === 'good' ? 'success' : overallHealth === 'warning' ? 'danger' : 'warning'">
              {{ healthyDepartments }}/{{ totalDepartments }} {{ $t('charts.departments', 'departments') }}
            </DsPill>
          </div>
        </DsCard>
      </div>

      <!-- Department Details -->
      <h4 class="section-title">{{ $t('charts.byDepartment', 'By Department') }}</h4>
      <div class="department-list">
        <DsCard v-for="dept in departmentData" :key="dept.department" variant="flat" padding="sm">
          <div class="dept-row">
            <span class="dept-name">{{ dept.department }}</span>
            <strong class="dept-ndvi">{{ dept.ndvi.toFixed(2) }}</strong>
            <DsPill :variant="dept.health === 'good' ? 'success' : dept.health === 'warning' ? 'danger' : 'warning'">
              {{ translateHealthStatus(dept.health) }}
            </DsPill>
            <span class="dept-change" :class="{ positive: dept.change > 0, negative: dept.change < 0 }">
              {{ dept.change > 0 ? '+' : '' }}{{ dept.change }}%
            </span>
          </div>
        </DsCard>
      </div>

      <p class="last-updated">{{ $t('charts.lastUpdated', 'Last updated') }}: {{ formatDate(lastUpdated) }}</p>
    </div>
  </div>
</template>

<script>
import agriculturalService from '../../services/agriculturalService.js';
import { useChartTheme } from '../../composables/useChartTheme.js';
import DsCard from '../ds/Card.vue';
import DsPill from '../ds/Pill.vue';
import DsSelect from '../ds/Select.vue';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';

export default {
  name: 'CropHealthChart',
  components: { DsCard, DsPill, DsSelect, DsSpinner, DsStateDisplay },
  props: {
    region: {
      type: String,
      default: 'El Salvador'
    },
    autoRefresh: {
      type: Boolean,
      default: false
    },
    refreshInterval: {
      type: Number,
      default: 300000
    }
  },
  data() {
    return {
      loading: false,
      error: null,
      cropData: null,
      selectedRegion: 'all',
      refreshTimer: null
    };
  },
  setup() {
    const { theme, isDarkMode, getCssVarStrings } = useChartTheme({
      onThemeChange: () => {
        // Theme change triggers re-render via computed chartOptions
      }
    });
    return { theme, isDarkMode, getCssVarStrings };
  },
  computed: {
    departments() {
      return this.cropData?.data?.map((d) => d.department) || [];
    },
    departmentData() {
      if (!this.cropData?.data) return [];
      if (this.selectedRegion === 'all') return this.cropData.data;
      return this.cropData.data.filter((d) => d.department === this.selectedRegion);
    },
    averageNDVI() {
      if (!this.cropData?.average) return '0.00';
      return this.cropData.average.ndvi.toFixed(2);
    },
    averageTrend() {
      return this.cropData?.average?.trend || 'stable';
    },
    averageChange() {
      if (!this.cropData?.average) return 0;
      return this.cropData.average.change;
    },
    overallHealth() {
      if (!this.cropData?.data) return 'unknown';
      const healthy = this.cropData.data.filter((d) => d.health === 'good').length;
      const warning = this.cropData.data.filter((d) => d.health === 'warning').length;
      const total = this.cropData.data.length;

      if (warning >= 2) return 'warning';
      if (healthy >= total - 1) return 'good';
      return 'moderate';
    },
    healthyDepartments() {
      if (!this.cropData?.data) return 0;
      return this.cropData.data.filter((d) => d.health === 'good').length;
    },
    totalDepartments() {
      return this.cropData?.data?.length || 0;
    },
    lastUpdated() {
      return this.cropData?.lastUpdated || new Date().toISOString();
    },
    chartOptions() {
      const departments = this.departmentData.map((d) => d.department);
      const ndviValues = this.departmentData.map((d) => d.ndvi);
      const pointColors = this.departmentData.map((d) => this.getHealthColor(d.health));
      const cssVars = this.getCssVarStrings();

      return {
        chart: {
          type: 'line',
          toolbar: { show: false },
          animations: { enabled: true, easing: 'easeinout', speed: 800 },
          background: 'transparent'
        },
        xaxis: {
          categories: departments,
          labels: { rotate: -45, style: { fontSize: '11px', colors: cssVars.mutedColor } },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis: {
          title: { text: this.$t('charts.ndviValue', 'NDVI Value'), style: { color: cssVars.mutedColor } },
          min: 0,
          max: 1,
          labels: { style: { colors: cssVars.mutedColor }, formatter: (v) => v.toFixed(2) }
        },
        colors: pointColors,
        stroke: { curve: 'smooth', width: 3 },
        fill: {
          type: 'gradient',
          gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.1, stops: [0, 90, 100] }
        },
        markers: { size: 6, colors: pointColors, strokeColors: cssVars.backgroundColor, strokeWidth: 2 },
        tooltip: { y: { formatter: (v) => v.toFixed(3) }, theme: this.isDarkMode ? 'dark' : 'light' },
        grid: { borderColor: cssVars.gridColor, strokeDashArray: 4 }
      };
    },
    chartSeries() {
      return [
        {
          name: this.$t('charts.ndvi', 'NDVI'),
          data: this.departmentData.map((d) => d.ndvi)
        }
      ];
    }
  },
  mounted() {
    this.loadCropHealthData();
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(this.loadCropHealthData, this.refreshInterval);
    }
  },
  beforeUnmount() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  },
  methods: {
    getHealthColor(health) {
      const map = { good: 'var(--success)', moderate: 'var(--warning)', warning: 'var(--danger)' };
      return map[health] || 'var(--muted)';
    },
    translateTrend(trend) {
      const map = {
        improving: this.$t('charts.improving', 'Improving'),
        stable: this.$t('charts.stable', 'Stable'),
        declining: this.$t('charts.declining', 'Declining')
      };
      return map[trend] || trend;
    },
    translateHealthStatus(status) {
      const map = {
        good: this.$t('charts.good', 'Good'),
        moderate: this.$t('charts.moderate', 'Moderate'),
        warning: this.$t('charts.warning', 'Warning'),
        unknown: this.$t('charts.unknown', 'Unknown')
      };
      return map[status] || status;
    },
    async loadCropHealthData() {
      this.loading = true;
      this.error = null;
      try {
        const data = await agriculturalService.getCropHealth(this.region);
        this.cropData = { ...data, lastUpdated: new Date().toISOString() };
      } catch (err) {
        this.error = this.$t('charts.loadDataError', 'Failed to load data');
        console.error('Error loading crop health data:', err);
      } finally {
        this.loading = false;
      }
    },
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleString();
    }
  }
};
</script>

<style scoped>
.crop-health-chart {
  position: relative;
  width: 100%;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.chart-header h3 {
  margin: 0;
  font-size: var(--text-lg);
  color: var(--fg);
}

.chart-subtitle {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-sm);
  color: var(--muted);
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  margin: var(--space-lg) 0;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.summary-label {
  font-size: var(--text-sm);
  color: var(--muted);
}

.summary-value {
  font-size: var(--text-xl);
}

.section-title {
  margin: var(--space-lg) 0 var(--space-md);
  font-size: var(--text-md);
  color: var(--fg);
}

.department-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.dept-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.dept-name {
  flex: 1;
  font-size: var(--text-sm);
}

.dept-ndvi {
  font-size: var(--text-sm);
  min-width: 4ch;
  text-align: right;
}

.dept-change {
  font-size: var(--text-xs);
  min-width: 5ch;
  text-align: right;
}

.dept-change.positive {
  color: var(--success);
}

.dept-change.negative {
  color: var(--danger);
}

.last-updated {
  margin-top: var(--space-md);
  font-size: var(--text-xs);
  color: var(--muted);
}

@media (max-width: 640px) {
  .chart-header {
    flex-direction: column;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
