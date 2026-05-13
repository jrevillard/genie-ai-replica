<!-- TopQueriesChart.vue - Changed dark mode table background to transparent to blend with analytics dialog (#414141) -->
<template>
  <div class="top-queries-chart">
    <DsSpinner v-if="loading" overlay>
      <span>{{ $t('analytics.status.loading') }}</span>
    </DsSpinner>
    <DsStateDisplay v-else-if="error" type="error" :message="error" />
    <DsStateDisplay v-else-if="!data || data.length === 0" type="empty">
      {{ $t('analytics.status.noData') }}
    </DsStateDisplay>
    <div v-else>
      <!-- Compressed table view -->
      <div class="table-container">
        <table class="top-queries-table" :style="tableStyle">
          <thead>
            <tr>
              <th class="rank" :style="textStyle">
                {{ $t('analytics.table.rank') }}
              </th>
              <th :style="textStyle">{{ $t('analytics.table.query') }}</th>
              <th class="count" :style="textStyle">
                {{ $t('analytics.table.count') }}
              </th>
              <th class="avg-time" :style="textStyle">
                {{ $t('analytics.table.avgTime') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(query, index) in data" :key="index">
              <td class="rank" :style="textStyle">{{ index + 1 }}</td>
              <td class="query-text" :style="textStyle">{{ query.text }}</td>
              <td class="count" :style="textStyle">
                {{ query.count.toLocaleString() }}
              </td>
              <td class="avg-time" :style="textStyle">{{ query.avgTime }}s</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Single bar chart using ApexCharts -->
      <div ref="chart" class="bar-chart-container">
        <apexchart
          v-if="!loading && !error && chartOptions"
          type="bar"
          height="140"
          :options="chartOptions"
          :series="chartSeries"
        />
      </div>
    </div>
  </div>
</template>

<script>
import analyticsService from '../../services/analyticsService';
import { useChartTheme } from '../../composables/useChartTheme';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';

export default {
  name: 'TopQueriesChart',
  components: {
    DsSpinner,
    DsStateDisplay
  },
  props: {
    // Data can be provided by parent component
    data: {
      type: Array,
      default: () => []
    },
    // Whether data is provided externally
    externalData: {
      type: Boolean,
      default: true
    },
    // Period and date for API fetching if not using external data
    period: {
      type: String,
      default: 'daily'
    },
    selectedDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0]
    },
    // Added to force re-render when language or theme changes
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
      chartData: [],
      loading: false,
      error: null,
      chartOptions: null,
      chartSeries: [],
      isMobile: false,
      tooltipId: 'top-queries-chart-tooltip' // Store tooltip ID for reference
    };
  },
  computed: {
    tableStyle() {
      return { backgroundColor: 'var(--surface)' };
    },
    textStyle() {
      return { color: 'var(--fg)' };
    }
  },
  watch: {
    // Watch for data changes from parent
    data: {
      handler(newData) {
        if (this.externalData && newData && newData.length > 0) {
          this.chartData = newData;
          this.updateChart();
        }
      },
      deep: true
    },
    // Re-fetch if period or date changes
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
    // Watch for renderKey (theme/locale) changes to force complete re-render
    renderKey: {
      handler() {
        this.$nextTick(() => {
          if (this.chartData && this.chartData.length > 0) {
            this.updateChart();
          }
        });
      }
    },
    // Watch for locale changes directly
    '$i18n.locale': {
      handler() {
        this.$nextTick(() => {
          if (this.chartData && this.chartData.length > 0) {
            this.updateChart();
          }
        });
      },
      immediate: false
    },
    // Watch for theme changes from the composable
    theme: {
      handler() {
        this.$nextTick(() => {
          if (this.chartData && this.chartData.length > 0) {
            this.updateChart();
          }
        });
      }
    }
  },
  mounted() {
    // Check if mobile on mount
    this.checkMobile();

    // Use data from props or fetch from API
    if (this.externalData && this.data.length > 0) {
      this.chartData = this.data;
      this.updateChart();
    } else if (!this.externalData) {
      this.fetchData();
    }

    // Add resize listener
    window.addEventListener('resize', this.handleResize);

    // Create custom tooltip element
    this.ensureCustomTooltipExists();

    // Force re-render after parent theme sync
    setTimeout(() => {
      this.updateChart();
    }, 300); // Increased delay for parent theme sync
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);

    // Clean up tooltip
    this.cleanupTooltip();
  },
  methods: {
    /**
     * Check if the device is mobile based on screen width
     */
    checkMobile() {
      this.isMobile = window.innerWidth < 768;
    },

    /**
     * Fetch top queries data if not provided externally
     */
    async fetchData() {
      if (this.externalData) return;

      this.loading = true;
      this.error = null;

      try {
        try {
          const dashboardData = await analyticsService.getDashboardAnalytics(this.period, this.selectedDate);
          if (dashboardData && dashboardData.topQueries) {
            this.chartData = dashboardData.topQueries;
          } else {
            throw new Error(this.$t('analytics.status.noData'));
          }
        } catch {
          this.chartData = [];
        }

        this.updateChart();
      } catch {
        this.error = this.$t('analytics.status.error');
      } finally {
        this.loading = false;
      }
    },

    /**
     * Handle window resize
     */
    handleResize() {
      this.checkMobile();
      this.updateChart();
    },

    /**
     * Truncate text to fit in available space
     */
    truncateText(text, maxLength) {
      if (!text) return '';
      return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
    },

    /**
     * Create a custom tooltip element with a unique ID
     */
    ensureCustomTooltipExists() {
      this.cleanupTooltip();
      const tooltip = document.createElement('div');
      tooltip.id = this.tooltipId;
      tooltip.style.cssText = `
        position: absolute;
        background: var(--fg);
        color: var(--bg);
        padding: 10px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        pointer-events: none;
        z-index: 10000;
        display: none;
        min-width: 160px;
        box-shadow: var(--shadow-lg);
      `;
      document.body.appendChild(tooltip);
    },

    /**
     * Clean up the tooltip element
     */
    cleanupTooltip() {
      const tooltip = document.getElementById(this.tooltipId);
      if (tooltip) {
        tooltip.remove();
      }
    },

    /**
     * Add tooltip event handlers to chart bars
     */
    addTooltipHandlers() {
      const tooltip = document.getElementById(this.tooltipId);
      if (!tooltip) {
        this.ensureCustomTooltipExists();
        return;
      }

      const chartContainer = this.$refs.chart;
      if (!chartContainer) return;

      const barSelectors = [
        '.apexcharts-bar-area',
        '.apexcharts-bar-series rect',
        '.apexcharts-bar rect',
        '.apexcharts-series rect'
      ];

      let bars = [];
      for (const selector of barSelectors) {
        bars = chartContainer.querySelectorAll(selector);
        if (bars.length > 0) {
          break;
        }
      }

      if (bars.length === 0) {
        for (const selector of barSelectors) {
          bars = document.querySelectorAll(selector);
          if (bars.length > 0) {
            break;
          }
        }
      }

      if (bars.length > 0) {
        bars.forEach((bar, index) => {
          if (index >= this.chartData.length) return;

          bar.style.cursor = 'pointer';
          bar.setAttribute('data-bar-index', index);

          bar.addEventListener('mouseenter', (e) => {
            const barIndex = parseInt(e.target.getAttribute('data-bar-index'));
            const item = this.chartData[barIndex !== undefined ? barIndex : index];
            if (!item) return;

            tooltip.innerHTML = `
              <div style="font-weight: bold; margin-bottom: 6px;">${this.truncateText(item.text, 40)}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>${this.$t('analytics.table.count')}:</span>
                <span style="font-weight: 500;">${item.count.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>${this.$t('analytics.table.avgTime')}:</span>
                <span style="font-weight: 500;">${item.avgTime}s</span>
              </div>
            `;
            tooltip.style.display = 'block';
          });

          bar.addEventListener('mousemove', (e) => {
            const offset = 15;
            tooltip.style.left = e.pageX + offset + 'px';
            tooltip.style.top = e.pageY + offset + 'px';
          });

          bar.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
          });
        });
      } else {
        setTimeout(() => {
          this.addTooltipHandlers();
        }, 1000);
      }
    },

    /**
     * Update the chart with current data and properly themed labels
     */
    updateChart() {
      if (!this.chartData || this.chartData.length === 0) {
        this.error = this.$t('analytics.status.noData');
        return;
      }

      // FINAL FIX: Stop ApexCharts from exploding when container collapses (mobile resize)
      const chartContainer = this.$refs.chart;
      if (chartContainer) {
        const width = Math.max(0, chartContainer.offsetWidth);
        if (width < 50) {
          return; // Silently skip — no negative width, no errors
        }
      }

      const theme = this.getCssVarStrings();
      const textColor = theme.textColor;

      const topQueries = this.chartData.slice(0, 5);

      this.chartSeries = [
        {
          name: this.$t('analytics.table.count'),
          data: topQueries.map((query) => query.count)
        }
      ];

      this.chartOptions = {
        chart: {
          type: 'bar',
          height: 140,
          fontFamily: 'inherit',
          toolbar: { show: false },
          background: 'transparent',
          foreColor: textColor,
          events: {
            mounted: () => {
              setTimeout(() => {
                this.addTooltipHandlers();
                this.fixLabelColors(textColor);
              }, 100);
            },
            updated: () => {
              setTimeout(() => {
                this.addTooltipHandlers();
                this.fixLabelColors(textColor);
              }, 100);
            }
          }
        },
        plotOptions: {
          bar: {
            horizontal: false, // ← VERTICAL BARS (this was the fuckup)
            borderRadius: 2,
            columnWidth: '45%',
            dataLabels: { position: 'top' }
          }
        },
        colors: ['var(--accent)'],
        dataLabels: {
          enabled: true,
          formatter: (val) => val.toLocaleString(),
          offsetY: -20,
          style: {
            fontSize: '10px',
            colors: [textColor],
            fontWeight: '600'
          }
        },
        grid: {
          show: false
        },
        xaxis: {
          categories: topQueries.map((q, i) => `#${i + 1}`),
          labels: {
            style: { colors: textColor, fontSize: '11px' }
          },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis: {
          labels: { show: false },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        tooltip: { enabled: false },
        states: {
          hover: { filter: { type: 'none' } },
          active: {
            allowMultipleDataPointsSelection: false,
            filter: { type: 'none' }
          }
        },
        theme: {
          mode: theme.isDarkMode ? 'dark' : 'light'
        }
      };
    },

    /**
     * Fix label colors after chart render to ensure they match the theme
     */
    fixLabelColors(textColor) {
      const chartContainer = this.$refs.chart;
      if (!chartContainer) return;

      const textElements = chartContainer.querySelectorAll('text');
      textElements.forEach((element) => {
        element.setAttribute('fill', textColor);
      });

      const dataLabels = chartContainer.querySelectorAll('.apexcharts-datalabels text');
      dataLabels.forEach((label) => {
        label.setAttribute('fill', textColor);
        const children = label.querySelectorAll('*');
        children.forEach((child) => {
          if (child.tagName === 'tspan') {
            child.setAttribute('fill', textColor);
          }
        });
      });

      const topDataLabels = chartContainer.querySelectorAll(
        '.apexcharts-bar-top-datalabels text, .apexcharts-datalabel-value'
      );
      topDataLabels.forEach((label) => {
        label.setAttribute('fill', textColor);
      });
    }
  }
};
</script>

<style scoped>
.top-queries-chart {
  position: relative;
  width: 100%;
  min-height: 180px;
  background-color: var(--surface);
}

.table-container {
  max-height: 140px;
  overflow-y: auto;
  margin-bottom: var(--space-sm);
  background-color: var(--surface);
}

.top-queries-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
  background-color: var(--surface);
}

.top-queries-table th {
  background-color: var(--bg);
  padding: var(--space-xs) var(--space-sm);
  text-align: left;
  font-weight: 600;
  color: var(--fg);
  position: sticky;
  top: 0;
  z-index: 1;
  font-size: 10px;
}

.top-queries-table td {
  padding: var(--space-xs) var(--space-sm);
  border-top: 1px solid var(--border-light, var(--border-light));
  color: var(--fg);
  background-color: var(--surface);
}

.top-queries-table .rank {
  text-align: center;
  width: 30px;
}

.top-queries-table .count,
.top-queries-table .avg-time {
  text-align: right;
  width: 70px;
}

.top-queries-table .query-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
  color: var(--fg);
}

.bar-chart-container {
  width: 100%;
  height: 140px;
  margin-top: var(--space-sm);
  background-color: transparent;
}
</style>
