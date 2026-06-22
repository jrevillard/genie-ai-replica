<!-- SatisfactionGauge.vue - Changed dark mode gauge center circle background to transparent to blend with UnifiedAnalytics.vue (#414141) -->
<template>
  <div class="gauge-wrapper">
    <!-- Chart container -->
    <div ref="chart" class="chart-container">
      <!-- ApexCharts radial bar for satisfaction gauge -->
      <apexchart
        v-if="!loading && !error && chartOptions"
        :key="chartKey"
        type="radialBar"
        height="290"
        :options="{
          ...chartOptions,
          plotOptions: {
            ...chartOptions.plotOptions,
            radialBar: {
              ...chartOptions.plotOptions.radialBar,
              dataLabels: {
                ...chartOptions.plotOptions.radialBar.dataLabels,
                value: {
                  ...chartOptions.plotOptions.radialBar.dataLabels.value,
                  formatter: function (val) {
                    return val.toFixed(2) + '%';
                  }
                }
              }
            }
          }
        }"
        :series="[actualSatisfactionValue]"
      />
    </div>

    <!-- Historical trends section -->
    <div v-if="!loading && !error && computedHistoricalData.length > 0" class="historical-trends">
      <h3>
        {{ translate('analytics.gauge.historical', 'Historical Trends') }}
      </h3>
      <div v-for="(item, index) in computedHistoricalData" :key="index" class="trend-item">
        <span class="label">{{ item.label }}</span>
        <span class="value">{{ item.value.toFixed(2) }}%</span>
        <div class="progress" :style="{ width: `${item.value}%` }"></div>
      </div>
    </div>

    <!-- Change indicator -->
    <div
      v-if="!loading && !error && computedChangeIndicator !== null"
      class="change-indicator"
      :class="computedChangeIndicator >= 0 ? 'positive' : 'negative'"
    >
      <span class="change-arrow">{{ computedChangeIndicator >= 0 ? '↑' : '↓' }}</span>
      <span>{{ Math.abs(computedChangeIndicator).toFixed(1) }}%</span>
      <span class="change-period">{{ translate('analytics.gauge.vsPrevious', 'vs previous period') }}</span>
    </div>

    <!-- Target indicator -->
    <div v-if="!loading && !error" class="target-indicator">
      <span>{{ translate('analytics.gauge.target', 'Target') }}: {{ actualTarget }}%</span>
    </div>

    <DsSpinner v-if="loading" overlay>
      <span>{{ translate('analytics.status.loading', 'Loading...') }}</span>
    </DsSpinner>

    <DsStateDisplay v-if="error" type="error" :message="error" />
  </div>
</template>

<script>
import { nextTick } from 'vue';
import analyticsService from '../../services/analyticsService';
import { useChartTheme } from '../../composables/useChartTheme';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';

export default {
  name: 'SatisfactionGauge',
  components: {
    DsSpinner,
    DsStateDisplay
  },
  props: {
    // Current satisfaction value provided by parent
    value: {
      type: Number,
      default: null
    },
    // Target value provided by parent
    target: {
      type: Number,
      default: 85
    },
    // Historical data provided by parent
    historicalData: {
      type: Array,
      default: () => []
    },
    // Change percentage for trend indicator
    changePercentage: {
      type: Number,
      default: null
    },
    // Whether to use provided data or fetch from API
    externalData: {
      type: Boolean,
      default: false
    },
    // Period and date for API fetching if not using external data
    period: {
      type: String,
      default: 'monthly'
    },
    selectedDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0]
    },
    // Force re-render when language changes
    renderKey: {
      type: String,
      default: null
    }
  },
  setup() {
    const { theme, getCssVarStrings } = useChartTheme();
    return { theme, getCssVarStrings };
  },
  data() {
    return {
      satisfactionValue: null, // Internal value when externalData is false
      internalHistoricalData: [], // Internal data when externalData is false
      internalChangeIndicator: null, // Internal change when externalData is false
      loading: false,
      error: null,
      chartOptions: null,
      internalTarget: 85, // Default target
      chartKey: 0, // Force re-renders
      lastError: null
    };
  },
  computed: {
    // Compute the actual satisfaction value to display
    actualSatisfactionValue() {
      if (this.externalData && this.value !== null) {
        return this.value >= 0 ? this.value : 0;
      }
      const value = this.satisfactionValue;
      return value !== null && value >= 0 ? value : 0;
    },
    // Compute the target value
    actualTarget() {
      return this.target || this.internalTarget || 85;
    },
    // Compute historical data for trends
    computedHistoricalData() {
      let data = this.externalData && this.historicalData ? this.historicalData : this.internalHistoricalData;
      data = data.filter((item) => item && typeof item.value === 'number' && item.value >= 0);
      if (!data.length) {
        // Fallback data if historicalData is empty
        data = [
          {
            label: 'Current',
            value: this.actualSatisfactionValue || 0,
            periodStart: new Date().toISOString(),
            periodEnd: new Date().toISOString()
          },
          {
            label: 'Last Week',
            value: 0,
            periodStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            periodEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          },
          {
            label: '2 Weeks Ago',
            value: 0,
            periodStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
            periodEnd: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
          },
          {
            label: '3 Weeks Ago',
            value: 0,
            periodStart: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
            periodEnd: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()
          },
          {
            label: '4 Weeks Ago',
            value: 0,
            periodStart: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
            periodEnd: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
          }
        ];
      }
      return data;
    },
    // Compute change percentage for indicator
    computedChangeIndicator() {
      const change =
        this.externalData && this.changePercentage !== null ? this.changePercentage : this.internalChangeIndicator;
      return change !== null ? change : 0; // Default to 0 if null
    }
  },
  watch: {
    // Watch for theme changes from the composable
    theme: {
      handler(_newTheme) {
        this.injectGlobalStyleForTheme();
        this.chartOptions = null;
        nextTick(() => {
          this.chartKey++;
          this.initChart();
        });
      }
    },
    // Watch for changes in value prop
    value: {
      handler(newValue) {
        if (this.externalData && newValue !== null) {
          this.satisfactionValue = newValue;
          this.chartOptions = null;
          this.$nextTick(() => {
            this.chartKey++;
            this.initChart();
          });
        }
      },
      immediate: true
    },
    // Watch for changes in historicalData prop
    historicalData: {
      handler(_newData) {
        // Data is handled via computed property
      },
      deep: true,
      immediate: true
    },
    // Watch for changes in changePercentage prop
    changePercentage: {
      handler(_newValue) {
        // Data is handled via computed property
      },
      immediate: true
    },
    // Watch for changes in period
    period: {
      handler(_newValue) {
        if (!this.externalData) {
          this.fetchData();
        }
      }
    },
    // Watch for changes in selectedDate
    selectedDate: {
      handler(_newValue) {
        if (!this.externalData) {
          this.fetchData();
        }
      }
    },
    // Watch for changes in renderKey (locale)
    renderKey: {
      handler(_newValue) {
        this.chartOptions = null;
        this.$nextTick(() => {
          this.chartKey++;
          this.initChart();
        });
        if (!this.externalData) {
          this.fetchData();
        }
      }
    }
  },
  mounted() {
    // Initial theme detection via composable (theme ref is already set by useChartTheme)
    this.injectGlobalStyleForTheme();

    if (!this.externalData) {
      this.fetchData();
    } else {
      this.chartOptions = null;
      this.$nextTick(() => {
        this.chartKey++;
        this.initChart();
      });
    }

    window.addEventListener('error', this.handleGlobalError);
  },
  beforeUnmount() {
    window.removeEventListener('error', this.handleGlobalError);
    const injectedStyle = document.getElementById('satisfaction-gauge-theme-style');
    if (injectedStyle) {
      document.head.removeChild(injectedStyle);
    }
  },
  methods: {
    /**
     * Translate text using i18n
     */
    translate(key, defaultValue) {
      if (this.$i18n && this.$t) {
        const translation = this.$t(key);
        return translation === key ? defaultValue : translation;
      }
      return defaultValue;
    },

    /**
     * Handle global chart errors
     */
    handleGlobalError(event) {
      if (event.message && event.message.includes('chart')) {
        this.lastError = event.message;
        this.chartKey++;
      }
    },

    /**
     * Fetch satisfaction data from API
     */
    async fetchData() {
      if (this.externalData) {
        return;
      }
      this.loading = true;
      this.error = null;

      try {
        const data = await analyticsService.getSatisfactionGauge(
          this.period,
          this.selectedDate,
          this.$i18n ? this.$i18n.locale : null
        );

        if (data && typeof data.currentValue === 'number') {
          this.satisfactionValue = data.currentValue;
          this.internalChangeIndicator = data.changePercentage;
          this.internalHistoricalData = data.historicalData || [];
          this.internalTarget = data.target || 85;
        } else {
          this.satisfactionValue = 0;
          this.internalHistoricalData = [];
          this.internalChangeIndicator = null;
        }

        this.chartOptions = null;
        this.$nextTick(() => {
          this.chartKey++;
          this.initChart();
        });
      } catch {
        this.error = this.translate('analytics.errors.loading', 'Failed to load satisfaction data');
        this.satisfactionValue = 0;
        this.internalHistoricalData = [];
        this.internalChangeIndicator = null;

        this.chartOptions = null;
        this.$nextTick(() => {
          this.chartKey++;
          this.initChart();
        });
      } finally {
        this.loading = false;
      }
    },

    /**
     * Get gauge color based on value
     */
    getGaugeColor(value) {
      const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim();
      const warning = getComputedStyle(document.documentElement).getPropertyValue('--warning').trim();
      const info = getComputedStyle(document.documentElement).getPropertyValue('--info').trim();
      const success = getComputedStyle(document.documentElement).getPropertyValue('--success').trim();
      if (value >= 90) return success;
      if (value >= 80) return info;
      if (value >= 70) return warning;
      return danger;
    },

    /**
     * Initialize chart with speedometer options
     */
    initChart() {
      if (this.actualSatisfactionValue < 0) {
        return;
      }

      const isDarkMode = this.theme === 'dark';

      const textColor = this.getCssVarStrings().textColor;
      const backgroundColor = 'transparent';
      const trackColor = isDarkMode ? 'var(--muted)' : 'var(--border)';

      const getGradientColors = (value) => {
        const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim();
        const warning = getComputedStyle(document.documentElement).getPropertyValue('--warning').trim();
        const info = getComputedStyle(document.documentElement).getPropertyValue('--info').trim();
        const success = getComputedStyle(document.documentElement).getPropertyValue('--success').trim();
        const colors = { poor: danger, low: warning, medium: info, high: success };

        if (value < 60) return [colors.poor, colors.poor];
        if (value < 70) return [colors.poor, colors.low];
        if (value < 80) return [colors.low, colors.medium];
        if (value < 90) return [colors.medium, colors.high];
        return [colors.high, colors.high];
      };

      const gradientColors = getGradientColors(this.actualSatisfactionValue);

      this.chartOptions = {
        chart: {
          type: 'radialBar',
          background: backgroundColor,
          foreColor: textColor,
          animations: {
            enabled: true,
            easing: 'easeinout',
            speed: 800
          },
          fontFamily: 'inherit'
        },
        plotOptions: {
          radialBar: {
            startAngle: -135,
            endAngle: 135,
            hollow: {
              margin: 0,
              size: '65%',
              background: backgroundColor
            },
            track: {
              background: trackColor,
              strokeWidth: '97%',
              margin: 5,
              dropShadow: {
                enabled: false
              }
            },
            dataLabels: {
              show: true,
              name: {
                show: true,
                fontSize: '16px',
                fontWeight: 600,
                color: textColor,
                offsetY: -10
              },
              value: {
                show: true,
                fontSize: '24px',
                fontWeight: 700,
                color: textColor,
                offsetY: 5,
                formatter: function (val) {
                  return val.toFixed(2) + '%';
                }
              }
            }
          }
        },
        fill: {
          type: 'gradient',
          gradient: {
            shade: 'dark',
            type: 'horizontal',
            gradientToColors: [gradientColors[1]],
            stops: [0, 100],
            colorStops: [
              {
                offset: 0,
                color: gradientColors[0],
                opacity: 1
              },
              {
                offset: 100,
                color: gradientColors[1],
                opacity: 1
              }
            ]
          }
        },
        stroke: {
          lineCap: 'round',
          dashArray: 0
        },
        labels: [this.translate('analytics.metrics.satisfaction', 'User Satisfaction')],
        tooltip: {
          enabled: false
        }
      };

      this.$nextTick(() => {
        setTimeout(() => {
          this.forceTextColorUpdate();
        }, 300);
      });
    },

    /**
     * Inject global styles for the current theme
     */
    injectGlobalStyleForTheme() {
      const styleId = 'satisfaction-gauge-theme-style';
      let styleEl = document.getElementById(styleId);
      if (styleEl) {
        styleEl.remove(); // Remove existing style to prevent duplicates
      }

      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        .apexcharts-text,
        .apexcharts-datalabel-label,
        .apexcharts-datalabel-value,
        .apexcharts-radialbar-label text,
        .apexcharts-radialbar text {
          fill: var(--fg) !important;
        }
      `;

      document.head.appendChild(styleEl);
    },

    /**
     * Force ApexCharts text color update
     */
    forceTextColorUpdate() {
      const chartElement = this.$refs.chart;
      if (!chartElement) {
        return;
      }

      setTimeout(() => {
        try {
          const textElements = chartElement.querySelectorAll(
            '.apexcharts-text, .apexcharts-datalabel-label, .apexcharts-datalabel-value'
          );

          textElements.forEach((el) => {
            el.setAttribute('fill', 'var(--fg)');
            const tspans = el.querySelectorAll('tspan');
            tspans.forEach((tspan) => {
              tspan.setAttribute('fill', 'var(--fg)');
            });
          });
        } catch {
          // Silently handle errors
        }
      }, 300);
    }
  }
};
</script>

<style scoped>
.gauge-wrapper {
  position: relative;
  width: 100%;
  background-color: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.chart-container {
  position: relative;
  width: 100%;
  height: 290px;
  background-color: transparent;
  border-radius: var(--radius-md);
}

/* Historical trends section */
.historical-trends {
  width: 100%;
  margin-top: var(--space-lg);
  padding: 0 var(--space-lg);
}

.historical-trends h3 {
  font-size: var(--text-md);
  margin-bottom: var(--space-sm);
  color: var(--fg);
}

.trend-item {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-sm);
  position: relative;
  min-height: 20px;
}

.label {
  width: 120px;
  font-size: var(--text-base);
  color: var(--muted);
}

.value {
  width: 50px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--fg);
  margin-right: var(--space-sm);
}

.progress {
  height: 8px;
  background: linear-gradient(to right, var(--warning), var(--accent), var(--success));
  border-radius: var(--radius-sm);
  max-width: calc(100% - 180px);
}

/* Change indicator */
.change-indicator {
  margin-top: var(--space-md);
  font-size: var(--text-base);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.change-indicator.positive {
  color: var(--success);
}

.change-indicator.negative {
  color: var(--danger);
}

.change-arrow {
  font-size: var(--text-md);
  font-weight: bold;
}

.change-period {
  color: var(--muted);
  font-size: var(--text-sm);
  margin-left: var(--space-xs);
}

/* Target indicator */
.target-indicator {
  margin-top: var(--space-sm);
  font-size: var(--text-base);
  color: var(--muted);
}

/* Position the custom gauge scale */
:deep(.custom-gauge-scale) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 20;
}

/* Component-specific text styles (historical trends section) */
[data-theme='dark'] .historical-trends h3,
[data-theme='dark'] .label,
[data-theme='dark'] .value {
  color: var(--fg) !important;
  -webkit-text-fill-color: var(--fg) !important;
  text-shadow: none !important;
}
</style>
