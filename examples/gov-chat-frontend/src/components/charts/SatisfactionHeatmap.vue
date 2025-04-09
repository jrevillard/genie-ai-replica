<!-- SatisfactionHeatmap.vue - Fixed with tooltip background matching CategoryDistributionChart -->
<template>
  <div class="heatmap-wrapper">
    <div ref="chart" class="chart-container">
      <apexchart v-if="!loading && !error && chartOptions" type="heatmap" height="290" :options="chartOptions"
        :series="chartSeries"></apexchart>
    </div>
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ translate('analytics.status.loading', 'Loading...') }}</span>
    </div>
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script>
import analyticsService from '../../services/analyticsService';
import { getThemeInfo as getThemeFromManager } from '../../utils/ThemeManager';

export default {
  name: 'SatisfactionHeatmap',
  props: {
    // Data can be provided by parent component
    data: {
      type: Array,
      default: () => []
    },
    // Whether to use provided data or fetch from API
    externalData: {
      type: Boolean,
      default: true
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
    // Added to force re-render when language changes
    renderKey: {
      type: String,
      default: null
    }
  },
  data() {
    return {
      chartData: [],
      loading: false,
      error: null,
      chartOptions: null,
      chartSeries: [],
      isMobile: false,
      themeObserver: null,
      systemThemeMediaQuery: null,
      systemThemeChangeHandler: null
    };
  },
  computed: {
    isI18nReady() {
      return typeof this.$t === 'function';
    },
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
    // Watch for renderKey (locale) changes to force complete re-render
    renderKey: {
      handler() {
        if (this.chartData && this.chartData.length > 0) {
          this.updateChart();
        }
      }
    }
  },
  mounted() {
    // Check if mobile on mount
    this.checkMobile();

    // Add theme change listener
    this.setupThemeChangeListener();
    
    // Inject global style to ensure text is properly colored
    this.injectGlobalStyleForDarkMode();

    // Use data from props or fetch from API
    if (this.externalData && this.data.length > 0) {
      this.chartData = this.data;
      this.updateChart();
    } else if (!this.externalData) {
      this.fetchData();
    } else {
      // Use sample data if no data is provided
      this.chartData = this.getFallbackData();
      this.updateChart();
    }

    // Add resize listener
    window.addEventListener('resize', this.handleResize);
    
    // Initial enforcement of white text for dark mode
    this.$nextTick(() => {
      this.enforceColorScheme();
    });
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);

    // Clean up theme change listeners
    this.cleanupThemeChangeListener();
    
    // Remove the injected style if it exists
    const injectedStyle = document.getElementById('satisfaction-heatmap-dark-mode-style');
    if (injectedStyle) {
      document.head.removeChild(injectedStyle);
    }
  },
  methods: {
    /**
     * Safe translation method
     * @param {string} key - Translation key
     * @param {string} defaultValue - Default value if key not found or i18n not ready
     * @returns {string} Translated text or default value
     */
    translate(key, defaultValue) {
      return this.isI18nReady ? this.$t(key, defaultValue) : defaultValue;
    },

    /**
     * Inject a global stylesheet that targets ApexCharts elements
     * This ensures all text elements are white in dark mode
     */
    injectGlobalStyleForDarkMode() {
      // Check if the style already exists
      if (document.getElementById('satisfaction-heatmap-dark-mode-style')) {
        return;
      }
      
      // Create style element
      const styleEl = document.createElement('style');
      styleEl.id = 'satisfaction-heatmap-dark-mode-style';
      styleEl.textContent = `
        /* Force ApexCharts title and subtitle to be white in dark mode */
        [data-theme="dark"] .apexcharts-title-text,
        [data-theme="dark"] .apexcharts-subtitle-text {
          fill: #FFFFFF !important;
        }
        
        /* Additional styling for other text elements */
        [data-theme="dark"] .apexcharts-text,
        [data-theme="dark"] .apexcharts-xaxis-label text,
        [data-theme="dark"] .apexcharts-yaxis-label text {
          fill: #FFFFFF !important;
        }
        
        /* Legend text needs color property, not fill */
        [data-theme="dark"] .apexcharts-legend-text {
          color: #FFFFFF !important;
        }
        
        /* Force tooltips to match CategoryDistributionChart */
        .apexcharts-tooltip {
          background-color: rgba(0, 0, 0, 0.65) !important;
          color: #FFFFFF !important;
          border: none !important;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3) !important;
        }
        
        .apexcharts-tooltip-title {
          background-color: rgba(0, 0, 0, 0.65) !important;
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
     * Fetch satisfaction heatmap data from API
     */
    async fetchData() {
      this.loading = true;
      this.error = null;

      try {
        // Get current locale from i18n
        const locale = this.isI18nReady ? this.$i18n.locale : 'en';

        // Fetch satisfaction heatmap data
        const heatmapData = await analyticsService.getSatisfactionHeatmap(
          this.period,
          this.selectedDate,
          locale
        );

        if (heatmapData && heatmapData.length > 0) {
          this.chartData = heatmapData;
          this.updateChart();
        } else {
          console.warn('No satisfaction heatmap data returned from API');
          this.chartData = this.getFallbackData();
          this.updateChart();
        }
      } catch (error) {
        console.error('Error fetching satisfaction heatmap data:', error);
        this.error = this.translate('analytics.errors.loading', 'Failed to load satisfaction data. Please try again.');
        
        // Use fallback data in case of error
        this.chartData = this.getFallbackData();
        this.updateChart();
      } finally {
        this.loading = false;
      }
    },

    /**
     * Get fallback data in case API fails
     * @returns {Array} Sample satisfaction heatmap data
     */
    getFallbackData() {
      // Knowledge areas
      const areas = [
        this.translate('analytics.areas.immigration', 'Immigration & Citizenship'),
        this.translate('analytics.areas.business', 'Business & Trade'),
        this.translate('analytics.areas.identity', 'Identity & Civil Registration'),
        this.translate('analytics.areas.social', 'Social Security & Pensions'),
        this.translate('analytics.areas.education', 'Education & Learning'),
        this.translate('analytics.areas.employment', 'Employment & Labor Services'),
        this.translate('analytics.areas.health', 'Health & Social Services')
      ];

      // Time periods
      const timePeriods = [
        this.translate('analytics.timePeriods.week4', '4 Weeks Ago'),
        this.translate('analytics.timePeriods.week3', '3 Weeks Ago'),
        this.translate('analytics.timePeriods.week2', '2 Weeks Ago'),
        this.translate('analytics.timePeriods.week1', 'Last Week'),
        this.translate('analytics.timePeriods.current', 'Current')
      ];

      // Generate sample data for each area and time period
      return areas.map(area => {
        const data = {};
        data.name = area;
        data.data = timePeriods.map((period, index) => {
          // Generate random satisfaction scores that trend slightly upward
          let baseScore = 75 + Math.floor(Math.random() * 15);
          // Add a small upward trend (with some randomness)
          baseScore += index * (1 + Math.random());
          // Ensure score doesn't exceed 100
          const score = Math.min(Math.round(baseScore), 100);
          
          return {
            x: period,
            y: score
          };
        });
        return data;
      });
    },

    /**
     * Handle window resize
     */
    handleResize() {
      this.checkMobile();
      this.updateChart();
    },

    /**
     * Set up theme change listener to update chart when theme changes
     */
    setupThemeChangeListener() {
      // Watch for theme changes through classList mutations
      this.themeObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme') {
            this.updateChart();
            
            // Also enforce color scheme after chart updates
            setTimeout(() => {
              this.enforceColorScheme();
            }, 300);
            
            break;
          }
        }
      });

      // Observe document root for theme changes
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });

      // Also listen for system preference changes
      this.systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemThemeChangeHandler = () => {
        this.updateChart();
        
        // Also enforce color scheme after chart updates
        setTimeout(() => {
          this.enforceColorScheme();
        }, 300);
      };

      // Add listener with compatibility for older browsers
      if (this.systemThemeMediaQuery.addEventListener) {
        this.systemThemeMediaQuery.addEventListener('change', this.systemThemeChangeHandler);
      } else {
        // Fallback for older browsers
        this.systemThemeMediaQuery.addListener(this.systemThemeChangeHandler);
      }
    },

    /**
     * Clean up theme change listeners
     */
    cleanupThemeChangeListener() {
      if (this.themeObserver) {
        this.themeObserver.disconnect();
      }

      if (this.systemThemeMediaQuery) {
        if (this.systemThemeMediaQuery.removeEventListener) {
          this.systemThemeMediaQuery.removeEventListener('change', this.systemThemeChangeHandler);
        } else {
          // Fallback for older browsers
          this.systemThemeMediaQuery.removeListener(this.systemThemeChangeHandler);
        }
      }
    },

    /**
     * Get current theme information
     */
    getThemeInfo() {
      // Use the singleton theme manager
      return getThemeFromManager();
    },
    
    /**
     * Enforce color scheme on chart text elements directly
     * This ensures text is visible in dark mode
     */
    enforceColorScheme() {
      // Directly modify SVG text elements for better visibility in dark mode
      const theme = this.getThemeInfo();
      if (theme.isDarkMode) {
        setTimeout(() => {
          // Get the chart container
          const chartContainer = this.$refs.chart;
          if (!chartContainer) return;
          
          // Find all SVG text elements
          const textElements = chartContainer.querySelectorAll('text');
          textElements.forEach(text => {
            text.setAttribute('fill', '#FFFFFF');
            
            // Also handle any tspan elements inside
            const tspans = text.querySelectorAll('tspan');
            tspans.forEach(tspan => {
              tspan.setAttribute('fill', '#FFFFFF');
            });
          });
          
          // Specifically target title and subtitle
          const title = chartContainer.querySelector('.apexcharts-title-text');
          if (title) title.setAttribute('fill', '#FFFFFF');
          
          const subtitle = chartContainer.querySelector('.apexcharts-subtitle-text');
          if (subtitle) subtitle.setAttribute('fill', '#FFFFFF');
          
          // Specifically target legend text
          const legendItems = chartContainer.querySelectorAll('.apexcharts-legend-text');
          legendItems.forEach(item => {
            item.style.color = '#FFFFFF';
          });
        }, 200);
      }
    },

    /**
     * Update the chart with current data and theme
     */
    updateChart() {
      if (!this.chartData || this.chartData.length === 0) {
        this.error = this.translate('analytics.status.noData', 'No data available');
        return;
      }

      // Get theme information
      const theme = this.getThemeInfo();
      
      // Get text and background colors - FORCE white text in dark mode
      const textColor = theme.isDarkMode ? '#FFFFFF' : '#333333';
      const backgroundColor = theme.isDarkMode ? '#414141' : '#FFFFFF';
      const borderColor = theme.isDarkMode ? '#555555' : '#E5E7EB';

      // Series data is the chartData directly
      this.chartSeries = this.chartData;

      // Color function for heatmap cells
      const getColorScale = () => {
        if (theme.isDarkMode) {
          // Dark mode: slightly different, more visible colors
          return {
            ranges: [
              { from: 0, to: 69.99, color: '#7D3030', name: 'Poor' },
              { from: 70, to: 79.99, color: '#A36624', name: 'Average' },
              { from: 80, to: 89.99, color: '#3D7242', name: 'Good' },
              { from: 90, to: 100, color: '#1A9350', name: 'Excellent' }
            ]
          };
        } else {
          // Light mode
          return {
            ranges: [
              { from: 0, to: 69.99, color: '#EF4444', name: 'Poor' },
              { from: 70, to: 79.99, color: '#F59E0B', name: 'Average' },
              { from: 80, to: 89.99, color: '#84CC16', name: 'Good' },
              { from: 90, to: 100, color: '#22C55E', name: 'Excellent' }
            ]
          };
        }
      };

      // Set up chart options with proper text colors for dark mode
      this.chartOptions = {
        chart: {
          type: 'heatmap',
          fontFamily: 'inherit',
          toolbar: {
            show: false
          },
          background: backgroundColor,
          foreColor: textColor, // This sets the base text color
          events: {
            mounted: () => {
              // Once chart is mounted, enforce the color scheme
              this.enforceColorScheme();
            },
            updated: () => {
              // When chart updates, re-enforce the color scheme
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
            colors: ['#FFFFFF'],  // Always white for better visibility on colored cells
            fontSize: '12px',
            fontWeight: 'bold'
          },
          formatter: function(val) {
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
            fill: textColor // Added fill property for SVG text
          }
        },
        subtitle: {
          text: this.translate('analytics.charts.satisfactionSubtitle', 'Percentage scores over time'),
          align: 'center',
          style: {
            fontSize: '12px',
            color: textColor,
            fill: textColor // Added fill property for SVG text
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
          // Always use dark theme for tooltips regardless of current theme
          theme: 'dark',
          style: {
            fontSize: '12px'
          },
          // Custom tooltip formatter to match CategoryDistributionChart
          custom: function({ series, seriesIndex, dataPointIndex, w }) {
            // Get the value and category
            const value = series[seriesIndex][dataPointIndex];
            const category = w.globals.seriesNames[seriesIndex];
            const xLabel = w.globals.labels[dataPointIndex];
            
            // Use exact same tooltip style as CategoryDistributionChart
            return `
              <div class="apexcharts-tooltip-box" style="background: rgba(0, 0, 0, 0.65); color: #fff; padding: 8px 10px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
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
            formatter: function(val) {
              return val + '%';
            },
            title: {
              formatter: function(seriesName) {
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
            offsetX: -14 // Add a moderate offset to move labels left
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
      
      // Schedule another color enforcement after chart renders
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
  border-top: 3px solid var(--accent-color, #4E97D1);
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

/* Mobile-specific styles */
@media (max-width: 767px) {
  .heatmap-wrapper {
    min-height: 400px;
  }
}

/* Fix dark mode spinner */
[data-theme="dark"] .spinner {
  border-color: rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent-color, #4E97D1);
}

/* Force title and subtitle to be white in dark mode */
:deep([data-theme="dark"]) .apexcharts-title-text,
:deep([data-theme="dark"]) .apexcharts-subtitle-text {
  fill: white !important;
}

/* Force axis labels to be white in dark mode */
:deep([data-theme="dark"]) .apexcharts-yaxis-label text,
:deep([data-theme="dark"]) .apexcharts-xaxis-label text {
  fill: white !important;
}

/* Force legend text to be white in dark mode */
:deep([data-theme="dark"]) .apexcharts-legend-text {
  color: white !important;
}

/* Ensure all text elements are white in dark mode */
:deep([data-theme="dark"]) text,
:deep([data-theme="dark"]) tspan {
  fill: white !important;
}

/* Match tooltip styling exactly with CategoryDistributionChart */
:deep(.apexcharts-tooltip) {
  background-color: rgba(0, 0, 0, 0.65) !important;
  color: white !important;
  border: none !important;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3) !important;
}

:deep(.apexcharts-tooltip-title) {
  background-color: rgba(0, 0, 0, 0.65) !important;
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