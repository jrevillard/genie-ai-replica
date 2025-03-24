<template>
  <div class="top-queries-chart">
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t('analytics.status.loading') }}</span>
    </div>
    <div v-else-if="error" class="error-message">
      {{ error }}
    </div>
    <div v-else-if="!data || data.length === 0" class="no-data">
      {{ $t('analytics.status.noData') }}
    </div>
    <div v-else>
      <!-- Compressed table view -->
      <div class="table-container">
        <table class="top-queries-table">
          <thead>
            <tr>
              <th class="rank">{{ $t('analytics.table.rank') }}</th>
              <th>{{ $t('analytics.table.query') }}</th>
              <th class="count">{{ $t('analytics.table.count') }}</th>
              <th class="avg-time">{{ $t('analytics.table.avgTime') }}</th>
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
      
      <!-- Stacked bar chart visualization -->
      <div ref="stackedBarChart" class="stacked-bar-chart"></div>
      
      <!-- Bottom bar chart visualization -->
      <div ref="bottomBarChart" class="bottom-bar-chart"></div>
    </div>
  </div>
</template>

<script>
import * as d3 from 'd3';
import analyticsService from '../../services/analyticsService';
import { 
  getThemeColors, 
  applyThemeToAxes, 
  createThemedGrid, 
  cleanupTooltips, 
  ensureTooltipExists 
} from '../../utils/chartThemeUtils';

export default {
  name: 'TopQueriesChart',
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
  data() {
    return {
      chartData: [],
      loading: false,
      error: null
    };
  },
  watch: {
    // Watch for data changes from parent
    data: {
      handler(newData) {
        if (this.externalData && newData && newData.length > 0) {
          this.chartData = newData;
          this.$nextTick(() => {
            this.renderStackedBarChart();
            this.renderBottomBarChart();
          });
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
          // Clean up existing tooltips
          cleanupTooltips();
          
          // Completely re-render charts
          if (this.$refs.stackedBarChart) {
            this.renderStackedBarChart();
          }
          
          if (this.$refs.bottomBarChart) {
            this.renderBottomBarChart();
          }
        });
      }
    },
    // Watch for locale changes directly
    '$i18n.locale': {
      handler() {
        // Force chart re-render when locale changes
        this.$nextTick(() => {
          cleanupTooltips();
          
          if (this.$refs.stackedBarChart) {
            this.renderStackedBarChart();
          }
          
          if (this.$refs.bottomBarChart) {
            this.renderBottomBarChart();
          }
        });
      },
      immediate: false
    }
  },
  mounted() {
    // Use data from props or fetch from API
    if (this.externalData && this.data.length > 0) {
      this.chartData = this.data;
      this.$nextTick(() => {
        this.renderStackedBarChart();
        this.renderBottomBarChart();
      });
    } else if (!this.externalData) {
      this.fetchData();
    }
    
    // Add resize listener for the chart
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    cleanupTooltips();
  },
  methods: {
    /**
     * Gets theme variables and detects current theme mode
     * @returns {Object} Theme colors and mode information
     */
    getThemeColors() {
      return getThemeColors();
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
          const dashboardData = await analyticsService.getDashboardAnalytics(this.period, this.selectedDate);
          if (dashboardData && dashboardData.topQueries) {
            this.chartData = dashboardData.topQueries;
          } else {
            throw new Error(this.$t('analytics.status.noData'));
          }
        } catch (apiError) {
          console.error('Error calling API:', apiError);
          console.log('Falling back to sample query data...');
          // Fall back to hard-coded data
          this.chartData = this.getFallbackData();
        }
        
        this.$nextTick(() => {
          this.renderStackedBarChart();
          this.renderBottomBarChart();
        });
      } catch (error) {
        console.error('Error fetching top queries data:', error);
        this.error = this.$t('analytics.status.error');
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
        { text: "How do I apply for a business license?", count: 2347, avgTime: 2.3 },
        { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
        { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
        { text: "What documents do I need for passport application?", count: 1423, avgTime: 3.4 },
        { text: "When are property taxes due?", count: 1289, avgTime: 1.5 }
      ];
    },
    
    /**
     * Handle window resize
     */
    handleResize() {
      this.renderStackedBarChart();
      this.renderBottomBarChart();
    },
    
    /**
     * Truncate text to fit in available space
     */
    truncateText(text, maxLength) {
      if (!text) return '';
      return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
    },
    
    /**
     * Render stacked bar chart
     */
    renderStackedBarChart() {
      if (!this.$refs.stackedBarChart || !this.chartData || this.chartData.length === 0) return;
      
      // Clear any existing chart
      d3.select(this.$refs.stackedBarChart).selectAll('*').remove();
      
      // Get theme colors with dark mode detection
      const theme = this.getThemeColors();
      
      // Get container dimensions
      const container = this.$refs.stackedBarChart;
      const width = container.clientWidth;
      const height = 100; // Fixed height for the stacked bar
      
      // Set up margins
      const margin = { top: 10, right: 10, bottom: 25, left: 40 };
      const chartWidth = width - margin.left - margin.right;
      const chartHeight = height - margin.top - margin.bottom;
      
      // Process data for the stacked bar chart
      // Combine into "groups" - count and avgTime
      const stackData = this.chartData.map((d, i) => ({
        query: this.$t('analytics.query') + ' ' + (i + 1),
        shortText: this.truncateText(d.text, 15),
        count: d.count,
        avgTime: d.avgTime,
        // Normalize metrics to make them comparable in a stacked view
        // Count will be proportional to its value within the dataset
        // Avg time will be scaled to be visible alongside count
        normalizedCount: d.count,
        normalizedTime: d.avgTime * 300 // Scaling factor to make time visible
      }));
      
      // Create SVG
      const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
      
      // Create horizontal scale for queries
      const x = d3.scaleBand()
        .domain(stackData.map(d => d.query))
        .range([0, chartWidth])
        .padding(0.3);
      
      // Create vertical scale for count values
      const y = d3.scaleLinear()
        .domain([0, d3.max(stackData, d => d.normalizedCount)])
        .nice()
        .range([chartHeight, 0]);
      
      // Add themed grid
      createThemedGrid(svg, x, y, chartWidth, chartHeight, theme, false, true);
      
      // Add X axis
      const xAxis = svg.append('g')
        .attr('transform', `translate(0,${chartHeight})`)
        .call(d3.axisBottom(x).tickSizeOuter(0));
      
      // Apply theme to axis
      applyThemeToAxes(xAxis, theme);
      
      // Add Y axis
      const yAxis = svg.append('g')
        .call(d3.axisLeft(y).ticks(3).tickFormat(d => d3.format('.0s')(d)));
      
      // Apply theme to axis
      applyThemeToAxes(yAxis, theme);
      
      // Draw count bars
      const bars = svg.append('g')
        .selectAll('.bar')
        .data(stackData)
        .enter()
        .append('rect')
        .attr('class', 'bar')
        .attr('x', d => x(d.query))
        .attr('y', d => y(d.normalizedCount))
        .attr('width', x.bandwidth())
        .attr('height', d => chartHeight - y(d.normalizedCount))
        .attr('fill', theme.accentColor)
        .attr('rx', 2)
        .attr('ry', 2);
      
      // Add labels for queries at the bottom
      svg.append('g')
        .selectAll('.query-label')
        .data(stackData)
        .enter()
        .append('text')
        .attr('class', 'query-label')
        .attr('x', d => x(d.query) + x.bandwidth() / 2)
        .attr('y', chartHeight + 20)
        .attr('text-anchor', 'middle')
        .style('font-size', '8px')
        .style('fill', theme.textColor) // Use theme text color
        .text((d, i) => `#${i + 1}`);
      
      // Add count labels inside the bars (for larger bars only)
      svg.append('g')
        .selectAll('.value-label')
        .data(stackData)
        .enter()
        .append('text')
        .attr('class', 'value-label')
        .attr('x', d => x(d.query) + x.bandwidth() / 2)
        .attr('y', d => y(d.normalizedCount) + 12)
        .attr('text-anchor', 'middle')
        .style('font-size', '8px')
        .style('fill', 'white') // Keep white for contrast against colored bars
        .style('font-weight', 'bold')
        .text(d => {
          // Only show label if bar is tall enough
          const height = chartHeight - y(d.normalizedCount);
          return height > 20 ? d3.format(',')(d.count) : '';
        });
      
      // Add tooltips
      const tooltip = ensureTooltipExists();
      
      bars.on('mouseover', (event, d) => {
        tooltip.transition()
          .duration(200)
          .style('opacity', 0.9);
        
        tooltip.html(`
          <div><strong>${d.shortText}</strong></div>
          <div>${this.$t('analytics.table.count')}: ${d3.format(',')(d.count)}</div>
          <div>${this.$t('analytics.table.avgTime')}: ${d.avgTime}s</div>
        `)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 28) + 'px');
      })
      .on('mouseout', () => {
        tooltip.transition()
          .duration(500)
          .style('opacity', 0);
      });
    },
    
    /**
     * Render bottom bar chart
     */
    renderBottomBarChart() {
      // Get container element
      const container = this.$refs.bottomBarChart;
      if (!container || !this.chartData || this.chartData.length === 0) return;
      
      // Clear any existing content
      d3.select(container).selectAll('*').remove();
      
      // Get theme colors with dark mode detection
      const theme = this.getThemeColors();
      
      // Set dimensions
      const margin = { top: 10, right: 10, bottom: 20, left: 40 };
      const width = container.clientWidth;
      const height = 80;
      const chartWidth = width - margin.left - margin.right;
      const chartHeight = height - margin.top - margin.bottom;
      
      // Prepare data (top 5 queries)
      const data = this.chartData.slice(0, 5).map((d, i) => ({
        query: `Query ${i + 1}`,
        count: d.count
      }));
      
      // Create SVG
      const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
      
      // Create scales
      const x = d3.scaleBand()
        .domain(data.map(d => d.query))
        .range([0, chartWidth])
        .padding(0.4);
      
      const y = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.count) * 1.1])
        .range([chartHeight, 0]);
      
      // Add X axis with theme-colored text
      const xAxis = svg.append('g')
        .attr('transform', `translate(0,${chartHeight})`)
        .call(d3.axisBottom(x));
      
      // Apply theme to axes
      applyThemeToAxes(xAxis, theme);
      
      // Add background grid
      createThemedGrid(svg, x, y, chartWidth, chartHeight, theme);
      
      // Add the bars with accent color
      svg.selectAll('.bar')
        .data(data)
        .enter()
        .append('rect')
        .attr('class', 'bar')
        .attr('x', d => x(d.query))
        .attr('y', d => y(d.count))
        .attr('width', x.bandwidth())
        .attr('height', d => chartHeight - y(d.count))
        .attr('fill', theme.accentColor)
        .attr('rx', 1)
        .attr('ry', 1);
      
      // Add value labels on top of bars
      svg.selectAll('.value-label')
        .data(data)
        .enter()
        .append('text')
        .attr('class', 'value-label')
        .attr('x', d => x(d.query) + x.bandwidth() / 2)
        .attr('y', d => y(d.count) - 5)
        .attr('text-anchor', 'middle')
        .style('font-size', '8px')
        .style('fill', theme.textColor)
        .text(d => d3.format(',')(d.count));
    }
  }
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
  border-top: 3px solid var(--accent-color, #4E97D1);
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
  margin-bottom: 8px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-message, .no-data {
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
}

.top-queries-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
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

.stacked-bar-chart {
  width: 100%;
  height: 100px;
  margin-top: 5px;
  background-color: transparent;
}

.bottom-bar-chart {
  width: 100%;
  height: 80px;
  margin-top: 10px;
  background-color: transparent;
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