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
      ></apexchart>
    </div>
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ translate("analytics.status.loading", "Loading...") }}</span>
    </div>
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script>
import analyticsService from "../../services/analyticsService";
import { useChartTheme } from "@/composables/useChartTheme";

export default {
  name: "SatisfactionHeatmap",
  props: {
    data: {
      type: Array,
      default: null,
    },
    externalData: {
      type: Boolean,
      default: true,
    },
    period: {
      type: String,
      default: "monthly",
    },
    selectedDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    renderKey: {
      type: String,
      default: null,
    },
  },
  setup() {
    const { theme, getTheme } = useChartTheme({
      listenToSystem: true,
      onThemeChange: () => {
        // Chart will re-render via the theme watcher
      },
    });
    return { theme, getTheme };
  },
  data() {
    return {
      chartData: [],
      loading: false,
      error: null,
      chartOptions: null,
      chartSeries: [],
      isMobile: false,
    };
  },
  computed: {
    isI18nReady() {
      return typeof this.$t === "function";
    },
  },
  watch: {
    data: {
      handler(newData) {
        if (this.externalData && newData && newData.length > 0) {
          console.log(
            "[SatisfactionHeatmap] Updating chart with new external data:",
            newData
          );
          this.chartData = newData;
          this.updateChart();
        }
      },
      deep: true,
    },
    period: {
      handler() {
        if (!this.externalData) {
          console.log(
            "[SatisfactionHeatmap] Period changed, fetching new data"
          );
          this.fetchData();
        }
      },
    },
    selectedDate: {
      handler() {
        if (!this.externalData) {
          console.log(
            "[SatisfactionHeatmap] Selected date changed, fetching new data"
          );
          this.fetchData();
        }
      },
    },
    renderKey: {
      handler() {
        if (this.chartData && this.chartData.length > 0) {
          console.log(
            "[SatisfactionHeatmap] Render key changed, updating chart"
          );
          this.updateChart();
        }
      },
    },
    // Watch for theme changes from useChartTheme composable
    theme: {
      handler() {
        this.$nextTick(() => {
          this.injectGlobalStyleForTheme();
          if (this.chartData && this.chartData.length > 0) {
            this.updateChart();
            setTimeout(() => {
              this.enforceColorScheme();
            }, 300);
          }
        });
      },
    },
  },
  mounted() {
    this.checkMobile();
    this.injectGlobalStyleForTheme();

    if (this.externalData && this.data && this.data.length > 0) {
      console.log("[SatisfactionHeatmap] Using external data:", this.data);
      this.chartData = this.data;
      this.updateChart();
    } else if (!this.externalData) {
      console.log("[SatisfactionHeatmap] Fetching data from API");
      this.fetchData();
    } else {
      console.log("[SatisfactionHeatmap] No data provided, chart will be empty");
      this.chartData = [];
      this.updateChart();
    }

    window.addEventListener("resize", this.handleResize);
    this.$nextTick(() => {
      this.enforceColorScheme();
    });
  },
  beforeUnmount() {
    window.removeEventListener("resize", this.handleResize);
    const injectedStyle = document.getElementById(
      "satisfaction-heatmap-theme-style"
    );
    if (injectedStyle) {
      document.head.removeChild(injectedStyle);
    }
  },
  methods: {
    /**
     * Inject a global stylesheet for chart text based on theme
     */
    injectGlobalStyleForTheme() {
      if (document.getElementById("satisfaction-heatmap-theme-style")) {
        return;
      }
      const styleEl = document.createElement("style");
      styleEl.id = "satisfaction-heatmap-theme-style";
      const theme = this.getTheme();
      if (theme.isDarkMode) {
        styleEl.textContent = `
          [data-theme="dark"] .apexcharts-title-text,
          [data-theme="dark"] .apexcharts-subtitle-text,
          [data-theme="dark"] .apexcharts-text,
          [data-theme="dark"] .apexcharts-xaxis-label,
          [data-theme="dark"] .apexcharts-yaxis-label,
          [data-theme="dark"] .apexcharts-legend-text {
            fill: #FFFFFF !important;
            color: #FFFFFF !important;
          }
          .apexcharts-tooltip, .apexcharts-tooltip * {
            background-color: transparent !important;
          }
          .apexcharts-tooltip-box {
            background-color: rgba(0, 0, 0, 0.55) !important;
            color: #FFFFFF !important;
            border: none !important;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3) !important;
          }
          .apexcharts-tooltip-title {
            background-color: rgba(0, 0, 0, 0.55) !important;
            color: #FFFFFF !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2) !important;
          }
          .apexcharts-tooltip-text-y-label,
          .apexcharts-tooltip-text-y-value,
          .apexcharts-tooltip-text-z-label,
          .apexcharts-tooltip-text-z-value,
          .apexcharts-tooltip-marker,
          .apexcharts-tooltip * {
            color: #FFFFFF !important;
          }
        `;
        console.log("[SatisfactionHeatmap] Injected dark mode style");
      } else {
        styleEl.textContent = `
          [data-theme="light"] .apexcharts-title-text,
          [data-theme="light"] .apexcharts-subtitle-text,
          [data-theme="light"] .apexcharts-text,
          [data-theme="light"] .apexcharts-xaxis-label,
          [data-theme="light"] .apexcharts-yaxis-label,
          [data-theme="light"] .apexcharts-legend-text {
            fill: #333333 !important;
            color: #333333 !important;
          }
          .apexcharts-tooltip, .apexcharts-tooltip * {
            background-color: transparent !important;
          }
          .apexcharts-tooltip-box {
            background-color: rgba(0, 0, 0, 0.55) !important;
            color: #FFFFFF !important;
            border: none !important;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3) !important;
          }
          .apexcharts-tooltip-title {
            background-color: rgba(0, 0, 0, 0.55) !important;
            color: #FFFFFF !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2) !important;
          }
          .apexcharts-tooltip-text-y-label,
          .apexcharts-tooltip-text-y-value,
          .apexcharts-tooltip-text-z-label,
          .apexcharts-tooltip-text-z-value,
          .apexcharts-tooltip-marker,
          .apexcharts-tooltip * {
            color: #FFFFFF !important;
          }
        `;
        console.log("[SatisfactionHeatmap] Injected light mode style");
      }
      document.head.appendChild(styleEl);
      console.log(
        "[DEBUG] Injected theme style:",
        theme.isDarkMode ? "dark" : "light"
      );
      console.log("[DEBUG] Tooltip styles applied with !important");
      console.log("[DEBUG] Tooltip wrapper background set to transparent");
    },

    translate(key, defaultValue) {
      if (this.isI18nReady) {
        try {
          const locale = this.$i18n ? this.$i18n.locale : "en";
          const translation = this.$i18n.t(key, { locale: locale });
          if (translation === key) {
            return defaultValue;
          }
          return translation;
        } catch (e) {
          console.warn(`Translation error for key "${key}":`, e);
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
        console.log(
          "[SatisfactionHeatmap] Skipping fetchData due to externalData=true"
        );
        return;
      }
      this.loading = true;
      this.error = null;

      try {
        const locale = this.isI18nReady ? this.$i18n.locale : "en";
        console.log(
          `[SatisfactionHeatmap] Fetching data with period=${this.period}, date=${this.selectedDate}, locale=${locale}`
        );
        const heatmapData = await analyticsService.getSatisfactionHeatmap(
          this.period,
          this.selectedDate,
          locale
        );

        if (heatmapData && heatmapData.length > 0) {
          console.log(
            "[SatisfactionHeatmap] Heatmap data received:",
            heatmapData
          );
          this.chartData = heatmapData;
          this.updateChart();
        } else {
          console.warn(
            "[SatisfactionHeatmap] No satisfaction heatmap data returned from API"
          );
          this.chartData = [];
          this.updateChart();
        }
      } catch (error) {
        console.error(
          error,
          "[SatisfactionHeatmap] Error fetching satisfaction heatmap"
        );
        this.error = this.translate(
          "analytics.error.loading",
          "Failed to load satisfaction data."
        );
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
      const theme = this.getTheme();
      const textColor = theme.textColor;
      setTimeout(() => {
        const chartContainer = this.$refs.chart;
        if (!chartContainer) return;

        const textElements = chartContainer.querySelectorAll("text");
        textElements.forEach((text) => {
          text.setAttribute("fill", textColor);
          const tspans = text.querySelectorAll("tspan");
          tspans.forEach((tspan) => {
            tspan.setAttribute("fill", textColor);
          });
        });

        const title = chartContainer.querySelector(".apexcharts-title-text");
        if (title) title.setAttribute("fill", textColor);

        const subtitle = chartContainer.querySelector(
          ".apexcharts-subtitle-text"
        );
        if (subtitle) subtitle.setAttribute("fill", textColor);

        const legendItems = chartContainer.querySelectorAll(
          ".apexcharts-legend-text"
        );
        legendItems.forEach((item) => {
          item.style.color = textColor;
        });

        console.log(`[DEBUG] Enforcing text color: ${textColor}`);
      }, 200);
    },

    updateChart() {
      if (!this.chartData || this.chartData.length === 0) {
        this.error = this.translate(
          "analytics.status.noData",
          "No data available"
        );
        return;
      }

      const theme = this.getTheme();
      const textColor = theme.textColor;
      const backgroundColor = theme.backgroundColor;
      const borderColor = theme.borderColor;

      this.chartSeries = this.chartData;

      const getColorScale = () => {
        const poorText = this.translate("analytics.ratings.poor", "Poor");
        const averageText = this.translate(
          "analytics.ratings.average",
          "Average"
        );
        const goodText = this.translate("analytics.ratings.good", "Good");
        const excellentText = this.translate(
          "analytics.ratings.excellent",
          "Excellent"
        );

        if (theme.isDarkMode) {
          return {
            ranges: [
              { from: 0, to: 69.99, color: "#7D3030", name: poorText },
              { from: 70, to: 79.99, color: "#A36624", name: averageText },
              { from: 80, to: 89.99, color: "#3D7242", name: goodText },
              { from: 90, to: 100, color: "#1A9350", name: excellentText },
            ],
          };
        } else {
          return {
            ranges: [
              { from: 0, to: 69.99, color: "#EF4444", name: poorText },
              { from: 70, to: 79.99, color: "#F59E0B", name: averageText },
              { from: 80, to: 89.99, color: "#84CC16", name: goodText },
              { from: 90, to: 100, color: "#22C55E", name: excellentText },
            ],
          };
        }
      };

      this.chartOptions = {
        chart: {
          type: "heatmap",
          fontFamily: "inherit",
          toolbar: {
            show: false,
          },
          background: backgroundColor,
          foreColor: textColor,
          events: {
            mounted: () => {
              this.enforceColorScheme();
            },
            updated: () => {
              this.enforceColorScheme();
            },
          },
        },
        plotOptions: {
          heatmap: {
            colorScale: getColorScale(),
            radius: 2,
            enableShades: true,
            shadeIntensity: 0.5,
          },
        },
        dataLabels: {
          enabled: true,
          style: {
            colors: ["#FFFFFF"],
            fontSize: "12px",
            fontWeight: "bold",
          },
          formatter: function (val) {
            return val + "%";
          },
        },
        stroke: {
          width: 1,
          colors: [backgroundColor],
        },
        title: {
          text: this.translate(
            "analytics.charts.satisfactionHeatmap",
            "Satisfaction by Knowledge Area"
          ),
          align: "center",
          style: {
            fontSize: "16px",
            fontWeight: "bold",
            color: textColor,
            fill: textColor,
          },
        },
        subtitle: {
          text: this.translate(
            "analytics.charts.satisfactionSubtitle",
            "Percentage scores over time"
          ),
          align: "center",
          style: {
            fontSize: "12px",
            color: textColor,
            fill: textColor,
          },
        },
        legend: {
          position: "bottom",
          labels: {
            colors: textColor,
          },
        },
        tooltip: {
          enabled: true,
          theme: "dark",
          style: {
            fontSize: "12px",
          },
          custom: ({ series, seriesIndex, dataPointIndex, w }) => {
            console.log(
              "[DEBUG] Tooltip background set to rgba(0, 0, 0, 0.55)"
            );
            const value = series[seriesIndex][dataPointIndex];
            const category = w.globals.seriesNames[seriesIndex];
            const xLabel = w.globals.labels[dataPointIndex];
            return `
              <div class="apexcharts-tooltip-box" style="background: rgba(0, 0, 0, 0.55) !important; color: #fff; padding: 8px 10px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                <div style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px;">
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
              return val + "%";
            },
            title: {
              formatter: function (seriesName) {
                return seriesName;
              },
            },
          },
        },
        xaxis: {
          labels: {
            style: {
              colors: textColor,
              fontSize: "12px",
            },
          },
        },
        yaxis: {
          labels: {
            style: {
              colors: textColor,
              fontSize: "12px",
            },
            offsetX: -14,
          },
        },
        grid: {
          borderColor: borderColor,
          padding: {
            right: 0,
            left: 0,
          },
        },
        theme: {
          mode: theme.isDarkMode ? "dark" : "light",
          palette: "palette1",
        },
      };

      this.$nextTick(() => {
        setTimeout(() => {
          this.enforceColorScheme();
        }, 300);
      });
    },
  },
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
  border-radius: 8px;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, rgba(255, 255, 255, 0.8));
  z-index: 1;
}

.spinner {
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top: 3px solid var(--accent-color, #4e97d1);
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin-bottom: 10px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.error-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: var(--status-outage, #d32f2f);
}

@media (max-width: 767px) {
  .heatmap-wrapper {
    min-height: 400px;
  }
}

[data-theme="dark"] .spinner {
  border-color: rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent-color, #4e97d1);
}

:deep([data-theme="dark"]) .apexcharts-title-text,
:deep([data-theme="dark"]) .apexcharts-subtitle-text {
  fill: white !important;
}

:deep([data-theme="dark"]) .apexcharts-yaxis-label text,
:deep([data-theme="dark"]) .apexcharts-xaxis-label text {
  fill: white !important;
}

:deep([data-theme="dark"]) .apexcharts-legend-text {
  color: white !important;
}

:deep([data-theme="dark"]) text,
:deep([data-theme="dark"]) tspan {
  fill: white !important;
}

:deep(.apexcharts-tooltip, .apexcharts-tooltip *) {
  background-color: transparent !important;
}

:deep(.apexcharts-tooltip-box) {
  background-color: rgba(0, 0, 0, 0.55) !important;
  color: white !important;
  border: none !important;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3) !important;
}

:deep(.apexcharts-tooltip-title) {
  background-color: rgba(0, 0, 0, 0.55) !important;
  color: white !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2) !important;
}

:deep(.apexcharts-tooltip-text),
:deep(.apexcharts-tooltip-y-group),
:deep(.apexcharts-tooltip-text-y-label),
:deep(.apexcharts-tooltip-text-y-value) {
  color: white !important;
}
</style>