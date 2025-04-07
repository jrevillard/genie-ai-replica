<!-- SatisfactionHeatmap.vue - Fixed version with forced white text in dark mode -->
<template>
    <div class="heatmap-wrapper">
      <div ref="chart" class="chart-container">
        <apexchart v-if="!loading && !error && chartOptions" type="heatmap" height="290" :options="chartOptions"
          :series="chartSeries"></apexchart>
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
    },
    methods: {
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
          const locale = this.$i18n.locale;
  
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
          this.error = this.$t('analytics.errors.loading', 'Failed to load satisfaction data. Please try again.');
          
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
          this.$t('analytics.areas.immigration', 'Immigration & Citizenship'),
          this.$t('analytics.areas.business', 'Business & Trade'),
          this.$t('analytics.areas.identity', 'Identity & Civil Registration'),
          this.$t('analytics.areas.social', 'Social Security & Pensions'),
          this.$t('analytics.areas.education', 'Education & Learning'),
          this.$t('analytics.areas.employment', 'Employment & Labor Services'),
          this.$t('analytics.areas.health', 'Health & Social Services')
        ];
  
        // Time periods
        const timePeriods = [
          this.$t('analytics.timePeriods.week4', '4 Weeks Ago'),
          this.$t('analytics.timePeriods.week3', '3 Weeks Ago'),
          this.$t('analytics.timePeriods.week2', '2 Weeks Ago'),
          this.$t('analytics.timePeriods.week1', 'Last Week'),
          this.$t('analytics.timePeriods.current', 'Current')
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
            
            // Specifically target legend text
            const legendItems = chartContainer.querySelectorAll('.apexcharts-legend-text');
            legendItems.forEach(item => {
              item.style.color = '#FFFFFF';
            });
            
            // Target title and subtitle
            const title = chartContainer.querySelector('.apexcharts-title-text');
            if (title) title.setAttribute('fill', '#FFFFFF');
            
            const subtitle = chartContainer.querySelector('.apexcharts-subtitle-text');
            if (subtitle) subtitle.setAttribute('fill', '#FFFFFF');
            
            console.log('Enforced white text for dark mode');
          }, 200);
        }
      },
  
      /**
       * Update the chart with current data and theme
       */
      updateChart() {
        if (!this.chartData || this.chartData.length === 0) {
          this.error = this.$t('analytics.status.noData', 'No data available');
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
  
        // Set up chart options with forced white text for dark mode
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
              colors: theme.isDarkMode ? ['#FFFFFF'] : ['#FFFFFF'],  // Always white for better visibility on colored cells
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
            text: this.$t('analytics.charts.satisfactionHeatmap', 'Satisfaction by Knowledge Area'),
            align: 'center',
            style: {
              fontSize: '16px',
              fontWeight: 'bold',
              color: textColor
            }
          },
          subtitle: {
            text: this.$t('analytics.charts.satisfactionSubtitle', 'Percentage scores over time'),
            align: 'center',
            style: {
              fontSize: '12px',
              color: textColor
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
            theme: theme.isDarkMode ? 'dark' : 'light',
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
              }
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
  
  /* Dark mode overrides - for theme consistency */
  [data-theme="dark"] .heatmap-wrapper,
  .dark-theme .heatmap-wrapper,
  .dark-mode .heatmap-wrapper {
    background-color: #414141 !important;
  }
  
  /* Force ALL TEXT elements to be white in dark mode */
  :deep([data-theme="dark"]) .apexcharts-text,
  :deep(.dark-theme) .apexcharts-text,
  :deep(.dark-mode) .apexcharts-text {
    fill: white !important;
  }
  
  /* Title color fix */
  :deep([data-theme="dark"]) .apexcharts-title-text,
  :deep(.dark-theme) .apexcharts-title-text,
  :deep(.dark-mode) .apexcharts-title-text {
    fill: white !important;
  }
  
  /* Subtitle color fix */
  :deep([data-theme="dark"]) .apexcharts-subtitle-text,
  :deep(.dark-theme) .apexcharts-subtitle-text,
  :deep(.dark-mode) .apexcharts-subtitle-text {
    fill: white !important;
  }
  
  /* Legend text fix */
  :deep([data-theme="dark"]) .apexcharts-legend-text,
  :deep(.dark-theme) .apexcharts-legend-text,
  :deep(.dark-mode) .apexcharts-legend-text {
    color: white !important;
  }
  
  /* Ensure axis labels are visible in dark mode */
  :deep([data-theme="dark"]) .apexcharts-yaxis-label text,
  :deep([data-theme="dark"]) .apexcharts-xaxis-label text,
  :deep(.dark-theme) .apexcharts-yaxis-label text,
  :deep(.dark-theme) .apexcharts-xaxis-label text,
  :deep(.dark-mode) .apexcharts-yaxis-label text,
  :deep(.dark-mode) .apexcharts-xaxis-label text {
    fill: white !important;
  }
  
  /* Comprehensive fix for all text elements in dark mode */
  :deep([data-theme="dark"]) text,
  :deep(.dark-theme) text,
  :deep(.dark-mode) text {
    fill: white !important;
  }
  </style>