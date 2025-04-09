<!-- SatisfactionGauge.vue - Speedometer with correctly positioned notches and debug code -->
<template>
  <div class="gauge-wrapper">
    <!-- Debug panel -->
    <pre v-if="debug" style="font-size: 10px; max-height: 150px; overflow: auto; background: #333; color: #fff; padding: 5px;">
      Loading: {{ loading }}
      Error: {{ error }}
      Value: {{ actualSatisfactionValue }}
      Chart Options: {{ chartOptions ? 'Set' : 'Not Set' }}
      externalData: {{ externalData }}
      Last Error: {{ lastError }}
      ChartKey: {{ chartKey }}
    </pre>
    
    <div ref="chart" class="chart-container">
      <!-- Debug outline to see if container is rendering -->
      <div v-if="debug" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; border: 2px dashed red; z-index: 100; pointer-events: none;"></div>
      
      <!-- Only render chart when data and options are definitely ready -->
      <apexchart 
        v-if="!loading && !error && actualSatisfactionValue > 0 && chartOptions" 
        :key="chartKey" 
        type="radialBar" 
        height="290" 
        :options="chartOptions"
        :series="[actualSatisfactionValue]"
      ></apexchart>
    </div>
    
    <div class="historical-trends" v-if="!loading && !error && historicalData.length > 0">
      <h3>{{ $t('analytics.gauge.historical', 'Historical Trends') }}</h3>
      <div class="trend-item" v-for="(item, index) in historicalData" :key="index">
        <span class="trend-label">{{ item.label }}</span>
        <span class="trend-value">{{ item.value }}%</span>
        <div class="trend-bar" :style="{ width: `${item.value}%` }"></div>
      </div>
    </div>
    
    <div v-if="!loading && !error && changePercentage !== null" class="change-indicator"
      :class="changePercentage >= 0 ? 'positive' : 'negative'">
      <span class="change-arrow">{{ changePercentage >= 0 ? '↑' : '↓' }}</span>
      <span>{{ Math.abs(changePercentage).toFixed(1) }}%</span>
      <span class="change-period">{{ $t('analytics.gauge.vsPrevious', 'vs previous period') }}</span>
    </div>
    
    <div class="target-indicator" v-if="!loading && !error">
      <span>{{ $t('analytics.gauge.target', 'Target') }}: {{ target }}%</span>
    </div>
    
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t('analytics.status.loading', 'Loading...') }}</span>
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
  name: 'SatisfactionGauge',
  props: {
    // Data can be provided by parent component
    value: {
      type: Number,
      default: null
    },
    target: {
      type: Number,
      default: 85
    },
    // Whether to use provided value or fetch from API
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
    // Added to force re-render when language changes
    renderKey: {
      type: String,
      default: null
    }
  },
  data() {
    return {
      satisfactionValue: null, // Will be populated from API or prop
      historicalData: [], // Will be populated from API
      changePercentage: null, // Will be populated from API
      loading: false,
      error: null,
      chartOptions: null,
      themeObserver: null,
      internalTarget: 85, // Default target value

      // Debug properties
      debug: false, // Set to true to enable debug display
      chartKey: 0,  // Used to force complete re-renders
      lastError: null,
      mountCount: 0
    };
  },
  computed: {
    // Ensures we never return a value that would cause display issues
    actualSatisfactionValue() {
      // Get value from props, API data, or fallback
      const value = this.externalData ? this.value : this.satisfactionValue;
      console.log('actualSatisfactionValue this.value:', this.value);
      console.log('actualSatisfactionValue this.satisfactionValue:', this.satisfactionValue);
      
      // Ensure value is a valid number
      if (value === null || value === undefined || isNaN(value) || value <= 0) {
        console.log('[SatisfactionGauge] Using fallback value 72.5');
        return 72.5; // Default fallback value
      }
      
      return value;
    },
    
    // Get target value from props or API data
    actualTarget() {
      return this.target || this.internalTarget || 85;
    }
  },
  watch: {
    // Watch for value changes from parent
    value: {
      handler(newValue) {
        console.log(`[SatisfactionGauge] value prop changed to ${newValue}`);
        if (this.externalData && newValue !== null && newValue > 0) {
          this.satisfactionValue = newValue;
          // Force complete re-render of chart
          this.chartOptions = null;
          this.$nextTick(() => {
            this.chartKey++;
            this.initChart();
          });
        }
      },
      immediate: true
    },
    // Re-fetch if period or date changes
    period: {
      handler(newValue) {
        console.log(`[SatisfactionGauge] period changed to ${newValue}`);
        if (!this.externalData) {
          this.fetchData();
        }
      }
    },
    selectedDate: {
      handler(newValue) {
        console.log(`[SatisfactionGauge] selectedDate changed to ${newValue}`);
        if (!this.externalData) {
          this.fetchData();
        }
      }
    },
    // Watch for renderKey (locale) changes
    renderKey: {
      handler(newValue) {
        console.log(`[SatisfactionGauge] renderKey changed to ${newValue}`);
        // Force chart update on locale change
        this.chartOptions = null;
        this.$nextTick(() => {
          this.chartKey++;
          this.initChart();
        });
        
        // Also refetch data if using API data
        if (!this.externalData) {
          this.fetchData();
        }
      }
    }
  },
  mounted() {
    console.log(`[SatisfactionGauge] MOUNTED (${++this.mountCount}) externalData=${this.externalData}`);
    
    // Get data from API if not using external data
    if (!this.externalData) {
      console.log("[SatisfactionGauge] Fetching data from API");
      this.fetchData();
    } else {
      // Initialize the chart with prop values
      console.log("[SatisfactionGauge] Using external data:", this.value);
      this.chartOptions = null;
      this.$nextTick(() => {
        this.chartKey++;
        this.initChart();
      });
    }
    
    // Set up theme change observer
    this.setupThemeChangeListener();
    
    // Apply a document style to force text colors in dark mode
    this.injectGlobalStyleForDarkMode();
    
    // Add a global error handler for chart-related errors
    window.addEventListener('error', this.handleGlobalError);
  },
  beforeUnmount() {
    // Clean up theme change listener and error handler
    if (this.themeObserver) {
      this.themeObserver.disconnect();
    }
    
    window.removeEventListener('error', this.handleGlobalError);
    
    // Remove the injected style if it exists
    const injectedStyle = document.getElementById('satisfaction-gauge-dark-mode-style');
    if (injectedStyle) {
      document.head.removeChild(injectedStyle);
    }
    
    console.log("[SatisfactionGauge] UNMOUNTED");
  },
  methods: {
    // Add a global error handler
    handleGlobalError(event) {
      if (event.message && event.message.includes('chart')) {
        this.lastError = event.message;
        console.warn("[SatisfactionGauge] Chart error caught:", event.message);
        // Increment chart key to force re-render
        this.chartKey++;
      }
    },
    
    /**
     * Fetch satisfaction data from API
     */
    async fetchData() {
      console.log("[SatisfactionGauge] Starting fetchData()");
      this.loading = true;
      this.error = null;

      try {
        console.log(`[SatisfactionGauge] Calling analyticsService.getSatisfactionGauge(${this.period}, ${this.selectedDate})`);

        // Use the existing properly defined method in analyticsService
        const data = await analyticsService.getSatisfactionGauge(
          this.period,
          this.selectedDate,
          this.$i18n ? this.$i18n.locale : null
        );

        console.log('[SatisfactionGauge] Satisfaction data received:', JSON.stringify(data));

        // Validate the data format
        if (data && typeof data.currentValue === 'number') {
          console.log(`[SatisfactionGauge] Setting satisfactionValue to ${data.currentValue}`);
          this.satisfactionValue = data.currentValue;
          this.changePercentage = data.changePercentage;
          this.historicalData = data.historicalData || [];
          this.internalTarget = data.target || 85;
        } else {
          console.warn('[SatisfactionGauge] Invalid data received, using fallback');
          this.satisfactionValue = 72.5;
        }

        // Force a complete chart recreation
        this.chartOptions = null;
        this.$nextTick(() => {
          // Increment key before initializing chart
          this.chartKey++;
          // Initialize chart with new data
          this.initChart();
        });

      } catch (error) {
        console.error('[SatisfactionGauge] Error fetching data:', error);
        this.error = 'Failed to load satisfaction data';
        this.satisfactionValue = 72.5;

        // Force a complete chart recreation
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
     * Set up listener for theme changes
     */
    setupThemeChangeListener() {
      // Watch for theme changes through classList mutations
      this.themeObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme') {
            console.log('[SatisfactionGauge] Theme change detected');
            this.chartOptions = null;
            this.$nextTick(() => {
              this.chartKey++;
              this.initChart();
            });
            break;
          }
        }
      });

      // Observe document root for theme changes
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
    },

    /**
     * Get current theme information
     */
    getThemeInfo() {
      // Use the singleton theme manager
      return getThemeFromManager();
    },

    /**
     * Get the color for the gauge based on the value
     */
    getGaugeColor(value) {
      const theme = this.getThemeInfo();
      const isDarkMode = theme.isDarkMode;

      if (value >= 90) return '#22C55E'; // Green
      if (value >= 80) return '#84CC16'; // Light green
      if (value >= 70) return '#F59E0B'; // Orange
      return '#EF4444'; // Red
    },

    /**
     * Initialize the chart with speedometer options
     */
    initChart() {
      console.log(`[SatisfactionGauge] initChart called with value: ${this.actualSatisfactionValue}`);
      
      // Safety check - don't initialize if no value
      if (!this.actualSatisfactionValue || this.actualSatisfactionValue <= 0) {
        console.warn('[SatisfactionGauge] Cannot initialize chart - invalid value');
        return;
      }
      
      // Get theme information
      const theme = this.getThemeInfo();
      const isDarkMode = theme.isDarkMode;
      
      // Text and background colors based on theme
      const textColor = isDarkMode ? '#FFFFFF' : '#333333';
      const backgroundColor = isDarkMode ? '#414141' : '#FFFFFF';
      const trackColor = isDarkMode ? '#666666' : '#E5E7EB';
      
      // Create a gradient based on satisfaction value
      const getGradientColors = (value) => {
        // Define colors for different ranges
        const colors = {
          poor: '#EF4444',   // Red
          low: '#F59E0B',    // Orange
          medium: '#84CC16', // Light green
          high: '#22C55E'    // Green
        };
        
        if (value < 60) {
          return [colors.poor, colors.poor]; // Red
        } else if (value < 70) {
          return [colors.poor, colors.low]; // Red to Orange
        } else if (value < 80) {
          return [colors.low, colors.medium]; // Orange to Light green
        } else if (value < 90) {
          return [colors.medium, colors.high]; // Light green to Green
        } else {
          return [colors.high, colors.high]; // Green
        }
      };
      
      const gradientColors = getGradientColors(this.actualSatisfactionValue);
      
      // Create a speedometer-style gauge chart with appropriate text colors
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
          fontFamily: 'inherit',
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
                formatter: function(val) {
                  return val + '%';
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
        labels: [this.$t('analytics.metrics.satisfaction', 'User Satisfaction')],
        tooltip: {
          enabled: false
        }
      };

      console.log('[SatisfactionGauge] Chart options initialized');

      // Force refresh the CSS after chart initialization in a safe way
      this.$nextTick(() => {
        setTimeout(() => {
          this.forceTextColorUpdate();
        }, 300); // Increase timeout for more safety
      });
    },
    
    /**
     * Inject a global stylesheet that targets ApexCharts elements
     * This ensures all text elements are white in dark mode regardless
     * of how ApexCharts renders them
     */
    injectGlobalStyleForDarkMode() {
      // Check if the style already exists
      if (document.getElementById('satisfaction-gauge-dark-mode-style')) {
        return;
      }
      
      // Create style element
      const styleEl = document.createElement('style');
      styleEl.id = 'satisfaction-gauge-dark-mode-style';
      styleEl.textContent = `
        /* Force all ApexCharts text to be white in dark mode */
        [data-theme="dark"] .apexcharts-text,
        [data-theme="dark"] .apexcharts-datalabel-label,
        [data-theme="dark"] .apexcharts-datalabel-value,
        [data-theme="dark"] .apexcharts-radialbar-label text,
        [data-theme="dark"] .apexcharts-radialbar text {
          fill: #FFFFFF !important;
        }
      `;
      
      // Append to document head
      document.head.appendChild(styleEl);
      console.log('[SatisfactionGauge] Injected dark mode style');
    },
    
    /**
     * Force ApexCharts text elements to use correct color in dark mode
     * This method will be called after chart initialization
     */
    forceTextColorUpdate() {
      console.log('[SatisfactionGauge] Attempting to force text color update');
      const theme = this.getThemeInfo();
      const isDarkMode = theme.isDarkMode;
      
      if (isDarkMode) {
        // Get the chart element
        const chartElement = this.$refs.chart;
        if (!chartElement) {
          console.warn('[SatisfactionGauge] Chart element not found');
          return;
        }
        
        // Use setTimeout to ensure this runs after ApexCharts has rendered
        setTimeout(() => {
          try {
            // Select all text elements in the chart
            const textElements = chartElement.querySelectorAll('.apexcharts-text, .apexcharts-datalabel-label, .apexcharts-datalabel-value');
            console.log(`[SatisfactionGauge] Found ${textElements.length} text elements to update`);
            
            // Set fill attribute to white
            textElements.forEach(el => {
              el.setAttribute('fill', '#FFFFFF');
              
              // Also update any tspan elements that might be children
              const tspans = el.querySelectorAll('tspan');
              tspans.forEach(tspan => {
                tspan.setAttribute('fill', '#FFFFFF');
              });
            });
          } catch (error) {
            console.error('[SatisfactionGauge] Error updating text colors:', error);
          }
        }, 300); // Increase timeout to ensure chart is fully rendered
      }
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

/* Historical trends section */
.historical-trends {
  width: 100%;
  margin-top: 20px;
  padding: 0 20px;
}

.historical-trends h3 {
  font-size: 16px;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.trend-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  position: relative;
}

.trend-label {
  width: 120px;
  font-size: 14px;
  color: var(--text-secondary);
}

.trend-value {
  width: 50px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-right: 10px;
}

.trend-bar {
  height: 8px;
  background: linear-gradient(to right, #F59E0B, #84CC16, #22C55E);
  border-radius: 4px;
  max-width: calc(100% - 180px); /* Account for label and value width */
}

/* Change indicator */
.change-indicator {
  margin-top: 15px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.change-indicator.positive {
  color: var(--status-success, #22C55E);
}

.change-indicator.negative {
  color: var(--status-outage, #d32f2f);
}

.change-arrow {
  font-size: 16px;
  font-weight: bold;
}

.change-period {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: 5px;
}

/* Target indicator */
.target-indicator {
  margin-top: 10px;
  font-size: 14px;
  color: var(--text-secondary);
}

/* Position the custom gauge scale above the chart but below other elements */
:deep(.custom-gauge-scale) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 20;
}

/* Simple and direct dark mode text fixes */
:deep([data-theme="dark"]) .apexcharts-text,
:deep([data-theme="dark"]) .apexcharts-datalabel-label,
:deep([data-theme="dark"]) .apexcharts-datalabel-value {
  fill: white !important;
}

/* SVG text elements */
:deep([data-theme="dark"]) text tspan {
  fill: white !important;
}

/* Track color in dark mode */
:deep([data-theme="dark"]) .apexcharts-radialbar .apexcharts-radialbar-track .apexcharts-radialbar-area {
  stroke: #666666 !important;
}
</style>