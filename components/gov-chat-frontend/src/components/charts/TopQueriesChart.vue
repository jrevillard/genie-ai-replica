<!-- TopQueriesChart.vue - Modified to force white data labels in dark mode -->
<template>
  <div class="top-queries-chart">
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t("analytics.status.loading") }}</span>
    </div>
    <div v-else-if="error" class="error-message">
      {{ error }}
    </div>
    <div v-else-if="!data || data.length === 0" class="no-data">
      {{ $t("analytics.status.noData") }}
    </div>
    <div v-else>
      <!-- Compressed table view -->
      <div class="table-container">
        <table class="top-queries-table">
          <thead>
            <tr>
              <th class="rank">{{ $t("analytics.table.rank") }}</th>
              <th>{{ $t("analytics.table.query") }}</th>
              <th class="count">{{ $t("analytics.table.count") }}</th>
              <th class="avg-time">{{ $t("analytics.table.avgTime") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(query, index) in data" :key="index">
              <td class="rank">{{ index + 1 }}</td>
              <td class="query-text">{{ query.text }}</td>
              <td class="count">{{ query.count.toLocaleString() }}</td>
              <td class="avg-time">{{ query.avgTime }}s</td>
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
        ></apexchart>
      </div>
    </div>
  </div>
</template>

<script>
import analyticsService from "../../services/analyticsService";

export default {
  name: "TopQueriesChart",
  props: {
    // Data can be provided by parent component
    data: {
      type: Array,
      default: () => [],
    },
    // Whether data is provided externally
    externalData: {
      type: Boolean,
      default: true,
    },
    // Period and date for API fetching if not using external data
    period: {
      type: String,
      default: "daily",
    },
    selectedDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    // Added to force re-render when language or theme changes
    renderKey: {
      type: String,
      default: null,
    },
  },
  data() {
    return {
      theme: "light", // Store current theme
      chartData: [],
      loading: false,
      error: null,
      chartOptions: null,
      chartSeries: [],
      isMobile: false,
      tooltipId: "top-queries-chart-tooltip", // Store tooltip ID for reference
      themeObserver: null,
    };
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
      deep: true,
    },
    // Re-fetch if period or date changes
    period: {
      handler() {
        if (!this.externalData) {
          this.fetchData();
        }
      },
    },
    selectedDate: {
      handler() {
        if (!this.externalData) {
          this.fetchData();
        }
      },
    },
    // Watch for renderKey (theme/locale) changes to force complete re-render
    renderKey: {
      handler() {
        this.$nextTick(() => {
          if (this.chartData && this.chartData.length > 0) {
            this.updateChart();
          }
        });
      },
    },
    // Watch for locale changes directly
    "$i18n.locale": {
      handler() {
        this.$nextTick(() => {
          if (this.chartData && this.chartData.length > 0) {
            this.updateChart();
          }
        });
      },
      immediate: false,
    },
  },
  mounted() {
    // Check if mobile on mount
    this.checkMobile();

    // Inject global stylesheet for theme
    this.injectGlobalStyleForTheme();

    // Use data from props or fetch from API
    if (this.externalData && this.data.length > 0) {
      this.chartData = this.data;
      this.updateChart();
    } else if (!this.externalData) {
      this.fetchData();
    }

    // Add resize listener
    window.addEventListener("resize", this.handleResize);

    // Create custom tooltip element
    this.ensureCustomTooltipExists();

    // Set up theme change listener
    this.setupThemeChangeListener();
  },
  beforeUnmount() {
    window.removeEventListener("resize", this.handleResize);

    // Clean up tooltip
    this.cleanupTooltip();

    // Clean up theme observer
    if (this.themeObserver) {
      this.themeObserver.disconnect();
    }

    // Remove the injected style if it exists
    const injectedStyle = document.getElementById(
      "top-queries-chart-theme-style"
    );
    if (injectedStyle) {
      document.head.removeChild(injectedStyle);
    }
  },
  methods: {
    /**
     * Inject a global stylesheet that targets ApexCharts data labels specifically
     * This ensures data label elements are styled according to the current theme
     */
    injectGlobalStyleForTheme() {
      // Check if the style already exists
      if (document.getElementById("top-queries-chart-theme-style")) {
        return;
      }

      // Create style element
      const styleEl = document.createElement("style");
      styleEl.id = "top-queries-chart-theme-style";
      const theme = this.getTheme();
      if (theme.isDarkMode) {
        styleEl.textContent = `
          /* Force ApexCharts data labels to be white in dark mode */
          [data-theme="dark"] .apexcharts-datalabels text,
          [data-theme="dark"] .apexcharts-datalabel-value,
          [data-theme="dark"] .apexcharts-datalabel,
          [data-theme="dark"] .apexcharts-datalabel-label {
            fill: #FFFFFF !important;
          }
          /* Target specifically the bar chart data labels */
          [data-theme="dark"] .apexcharts-bar-series .apexcharts-datalabels text {
            fill: #FFFFFF !important;
          }
        `;
        console.log("[TopQueriesChart] Injected dark mode style");
      } else {
        styleEl.textContent = `
          /* Force ApexCharts data labels to be black in light mode */
          [data-theme="light"] .apexcharts-datalabels text,
          [data-theme="light"] .apexcharts-datalabel-value,
          [data-theme="light"] .apexcharts-datalabel,
          [data-theme="light"] .apexcharts-datalabel-label {
            fill: #333333 !important;
          }
          /* Target specifically the bar chart data labels */
          [data-theme="light"] .apexcharts-bar-series .apexcharts-datalabels text {
            fill: #333333 !important;
          }
        `;
        console.log("[TopQueriesChart] Injected light mode style");
      }

      // Append to document head
      document.head.appendChild(styleEl);
    },

    /**
     * Check if the device is mobile based on screen width
     */
    checkMobile() {
      this.isMobile = window.innerWidth < 768;
    },

    /**
     * Get current theme information
     */
    getTheme() {
      let themeMode =
        this.$refs.chart?.closest("[data-theme]")?.getAttribute("data-theme") ||
        document.documentElement.getAttribute("data-theme") ||
        localStorage.getItem("theme") ||
        "light";
      if (!["light", "dark", "system"].includes(themeMode)) {
        console.warn(
          `[TopQueriesChart] Invalid themeMode: ${themeMode}, defaulting to light`
        );
        themeMode = "light";
      }
      if (themeMode === "system") {
        themeMode = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      }
      this.theme = themeMode;
      return {
        isDarkMode: themeMode === "dark",
        accentColor: "#4E97D1",
        backgroundColor: themeMode === "dark" ? "#414141" : "#FFFFFF",
        textColor: themeMode === "dark" ? "#FFFFFF" : "#333333",
      };
    },

    /**
     * Set up theme change listener
     */
    setupThemeChangeListener() {
      this.themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.attributeName === "class" ||
            mutation.attributeName === "data-theme"
          ) {
            console.log("[TopQueriesChart] Theme change detected");
            this.injectGlobalStyleForTheme();
            this.updateChart();
            break;
          }
        }
      });

      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    },

    /**
     * Fetch top queries data if not provided externally
     */
    async fetchData() {
      if (this.externalData) return;

      this.loading = true;
      this.error = null;

      try {
        // Try to call the real API
        try {
          // In a real implementation, you would call the API to get top queries data
          const dashboardData = await analyticsService.getDashboardAnalytics(
            this.period,
            this.selectedDate
          );
          if (dashboardData && dashboardData.topQueries) {
            this.chartData = dashboardData.topQueries;
          } else {
            throw new Error(this.$t("analytics.status.noData"));
          }
        } catch (apiError) {
          console.error("Error calling API:", apiError);
          console.log("Falling back to sample query data...");
          // Fall back to hard-coded data
          this.chartData = this.getFallbackData();
        }

        this.updateChart();
      } catch (error) {
        console.error("Error fetching top queries data:", error);
        this.error = this.$t("analytics.status.error");
      } finally {
        this.loading = false;
      }
    },

    /**
     * Get fallback data for top queries
     * @returns {Array} Sample top queries data
     */
    getFallbackData() {
      return [
        {
          text: "How do I apply for a business license?",
          count: 2347,
          avgTime: 2.3,
        },
        { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
        {
          text: "How to renew my driver's license?",
          count: 1645,
          avgTime: 2.1,
        },
        {
          text: "What documents do I need for passport application?",
          count: 1423,
          avgTime: 3.4,
        },
        { text: "When are property taxes due?", count: 1289, avgTime: 1.5 },
      ];
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
      if (!text) return "";
      return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
    },

    /**
     * Create a custom tooltip element with a unique ID
     */
    ensureCustomTooltipExists() {
      // Remove any existing tooltip with this ID
      this.cleanupTooltip();

      // Create a new tooltip element
      const tooltip = document.createElement("div");
      tooltip.id = this.tooltipId;
      tooltip.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.65);
        color: white;
        padding: 10px;
        border-radius: 4px;
        font-size: 12px;
        pointer-events: none;
        z-index: 10000;
        display: none;
        min-width: 160px;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
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
      // Get the tooltip element
      const tooltip = document.getElementById(this.tooltipId);
      if (!tooltip) {
        this.ensureCustomTooltipExists();
        return;
      }

      // Get chart container
      const chartContainer = this.$refs.chart;
      if (!chartContainer) return;

      // All possible selectors for chart bars
      const barSelectors = [
        ".apexcharts-bar-area",
        ".apexcharts-bar-series rect",
        ".apexcharts-bar rect",
        ".apexcharts-series rect",
      ];

      // Try different selectors until we find bars
      let bars = [];
      for (const selector of barSelectors) {
        bars = chartContainer.querySelectorAll(selector);
        if (bars.length > 0) {
          console.log(
            `[DEBUG] Found ${bars.length} bars using selector: ${selector}`
          );
          break;
        }
      }

      // If we still can't find bars, try the document
      if (bars.length === 0) {
        for (const selector of barSelectors) {
          bars = document.querySelectorAll(selector);
          if (bars.length > 0) {
            console.log(
              `[DEBUG] Found ${bars.length} bars in document using selector: ${selector}`
            );
            break;
          }
        }
      }

      // Apply hover handlers to each bar
      if (bars.length > 0) {
        bars.forEach((bar, index) => {
          // Make sure index is in range of our data
          if (index >= this.chartData.length) return;

          // Set cursor style
          bar.style.cursor = "pointer";

          // Create data attribute to identify the bar
          bar.setAttribute("data-bar-index", index);

          // Mouse enter handler - show tooltip
          bar.addEventListener("mouseenter", (e) => {
            const barIndex = parseInt(e.target.getAttribute("data-bar-index"));
            const item =
              this.chartData[barIndex !== undefined ? barIndex : index];
            if (!item) return;

            // Update tooltip content
            tooltip.innerHTML = `
              <div style="font-weight: bold; margin-bottom: 6px;">${this.truncateText(
                item.text,
                40
              )}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>${this.$t("analytics.table.count")}:</span>
                <span style="font-weight: 500;">${item.count.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>${this.$t("analytics.table.avgTime")}:</span>
                <span style="font-weight: 500;">${item.avgTime}s</span>
              </div>
            `;

            // Show tooltip
            tooltip.style.display = "block";
          });

          // Mouse move handler - position tooltip
          bar.addEventListener("mousemove", (e) => {
            // Position tooltip near cursor but not directly under it
            const offset = 15;
            tooltip.style.left = e.pageX + offset + "px";
            tooltip.style.top = e.pageY + offset + "px";
          });

          // Mouse leave handler - hide tooltip
          bar.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        });

        console.log("[DEBUG] Successfully added tooltip handlers to bars");
      } else {
        console.log(
          "[DEBUG] No bars found to attach tooltips, trying again later"
        );

        // Last resort: try again after a longer delay
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
        this.error = this.$t("analytics.status.noData");
        return;
      }

      // Get theme information
      const theme = this.getTheme();
      console.log(
        `[DEBUG] Theme detected: ${theme.isDarkMode ? "dark" : "light"}`
      );

      // Determine text color based on theme - white for dark mode, black for light mode
      const textColor = theme.isDarkMode ? "#FFFFFF" : "#333333";

      // Create series data for ApexCharts (limit to top 5)
      const topQueries = this.chartData.slice(0, 5);

      this.chartSeries = [
        {
          name: this.$t("analytics.table.count"),
          data: topQueries.map((query) => query.count),
        },
      ];

      // Set up chart options
      this.chartOptions = {
        chart: {
          type: "bar",
          fontFamily: "inherit",
          toolbar: {
            show: false,
          },
          animations: {
            enabled: true,
            speed: 300,
          },
          background: theme.backgroundColor,
          foreColor: textColor, // Set foreColor for all text based on theme
          events: {
            mounted: () => {
              // Add tooltip handlers when chart is first mounted
              setTimeout(() => {
                this.addTooltipHandlers();

                // Fix label colors after render
                this.fixLabelColors(textColor);
              }, 300);
            },
            updated: () => {
              // Re-add tooltip handlers when chart updates
              setTimeout(() => {
                this.addTooltipHandlers();

                // Fix label colors after update
                this.fixLabelColors(textColor);
              }, 300);
            },
          },
        },
        plotOptions: {
          bar: {
            horizontal: false,
            columnWidth: "55%",
            borderRadius: 2,
            dataLabels: {
              position: "top",
            },
          },
        },
        colors: [theme.accentColor || "#4E97D1"],
        dataLabels: {
          enabled: true,
          formatter: function (val) {
            return val.toLocaleString();
          },
          offsetY: -20,
          style: {
            fontSize: "10px",
            colors: [textColor], // Set to match the theme
            fontWeight: "600",
          },
          background: {
            enabled: false,
          },
        },
        xaxis: {
          categories: topQueries.map((query, index) => `#${index + 1}`),
          position: "bottom",
          axisBorder: {
            show: false,
          },
          axisTicks: {
            show: false,
          },
          labels: {
            style: {
              colors: textColor, // Set x-axis label color based on theme
              fontSize: "10px",
            },
          },
        },
        yaxis: {
          labels: {
            formatter: (value) => {
              return value.toLocaleString();
            },
            style: {
              colors: textColor, // Set y-axis label color based on theme
              fontSize: "10px",
            },
          },
        },
        grid: {
          borderColor: theme.isDarkMode
            ? "rgba(255, 255, 255, 0.1)"
            : "rgba(0, 0, 0, 0.1)",
        },
        tooltip: {
          enabled: false, // Disable built-in tooltips completely
        },
        states: {
          hover: {
            filter: {
              type: "none", // No filter on hover
            },
          },
          active: {
            allowMultipleDataPointsSelection: false,
            filter: {
              type: "none", // No filter on active state
            },
          },
        },
        theme: {
          mode: theme.isDarkMode ? "dark" : "light",
        },
      };
    },

    /**
     * Fix label colors after chart render to ensure they match the theme
     * This is a backup method in case the config options don't apply correctly
     */
    fixLabelColors(textColor) {
      // Select all chart text elements
      const chartContainer = this.$refs.chart;
      if (!chartContainer) return;

      // Find all text elements in the chart
      const textElements = chartContainer.querySelectorAll("text");

      // Apply the correct color based on theme
      textElements.forEach((element) => {
        // Don't change dataLabel colors (they're inside the bars)
        element.setAttribute("fill", textColor);
      });

      // Specifically target data labels for bar values
      const dataLabels = chartContainer.querySelectorAll(
        ".apexcharts-datalabels text"
      );
      dataLabels.forEach((label) => {
        label.setAttribute("fill", textColor);

        // Find any child elements and set them too
        const children = label.querySelectorAll("*");
        children.forEach((child) => {
          if (child.tagName === "tspan") {
            child.setAttribute("fill", textColor);
          }
        });
      });

      // Target data labels on top of bars specifically
      const topDataLabels = chartContainer.querySelectorAll(
        ".apexcharts-bar-top-datalabels text, .apexcharts-datalabel-value"
      );
      topDataLabels.forEach((label) => {
        label.setAttribute("fill", textColor);
      });

      // If we are in dark mode, force white text for data labels
      if (textColor === "#FFFFFF") {
        const allDataLabelElements = chartContainer.querySelectorAll(
          ".apexcharts-datalabels text, .apexcharts-datalabel, .apexcharts-datalabel-label, .apexcharts-datalabel-value"
        );
        allDataLabelElements.forEach((el) => {
          el.setAttribute("fill", "#FFFFFF");
        });
      }
    },
  },
};
</script>

<style scoped>
.top-queries-chart {
  position: relative;
  width: 100%;
  min-height: 180px;
  background-color: var(--bg-card, #fff);
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
  opacity: 0.8;
  z-index: 1;
}

.spinner {
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top: 3px solid var(--accent-color, #4e97d1);
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
  margin-bottom: 8px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.error-message,
.no-data {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: var(--text-primary, #333);
  font-size: 12px;
}

.error-message {
  color: var(--status-outage, #d32f2f);
}

.table-container {
  max-height: 140px;
  overflow-y: auto;
  margin-bottom: 8px;
  background-color: var(--bg-card, #fff);
}

.top-queries-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  background-color: var(--bg-card, #fff);
}

.top-queries-table th {
  background-color: var(--bg-tertiary, #f5f7fa);
  padding: 5px 6px;
  text-align: left;
  font-weight: 600;
  color: var(--text-primary, #333);
  position: sticky;
  top: 0;
  z-index: 1;
  font-size: 10px;
}

.top-queries-table td {
  padding: 4px 6px;
  border-top: 1px solid var(--border-light, #eee);
  color: var(--text-primary, #333);
  background-color: var(--bg-card, #fff);
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
  color: var(--text-primary, #333);
}

.bar-chart-container {
  width: 100%;
  height: 140px;
  margin-top: 10px;
  background-color: transparent;
}

/* Force data labels to be white in dark mode - focused selector */
:deep([data-theme="dark"]) .apexcharts-datalabels text,
:deep([data-theme="dark"]) .apexcharts-datalabel-value,
:deep([data-theme="dark"]) .apexcharts-datalabel-label {
  fill: white !important;
}

/* Target specifically the data labels above the bars */
:deep([data-theme="dark"]) .apexcharts-bar-series .apexcharts-datalabels text {
  fill: white !important;
}

/* Retain existing dark mode styles */
/* Force all text in charts to follow theme colors */
:deep([data-theme="dark"]) .apexcharts-text,
:deep(.dark-theme) .apexcharts-text,
:deep(.dark-mode) .apexcharts-text {
  fill: white !important;
}

:deep([data-theme="light"]) .apexcharts-text,
:deep(:not([data-theme="dark"]):not(.dark-theme):not(.dark-mode))
  .apexcharts-text {
  fill: #333333 !important;
}

/* Target specifically the X-axis labels at the bottom which appear to be the problem */
:deep([data-theme="dark"]) .apexcharts-xaxis .apexcharts-xaxis-texts-g text,
:deep(.dark-theme) .apexcharts-xaxis .apexcharts-xaxis-texts-g text,
:deep(.dark-mode) .apexcharts-xaxis .apexcharts-xaxis-texts-g text {
  fill: white !important;
  color: white !important;
}

/* Target the Y-axis labels too */
:deep([data-theme="dark"]) .apexcharts-yaxis .apexcharts-yaxis-texts-g text,
:deep(.dark-theme) .apexcharts-yaxis .apexcharts-yaxis-texts-g text,
:deep(.dark-mode) .apexcharts-yaxis .apexcharts-yaxis-texts-g text {
  fill: white !important;
  color: white !important;
}

/* Target data value labels on top of bars */
:deep([data-theme="dark"]) .apexcharts-datalabels text,
:deep(.dark-theme) .apexcharts-datalabels text,
:deep(.dark-mode) .apexcharts-datalabels text {
  fill: white !important;
  color: white !important;
}

/* Dark mode overrides - these will only apply in dark mode */
[data-theme="dark"] .top-queries-chart,
.dark-theme .top-queries-chart,
.dark-mode .top-queries-chart {
  background-color: #414141 !important; /* Dark mode background */
}

[data-theme="dark"] .top-queries-table th,
.dark-theme .top-queries-table th,
.dark-mode .top-queries-table th {
  background-color: #414141 !important; /* Dark mode background */
  color: white !important; /* Dark mode text */
}

[data-theme="dark"] .bar-chart-container,
.dark-theme .bar-chart-container,
.dark-mode .bar-chart-container {
  background-color: #414141 !important; /* Dark mode background */
}

[data-theme="dark"] .top-queries-table td,
.dark-theme .top-queries-table td,
.dark-mode .top-queries-table td {
  border-top: 1px solid #555 !important; /* Dark mode border */
  color: white !important; /* Dark mode text */
  background-color: #414141 !important; /* Dark mode background */
}

[data-theme="dark"] .table-container,
.dark-theme .table-container,
.dark-mode .table-container {
  background-color: #414141 !important; /* Dark mode background */
}

[data-theme="dark"] .top-queries-table .query-text,
.dark-theme .top-queries-table .query-text,
.dark-mode .top-queries-table .query-text {
  color: white !important; /* Dark mode text */
}

[data-theme="dark"] .top-queries-table,
.dark-theme .top-queries-table,
.dark-mode .top-queries-table {
  background-color: #414141 !important; /* Dark mode background */
}
</style>