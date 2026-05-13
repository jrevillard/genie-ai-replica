<!-- CategoryDistributionChart.vue -->
<template>
  <div class="chart-wrapper">
    <DsSpinner v-if="loading" overlay>
      <span>{{ $t('analytics.status.loading') }}</span>
    </DsSpinner>
    <DsStateDisplay v-if="error" type="error" :message="error" />
    <div ref="chart" class="chart-container">
      <apexchart
        v-if="!loading && !error && chartOptions"
        type="donut"
        height="100%"
        :options="chartOptions"
        :series="chartSeries"
      />
    </div>
  </div>
</template>

<script>
import analyticsService from '../../services/analyticsService';
import { serviceTreeService } from '../../services';
import { useChartTheme } from '../../composables/useChartTheme';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';

export default {
  name: 'CategoryDistributionChart',
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
    // Whether to use provided data or fetch from API
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
    // Added to force re-render when language changes
    renderKey: {
      type: String,
      default: null
    }
  },
  setup() {
    const { theme, getCssVarStrings } = useChartTheme({
      listenToSystem: true
    });
    return { theme, getCssVarStrings };
  },
  data() {
    return {
      chartData: [],
      categories: {},
      loading: false,
      error: null,
      chartOptions: null,
      chartSeries: [],
      isMobile: false,
      processedData: []
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
        // Reload category names with new locale
        this.loadCategoryNames().then(() => {
          if (this.chartData && this.chartData.length > 0) {
            // Update chart with new locale
            this.updateChart();
          }
        });
      }
    },
    // Watch for theme changes (driven by useChartTheme composable)
    theme() {
      if (this.chartData && this.chartData.length > 0) {
        this.updateChart();
      }
    }
  },
  mounted() {
    // Check if mobile on mount
    this.checkMobile();

    // Load category names first
    this.loadCategoryNames().then(() => {
      // Use data from props or fetch from API
      if (this.externalData && this.data.length > 0) {
        this.chartData = this.data;
        this.updateChart();
      } else if (!this.externalData) {
        this.fetchData();
      }
    });

    // Add resize listener
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);

    // Remove custom tooltip element
    const tooltip = document.getElementById('chart-custom-tooltip');
    if (tooltip) {
      tooltip.remove();
    }
  },
  methods: {
    /**
     * Check if the device is mobile based on screen width
     */
    checkMobile() {
      this.isMobile = window.innerWidth < 768;
    },

    /**
     * Fetch category distribution data from API
     */
    async fetchData() {
      if (this.externalData) return;

      this.loading = true;
      this.error = null;

      try {
        // Calculate date range based on period
        analyticsService.calculateDateRange(this.period, this.selectedDate);

        // Make sure analyticsService has the locale information
        if (!analyticsService.$i18n) {
          analyticsService.$i18n = this.$i18n;
        }

        // Fetch dashboard analytics with explicit locale
        const dashboardData = await analyticsService.getDashboardAnalytics(this.period, this.selectedDate);

        if (dashboardData && dashboardData.queryDistribution) {
          this.chartData = dashboardData.queryDistribution;
          this.updateChart();

          // Debug: Check language of received category names
        } else {
          this.error = this.$t('analytics.status.noData');
        }
      } catch {
        this.chartData = [];
        this.updateChart();
      } finally {
        this.loading = false;
      }
    },

    /**
     * Load category names from the service
     */
    async loadCategoryNames() {
      try {
        const categories = await serviceTreeService.getAllCategories();

        // Create a lookup object for category names by ID
        categories.forEach((category) => {
          // Extract the numeric ID from serviceCategories/123 (full path)
          // or just use the raw _key (which is typically just the number)
          const id =
            category._key || (category._id && category._id.split('/')[1]) || category.catKey || category.categoryId;

          if (id) {
            // Use the appropriate translation based on current locale
            const currentLocale = this.$i18n.locale;

            // Use nameXX based on locale or fall back to nameEN
            let name;
            if (currentLocale === 'fr' && category.nameFR) {
              name = category.nameFR;
            } else if (currentLocale === 'sw' && category.nameSW) {
              name = category.nameSW;
            } else {
              name = category.nameEN || category.name || null;
            }

            // Store the name with various ID formats for flexible lookup
            if (name) {
              // Store with numeric ID (most important - this is the _key in ArangoDB)
              this.categories[id] = name;

              // Store with full path from _id (serviceCategories/X)
              if (category._id) {
                this.categories[category._id] = name;
              } else if (id.match(/^\d+$/)) {
                this.categories[`serviceCategories/${id}`] = name;
              }

              // Store with s/X short format
              if (id.match(/^\d+$/)) {
                this.categories[`s/${id}`] = name;
              }

              // Store with serviceCategorie format
              if (id.match(/^\d+$/)) {
                this.categories[`serviceCategorie${id}`] = name;
              }

              // Store with cat format
              if (id.match(/^\d+$/)) {
                this.categories[`cat${id}`] = name;
              }
            }
          }
        });
      } catch {
        // Populate with fallback data in case of error
        this.populateFallbackCategories();
      }
    },

    /**
     * Populate with fallback category names when service fails
     */
    populateFallbackCategories() {
      // Based on the schema/sample data, provide fallback names
      const fallbackCategories = {
        1: {
          nameEN: 'Identity & Civil Registration',
          nameFR: 'Identité et état civil',
          nameSW: 'Utambulisho na Usajili wa Kiraia'
        },
        2: { nameEN: 'Transportation', nameFR: 'Transport', nameSW: 'Usafiri' },
        3: {
          nameEN: 'Taxes & Revenue',
          nameFR: 'Impôts et Revenus',
          nameSW: 'Kodi na Mapato'
        },
        4: {
          nameEN: 'Immigration & Citizenship',
          nameFR: 'Immigration et Citoyenneté',
          nameSW: 'Uhamiaji na Uraia'
        },
        5: {
          nameEN: 'Education & Learning',
          nameFR: 'Éducation et Apprentissage',
          nameSW: 'Elimu na Mafunzo'
        },
        6: {
          nameEN: 'Housing & Properties',
          nameFR: 'Logement et Propriétés',
          nameSW: 'Nyumba na Mali'
        },
        7: {
          nameEN: 'Health & Healthcare',
          nameFR: 'Santé et Soins Médicaux',
          nameSW: 'Afya na Huduma za Afya'
        },
        8: {
          nameEN: 'Public Safety',
          nameFR: 'Sécurité Publique',
          nameSW: 'Usalama wa Umma'
        },
        9: {
          nameEN: 'Business & Economy',
          nameFR: 'Entreprise et Économie',
          nameSW: 'Biashara na Uchumi'
        },
        10: {
          nameEN: 'Social Services',
          nameFR: 'Services Sociaux',
          nameSW: 'Huduma za Kijamii'
        },
        11: {
          nameEN: 'Environment',
          nameFR: 'Environnement',
          nameSW: 'Mazingira'
        },
        12: {
          nameEN: 'Culture & Recreation',
          nameFR: 'Culture et Loisirs',
          nameSW: 'Utamaduni na Burudani'
        },
        13: {
          nameEN: 'Legal Services',
          nameFR: 'Services Juridiques',
          nameSW: 'Huduma za Kisheria'
        }
      };

      // Determine the current locale
      const currentLocale = this.$i18n.locale;

      // Add entries for each format with the appropriate language
      Object.entries(fallbackCategories).forEach(([id, names]) => {
        // Choose the right language name
        let name = names.nameEN;
        if (currentLocale === 'fr' && names.nameFR) {
          name = names.nameFR;
        } else if (currentLocale === 'sw' && names.nameSW) {
          name = names.nameSW;
        }

        // Add entries with all possible ID formats for maximum compatibility
        this.categories[id] = name;
        this.categories[`serviceCategories/${id}`] = name;
        this.categories[`s/${id}`] = name;
        this.categories[`serviceCategorie${id}`] = name;
        this.categories[`cat${id}`] = name;
      });
    },

    /**
     * Format category ID for display when no name is found
     */
    formatCategoryId(categoryId) {
      if (!categoryId) return this.$t('charts.notAvailable');

      // Extract the numeric ID from different formats
      let numericId = null;

      // Try serviceCategories/X format (from database _id)
      const serviceCategoriesMatch = categoryId.match(/serviceCategories\/(\d+)/i);
      if (serviceCategoriesMatch) {
        numericId = serviceCategoriesMatch[1];
      }

      // Try s/X format
      if (!numericId) {
        const sMatch = categoryId.match(/s\/(\d+)/i);
        if (sMatch) {
          numericId = sMatch[1];
        }
      }

      // Try serviceCategorie format
      if (!numericId) {
        const serviceCatMatch = categoryId.match(/serviceCategorie(\d+)/i);
        if (serviceCatMatch) {
          numericId = serviceCatMatch[1];
        }
      }

      // Try cat format
      if (!numericId) {
        const catMatch = categoryId.match(/cat(\d+)/i);
        if (catMatch) {
          numericId = catMatch[1];
        }
      }

      // Try to parse the ID itself if it's a number
      if (!numericId && /^\d+$/.test(categoryId)) {
        numericId = categoryId;
      }

      // If we found a numeric ID, check our fallback data
      if (numericId && this.categories[numericId]) {
        return this.categories[numericId];
      }

      // Default fallback - just format the ID nicely
      // Extract the relevant part of the ID for display
      const idDisplay = categoryId.includes('/')
        ? categoryId.split('/').pop()
        : categoryId.replace(/^(serviceCategorie|cat)/i, '');

      return `${this.$t('analytics.chartLabels.category')} ${idDisplay}`;
    },

    /**
     * Remove number prefix from category name
     */
    removeNumberPrefix(text) {
      if (!text) return '';
      return text.replace(/^\d+\.\s*/, '');
    },

    /**
     * Handle window resize
     */
    handleResize() {
      this.checkMobile();
      this.updateChart();
    },

    /**
     * Get ApexCharts tooltip formatter with transparent black background
     */
    tooltipFormatter(value, opts) {
      const item = this.processedData[opts.dataPointIndex];
      if (!item) return '';

      // Use theme-aware colors for tooltip
      const bgColor = 'var(--fg)';
      const textColor = 'var(--bg)';

      return `
        <div class="apexcharts-tooltip-box" style="background: ${bgColor}; border-radius: var(--radius-sm); padding: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
          <div class="apexcharts-tooltip-title" style="color: ${textColor}; font-weight: bold; margin-bottom: 5px;">${
            item.categoryName
          }</div>
          <div class="apexcharts-tooltip-series-group" style="color: ${textColor}; padding: 0;">
            <div style="color: ${textColor}; padding: 2px 0;">${this.$t(
              'analytics.table.count'
            )}: ${item.count ? item.count.toLocaleString() : 'N/A'}</div>
            <div style="color: ${textColor}; padding: 2px 0;">${this.$t(
              'analytics.percentage',
              'Percentage'
            )}: ${Math.round(item.percentage)}%</div>
          </div>
        </div>
      `;
    },

    /**
     * Get localized category name based on ID
     */
    getCategoryDisplayName(categoryId) {
      // First check if the exact ID exists in our categories lookup
      if (this.categories[categoryId]) {
        return this.categories[categoryId];
      }

      // Handle "serviceCategories/X" format (format from the database _id field)
      const serviceCategoriesMatch = categoryId.match(/serviceCategories\/(\d+)/i);
      if (serviceCategoriesMatch && this.categories[serviceCategoriesMatch[1]]) {
        return this.categories[serviceCategoriesMatch[1]];
      }

      // Handle "s/X" format (shorthand format used in some places)
      const sMatch = categoryId.match(/s\/(\d+)/i);
      if (sMatch && this.categories[sMatch[1]]) {
        return this.categories[sMatch[1]];
      }

      // Then try extracting numeric part if it's a serviceCategorie format
      const serviceMatch = categoryId.match(/serviceCategorie(\d+)/i);
      if (serviceMatch && this.categories[serviceMatch[1]]) {
        return this.categories[serviceMatch[1]];
      }

      // Then try extracting numeric part if it's a cat format
      const catMatch = categoryId.match(/cat(\d+)/i);
      if (catMatch && this.categories[catMatch[1]]) {
        return this.categories[catMatch[1]];
      }

      // Fallback to formatting the ID
      return this.formatCategoryId(categoryId);
    },

    /**
     * Process chart data to ensure all necessary properties
     */
    processChartData() {
      if (!this.chartData || this.chartData.length === 0) return [];

      // Calculate total for percentages
      const total = this.chartData.reduce((sum, item) => {
        const value = Number(item.value) || Number(item.count) || 1;
        return sum + value;
      }, 0);

      // Process and prepare data with proper names
      return this.chartData
        .map((item) => {
          // Ensure the value property exists and is a valid number
          const value = Number(item.value) || Number(item.count) || 1;
          const percentage = (value / total) * 100;

          // CRITICAL: Prioritize the name directly from the API response
          const displayName =
            item.name && item.name !== item.categoryId && !item.name.startsWith('Category ')
              ? item.name
              : this.getCategoryDisplayName(item.categoryId);

          return {
            categoryId: item.categoryId,
            categoryName: displayName,
            count: Number(item.count) || 0,
            value: value,
            percentage: percentage
          };
        })
        .sort((a, b) => b.value - a.value); // Sort by value descending for better visualization
    },

    /**
     * Update the chart and implement manual tooltips
     */
    updateChart() {
      // Process the data for the chart
      this.processedData = this.processChartData();

      if (!this.processedData || this.processedData.length === 0) {
        this.error = this.$t('analytics.status.noData');
        return;
      }

      const container = this.$refs.chart;
      if (container && Math.max(0, container.offsetWidth) < 100) {
        return; // Prevents ApexCharts from rendering when container is collapsed
      }

      // Get theme information
      const theme = this.getCssVarStrings();

      // Create explicit center label style based on theme
      const centerLabelStyle = {
        color: theme.textColor,
        fontSize: '14px',
        fontWeight: 'bold'
      };

      // Prepare series data for ApexCharts
      this.chartSeries = this.processedData.map((item) => item.value);

      // Set up chart labels with proper category names
      const labels = this.processedData.map((item) => {
        // Truncate long names
        const nameMaxLength = this.isMobile ? 18 : 25;
        return this.truncateText(item.categoryName, nameMaxLength);
      });

      // Get colors for chart
      const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'];

      // Set up chart options - DISABLE BUILT-IN TOOLTIPS COMPLETELY
      this.chartOptions = {
        chart: {
          type: 'donut',
          fontFamily: 'inherit',
          toolbar: {
            show: false
          },
          animations: {
            enabled: true,
            speed: 300
          },
          background: theme.backgroundColor,
          foreColor: theme.textColor
        },
        stroke: {
          width: 0 // Remove stroke around slices
        },
        colors: colors,
        labels: labels,
        dataLabels: {
          enabled: true,
          formatter: (val) => {
            return Math.round(val) + '%';
          },
          style: {
            fontSize: '12px',
            fontWeight: 'bold',
            colors: [theme.textColor]
          },
          dropShadow: {
            enabled: false
          }
        },
        legend: {
          position: this.isMobile ? 'bottom' : 'right',
          offsetY: this.isMobile ? 10 : 0,
          formatter: (seriesName, opts) => {
            const item = this.processedData[opts.seriesIndex];
            if (!item) return seriesName;
            return `${seriesName} (${Math.round(item.percentage)}%)`;
          },
          labels: {
            colors: theme.textColor
          }
        },
        tooltip: {
          enabled: false // DISABLE BUILT-IN TOOLTIPS
        },
        plotOptions: {
          pie: {
            expandOnClick: false, // Don't expand on click
            donut: {
              size: '60%',
              background: 'transparent',
              labels: {
                show: true,
                name: {
                  show: true,
                  formatter: function () {
                    return 'Knowledge Areas';
                  },
                  style: centerLabelStyle
                },
                value: {
                  show: true,
                  formatter: function (val) {
                    return val; // Show the value
                  },
                  style: centerLabelStyle
                },
                total: {
                  show: true,
                  label: 'by Usage', // Second line
                  formatter: function () {
                    return ''; // Use empty formatter to show just the label
                  },
                  style: centerLabelStyle
                }
              }
            },
            dataLabels: {
              style: {
                colors: [theme.textColor]
              },
              background: {
                enabled: false
              }
            }
          }
        },
        states: {
          hover: {
            filter: {
              type: 'none' // No filter on hover
            }
          },
          active: {
            allowMultipleDataPointsSelection: false,
            filter: {
              type: 'none' // No filter on active state
            }
          }
        },
        responsive: [
          {
            breakpoint: 768,
            options: {
              chart: {
                height: 380
              },
              legend: {
                position: 'bottom',
                offsetY: 0,
                height: 100
              }
            }
          }
        ],
        theme: {
          mode: theme.isDarkMode ? 'dark' : 'light',
          palette: 'palette1'
        }
      };

      // Create or get a custom tooltip element
      this.ensureCustomTooltipExists();

      // Apply fixes after chart renders
      this.$nextTick(() => {
        setTimeout(() => {
          // Fix center text color
          const centerColor = theme.textColor;
          const centerLabels = document.querySelectorAll('.apexcharts-datalabels-group text');
          centerLabels.forEach((label) => {
            label.setAttribute('fill', centerColor);
          });

          // Add custom tooltip handlers to chart slices
          this.addTooltipHandlers();
        }, 500); // Longer delay to ensure chart is fully rendered
      });
    },

    /**
     * Create a custom tooltip element if it doesn't exist
     */
    ensureCustomTooltipExists() {
      // Remove any existing tooltip
      const existingTooltip = document.getElementById('chart-custom-tooltip');
      if (existingTooltip) {
        existingTooltip.remove();
      }

      // Create a new tooltip element
      const tooltip = document.createElement('div');
      tooltip.id = 'chart-custom-tooltip';
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
     * Truncate text to fit in available space
     */
    truncateText(text, maxLength) {
      if (!text) return '';

      // On mobile, truncate more aggressively
      const limit = this.isMobile ? Math.min(maxLength, 18) : maxLength;
      return text.length > limit ? text.slice(0, limit) + '...' : text;
    },

    /**
     * Add tooltip event handlers to chart slices
     */
    addTooltipHandlers() {
      // Get the tooltip element
      const tooltip = document.getElementById('chart-custom-tooltip');
      if (!tooltip) return;

      // Get all slice elements
      const chartContainer = this.$refs.chart;
      if (!chartContainer) return;

      // All possible selectors for chart slices
      const sliceSelectors = [
        '.apexcharts-pie-area',
        '.apexcharts-slice-0',
        '.apexcharts-slice',
        '.apexcharts-pie .apexcharts-series path',
        '.apexcharts-donut-slice-0',
        '.apexcharts-series path'
      ];

      // Try different selectors until we find slices
      let slices = [];
      for (const selector of sliceSelectors) {
        slices = chartContainer.querySelectorAll(selector);
        if (slices.length > 0) {
          break;
        }
      }

      // If we still can't find slices, try the document
      if (slices.length === 0) {
        for (const selector of sliceSelectors) {
          slices = document.querySelectorAll(selector);
          if (slices.length > 0) {
            break;
          }
        }
      }

      // Apply hover handlers to each slice
      if (slices.length > 0) {
        slices.forEach((slice, index) => {
          // Make sure index is in range
          if (index >= this.processedData.length) return;

          // Set cursor style
          slice.style.cursor = 'pointer';

          // Mouse enter handler - show tooltip
          slice.addEventListener('mouseenter', () => {
            const item = this.processedData[index];
            if (!item) return;

            // Update tooltip content
            tooltip.innerHTML = `
              <div style="font-weight: bold; margin-bottom: 6px;">${item.categoryName}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Total Queries:</span>
                <span style="font-weight: 500;">${item.count.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Percentage:</span>
                <span style="font-weight: 500;">${Math.round(item.percentage)}%</span>
              </div>
            `;

            // Show tooltip
            tooltip.style.display = 'block';

            // Apply active styles to slice (optional)
            slice.setAttribute('data-active', 'true');
          });

          // Mouse move handler - position tooltip
          slice.addEventListener('mousemove', (e) => {
            // Position tooltip near cursor but not directly under it
            const offset = 15;
            tooltip.style.left = e.pageX + offset + 'px';
            tooltip.style.top = e.pageY + offset + 'px';
          });

          // Mouse leave handler - hide tooltip
          slice.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            slice.removeAttribute('data-active');
          });
        });
      } else {
        // Last resort: try again after a longer delay
        setTimeout(() => {
          this.addTooltipHandlers();
        }, 1000);
      }
    }
  }
};
</script>

<style scoped>
.chart-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background-color: transparent;
}

.chart-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background-color: transparent;
  border-radius: var(--radius-sm);
}

/* Mobile-specific styles */
@media (max-width: 768px) {
  .chart-wrapper {
    min-height: 450px;
  }
}
</style>
