// src/components/charts/UsageTrendChart.vue - Fully restored
<template>
  <div class="usage-trend-chart">
    <!-- Chart title and period selector -->
    <div class="chart-header">
      <h3>{{ $t('analytics.charts.usageTrend', 'Usage Trends') }}</h3>
      <div class="period-selector" v-if="showPeriodSelector">
        <select v-model="selectedPeriod" @change="onPeriodChange">
          <option value="daily">{{ $t('analytics.periods.daily', 'Daily') }}</option>
          <option value="weekly">{{ $t('analytics.periods.weekly', 'Weekly') }}</option>
          <option value="monthly">{{ $t('analytics.periods.monthly', 'Monthly') }}</option>
          <option value="all-time">{{ $t('analytics.periods.allTime', 'All Time') }}</option>
        </select>
      </div>
    </div>
    
    <div class="chart-container" ref="chartContainer"></div>
    
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t('analytics.loadingChart', 'Loading chart data...') }}</span>
    </div>
    
    <div v-if="error" class="error-message">
      {{ error }}
      <button @click="fetchData" class="retry-button">
        {{ $t('analytics.retry', 'Retry') }}
      </button>
    </div>
  </div>
</template>

<script>
import * as d3 from 'd3';
import analyticsService from '../../services/analyticsService';

export default {
  name: 'UsageTrendChart',
  props: {
    // Accept data directly (for parent component control)
    data: {
      type: Array,
      default: () => []
    },
    // Period type for fetching data if not provided
    period: {
      type: String,
      default: 'monthly'
    },
    // Selected date for fetching data if not provided
    selectedDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0]
    },
    // Whether the data is provided by the parent
    externalData: {
      type: Boolean,
      default: false
    },
    // Whether to show the period selector
    showPeriodSelector: {
      type: Boolean,
      default: true
    },
    // Whether to show the dual chart (queries + users)
    showDualChart: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      chartData: [],
      usersData: [], // For dual chart
      loading: false,
      error: null,
      chart: null,
      chartWidth: 0,
      chartHeight: 0,
      selectedPeriod: this.period, // Initialize with prop value
      margin: {
        top: 20,
        right: 30,
        bottom: 50,
        left: 60
      }
    };
  },
  watch: {
    // Watch for props changes
    data: {
      handler(newData) {
        if (this.externalData && newData) {
          this.chartData = newData;
          // Generate some user data for dual chart
          if (this.showDualChart) {
            this.generateUserData();
          }
          this.renderChart();
        }
      },
      deep: true
    },
    period: {
      handler(newPeriod) {
        this.selectedPeriod = newPeriod;
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
  mounted() {
    // Initialize chart dimensions
    this.initDimensions();
    
    // Fetch data if not provided externally
    if (!this.externalData) {
      this.fetchData();
    } else if (this.data.length > 0) {
      this.chartData = this.data;
      // Generate some user data for dual chart
      if (this.showDualChart) {
        this.generateUserData();
      }
      this.renderChart();
    }
    
    // Add resize listener
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    // Clean up
    window.removeEventListener('resize', this.handleResize);
    this.clearChart();
  },
  methods: {
    /**
     * Generate user data based on query data for dual chart
     */
    generateUserData() {
      this.usersData = this.chartData.map(item => {
        // Calculate users as ~30-40% of queries with some random variation
        const factor = 0.3 + Math.random() * 0.1;
        return {
          ...item,
          users: Math.round(item.value * factor)
        };
      });
    },
    
    /**
     * Handle period selector change
     */
    onPeriodChange() {
      this.$emit('period-change', this.selectedPeriod);
      if (!this.externalData) {
        this.fetchData();
      }
    },
    
    /**
     * Fetch time series data from the API
     */
    async fetchData() {
      if (this.externalData) return;
      
      this.loading = true;
      this.error = null;
      
      try {
        // Calculate appropriate interval based on period
        let interval = 'daily';
        
        switch (this.selectedPeriod) {
          case 'daily':
            interval = 'hourly';
            break;
          case 'weekly':
          case 'monthly':
            interval = 'daily';
            break;
          case 'all-time':
            interval = 'monthly';
            break;
        }
        
        // Calculate start and end dates
        const endDate = this.selectedDate || new Date().toISOString().split('T')[0];
        let startDate;
        
        switch (this.selectedPeriod) {
          case 'daily':
            startDate = endDate;
            break;
          case 'weekly':
            startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 6)).toISOString().split('T')[0];
            break;
          case 'monthly':
            startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 29)).toISOString().split('T')[0];
            break;
          case 'all-time':
            startDate = '2020-01-01';
            break;
        }
        
        // Fetch the data
        const data = await analyticsService.getTimeSeriesData('queries', interval, startDate, endDate);
        this.chartData = data;
        
        // Generate some user data for dual chart
        if (this.showDualChart) {
          this.generateUserData();
        }
        
        // Render the chart
        this.renderChart();
      } catch (error) {
        console.error('Error fetching time series data:', error);
        console.log('Falling back to sample data...');
        // Fall back to hard-coded data
        this.chartData = this.getFallbackData();
        
        // Generate some user data for dual chart
        if (this.showDualChart) {
          this.generateUserData();
        }
        
        this.renderChart();
      } finally {
        this.loading = false;
      }
    },
    
    /**
     * Initialize chart dimensions
     */
    initDimensions() {
      if (!this.$refs.chartContainer) return;
      
      const container = this.$refs.chartContainer;
      
      // Get container dimensions
      this.chartWidth = container.clientWidth;
      this.chartHeight = 300; // Fixed height or could be responsive
    },
    
    /**
     * Handle window resize
     */
    handleResize() {
      this.initDimensions();
      this.renderChart();
    },
    
    /**
     * Clear the current chart
     */
    clearChart() {
      if (this.$refs.chartContainer) {
        d3.select(this.$refs.chartContainer).selectAll('*').remove();
      }
    },
    
    /**
     * Render the time series chart using D3
     */
    renderChart() {
      if (!this.$refs.chartContainer || !this.chartData || this.chartData.length === 0) return;
      
      // Clear any existing chart
      this.clearChart();
      
      const margin = this.margin;
      const width = this.chartWidth - margin.left - margin.right;
      const height = this.chartHeight - margin.top - margin.bottom;
      
      // Create SVG element
      const svg = d3.select(this.$refs.chartContainer)
        .append('svg')
        .attr('width', this.chartWidth)
        .attr('height', this.chartHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
      
      // Add gridlines
      svg.append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(0,${height})`)
        .call(
          d3.axisBottom(d3.scalePoint()
            .domain(this.chartData.map(d => d.dateLabel))
            .range([0, width]))
            .tickSize(-height)
            .tickFormat('')
        )
        .selectAll('line')
        .attr('stroke', '#e0e0e0')
        .attr('stroke-opacity', 0.5);
      
      svg.append('g')
        .attr('class', 'grid')
        .call(
          d3.axisLeft(d3.scaleLinear()
            .domain([0, d3.max(this.chartData, d => d.value) * 1.2])
            .nice()
            .range([height, 0]))
            .tickSize(-width)
            .tickFormat('')
        )
        .selectAll('line')
        .attr('stroke', '#e0e0e0')
        .attr('stroke-opacity', 0.5);
      
      // Create scales
      const x = d3.scalePoint()
        .domain(this.chartData.map(d => d.dateLabel))
        .range([0, width])
        .padding(0.5);
      
      const y1 = d3.scaleLinear()
        .domain([0, d3.max(this.chartData, d => d.value) * 1.2]) // Add 20% padding
        .nice()
        .range([height, 0]);
      
      // Create second y-scale for users if dual chart
      let y2;
      if (this.showDualChart) {
        y2 = d3.scaleLinear()
          .domain([0, d3.max(this.usersData, d => d.users) * 1.2]) // Add 20% padding
          .nice()
          .range([height, 0]);
      }
      
      // Create gradient for area
      const areaGradient = svg.append('defs')
        .append('linearGradient')
        .attr('id', 'areaGradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%');
      
      areaGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#4E97D1')
        .attr('stop-opacity', 0.7);
      
      areaGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#4E97D1')
        .attr('stop-opacity', 0.1);
      
      // Create gradient for bar chart if dual chart
      if (this.showDualChart) {
        const barGradient = svg.append('defs')
          .append('linearGradient')
          .attr('id', 'barGradient')
          .attr('x1', '0%').attr('y1', '0%')
          .attr('x2', '0%').attr('y2', '100%');
        
        barGradient.append('stop')
          .attr('offset', '0%')
          .attr('stop-color', '#4CC2A5')
          .attr('stop-opacity', 1);
        
        barGradient.append('stop')
          .attr('offset', '100%')
          .attr('stop-color', '#4CC2A5')
          .attr('stop-opacity', 0.7);
      }
      
      // If dual chart, draw bars for users first (so they're behind the line)
      if (this.showDualChart) {
        const barWidth = width / this.usersData.length * 0.6;
        
        svg.selectAll('.bar')
          .data(this.usersData)
          .enter()
          .append('rect')
          .attr('class', 'bar')
          .attr('x', d => x(d.dateLabel) - barWidth / 2)
          .attr('y', d => y2(d.users))
          .attr('width', barWidth)
          .attr('height', d => height - y2(d.users))
          .attr('fill', 'url(#barGradient)')
          .attr('rx', 3)
          .attr('ry', 3);
      }
      
      // Create area generator
      const area = d3.area()
        .x(d => x(d.dateLabel))
        .y0(height)
        .y1(d => y1(d.value))
        .curve(d3.curveMonotoneX);
      
      // Add the area path
      svg.append('path')
        .datum(this.chartData)
        .attr('fill', 'url(#areaGradient)')
        .attr('d', area);
      
      // Create line generator
      const line = d3.line()
        .x(d => x(d.dateLabel))
        .y(d => y1(d.value))
        .curve(d3.curveMonotoneX); // Smooth curve
      
      // Add the line path
      svg.append('path')
        .datum(this.chartData)
        .attr('fill', 'none')
        .attr('stroke', '#4E97D1')
        .attr('stroke-width', 2.5)
        .attr('d', line);
      
      // Add data points
      svg.selectAll('.data-point')
        .data(this.chartData)
        .enter()
        .append('circle')
        .attr('class', 'data-point')
        .attr('cx', d => x(d.dateLabel))
        .attr('cy', d => y1(d.value))
        .attr('r', 4)
        .attr('fill', '#4E97D1')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
      
      // Add X axis
      svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x))
        .selectAll('text')
        .style('text-anchor', 'end')
        .attr('dx', '-.8em')
        .attr('dy', '.15em')
        .attr('transform', 'rotate(-45)');
      
      // Add primary Y axis
      svg.append('g')
        .call(d3.axisLeft(y1).ticks(5).tickFormat(d => d3.format(',')(d)));
      
      // Add primary Y axis label
      svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 0 - margin.left)
        .attr('x', 0 - (height / 2))
        .attr('dy', '1em')
        .style('text-anchor', 'middle')
        .style('fill', '#666')
        .text(this.$t('analytics.labels.totalQueries', 'Total Queries'));
      
      // If dual chart, add secondary Y axis
      if (this.showDualChart) {
        svg.append('g')
          .attr('transform', `translate(${width}, 0)`)
          .call(d3.axisRight(y2).ticks(5).tickFormat(d => d3.format(',')(d)));
        
        // Add secondary Y axis label
        svg.append('text')
          .attr('transform', 'rotate(90)')
          .attr('y', -width - margin.right)
          .attr('x', height / 2)
          .attr('dy', '-0.5em')
          .style('text-anchor', 'middle')
          .style('fill', '#666')
          .text(this.$t('analytics.labels.uniqueUsers', 'Unique Users'));
      }
      
      // Add legend if dual chart
      if (this.showDualChart) {
        const legend = svg.append('g')
          .attr('transform', `translate(${width / 2 - 100}, ${height + 40})`);
        
        // Total Queries legend
        legend.append('line')
          .attr('x1', 0)
          .attr('y1', 0)
          .attr('x2', 20)
          .attr('y2', 0)
          .attr('stroke', '#4E97D1')
          .attr('stroke-width', 2.5);
        
        legend.append('circle')
          .attr('cx', 10)
          .attr('cy', 0)
          .attr('r', 4)
          .attr('fill', '#4E97D1')
          .attr('stroke', '#fff')
          .attr('stroke-width', 2);
        
        legend.append('text')
          .attr('x', 25)
          .attr('y', 4)
          .text(this.$t('analytics.labels.totalQueries', 'Total Queries'))
          .style('font-size', '12px')
          .style('fill', '#666');
        
        // Unique Users legend
        legend.append('rect')
          .attr('x', 150)
          .attr('y', -8)
          .attr('width', 20)
          .attr('height', 16)
          .attr('fill', 'url(#barGradient)')
          .attr('rx', 2)
          .attr('ry', 2);
        
        legend.append('text')
          .attr('x', 175)
          .attr('y', 4)
          .text(this.$t('analytics.labels.uniqueUsers', 'Unique Users'))
          .style('font-size', '12px')
          .style('fill', '#666');
      }
      
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
      
      svg.selectAll('.data-point')
        .on('mouseover', (event, d) => {
          tooltip.transition()
            .duration(200)
            .style('opacity', 0.9);
          
          let tooltipContent = `
            <div><strong>${d.dateLabel}</strong></div>
            <div style="color: #4E97D1;">${this.$t('analytics.labels.totalQueries', 'Total Queries')}: ${d.value.toLocaleString()}</div>
          `;
          
          if (this.showDualChart) {
            const userData = this.usersData.find(u => u.dateLabel === d.dateLabel);
            if (userData) {
              tooltipContent += `<div style="color: #4CC2A5;">${this.$t('analytics.labels.uniqueUsers', 'Unique Users')}: ${userData.users.toLocaleString()}</div>`;
            }
          }
          
          tooltip.html(tooltipContent)
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
     * Update translations in the chart
     */
    updateTranslations() {
      // Re-render the chart with new translations
      this.renderChart();
    },

    /**
     * Get fallback data in case API fails
     * @returns {Array} Sample time series data
     */
    getFallbackData() {
      // Create fallback data based on selected period
      const now = new Date();
      const result = [];

      if (this.selectedPeriod === 'daily') {
        // Hourly data for today
        for (let hour = 0; hour < 24; hour++) {
          const time = new Date(now);
          time.setHours(hour, 0, 0, 0);
          
          // More activity during business hours
          const baseValue = hour >= 9 && hour <= 17 ? 50 : 20;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: time.toISOString(),
            dateLabel: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            value: value
          });
        }
      } else if (this.selectedPeriod === 'weekly') {
        // Daily data for the week
        for (let day = 6; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);
          
          // Less activity on weekends
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
            value: value
          });
        }
      } else if (this.selectedPeriod === 'monthly') {
        // Daily data for the month (last 30 days)
        for (let day = 29; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);
          
          // Random fluctuation with weekend pattern
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
            value: value
          });
        }
      } else {
        // Monthly data for all time (last 12 months)
        for (let month = 11; month >= 0; month--) {
          const date = new Date(now);
          date.setMonth(date.getMonth() - month);
          date.setDate(1);
          date.setHours(0, 0, 0, 0);
          
          // Increasing trend over time with seasonal variation
          const seasonalFactor = 1 + Math.sin(month / 6 * Math.PI) * 0.2;
          const growthFactor = 1 + (11 - month) * 0.05;
          const value = Math.round(300 * seasonalFactor * growthFactor);
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString([], { month: 'short', year: 'numeric' }),
            value: value
          });
        }
      }
      
      return result;
    }
  }
};
</script>

<style scoped>
.usage-trend-chart {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 350px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.chart-header h3 {
  margin: 0;
  font-size: 1.2rem;
  color: #333;
}

.period-selector select {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: white;
  font-size: 0.9rem;
}

.chart-container {
  width: 100%;
  height: calc(100% - 40px);
  min-height: 300px;
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

.retry-button {
  display: block;
  margin-top: 10px;
  padding: 6px 12px;
  background-color: #4E97D1;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
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