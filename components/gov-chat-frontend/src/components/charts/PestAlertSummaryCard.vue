<template>
  <DsCard variant="outline" padding="sm" hoverable class="pest-alert-summary-card" @click="openChart">
    <DsSpinner v-if="loading" size="sm" overlay />
    <div class="pest-alert__layout">
      <div class="pest-alert__icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </div>
      <div class="pest-alert__content">
        <div class="pest-alert__header">
          <span class="pest-alert__title">{{ $t('pestAlerts.title', 'Pest Alerts') }}</span>
          <DsPill :variant="pillVariant">{{ totalAlerts }}</DsPill>
        </div>
        <div class="pest-alert__breakdown">
          <span class="pest-alert__severity pest-alert__severity--high">
            {{ $t('pestAlerts.high', 'High') }}: {{ highSeverity }}
          </span>
          <span class="pest-alert__severity pest-alert__severity--moderate">
            {{ $t('pestAlerts.moderate', 'Moderate') }}: {{ moderateSeverity }}
          </span>
          <span class="pest-alert__severity pest-alert__severity--low">
            {{ $t('pestAlerts.low', 'Low') }}: {{ lowSeverity }}
          </span>
        </div>
      </div>
    </div>
  </DsCard>
</template>

<script>
import DsCard from '../ds/Card.vue';
import DsPill from '../ds/Pill.vue';
import DsSpinner from '../ds/Spinner.vue';
import agriculturalService from '../../services/agriculturalService.js';

export default {
  name: 'PestAlertSummaryCard',
  components: {
    DsCard,
    DsPill,
    DsSpinner
  },
  props: {
    region: {
      type: String,
      default: 'Central America'
    }
  },
  emits: ['open-chart'],
  data() {
    return {
      pestData: null,
      loading: false
    };
  },
  computed: {
    totalAlerts() {
      if (!this.pestData?.summary) return 0;
      return this.pestData.summary.total || 0;
    },
    highSeverity() {
      if (!this.pestData?.summary) return 0;
      return this.pestData.summary.high || 0;
    },
    moderateSeverity() {
      if (!this.pestData?.summary) return 0;
      return this.pestData.summary.moderate || 0;
    },
    lowSeverity() {
      if (!this.pestData?.summary) return 0;
      return this.pestData.summary.low || 0;
    },
    pillVariant() {
      if (this.highSeverity > 0) return 'danger';
      if (this.totalAlerts > 0) return 'warning';
      return 'success';
    }
  },
  async mounted() {
    await this.fetchPestAlerts();
  },
  methods: {
    async fetchPestAlerts() {
      this.loading = true;
      try {
        this.pestData = await agriculturalService.getPestAlerts(this.region);
      } catch (error) {
        console.error('Failed to fetch pest alerts:', error);
        this.pestData = null;
      } finally {
        this.loading = false;
      }
    },
    openChart() {
      this.$emit('open-chart', 'pest-alert');
    }
  }
};
</script>

<style scoped>
.pest-alert-summary-card {
  position: relative;
  min-height: 80px;
}

.pest-alert__layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
}

.pest-alert__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--warning-bg);
  color: var(--warning);
}

.pest-alert__content {
  flex: 1;
  min-width: 0;
}

.pest-alert__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.pest-alert__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
}

.pest-alert__breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--muted);
}

.pest-alert__severity {
  display: inline-flex;
  align-items: center;
}

.pest-alert__severity--high {
  color: var(--danger);
}

.pest-alert__severity--moderate {
  color: var(--warning);
}

.pest-alert__severity--low {
  color: var(--success);
}

@media (max-width: 768px) {
  .pest-alert__layout {
    gap: var(--space-sm);
  }

  .pest-alert__icon {
    width: 32px;
    height: 32px;
  }

  .pest-alert__icon svg {
    width: 20px;
    height: 20px;
  }

  .pest-alert__breakdown {
    flex-direction: column;
    gap: var(--space-xs);
  }
}
</style>
