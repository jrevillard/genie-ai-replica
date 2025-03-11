// src/components/charts/CategoryDistributionChart.vue - Improved spacing version
<template>
  <div class="chart-wrapper">
    <div ref="chart" class="chart-container"></div>
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t('analytics.loadingChart', 'Loading chart data...') }}</span>
    </div>
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script>
import * as d3 from 'd3';
import analyticsService from '../../services/analyticsService';
import { serviceTreeService } from '../../services';

export default {
  name: 'CategoryDistributionChart',
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
    }
  },
  data() {
    return {
      chartData: [],
      categories: {},
      loading: false,
      error: null,
      chart: null,
      width: 0,
      height: 0
    };
  },
  watch: {
    // Watch for data changes from parent
    data: {
      handler(newData) {
        if (this.externalData && newData && newData.length > 0) {
          this.chartData = newData;
          this.renderChart();
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
    }
  },
  async mounted() {
    // Load category names first
    await this.loadCategoryNames();
    
    // Set up chart dimensions
    this.initChartDimensions();
    
    // Use data from props or fetch from API
    if (this.externalData && this.data.length > 0) {
      this.chartData = this.data;
      this.renderChart();
    } else if (!this.externalData) {
      this.fetchData();
    }
    
    // Add resize listener
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    // Clean up any D3 tooltips
    d3.selectAll('.d3-tooltip').remove();
  },
  methods: {
    /**
     * Fetch category distribution data from API
     */
    async fetchData() {
      if (this.externalData) return;
      
      this.loading = true;
      this.error = null;
      
      try {
        // Calculate date range based on period
        const { startDate, endDate } = analyticsService.calculateDateRange(
          this.period, 
          this.selectedDate
        );
        
        // Fetch dashboard analytics which includes category distribution
        const dashboardData = await analyticsService.getDashboardAnalytics(this.period, this.selectedDate);
        
        if (dashboardData && dashboardData.queryDistribution) {
          this.chartData = dashboardData.queryDistribution;
          this.renderChart();
        } else {
          this.error = this.$t('analytics.errors.noData', 'No data available for this period');
        }
      } catch (error) {
        console.error('Error fetching category distribution data:', error);
        console.log('Falling back to sample category data...');
        // Fall back to hard-coded data
        this.chartData = this.getFallbackData();
        this.renderChart();
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
        
        // Create a lookup object for category names
        categories.forEach(category => {
          this.categories[category.catKey] = this.getCategoryName(category.catKey);
        });
      } catch (error) {
        console.error('Error loading category names:', error);
        // Use fallback approach - will use formatCategoryId instead
      }
    },
    
    /**
     * Get category name, with fallback if not found
     */
    getCategoryName(categoryId) {
      // Try to look up the name from translations
      const translationKey = `leftPanel.${categoryId}.name`;
      const translated = this.$t(translationKey);
      
      // Check if we got a valid translation
      if (translated && typeof translated === 'string' && translated !== translationKey) {
        return this.removeNumberPrefix(translated);
      }
      
      // Fallback to category ID
      return this.formatCategoryId(categoryId);
    },
    
    /**
     * Remove number prefix from category name
     */
    removeNumberPrefix(text) {
      if (!text) return '';
      return text.replace(/^\d+\.\s*/, '');
    },
    
    /**
     * Format category ID for display
     */
    formatCategoryId(categoryId) {
      if (!categoryId) return 'Unknown';
      
      // Convert format like "cat1" to "Category 1"
      const match = categoryId.match(/cat(\d+)/i);
      if (match) {
        return `Category ${match[1]}`;
      }
      
      // If not in expected format, just return the ID
      return categoryId;
    },
    
    /**
     * Initialize chart dimensions
     */
    initChartDimensions() {
      if (!this.$refs.chart) return;
      
      const container = this.$refs.chart;
      
      // Get container dimensions
      this.width = container.clientWidth;
      this.height = Math.min(400, this.width * 0.7); // Maintain aspect ratio
    },
    
    /**
     * Handle window resize
     */
    handleResize() {
      this.initChartDimensions();
      this.renderChart();
    },
    
    /**
     * Get fallback data in case API fails
     * @returns {Array} Sample category distribution data
     */
    getFallbackData() {
      return [
        { categoryId: 'cat1', name: 'Identity & Civil Registry', count: 2347, value: 23 },
        { categoryId: 'cat2', name: 'Healthcare & Social Services', count: 1782, value: 17 },
        { categoryId: 'cat3', name: 'Education & Learning', count: 1645, value: 16 },
        { categoryId: 'cat4', name: 'Employment & Labor Services', count: 1245, value: 12 },
        { categoryId: 'cat5', name: 'Taxes & Revenue', count: 980, value: 10 },
        { categoryId: 'cat6', name: 'Public Safety & Justice', count: 850, value: 8 },
        { categoryId: 'cat7', name: 'Transportation & Mobility', count: 720, value: 7 },
        { categoryId: 'cat8', name: 'Housing & Urban Development', count: 650, value: 6 }
      ];
    },
    
    /**
     * Truncate text to fit in available space
     */
    truncateText(text, maxLength) {
      if (!text) return '';
      return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
    },
    
    /**
     * Render the pie chart
     */
    renderChart() {
      if (!this.chartData || this.chartData.length === 0 || !this.$refs.chart) return;
      
      // Clear previous chart
      d3.select(this.$refs.chart).selectAll('*').remove();
      
      // Process the data and ensure values are valid numbers
      const chartData = this.chartData.map(item => {
        // Ensure the value property exists and is a valid number
        const value = Number(item.value) || Number(item.count) || 1;
        
        return {
          categoryId: item.categoryId,
          categoryName: this.categories[item.categoryId] || item.name || this.formatCategoryId(item.categoryId),
          count: Number(item.count) || 0,
          value: value
        };
      });
      
      // Calculate total for accurate percentages
      const total = chartData.reduce((sum, d) => sum + d.value, 0);
      
      // Set up chart dimensions
      const width = this.width;
      const height = this.height;
      const chartWidth = width * 0.5; // Use 50% of width for chart
      const radius = Math.min(chartWidth, height) / 2; // Chart radius
      
      // Create SVG
      const svg = d3.select(this.$refs.chart)
        .append('svg')
        .attr('width', width)
        .attr('height', height);
      
      // Create chart group - positioned for balance  
      const chartGroup = svg.append('g')
        .attr('class', 'chart-group')
        .attr('transform', `translate(${chartWidth / 2},${height / 2})`);
      
      // Set up color scale
      const colorScale = d3.scaleOrdinal()
        .domain(chartData.map(d => d.categoryId))
        .range([
          '#5470c6', '#91cc75', '#fac858', '#ee6666',
          '#73c0de', '#3ba272', '#fc8452', '#9a60b4'
        ]);
      
      // Create pie layout
      const pie = d3.pie()
        .value(d => d.value)
        .sort(null);
      
      // Create arc generators
      const arc = d3.arc()
        .innerRadius(radius * 0.6) // Make it a donut chart
        .outerRadius(radius);
      
      // Create pie slices
      const slices = chartGroup.selectAll('.slice')
        .data(pie(chartData))
        .enter()
        .append('path')
        .attr('class', 'slice')
        .attr('d', arc)
        .attr('fill', d => colorScale(d.data.categoryId))
        .attr('stroke', 'white')
        .style('stroke-width', '2px')
        .style('opacity', 0.8)
        .on('mouseover', function() {
          d3.select(this)
            .style('opacity', 1)
            .attr('transform', 'scale(1.05)');
        })
        .on('mouseout', function() {
          d3.select(this)
            .style('opacity', 0.8)
            .attr('transform', 'scale(1)');
        });
        
      // Add percentage labels inside the donut slices
      chartGroup.selectAll('.percent-label')
        .data(pie(chartData))
        .enter()
        .append('text')
        .attr('class', 'percent-label')
        .attr('transform', d => {
          // Position text in the middle of each arc
          const centroid = arc.centroid(d);
          return `translate(${centroid})`;
        })
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('font-size', '11px')
        .style('font-weight', 'bold')
        .style('fill', 'white')
        .style('pointer-events', 'none')
        .text(d => {
          const percent = Math.round((d.data.value / total) * 100);
          return percent >= 4 ? `${percent}%` : ''; // Only show percentage for segments large enough
        });
      
      // Add center text
      const centerText = chartGroup.append('g')
        .attr('class', 'center-text')
        .attr('text-anchor', 'middle');
      
      centerText.append('text')
        .attr('y', -10)
        .style('font-size', '12px')
        .style('font-weight', 'bold')
        .text('Service Categories');
      
      centerText.append('text')
        .attr('y', 10)
        .style('font-size', '12px')
        .text('by Usage');
      
      // Create a legend container - positioned to the right with proper spacing
      const legend = svg.append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(${chartWidth + 40},${(height - (chartData.length * 24)) / 2})`); // Centered vertically
      
      // Add legend title
      legend.append('text')
        .attr('x', 0)
        .attr('y', -20)
        .style('font-size', '14px')
        .style('font-weight', 'bold')
        .text('Categories');
      
      // Add legend items
      const legendItems = legend.selectAll('.legend-item')
        .data(chartData)
        .enter()
        .append('g')
        .attr('class', 'legend-item')
        .attr('transform', (d, i) => `translate(0, ${i * 24})`); // More spacing between items
      
      // Add color squares
      legendItems.append('rect')
        .attr('width', 14)
        .attr('height', 14)
        .attr('fill', d => colorScale(d.categoryId));
      
      // Add category names
      legendItems.append('text')
        .attr('x', 20)
        .attr('y', 12)
        .style('font-size', '12px')
        .text(d => {
          // Calculate percentage for display
          const percent = Math.round((d.value / total) * 100);
          
          // Truncate long names and add percentage
          const nameMaxLength = 25;
          const truncatedName = this.truncateText(d.categoryName, nameMaxLength);
          return `${truncatedName} (${percent}%)`;
        });
      
      // Add tooltips
      const tooltip = d3.select('body')
        .append('div')
        .attr('class', 'd3-tooltip')
        .style('position', 'absolute')
        .style('background', 'rgba(0, 0, 0, 0.7)')
        .style('color', 'white')
        .style('padding', '8px')
        .style('border-radius', '4px')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('z-index', 1000);
      
      slices.on('mouseover', (event, d) => {
        tooltip.transition()
          .duration(200)
          .style('opacity', 0.9);
        
        const percent = Math.round((d.data.value / total) * 100);
        
        tooltip.html(`
          <div><strong>${d.data.categoryName}</strong></div>
          <div>${this.$t('analytics.queries', 'Queries')}: ${d.data.count ? d.data.count.toLocaleString() : 'N/A'}</div>
          <div>${this.$t('analytics.percentage', 'Percentage')}: ${percent}%</div>
        `)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 28) + 'px');
      })
      .on('mouseout', () => {
        tooltip.transition()
          .duration(500)
          .style('opacity', 0);
      });
    }
  }
};
</script>

<style scoped>
.chart-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.chart-container {
  width: 100%;
  height: 100%;
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
  background: rgba(255, 255, 255, 0.8);
  z-index: 1;
}

.spinner {
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top: 3px solid #4E97D1;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin-bottom: 10px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: #d32f2f;
}

/* Global styles for D3 tooltip */
:global(.d3-tooltip) {
  position: absolute;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 8px;
  border-radius: 4px;
  pointer-events: none;
  opacity: 0;
  z-index: 1000;
}
</style>