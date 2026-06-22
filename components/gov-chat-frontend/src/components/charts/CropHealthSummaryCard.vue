<template>
  <DsCard variant="outline" hoverable padding="sm" class="crop-health-summary-card" @click="openChart">
    <DsSpinner v-if="loading" size="sm" />
    <div v-else class="card-content">
      <div class="donut-chart">
        <svg viewBox="0 0 100 100" class="donut">
          <circle cx="50" cy="50" r="40" stroke="var(--border-light)" stroke-width="8" fill="none" />
          <circle
            v-for="(segment, index) in segments"
            :key="index"
            cx="50"
            cy="50"
            r="40"
            :stroke="segment.color"
            stroke-width="8"
            fill="none"
            :stroke-dasharray="`${segment.length} ${circumference}`"
            :stroke-dashoffset="segment.offset"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div class="donut-center">
          <span class="health-percentage">{{ healthPercentage }}%</span>
        </div>
      </div>
      <div class="card-info">
        <span class="card-label">{{ $t('charts.cropHealth', 'Crop Health') }}</span>
        <strong class="card-value">{{ healthLabel }}</strong>
      </div>
      <span class="card-arrow">&rsaquo;</span>
    </div>
  </DsCard>
</template>

<script>
import agriculturalService from '../../services/agriculturalService.js';
import DsCard from '../ds/Card.vue';
import DsSpinner from '../ds/Spinner.vue';

export default {
  name: 'CropHealthSummaryCard',
  components: { DsCard, DsSpinner },
  props: {
    region: {
      type: String,
      default: 'El Salvador'
    }
  },
  emits: ['open-chart'],
  data() {
    return {
      healthData: null,
      loading: true
    };
  },
  computed: {
    circumference() {
      return 2 * Math.PI * 40;
    },
    healthPercentage() {
      if (!this.healthData?.average) return 0;
      return Math.round((this.healthData.average.ndvi || 0) * 100);
    },
    overallHealth() {
      if (!this.healthData?.data) return 'unknown';
      const healthy = this.healthData.data.filter((d) => d.health === 'good').length;
      const warning = this.healthData.data.filter((d) => d.health === 'warning').length;
      const total = this.healthData.data.length;
      if (warning >= 2) return 'warning';
      if (healthy >= total - 1) return 'good';
      return 'moderate';
    },
    healthLabel() {
      const map = {
        good: this.$t('charts.good', 'Good'),
        moderate: this.$t('charts.moderate', 'Moderate'),
        warning: this.$t('charts.warning', 'Warning'),
        unknown: this.$t('charts.unknown', 'Unknown')
      };
      return map[this.overallHealth] || map.unknown;
    },
    healthBreakdown() {
      if (!this.healthData?.data) return { good: 0, moderate: 0, warning: 0 };
      return {
        good: this.healthData.data.filter((d) => d.health === 'good').length,
        moderate: this.healthData.data.filter((d) => d.health === 'moderate').length,
        warning: this.healthData.data.filter((d) => d.health === 'warning').length
      };
    },
    segments() {
      const breakdown = this.healthBreakdown;
      const total = breakdown.good + breakdown.moderate + breakdown.warning;
      if (total === 0) return [];

      const colors = { good: 'var(--success)', moderate: 'var(--warning)', warning: 'var(--danger)' };
      let offset = 0;

      return Object.entries(breakdown)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => {
          const length = (value / total) * this.circumference;
          const segment = { color: colors[key], length, offset: -offset };
          offset += length;
          return segment;
        });
    }
  },
  mounted() {
    this.loadData();
  },
  methods: {
    async loadData() {
      this.loading = true;
      try {
        this.healthData = await agriculturalService.getCropHealth(this.region);
      } catch (err) {
        console.error('Error loading crop health data:', err);
      } finally {
        this.loading = false;
      }
    },
    openChart() {
      this.$emit('open-chart', 'crop-health');
    }
  }
};
</script>

<style scoped>
.crop-health-summary-card {
  cursor: pointer;
  min-height: 70px;
}

.card-content {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 100%;
}

.donut-chart {
  width: 45px;
  height: 45px;
  position: relative;
  flex-shrink: 0;
}

.donut {
  width: 100%;
  height: 100%;
}

.donut-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.health-percentage {
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--fg);
}

.card-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.card-label {
  font-size: var(--text-xs);
  color: var(--muted);
}

.card-value {
  font-size: var(--text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-arrow {
  font-size: var(--text-lg);
  color: var(--muted);
  flex-shrink: 0;
}
</style>
