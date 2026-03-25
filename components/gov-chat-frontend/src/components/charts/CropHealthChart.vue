<template>
  <div class="crop-health-chart" :class="{ 'dark-mode': isDarkMode }">
    <div class="chart-header">
      <div class="header-text">
        <h3>{{ chartTitle }}</h3>
        <p class="chart-subtitle">{{ chartSubtitle }}</p>
      </div>
      <div class="chart-controls">
        <select
          v-model="selectedRegion"
          @change="updateChartData"
          class="region-selector"
        >
          <option value="all">All Departments</option>
          <option v-for="dept in departments" :key="dept" :value="dept">
            {{ dept }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="loading-indicator">
      <i class="fas fa-spinner fa-spin"></i>
      <span>{{ translate("charts.loading", "Loading data...") }}</span>
    </div>

    <div v-else-if="error" class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      <span>{{ error }}</span>
    </div>

    <div v-else class="chart-content">
      <!-- NDVI Line Chart -->
      <div class="ndvi-chart-container">
        <apexchart
          type="line"
          height="300"
          :options="chartOptions"
          :series="chartSeries"
        ></apexchart>
      </div>

      <!-- Health Summary Cards -->
      <div class="health-summary">
        <div class="summary-card average">
          <div class="summary-icon">
            <i class="fas fa-leaf"></i>
          </div>
          <div class="summary-content">
            <div class="summary-label">
              {{ translate("charts.averageNDVI", "Average NDVI") }}
            </div>
            <div class="summary-value">{{ averageNDVI }}</div>
            <div :class="['trend-indicator', averageTrend]">
              <i :class="trendIcon"></i>
              <span>{{ translateTrend(averageTrend) }}</span>
              <span class="change-value" v-if="averageChange !== 0">
                ({{ averageChange > 0 ? "+" : "" }}{{ averageChange }}%)
              </span>
            </div>
          </div>
        </div>

        <div class="summary-card health-status">
          <div class="summary-icon" :class="overallHealthClass">
            <i :class="healthIcon"></i>
          </div>
          <div class="summary-content">
            <div class="summary-label">
              {{ translate("charts.overallHealth", "Overall Health") }}
            </div>
            <div class="summary-value" :class="overallHealthClass">
              {{ translateHealthStatus(overallHealth) }}
            </div>
            <div class="health-details">
              {{ healthyDepartments }}/{{ totalDepartments }}
              {{ translate("charts.departments", "departments") }}
            </div>
          </div>
        </div>
      </div>

      <!-- Department Details -->
      <div class="department-details">
        <h4>{{ translate("charts.byDepartment", "By Department") }}</h4>
        <div class="department-list">
          <div
            v-for="(dept, index) in departmentData"
            :key="dept.department"
            class="department-item"
            :class="dept.health"
          >
            <div class="dept-info">
              <span class="dept-name">{{ dept.department }}</span>
              <span class="dept-ndvi">{{ dept.ndvi.toFixed(2) }}</span>
            </div>
            <div class="dept-trend">
              <i :class="getTrendIcon(dept.trend)"></i>
              <span class="dept-change" :class="{ positive: dept.change > 0, negative: dept.change < 0 }">
                {{ dept.change > 0 ? "+" : "" }}{{ dept.change }}%
              </span>
            </div>
            <div class="dept-health-bar">
              <div
                class="health-bar-fill"
                :class="dept.health"
                :style="{ width: (dept.ndvi * 100) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Last Updated -->
      <div class="last-updated">
        <i class="fas fa-clock"></i>
        {{ translate("charts.lastUpdated", "Last updated") }}:
        {{ formatDate(lastUpdated) }}
      </div>
    </div>
  </div>
</template>

<script>
import agriculturalService from "../../services/agriculturalService";

export default {
  name: "CropHealthChart",
  props: {
    region: {
      type: String,
      default: "El Salvador",
    },
    autoRefresh: {
      type: Boolean,
      default: false,
    },
    refreshInterval: {
      type: Number,
      default: 300000, // 5 minutes
    },
  },
  data() {
    return {
      loading: false,
      error: null,
      cropData: null,
      selectedRegion: "all",
      refreshTimer: null,
    };
  },
  computed: {
    isDarkMode() {
      return (
        this.$root?.darkMode ||
        document.documentElement.getAttribute("data-theme") === "dark"
      );
    },
    chartTitle() {
      return this.translate("charts.cropHealthTitle", "Crop Health - NDVI Index");
    },
    chartSubtitle() {
      return this.translate(
        "charts.cropHealthSubtitle",
        "Vegetation health across departments"
      );
    },
    departmentData() {
      if (!this.cropData?.data) return [];
      if (this.selectedRegion === "all") {
        return this.cropData.data;
      }
      return this.cropData.data.filter((d) => d.department === this.selectedRegion);
    },
    departments() {
      return this.cropData?.data?.map((d) => d.department) || [];
    },
    averageNDVI() {
      if (!this.cropData?.average) return "0.00";
      return this.cropData.average.ndvi.toFixed(2);
    },
    averageTrend() {
      return this.cropData?.average?.trend || "stable";
    },
    averageChange() {
      if (!this.cropData?.average) return 0;
      return this.cropData.average.change;
    },
    trendIcon() {
      const icons = {
        improving: "fas fa-arrow-up",
        stable: "fas fa-minus",
        declining: "fas fa-arrow-down",
      };
      return icons[this.averageTrend] || "fas fa-minus";
    },
    overallHealth() {
      if (!this.cropData?.data) return "unknown";
      const healthy = this.cropData.data.filter((d) => d.health === "good").length;
      const warning = this.cropData.data.filter((d) => d.health === "warning").length;
      const total = this.cropData.data.length;

      if (warning >= 2) return "warning";
      if (healthy >= total - 1) return "good";
      return "moderate";
    },
    overallHealthClass() {
      return this.overallHealth;
    },
    healthIcon() {
      const icons = {
        good: "fas fa-check-circle",
        moderate: "fas fa-exclamation-circle",
        warning: "fas fa-exclamation-triangle",
        unknown: "fas fa-question-circle",
      };
      return icons[this.overallHealth] || "fas fa-question-circle";
    },
    healthyDepartments() {
      if (!this.cropData?.data) return 0;
      return this.cropData.data.filter((d) => d.health === "good").length;
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
      const colors = this.departmentData.map((d) => this.getHealthColor(d.health));

      return {
        chart: {
          type: "line",
          toolbar: { show: false },
          animations: {
            enabled: true,
            easing: "easeinout",
            speed: 800,
          },
          background: "transparent",
        },
        series: [
          {
            name: this.translate("charts.ndvi", "NDVI Value"),
            data: ndviValues,
          },
        ],
        xaxis: {
          categories: departments,
          labels: {
            rotate: -45,
            style: {
              fontSize: "11px",
              colors: this.isDarkMode ? "#9ca3af" : "#6b7280",
            },
          },
          axisBorder: { show: false },
          axisTicks: { show: false },
        },
        yaxis: {
          title: {
            text: this.translate("charts.ndviValue", "NDVI Value"),
            style: {
              color: this.isDarkMode ? "#9ca3af" : "#6b7280",
            },
          },
          min: 0,
          max: 1,
          labels: {
            style: {
              colors: this.isDarkMode ? "#9ca3af" : "#6b7280",
            },
            formatter: (value) => value.toFixed(2),
          },
        },
        colors: colors,
        stroke: {
          curve: "smooth",
          width: 3,
        },
        fill: {
          type: "gradient",
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.5,
            opacityTo: 0.1,
            stops: [0, 90, 100],
          },
        },
        markers: {
          size: 6,
          colors: colors,
          strokeColors: this.isDarkMode ? "#1f2937" : "#ffffff",
          strokeWidth: 2,
        },
        tooltip: {
          y: {
            formatter: (value) => value.toFixed(3),
          },
          theme: this.isDarkMode ? "dark" : "light",
        },
        grid: {
          borderColor: this.isDarkMode ? "#374151" : "#e5e7eb",
          strokeDashArray: 4,
        },
      };
    },
    chartSeries() {
      const ndviValues = this.departmentData.map((d) => d.ndvi);
      return [
        {
          name: this.translate("charts.ndvi", "NDVI"),
          data: ndviValues,
        },
      ];
    },
  },
  mounted() {
    this.loadCropHealthData();
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(
        this.loadCropHealthData,
        this.refreshInterval
      );
    }
  },
  beforeUnmount() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  },
  methods: {
    translate(key, defaultValue) {
      return this.$t(key, defaultValue);
    },
    translateTrend(trend) {
      const translations = {
        improving: this.translate("charts.improving", "Improving"),
        stable: this.translate("charts.stable", "Stable"),
        declining: this.translate("charts.declining", "Declining"),
      };
      return translations[trend] || trend;
    },
    translateHealthStatus(status) {
      const translations = {
        good: this.translate("charts.good", "Good"),
        moderate: this.translate("charts.moderate", "Moderate"),
        warning: this.translate("charts.warning", "Warning"),
        unknown: this.translate("charts.unknown", "Unknown"),
      };
      return translations[status] || status;
    },
    getHealthColor(health) {
      const colors = {
        good: "#4CAF50",
        moderate: "#FF9800",
        warning: "#F44336",
        unknown: "#9E9E9E",
      };
      return colors[health] || "#9E9E9E";
    },
    getTrendIcon(trend) {
      const icons = {
        improving: "fas fa-arrow-up",
        stable: "fas fa-minus",
        declining: "fas fa-arrow-down",
      };
      return icons[trend] || "fas fa-minus";
    },
    async loadCropHealthData() {
      this.loading = true;
      this.error = null;

      try {
        const data = await agriculturalService.getCropHealth(this.region);
        this.cropData = {
          ...data,
          lastUpdated: new Date().toISOString(),
        };
      } catch (err) {
        this.error = this.translate("charts.loadDataError", "Failed to load data");
        console.error("Error loading crop health data:", err);
      } finally {
        this.loading = false;
      }
    },
    updateChartData() {
      // Triggered when region selection changes
      // Data is already filtered via computed property
    },
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleString();
    },
    refresh() {
      this.loadCropHealthData();
    },
  },
};
</script>

<style scoped>
.crop-health-chart {
  padding: 24px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.crop-health-chart.dark-mode {
  background: #1f2937;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.header-text h3 {
  margin: 0 0 4px 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #111827;
}

.dark-mode .header-text h3 {
  color: #f9fafb;
}

.chart-subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: #6b7280;
}

.dark-mode .chart-subtitle {
  color: #9ca3af;
}

.chart-controls select {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.2s;
}

.chart-controls select:hover {
  border-color: #4CAF50;
}

.dark-mode .chart-controls select {
  background: #374151;
  border-color: #4b5563;
  color: #f9fafb;
}

.loading-indicator,
.error-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: #6b7280;
}

.dark-mode .loading-indicator,
.dark-mode .error-message {
  color: #9ca3af;
}

.error-message {
  color: #ef4444;
}

.ndvi-chart-container {
  margin-bottom: 24px;
}

.health-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.dark-mode .summary-card {
  background: #374151;
  border-color: #4b5563;
}

.summary-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 1.5rem;
  background: var(--primary-color, #4CAF50);
  color: white;
}

.summary-icon.good {
  background: #4CAF50;
}

.summary-icon.moderate {
  background: #FF9800;
}

.summary-icon.warning {
  background: #F44336;
}

.summary-icon.unknown {
  background: #9E9E9E;
}

.summary-content {
  flex: 1;
}

.summary-label {
  font-size: 0.85rem;
  color: #6b7280;
  margin-bottom: 4px;
}

.dark-mode .summary-label {
  color: #9ca3af;
}

.summary-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: #111827;
}

.dark-mode .summary-value {
  color: #f9fafb;
}

.summary-value.good {
  color: #4CAF50;
}

.summary-value.moderate {
  color: #FF9800;
}

.summary-value.warning {
  color: #F44336;
}

.trend-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  margin-top: 4px;
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

.change-value {
  opacity: 0.8;
}

.health-details {
  font-size: 0.85rem;
  color: #6b7280;
  margin-top: 4px;
}

.dark-mode .health-details {
  color: #9ca3af;
}

.department-details h4 {
  margin: 0 0 16px 0;
  font-size: 1.1rem;
  color: #111827;
}

.dark-mode .department-details h4 {
  color: #f9fafb;
}

.department-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.department-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  align-items: center;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  border-left: 4px solid transparent;
}

.dark-mode .department-item {
  background: #374151;
}

.department-item.good {
  border-left-color: #4CAF50;
}

.department-item.moderate {
  border-left-color: #FF9800;
}

.department-item.warning {
  border-left-color: #F44336;
}

.dept-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dept-name {
  font-weight: 600;
  color: #111827;
}

.dark-mode .dept-name {
  color: #f9fafb;
}

.dept-ndvi {
  font-size: 0.85rem;
  color: #6b7280;
}

.dark-mode .dept-ndvi {
  color: #9ca3af;
}

.dept-trend {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 60px;
}

.dept-change {
  font-size: 0.9rem;
  font-weight: 600;
}

.dept-change.positive {
  color: #4CAF50;
}

.dept-change.negative {
  color: #F44336;
}

.dept-health-bar {
  width: 100px;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.dark-mode .dept-health-bar {
  background: #4b5563;
}

.health-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.health-bar-fill.good {
  background: #4CAF50;
}

.health-bar-fill.moderate {
  background: #FF9800;
}

.health-bar-fill.warning {
  background: #F44336;
}

.last-updated {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
  font-size: 0.85rem;
  color: #6b7280;
}

.dark-mode .last-updated {
  color: #9ca3af;
}

@media (max-width: 768px) {
  .crop-health-chart {
    padding: 16px;
  }

  .chart-header {
    flex-direction: column;
  }

  .chart-controls {
    width: 100%;
  }

  .chart-controls select {
    width: 100%;
  }

  .health-summary {
    grid-template-columns: 1fr;
  }

  .department-item {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .dept-health-bar {
    width: 100%;
  }
}
</style>
