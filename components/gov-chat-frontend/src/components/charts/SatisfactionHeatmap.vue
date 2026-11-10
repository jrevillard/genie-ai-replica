<!-- SatisfactionHeatmap.vue - Updated to use external data for date range consistency -->
<template>
  <div class="heatmap-wrapper">
    <div ref="chart" class="chart-container">
      <apexchart
        v-if="!loading && !error && chartOptions"
        type="heatmap"
        height="580"
        :options="chartOptions"
        :series="chartSeries"
      />
    </div>
    <DsSpinner v-if="loading" overlay>
      <span>{{ translate('analytics.status.loading', 'Loading...') }}</span>
    </DsSpinner>
    <DsStateDisplay v-if="error" type="error" :message="error" />
    <DsStateDisplay
      v-else-if="noData"
      type="empty"
      :message="translate('analytics.status.noData', 'No data available')"
    />
  </div>
</template>

<script>
import analyticsService from '../../services/analyticsService';
import { useChartTheme } from '../../composables/useChartTheme';
import { buildSatisfactionScale } from '../../utils/chartColors';
import { periodLabel as translatePeriodLabel } from '../../utils/satisfactionPeriods.js';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';

export default {
  name: 'SatisfactionHeatmap',
  components: {
    DsSpinner,
    DsStateDisplay
  },
  props: {
    data: {
      type: Array,
      default: null
    },
    externalData: {
      type: Boolean,
      default: true
    },
    period: {
      type: String,
      default: 'monthly'
    },
    selectedDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0]
    },
    renderKey: {
      type: String,
      default: null
    }
  },
  setup() {
    const { theme, getResolvedTheme } = useChartTheme({ listenToSystem: true });
    return { theme, getResolvedTheme };
  },
  data() {
    return {
      chartData: [],
      loading: false,
      // error = fetch failures ONLY; noData = an empty dataset (an EMPTY state).
      // Two fields, one meaning each: updateChart runs after a failed fetch too,
      // and a single overloaded field let the empty branch overwrite the
      // failure message into a benign "No data available" (simplify review).
      error: null,
      noData: false,
      chartOptions: null,
      isMobile: false
    };
  },
  computed: {
    isI18nReady() {
      return typeof this.$t === 'function';
    },
    /**
     * The series handed to the chart: the period keys translated into their
     * display text. A computed keeps the array identity stable between
     * chart rebuilds (resize, theme change), so the chart does not redraw
     * its whole series on every one of those.
     */
    chartSeries() {
      return this.chartData.map((category) => ({
        ...category,
        data: (category.data || []).map((point) => ({ ...point, x: translatePeriodLabel(point.x, this.$i18n) }))
      }));
    }
  },
  watch: {
    data: {
      handler(newData) {
        if (this.externalData && newData && newData.length > 0) {
          this.chartData = newData;
          this.updateChart();
        }
      },
      deep: true
    },
    period: {
      handler() {
        if (!this.externalData) {
          this.fetchData();
        }
      }
    },
    selectedDate: {
      handler() {
        if (!this.externalData) {
          this.fetchData();
        }
      }
    },
    renderKey: {
      handler() {
        if (this.chartData && this.chartData.length > 0) {
          this.updateChart();
        }
      }
    }
  },
  mounted() {
    this.checkMobile();
    this.injectGlobalStyleForTheme();

    // Watch for theme changes from the composable
    this.$watch(
      () => this.theme,
      () => {
        this.updateChart();
        setTimeout(() => this.enforceColorScheme(), 300);
      }
    );

    if (this.externalData && this.data && this.data.length > 0) {
      this.chartData = this.data;
      this.updateChart();
    } else if (!this.externalData) {
      this.fetchData();
    } else {
      this.chartData = [];
      this.updateChart();
    }

    window.addEventListener('resize', this.handleResize);
    this.$nextTick(() => {
      this.enforceColorScheme();
    });
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    const injectedStyle = document.getElementById('satisfaction-heatmap-theme-style');
    if (injectedStyle) {
      document.head.removeChild(injectedStyle);
    }
  },
  methods: {
    /**
     * Inject a global stylesheet for chart text based on theme
     */
    injectGlobalStyleForTheme() {
      // Remove existing style if present to allow re-injection on theme change
      const existingStyle = document.getElementById('satisfaction-heatmap-theme-style');
      if (existingStyle) {
        document.head.removeChild(existingStyle);
      }

      const styleEl = document.createElement('style');
      styleEl.id = 'satisfaction-heatmap-theme-style';

      // Single consolidated style block that works for both light and dark modes
      styleEl.textContent = `
        .apexcharts-title-text,
        .apexcharts-subtitle-text,
        .apexcharts-text,
        .apexcharts-xaxis-label,
        .apexcharts-yaxis-label,
        .apexcharts-legend-text {
          fill: var(--fg) !important;
          color: var(--fg) !important;
        }
        .apexcharts-tooltip, .apexcharts-tooltip * {
          background-color: transparent !important;
        }
        .apexcharts-tooltip-box {
          background-color: var(--fg) !important;
          color: var(--bg) !important;
          border: none !important;
          box-shadow: var(--shadow-lg) !important;
        }
        .apexcharts-tooltip-title {
          background-color: var(--fg) !important;
          color: var(--bg) !important;
          border-bottom: 1px solid var(--border) !important;
        }
        .apexcharts-tooltip-text-y-label,
        .apexcharts-tooltip-text-y-value,
        .apexcharts-tooltip-text-z-label,
        .apexcharts-tooltip-text-z-value,
        .apexcharts-tooltip-marker,
        .apexcharts-tooltip * {
          color: var(--bg) !important;
        }
      `;
      document.head.appendChild(styleEl);
    },

    translate(key, defaultValue) {
      if (this.isI18nReady) {
        try {
          const locale = this.$i18n ? this.$i18n.locale : 'en';
          const translation = this.$i18n.t(key, { locale: locale });
          if (translation === key) {
            return defaultValue;
          }
          return translation;
        } catch {
          return defaultValue;
        }
      }
      return defaultValue;
    },

    checkMobile() {
      this.isMobile = window.innerWidth < 768;
    },

    async fetchData() {
      if (this.externalData) {
        return;
      }
      this.loading = true;
      this.error = null;
      this.noData = false;

      try {
        const locale = this.isI18nReady ? this.$i18n.locale : 'en';
        const heatmapData = await analyticsService.getSatisfactionHeatmap(this.period, this.selectedDate, locale);

        if (heatmapData && heatmapData.length > 0) {
          this.chartData = heatmapData;
          this.updateChart();
        } else {
          this.chartData = [];
          this.updateChart();
        }
      } catch {
        this.error = this.translate('analytics.error.loading', 'Failed to load satisfaction data.');
        this.chartData = [];
        this.updateChart();
      } finally {
        this.loading = false;
      }
    },

    handleResize() {
      this.checkMobile();
      this.updateChart();
    },

    enforceColorScheme() {
      const theme = this.getResolvedTheme();
      const textColor = theme.textColor;
      setTimeout(() => {
        const chartContainer = this.$refs.chart;
        if (!chartContainer) return;

        const textElements = chartContainer.querySelectorAll('text');
        textElements.forEach((text) => {
          text.setAttribute('fill', textColor);
          const tspans = text.querySelectorAll('tspan');
          tspans.forEach((tspan) => {
            tspan.setAttribute('fill', textColor);
          });
        });

        const title = chartContainer.querySelector('.apexcharts-title-text');
        if (title) title.setAttribute('fill', textColor);

        const subtitle = chartContainer.querySelector('.apexcharts-subtitle-text');
        if (subtitle) subtitle.setAttribute('fill', textColor);

        const legendItems = chartContainer.querySelectorAll('.apexcharts-legend-text');
        legendItems.forEach((item) => {
          item.style.color = textColor;
        });
      }, 200);
    },

    updateChart() {
      if (!this.chartData || this.chartData.length === 0) {
        // T1: an empty dataset is an EMPTY state, not an error — the siblings
        // (UsageTrend/TopQueries) already render their no-data as type=empty.
        // This never touches this.error: a failed fetch lands here with empty
        // data, and the template shows the error branch first, so a failure
        // stays a failure instead of being overwritten into "No data available".
        this.noData = true;
        return;
      }
      this.noData = false;

      const theme = this.getResolvedTheme();
      const textColor = theme.textColor;
      const backgroundColor = theme.backgroundColor;
      const borderColor = theme.borderColor;

      const getColorScale = () => {
        const poorText = this.translate('analytics.ratings.poor', 'Poor');
        const averageText = this.translate('analytics.ratings.average', 'Average');
        const goodText = this.translate('analytics.ratings.good', 'Good');
        const excellentText = this.translate('analytics.ratings.excellent', 'Excellent');

        // T1: the scale derives from the deployment's own status tokens
        // (was two hardcoded 4-stop hex scales). Dark mode steps lightness down.
        const scale = buildSatisfactionScale(theme.statusColors, { dimmed: theme.isDarkMode });
        const pick = (i, fallback) => scale[i] || fallback;
        return {
          ranges: [
            { from: 0, to: 69.99, color: pick(0, theme.statusColors.danger), name: poorText },
            { from: 70, to: 79.99, color: pick(1, theme.statusColors.warning), name: averageText },
            { from: 80, to: 89.99, color: pick(2, theme.statusColors.warning), name: goodText },
            { from: 90, to: 100, color: pick(4, theme.statusColors.success), name: excellentText }
          ]
        };
      };

      this.chartOptions = {
        chart: {
          type: 'heatmap',
          fontFamily: 'inherit',
          toolbar: {
            show: false
          },
          background: backgroundColor,
          foreColor: textColor,
          events: {
            mounted: () => {
              this.enforceColorScheme();
            },
            updated: () => {
              this.enforceColorScheme();
            }
          }
        },
        plotOptions: {
          heatmap: {
            colorScale: getColorScale(),
            radius: 2,
            enableShades: true,
            shadeIntensity: 0.5
          }
        },
        dataLabels: {
          enabled: true,
          style: {
            colors: ['#FFFFFF'],
            fontSize: '12px',
            fontWeight: 'bold'
          },
          formatter: function (val) {
            return val + '%';
          }
        },
        stroke: {
          width: 1,
          colors: [backgroundColor]
        },
        title: {
          text: this.translate('analytics.charts.satisfactionHeatmap', 'Satisfaction by Knowledge Area'),
          align: 'center',
          style: {
            fontSize: '16px',
            fontWeight: 'bold',
            color: textColor,
            fill: textColor
          }
        },
        subtitle: {
          text: this.translate('analytics.charts.satisfactionSubtitle', 'Percentage scores over time'),
          align: 'center',
          style: {
            fontSize: '12px',
            color: textColor,
            fill: textColor
          }
        },
        legend: {
          position: 'bottom',
          labels: {
            colors: textColor
          }
        },
        tooltip: {
          enabled: true,
          theme: 'dark',
          style: {
            fontSize: '12px'
          },
          custom: ({ series, seriesIndex, dataPointIndex, w }) => {
            const value = series[seriesIndex][dataPointIndex];
            const category = w.globals.seriesNames[seriesIndex];
            const xLabel = w.globals.labels[dataPointIndex];
            return `
              <div class="apexcharts-tooltip-box" style="background: var(--fg) !important; color: var(--bg); padding: 8px 10px; border-radius: var(--radius-sm); box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                <div style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid var(--border); padding-bottom: 4px;">
                  ${category}
                </div>
                <div>
                  <span style="display: inline-block; margin-right: 5px;">${xLabel}:</span>
                  <span style="font-weight: bold;">${value}%</span>
                </div>
              </div>
            `;
          },
          y: {
            formatter: function (val) {
              return val + '%';
            },
            title: {
              formatter: function (seriesName) {
                return seriesName;
              }
            }
          }
        },
        xaxis: {
          labels: {
            style: {
              colors: textColor,
              fontSize: '12px'
            }
          }
        },
        yaxis: {
          labels: {
            style: {
              colors: textColor,
              fontSize: '12px'
            },
            offsetX: -14
          }
        },
        grid: {
          borderColor: borderColor,
          padding: {
            right: 0,
            left: 0
          }
        },
        theme: {
          mode: theme.isDarkMode ? 'dark' : 'light',
          palette: 'palette1'
        }
      };

      this.$nextTick(() => {
        setTimeout(() => {
          this.enforceColorScheme();
        }, 300);
      });
    }
  }
};
</script>

<style scoped>
.heatmap-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 300px;
  background-color: transparent;
}

.chart-container {
  width: 100%;
  height: 100%;
  min-height: 300px;
  background-color: transparent;
  border-radius: var(--radius-md);
}

@media (max-width: 768px) {
  .heatmap-wrapper {
    min-height: 400px;
  }
}

/* T1: the old `:deep([data-theme='dark'])` overrides were DELETED — a leading
 * [data-theme] inside :deep() can never match (html/body carry the attribute,
 * not a node inside this component), so the block was dead; the global
 * charts-apex-overrides.css already owns these selectors. */

:deep(.apexcharts-tooltip, .apexcharts-tooltip *) {
  background-color: transparent !important;
}

:deep(.apexcharts-tooltip-box) {
  background-color: var(--fg) !important;
  color: var(--bg) !important;
  border: none !important;
  box-shadow: var(--shadow-lg) !important;
}

:deep(.apexcharts-tooltip-title) {
  background-color: var(--fg) !important;
  color: var(--bg) !important;
  border-bottom: 1px solid var(--border) !important;
}

:deep(.apexcharts-tooltip-text),
:deep(.apexcharts-tooltip-y-group),
:deep(.apexcharts-tooltip-text-y-label),
:deep(.apexcharts-tooltip-text-y-value) {
  color: var(--bg) !important;
}
</style>
