<template>
  <div class="crop-health-summary-card" :class="{ 'dark-mode': isDarkMode }" @click="openChart">
    <div class="card-content">
      <div class="donut-chart">
        <svg viewBox="0 0 100 100" class="donut">
          <circle
            cx="50"
            cy="50"
            r="40"
            :stroke="backgroundColor"
            stroke-width="8"
            fill="none"
          />
          <circle
            v-for="(segment, index) in segments"
            :key="index"
            cx="50"
            cy="50"
            r="40"
            :stroke="segment.color"
            stroke-width="8"
            fill="none"
            :stroke-dasharray="`${segment.length} ${remainingLength}`"
            :stroke-dashoffset="segment.offset"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div class="donut-center">
          <div class="health-percentage">{{ healthPercentage }}%</div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-label">{{ t('charts.cropHealth') }}</div>
        <div class="card-value" :style="{ color: healthColor }">
          {{ healthLabel }}
        </div>
      </div>
      <div class="card-arrow">
        <i class="fas fa-chevron-right"></i>
      </div>
    </div>
  </div>
</template>

<script>
import agriculturalService from "../../services/agriculturalService";

export default {
  name: "CropHealthSummaryCard",
  props: {
    region: {
      type: String,
      default: "El Salvador"
    }
  },
  data() {
    return {
      healthData: null,
      loading: true
    };
  },
  computed: {
    isDarkMode() {
      return document.documentElement.getAttribute("data-theme") === "dark";
    },
    backgroundColor() {
      return this.isDarkMode ? "#374151" : "#d1d5db";
    },
    healthPercentage() {
      if (!this.healthData?.average) return 0;
      return Math.round((this.healthData.average.ndvi || 0) * 100);
    },
    healthLabel() {
      const health = this.overallHealth;
      const labels = {
        good: this.t('charts.good'),
        moderate: this.t('charts.moderate'),
        warning: this.t('charts.warning'),
        unknown: this.t('charts.unknown')
      };
      return labels[health] || labels.unknown;
    },
    healthColor() {
      const health = this.overallHealth;
      const colors = {
        good: "#4CAF50",
        moderate: "#FF9800",
        warning: "#F44336",
        unknown: "#9E9E9E"
      };
      return colors[health] || colors.unknown;
    },
    overallHealth() {
      if (!this.healthData?.data) return "unknown";
      const healthy = this.healthData.data.filter(d => d.health === "good").length;
      const warning = this.healthData.data.filter(d => d.health === "warning").length;
      const total = this.healthData.data.length;

      if (warning >= 2) return "warning";
      if (healthy >= total - 1) return "good";
      return "moderate";
    },
    healthBreakdown() {
      if (!this.healthData?.data) return { good: 0, moderate: 0, warning: 0 };
      return {
        good: this.healthData.data.filter(d => d.health === "good").length,
        moderate: this.healthData.data.filter(d => d.health === "moderate").length,
        warning: this.healthData.data.filter(d => d.health === "warning").length
      };
    },
    totalItems() {
      const breakdown = this.healthBreakdown;
      return breakdown.good + breakdown.moderate + breakdown.warning;
    },
    remainingLength() {
      return 2 * Math.PI * 40;
    },
    segments() {
      const breakdown = this.healthBreakdown;
      const total = this.totalItems;
      if (total === 0) return [];

      const colors = {
        good: "#4CAF50",
        moderate: "#FF9800",
        warning: "#F44336"
      };

      let offset = 0;
      return Object.entries(breakdown)
        .filter(([key, value]) => value > 0)
        .map(([key, value]) => {
          const length = (value / total) * this.remainingLength;
          const segment = {
            color: colors[key],
            length: length,
            offset: -offset
          };
          offset += length;
          return segment;
        });
    }
  },
  methods: {
    t(key) {
      return this.$t(key);
    },
    async loadCropHealthData() {
      this.loading = true;
      try {
        const data = await agriculturalService.getCropHealth(this.region);
        this.healthData = data;
      } catch (error) {
        console.error("Error loading crop health data:", error);
      } finally {
        this.loading = false;
      }
    },
    openChart() {
      this.$emit("open-chart", "crop-health");
    }
  },
  mounted() {
    this.loadCropHealthData();
  }
};
</script>

<style scoped>
.crop-health-summary-card {
  padding: 12px;
  background: var(--bg-card, #ffffff);
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  height: 70px;
}

.crop-health-summary-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.dark-mode.crop-health-summary-card {
  background: var(--bg-card-dark, #1f2937);
  border-color: rgba(76, 175, 80, 0.5);
}

.card-content {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
}

.donut-chart {
  width: 45px;
  height: 45px;
  position: relative;
}

.donut {
  width: 100%;
  height: 100%;
  transform: rotate(0deg);
}

.donut-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.health-percentage {
  font-size: 12px;
  font-weight: bold;
  color: var(--text-primary, #111827);
}

.dark-mode .health-percentage {
  color: var(--text-primary-dark, #f9fafb);
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-label {
  font-size: 10px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-value {
  font-size: 14px;
  font-weight: bold;
  color: var(--text-primary, #111827);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark-mode .card-value {
  color: var(--text-primary-dark, #f9fafb);
}

.card-arrow {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  opacity: 0.6;
}

@media (max-width: 768px) {
  .crop-health-summary-card {
    padding: 10px;
    height: 65px;
  }

  .donut-chart {
    width: 40px;
    height: 40px;
  }

  .health-percentage {
    font-size: 11px;
  }

  .card-label {
    font-size: 9px;
  }

  .card-value {
    font-size: 13px;
  }
}
</style>
