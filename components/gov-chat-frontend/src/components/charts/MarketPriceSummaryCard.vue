<template>
  <DsCard variant="elevated" hoverable class="market-price-summary-card" @click="openChart">
    <div class="card-content">
      <!-- Sparkline Chart -->
      <div class="sparkline-container">
        <div v-if="loading" class="sparkline-loading">
          <DsSpinner size="sm" />
        </div>
        <div v-else-if="timeSeries.length >= 2" class="sparkline-chart">
          <apexchart type="line" :height="40" :options="chartOptions" :series="chartSeries" />
        </div>
        <div v-else class="sparkline-empty">
          {{ $t('charts.market.noData', 'No data') }}
        </div>
      </div>

      <!-- Card Info -->
      <div class="card-info">
        <div class="card-label">{{ cardTitle }}</div>
        <div class="card-value-row">
          <div class="card-value">{{ latestValue }}</div>
          <DsPill :variant="trendVariant" size="sm" class="trend-pill">
            {{ trendText }}
          </DsPill>
        </div>
      </div>
    </div>
  </DsCard>
</template>

<script>
import DsCard from '../ds/Card.vue';
import DsSpinner from '../ds/Spinner.vue';
import DsPill from '../ds/Pill.vue';
import worldBankService from '../../services/worldBankService.js';
import { useChartTheme } from '../../composables/useChartTheme.js';

export default {
  name: 'MarketPriceSummaryCard',

  components: {
    DsCard,
    DsSpinner,
    DsPill
  },

  props: {
    category: {
      type: String,
      required: true,
      validator: (value) =>
        [
          'maize',
          'cropProtection',
          'vegetables',
          'livestock',
          'fertilizer',
          'apiary',
          'aquaculture',
          'harvestStorage'
        ].includes(value)
    },
    region: {
      type: String,
      default: 'El Salvador'
    }
  },
  emits: ['open-chart'],

  setup() {
    const { getCssVarStrings } = useChartTheme({});
    return { getCssVarStrings };
  },
  data() {
    return {
      priceData: null,
      loading: true,
      timeSeries: []
    };
  },

  computed: {
    cardTitle() {
      const i18nMap = {
        maize: 'charts.market.maizeGrains',
        cropProtection: 'charts.market.cropProtection',
        vegetables: 'charts.market.fruitsVeggies',
        livestock: 'charts.market.livestock',
        fertilizer: 'charts.market.fertilizer',
        apiary: 'charts.market.apiary',
        aquaculture: 'charts.market.aquaculture',
        harvestStorage: 'charts.market.harvestStorage'
      };
      return this.$t(i18nMap[this.category] || 'charts.market.unknown', 'Unknown');
    },

    latestValue() {
      if (!this.timeSeries || this.timeSeries.length === 0) {
        return this.$t('charts.market.noData', 'N/A');
      }
      const latest = this.timeSeries[this.timeSeries.length - 1];
      return latest.value ? latest.value.toFixed(2) : this.$t('charts.market.noData', 'N/A');
    },

    unit() {
      return this.priceData?.unit || '';
    },

    trend() {
      return this.priceData?.trend || 'unknown';
    },

    trendVariant() {
      const variantMap = {
        up: 'success',
        down: 'danger',
        stable: 'accent',
        unknown: 'info'
      };
      return variantMap[this.trend] || 'info';
    },

    trendText() {
      const textMap = {
        up: '↑',
        down: '↓',
        stable: '→',
        unknown: '?'
      };
      return textMap[this.trend] || '?';
    },

    chartSeries() {
      if (!this.timeSeries || this.timeSeries.length === 0) {
        return [{ data: [] }];
      }
      return [
        {
          data: this.timeSeries.map((d) => d.value)
        }
      ];
    },

    chartOptions() {
      const cssVars = this.getCssVarStrings();

      return {
        chart: {
          type: 'line',
          sparkline: {
            enabled: true
          },
          animations: {
            enabled: false
          },
          background: 'transparent'
        },
        stroke: {
          curve: 'smooth',
          width: 2
        },
        colors: [cssVars.accentColor],
        fill: {
          type: 'gradient',
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.3,
            opacityTo: 0,
            stops: [0, 100]
          }
        },
        xaxis: {
          categories: this.timeSeries.map((d) => d.year),
          labels: {
            show: false
          },
          axisBorder: {
            show: false
          },
          axisTicks: {
            show: false
          }
        },
        yaxis: {
          show: false
        },
        grid: {
          show: false
        },
        tooltip: {
          enabled: true,
          theme: 'dark',
          x: {
            formatter: (value) => {
              const index = value - 1;
              if (this.timeSeries[index]) {
                return this.timeSeries[index].year;
              }
              return value;
            }
          },
          y: {
            formatter: (value) => {
              return value ? value.toFixed(2) : this.$t('charts.market.noData', 'N/A');
            }
          }
        },
        dataLabels: {
          enabled: false
        }
      };
    },

    categoryColor() {
      const colorMap = {
        maize: 'var(--success)',
        cropProtection: 'var(--warning)',
        vegetables: 'var(--brand)',
        livestock: 'var(--accent)',
        fertilizer: 'var(--info)',
        apiary: 'var(--warning)',
        aquaculture: 'var(--brand)',
        harvestStorage: 'var(--muted)'
      };
      return colorMap[this.category] || 'var(--muted)';
    }
  },

  async mounted() {
    await this.loadPriceData();
  },

  methods: {
    async loadPriceData() {
      this.loading = true;
      try {
        let data;
        switch (this.category) {
          case 'maize':
            data = await worldBankService.getMaizePrices();
            break;
          case 'cropProtection':
            data = await worldBankService.getCropProtectionCosts();
            break;
          case 'vegetables':
            data = await worldBankService.getVegetablePrices();
            break;
          case 'livestock':
            data = await worldBankService.getPoultryPorkFeedCosts();
            break;
          case 'fertilizer':
            data = await worldBankService.getFertilizerPrices();
            break;
          case 'apiary':
            data = await worldBankService.getHoneyMarketData();
            break;
          case 'aquaculture':
            data = await worldBankService.getTilapiaMarketData();
            break;
          case 'harvestStorage':
            data = await worldBankService.getHarvestStorageData();
            break;
          default:
            console.warn(`Unknown category: ${this.category}`);
            data = null;
        }

        if (data && data.data) {
          this.priceData = data;
          this.timeSeries = data.data;
        }
      } catch (error) {
        console.error(`Error loading price data for ${this.category}:`, error);
      } finally {
        this.loading = false;
      }
    },

    openChart() {
      this.$emit('open-chart', this.category);
    }
  }
};
</script>

<style scoped>
.market-price-summary-card {
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.card-content {
  display: flex;
  gap: var(--space-sm);
  width: 100%;
}

.sparkline-container {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sparkline-loading,
.sparkline-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  color: var(--muted);
}

.sparkline-chart {
  width: 100%;
  height: 100%;
}

.card-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.card-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-value-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.card-value {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--fg);
}

.trend-pill {
  font-size: var(--text-xs);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .sparkline-container {
    width: 50px;
    height: 50px;
  }

  .card-label {
    font-size: var(--text-xs);
  }

  .card-value {
    font-size: var(--text-sm);
  }
}
</style>
