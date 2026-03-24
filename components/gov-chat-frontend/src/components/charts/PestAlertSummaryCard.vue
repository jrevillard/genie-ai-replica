<template>
  <div class="pest-alert-summary-card" :class="{ 'dark-mode': isDarkMode }" @click="openChart">
    <div class="card-content">
      <div class="alert-icon" :style="{ background: alertColorWithAlpha }">
        <i :class="alertIcon" :style="{ color: alertColor }"></i>
      </div>
      <div class="card-info">
        <div class="card-label">{{ t('charts.pestAlerts') }}</div>
        <div class="card-value-row">
          <div class="card-count" :style="{ color: alertColor }">{{ totalAlerts }}</div>
          <div class="card-status">{{ t('charts.active') }}</div>
        </div>
      </div>
      <div class="card-arrow">
        <i class="fas fa-chevron-right"></i>
      </div>
    </div>
  </div>
</template>

<script>
import usdaRssService from "../../services/usdaRssService";

export default {
  name: "PestAlertSummaryCard",
  props: {
    region: {
      type: String,
      default: "Central America"
    }
  },
  data() {
    return {
      pestData: null,
      loading: true
    };
  },
  computed: {
    isDarkMode() {
      return document.documentElement.getAttribute("data-theme") === "dark";
    },
    totalAlerts() {
      if (!this.pestData?.summary) return 0;
      return this.pestData.summary.total || 0;
    },
    highSeverity() {
      if (!this.pestData?.summary) return 0;
      return this.pestData.summary.high || 0;
    },
    alertColor() {
      if (this.highSeverity > 0) return "#F44336";
      if (this.totalAlerts > 0) return "#FF9800";
      return "#4CAF50";
    },
    alertController() {
      if (this.highSeverity > 0) return "warning";
      if (this.totalAlerts > 0) return "moderate";
      return "good";
    },
    alertColorWithAlpha() {
      const color = this.alertColor;
      // Convert hex to rgba with 0.2 alpha
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, 0.2)`;
    },
    alertIcon() {
      if (this.highSeverity > 0) return "fas fa-exclamation-triangle";
      if (this.totalAlerts > 0) return "fas fa-info-circle";
      return "fas fa-check-circle";
    }
  },
  methods: {
    t(key) {
      return this.$t(key);
    },
    async loadPestAlertData() {
      this.loading = true;
      try {
        const data = await usdaRssService.getPestAlerts(this.region);
        this.pestData = data;
      } catch (error) {
        console.error("Error loading pest alert data:", error);
      } finally {
        this.loading = false;
      }
    },
    openChart() {
      this.$emit("open-chart", "pest-alert");
    }
  },
  mounted() {
    this.loadPestAlertData();
  }
};
</script>

<style scoped>
.pest-alert-summary-card {
  padding: 12px;
  background: var(--bg-card, #ffffff);
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  height: 60px;
}

.pest-alert-summary-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.dark-mode.pest-alert-summary-card {
  background: var(--bg-card-dark, #1f2937);
}

.alert-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 18px;
}

.card-content {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
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

.card-value-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-count {
  font-size: 16px;
  font-weight: bold;
}

.card-status {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-arrow {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  opacity: 0.4;
}

@media (max-width: 768px) {
  .pest-alert-summary-card {
    padding: 10px;
    height: 55px;
  }

  .alert-icon {
    width: 32px;
    height: 32px;
    font-size: 16px;
  }

  .card-count {
    font-size: 14px;
  }

  .card-status {
    font-size: 10px;
  }
}
</style>
