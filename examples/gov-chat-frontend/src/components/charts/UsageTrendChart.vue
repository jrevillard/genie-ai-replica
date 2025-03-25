<template>
  <div class="usage-trend-chart">
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t('analytics.status.loading') }}</span>
    </div>
    <div v-else-if="error" class="error-container">
      <p class="error-message">{{ error }}</p>
    </div>
    <div v-else-if="!data || data.length === 0" class="no-data">
      {{ $t('analytics.status.noData') }}
    </div>
    <div v-else ref="chartContainer" class="chart-container"></div>
  </div>
</template>

<script>
import * as d3 from 'd3';
import analyticsService from '../../services/analyticsService';
import { getThemeColors, applyThemeToAxes, cleanupTooltips } from '../../utils/chartThemeUtils';

export default {
  name: 'UsageTrendChart',
  props: {
    data: {
      type: Array,
      default: () => []
    },
    externalData: {
      type: Boolean,
      default: true
    },
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
  data() {
    return {
      chartData: [],
      loading: false,
      error: null,
      width: 0,
      height: 0
    };
  },
  watch: {
    data: {
      handler(newData) {
        if (this.externalData && newData && newData.length > 0) {
          this.chartData = newData;
          this.renderChart();
        }
      },
      deep: true
    },
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
        // Clear existing tooltips to prevent duplicates
        cleanupTooltips();

        // Re-render chart with new translations
        this.$nextTick(() => {
          if (this.chartData && this.chartData.length > 0) {
            // Force complete recreation
            if (this.$refs.chartContainer) {
              d3.select(this.$refs.chartContainer).selectAll('*').remove();
              this.renderChart();
            }
          }
        });
      }
    }
  },
  mounted() {
    this.initChartDimensions();

    if (this.externalData && this.data.length > 0) {
      this.chartData = this.data;
      this.renderChart();
    } else if (!this.externalData) {
      this.fetchData();
    }

    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    cleanupTooltips();
  },
  methods: {
    async fetchData() {
      if (this.externalData) return;

      this.loading = true;
      this.error = null;

      try {
        const params = analyticsService.calculateTimeSeriesParams(
          this.period,
          this.selectedDate
        );

        const url = `/api/analytics/timeseries/queries`;

        console.log(`Fetching time series data from ${url} with params:`, params);

        const response = await fetch(`${url}?interval=${params.interval}&startDate=${params.startDate}&endDate=${params.endDate}`);

        if (!response.ok) {
          throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
          console.log('Time series data loaded successfully:', data);

          this.chartData = data.map(item => ({
            timestamp: item.timestamp || '',
            dateLabel: this.formatDate(item.timestamp),
            value: typeof item.value === 'number' ? item.value : 0,
            userCount: typeof item.userCount === 'number' ? item.userCount : 0
          }));
        } else {
          console.warn('Empty or invalid time series data received:', data);
          this.chartData = this.generateSampleData();
        }

        this.renderChart();
      } catch (error) {
        console.error('Error loading time series data:', error);
        this.error = this.$t('analytics.status.error');
        this.chartData = this.generateSampleData();
        this.renderChart();
      } finally {
        this.loading = false;
      }
    },

    formatDate(dateString) {
      if (!dateString) return '';

      try {
        const date = new Date(dateString);
        return date.toLocaleDateString(this.$i18n.locale);
      } catch (e) {
        return dateString;
      }
    },

    generateSampleData() {
      const result = [];
      const today = new Date();

      for (let i = 30; i > 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        result.push({
          timestamp: date.toISOString(),
          dateLabel: date.toLocaleDateString(this.$i18n.locale),
          value: Math.floor(Math.random() * 1000),
          userCount: Math.floor(Math.random() * 200)
        });
      }

      console.log('Generated sample data for chart:', result);
      return result;
    },

    initChartDimensions() {
      if (!this.$refs.chartContainer) return;

      const container = this.$refs.chartContainer;
      this.width = container.clientWidth;
      this.height = 300;
    },

    handleResize() {
      this.initChartDimensions();
      this.renderChart();
    },

    renderChart() {
      if (!this.chartData || this.chartData.length === 0 || !this.$refs.chartContainer) return;

      // Clear previous chart
      d3.select(this.$refs.chartContainer).selectAll('*').remove();

      // Get theme colors using the utility function
      const theme = getThemeColors();
      const { textColor, backgroundColor, borderColor, gridColor, isDarkMode } = theme;

      // Use a LIGHT GRAY background for dark mode that contrasts with black text
      // This color will be used for all background elements
      const chartBackgroundColor = isDarkMode ? '#bbbcbe' : '#ffffff';

      const margin = { top: 40, right: 60, bottom: 50, left: 60 };
      const width = this.width - margin.left - margin.right;
      const height = this.height - margin.top - margin.bottom;

      // Create SVG element
      const svg = d3.select(this.$refs.chartContainer)
        .append('svg')
        .attr('width', this.width)
        .attr('height', this.height);

      // Add background rectangle that extends beyond the axes to make labels readable
      // Only add in dark mode with LIGHT GRAY color
      //if (isDarkMode) {
      //  svg.append('rect')
      //    .attr('width', this.width)
      //    .attr('height', this.height)
      //    .attr('fill', chartBackgroundColor)
      //    .attr('rx', 8)
      //    .attr('ry', 8);
      //}

      const mainGroup = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // Create defs for gradients and filters
      const defs = mainGroup.append('defs');

      // Add drop shadow filter
      defs.append('filter')
        .attr('id', 'drop-shadow')
        .attr('height', '130%')
        .append('feDropShadow')
        .attr('dx', 0)
        .attr('dy', 3)
        .attr('stdDeviation', 3)
        .attr('flood-color', 'rgba(0,0,0,0.3)');

      // Add bar gradient
      const barGradient = defs.append('linearGradient')
        .attr('id', 'bar-gradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');

      // Always use light green for bars
      barGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#62d9a6');

      barGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#2da676');

      // Add blue area gradient
      const areaGradient = defs.append('linearGradient')
        .attr('id', 'area-gradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');

      areaGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#4682B4')
        .attr('stop-opacity', 0.7);

      areaGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#4682B4')
        .attr('stop-opacity', 0.1);

      // Add line gradient
      const lineGradient = defs.append('linearGradient')
        .attr('id', 'line-gradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');

      lineGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#5b9bd5'); // Start color

      lineGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#3a6da0'); // End color

      // Parse dates and prepare data
      const data = this.chartData.map(d => {
        return {
          timestamp: d.timestamp ? new Date(d.timestamp) : new Date(),
          dateLabel: d.dateLabel || '',
          value: d.value,
          userCount: d.userCount
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      // Create scales
      const x = d3.scaleTime()
        .range([0, width])
        .domain(d3.extent(data, d => d.timestamp));

      const yLeft = d3.scaleLinear()
        .range([height, 0])
        .domain([0, d3.max(data, d => d.value) * 1.1])
        .nice();

      const yRight = d3.scaleLinear()
        .range([height, 0])
        .domain([0, d3.max(data, d => d.userCount) * 1.2])
        .nice();

      // Add chart background with the same light gray color
      //mainGroup.append('rect')
      //  .attr('width', width)
      //  .attr('height', height)
      //  .attr('fill', chartBackgroundColor)
      //  .attr('rx', 5)
      //  .attr('ry', 5);

      // Draw background grid
      mainGroup.append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(0,${height})`)
        .call(
          d3.axisBottom(x)
            .tickSize(-height)
            .tickFormat('')
        )
        .selectAll('line')
        .attr('stroke', gridColor)
        .attr('stroke-dasharray', isDarkMode ? '3,3' : 'none');

      mainGroup.append('g')
        .attr('class', 'grid')
        .call(
          d3.axisLeft(yLeft)
            .tickSize(-width)
            .tickFormat('')
        )
        .selectAll('line')
        .attr('stroke', gridColor)
        .attr('stroke-dasharray', isDarkMode ? '3,3' : 'none');

      // Remove grid domain lines
      mainGroup.selectAll('.grid .domain')
        .attr('stroke', 'none');

      // Calculate 60% wider bar width
      const barWidth = Math.min(16, width / data.length * 0.7);

      // Add bars for query counts with 3D effect
      const bars = mainGroup.selectAll('.bar-group')
        .data(data)
        .enter()
        .append('g')
        .attr('class', 'bar-group')
        .attr('transform', d => `translate(${x(d.timestamp) - barWidth / 2}, 0)`);

      // Main bar with gradient
      // Main bar with explicit green color
      bars.append('rect')
        .attr('class', 'bar')
        .attr('width', barWidth)
        .attr('y', d => yLeft(d.value))
        .attr('height', d => height - yLeft(d.value))
        .attr('fill', '#62d9a6') // Direct light green color
        .attr('rx', 1)
        .attr('ry', 1)
        .style('filter', 'url(#drop-shadow)')
        .style('opacity', 0.85);

      // Top highlight for 3D effect
      bars.append('rect')
        .attr('width', barWidth)
        .attr('height', 2)
        .attr('y', d => yLeft(d.value))
        .attr('fill', '#ffffff')
        .attr('opacity', 0.5)
        .attr('rx', 1);

      // Create the area fill below line (blue hue over the bars)
      const area = d3.area()
        .x(d => x(d.timestamp))
        .y0(height)
        .y1(d => yRight(d.userCount))
        .curve(d3.curveCardinal.tension(0.5));

      // Add the blue area fill with reduced opacity
      mainGroup.append('path')
        .datum(data)
        .attr('class', 'area')
        .attr('fill', 'url(#area-gradient)')
        .attr('d', area)
        .attr('opacity', 0.4);

      // Add line for user counts with THINNER styling
      const line = d3.line()
        .x(d => x(d.timestamp))
        .y(d => yRight(d.userCount))
        .curve(d3.curveCardinal.tension(0.5));

      // Add line shadow with reduced size
      mainGroup.append('path')
        .datum(data)
        .attr('class', 'line-shadow')
        .attr('fill', 'none')
        .attr('stroke', isDarkMode ? '#555' : '#333')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.2)
        .attr('d', line)
        .attr('transform', 'translate(1,1)');

      // Add the actual line with reduced thickness
      mainGroup.append('path')
        .datum(data)
        .attr('class', 'line')
        .attr('fill', 'none')
        .attr('stroke', 'url(#line-gradient)')
        .attr('stroke-width', 1.5)
        .attr('d', line);

      // Add circles for data points with smaller size
      mainGroup.selectAll('.dot-shadow')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'dot-shadow')
        .attr('cx', d => x(d.timestamp) + 1)
        .attr('cy', d => yRight(d.userCount) + 1)
        .attr('r', 3)
        .attr('fill', 'rgba(0,0,0,0.2)');

      mainGroup.selectAll('.dot')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'dot')
        .attr('cx', d => x(d.timestamp))
        .attr('cy', d => yRight(d.userCount))
        .attr('r', 2.5)
        .attr('fill', '#5b9bd5')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1);

      // Draw axes with styled appearance
      const xAxis = d3.axisBottom(x)
        .ticks(d3.timeDay.every(Math.ceil(data.length / 12)))
        .tickFormat(d => {
          const month = d.toLocaleString(this.$i18n.locale, { month: 'short' });
          const day = d.getDate();
          return `${month} ${day}`;
        });

      // X-axis with BLACK text that will be visible on light gray background
      const xAxisGroup = mainGroup.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(xAxis);

      // Use black text in dark mode for all axes (since we have light gray background)
      const axisTextColor = isDarkMode ? '#333333' : textColor;
      const axisLineColor = isDarkMode ? '#333333' : textColor;

      xAxisGroup.selectAll('text')
        .style('text-anchor', 'end')
        .style('font-weight', 'bold')
        .style('font-size', '11px')
        .style('fill', axisTextColor)
        .attr('dx', '-.8em')
        .attr('dy', '.15em')
        .attr('transform', 'rotate(-45)');

      xAxisGroup.selectAll('path')
        .attr('stroke', axisLineColor);

      xAxisGroup.selectAll('line')
        .attr('stroke', axisLineColor);

      // Y-axis left with proper text color
      const yAxisLeftGroup = mainGroup.append('g')
        .attr('class', 'y-axis-left')
        .call(d3.axisLeft(yLeft).ticks(5));

      yAxisLeftGroup.selectAll('text')
        .style('font-weight', 'bold')
        .style('font-size', '11px')
        .style('fill', axisTextColor);

      yAxisLeftGroup.selectAll('path')
        .attr('stroke', axisLineColor);

      yAxisLeftGroup.selectAll('line')
        .attr('stroke', axisLineColor);

      // Y-axis right with proper text color
      const yAxisRightGroup = mainGroup.append('g')
        .attr('class', 'y-axis-right')
        .attr('transform', `translate(${width},0)`)
        .call(d3.axisRight(yRight).ticks(5));

      yAxisRightGroup.selectAll('text')
        .style('font-weight', 'bold')
        .style('font-size', '11px')
        .style('fill', axisTextColor);

      yAxisRightGroup.selectAll('path')
        .attr('stroke', axisLineColor);

      yAxisRightGroup.selectAll('line')
        .attr('stroke', axisLineColor);

      // Enhanced chart title with dark text
      mainGroup.append('text')
        .attr('x', width / 2)
        .attr('y', -30)  // Change from -20 to -30 or even -35
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .attr('fill', axisTextColor)
        .text(this.$t('charts.usageTrend'));

      // Add enhanced legend with 3D effects
      const legendBox = mainGroup.append('g')
        .attr('class', 'legend-box')
        .attr('transform', `translate(${width / 2 - 170}, -15)`);

      // Legend background - also use same light gray
      //legendBox.append('rect')
      //  .attr('x', -5)
      //  .attr('y', -15)
      //  .attr('width', 340)
      //  .attr('height', 30)
      //  .attr('rx', 5)
      //  .attr('ry', 5)
      //  .attr('fill', chartBackgroundColor)
      //  .style('filter', 'url(#drop-shadow)');

      const legend = legendBox.append('g')
        .attr('class', 'legend');

      // Total Queries legend
      legend.append('rect')
        .attr('x', 10)
        .attr('y', -5)
        .attr('width', 12)
        .attr('height', 10)
        .attr('fill', 'url(#bar-gradient)')
        .attr('rx', 1)
        .attr('ry', 1);

      // Legend text with black color for contrast on light gray
      const totalQueriesText = legend.append('text')
        .attr('x', 30)
        .attr('y', 0)
        .attr('dy', '.15em')
        .style('font-size', '12px')
        .style('font-weight', 'bold')
        .attr('fill', axisTextColor)
        .text(this.$t('charts.tooltip.totalQueries'));

      // Unique Users legend with thinner line
      legend.append('line')
        .attr('x1', 170)
        .attr('y1', 0)
        .attr('x2', 200)
        .attr('y2', 0)
        .attr('stroke', '#5b9bd5')
        .attr('stroke-width', 1.5);

      legend.append('circle')
        .attr('cx', 185)
        .attr('cy', 0)
        .attr('r', 2.5)
        .attr('fill', '#5b9bd5')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1);

      // Legend text with black color for contrast on light gray
      const uniqueUsersText = legend.append('text')
        .attr('x', 210)
        .attr('y', 0)
        .attr('dy', '.15em')
        .style('font-size', '12px')
        .style('font-weight', 'bold')
        .attr('fill', axisTextColor)
        .text(this.$t('charts.tooltip.uniqueUsers'));

      // Create enhanced tooltip div
      if (d3.select('body').select('.d3-tooltip').empty()) {
        d3.select('body')
          .append('div')
          .attr('class', 'd3-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.7)')
          .style('color', 'white')
          .style('padding', '10px')
          .style('border-radius', '5px')
          .style('font-size', '12px')
          .style('box-shadow', '0 3px 14px rgba(0,0,0,0.4)')
          .style('pointer-events', 'none')
          .style('opacity', 0)
          .style('z-index', 1000);
      }

      // Add interactive overlay with vertical guide line
      const verticalLine = mainGroup.append('line')
        .attr('class', 'vertical-line')
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', borderColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,3')
        .style('opacity', 0);

      // Add hover dots that appear on the guide line
      const hoverDotLeft = mainGroup.append('circle')
        .attr('class', 'hover-dot')
        .attr('r', 5)
        .attr('fill', 'url(#bar-gradient)')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('opacity', 0);

      const hoverDotRight = mainGroup.append('circle')
        .attr('class', 'hover-dot')
        .attr('r', 3)
        .attr('fill', '#5b9bd5')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('opacity', 0);

      mainGroup.append('rect')
        .attr('width', width)
        .attr('height', height)
        .style('fill', 'none')
        .style('pointer-events', 'all')
        .on('mouseover', () => {
          d3.select('.d3-tooltip').style('opacity', 0.9);
          verticalLine.style('opacity', 1);
          hoverDotLeft.style('opacity', 1);
          hoverDotRight.style('opacity', 1);
        })
        .on('mouseout', () => {
          d3.select('.d3-tooltip').style('opacity', 0);
          verticalLine.style('opacity', 0);
          hoverDotLeft.style('opacity', 0);
          hoverDotRight.style('opacity', 0);
        })
        .on('mousemove', (event) => {
          const mouseX = d3.pointer(event)[0];

          // Find the closest data point
          const bisect = d3.bisector(d => d.timestamp).left;
          const x0 = x.invert(mouseX);
          const i = bisect(data, x0, 1);

          if (i === 0 || i >= data.length) {
            return;
          }

          const d0 = data[i - 1];
          const d1 = data[i];
          const d = x0 - d0.timestamp > d1.timestamp - x0 ? d1 : d0;

          // Update vertical line position
          verticalLine
            .attr('x1', x(d.timestamp))
            .attr('x2', x(d.timestamp));

          // Update hover dots positions
          hoverDotLeft
            .attr('cx', x(d.timestamp))
            .attr('cy', yLeft(d.value));

          hoverDotRight
            .attr('cx', x(d.timestamp))
            .attr('cy', yRight(d.userCount));

          // Format the tooltip content
          const totalQueriesLabel = this.$t('charts.tooltip.totalQueries');
          const uniqueUsersLabel = this.$t('charts.tooltip.uniqueUsers');

          // Updated tooltip with proper contrasting colors regardless of theme
          const tooltipContent = `
        <div style="margin-bottom: 5px; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px;">
          ${d.dateLabel}
        </div>
        <div style="margin: 5px 0;">
          <span style="display: inline-block; width: 12px; height: 12px; margin-right: 5px; background: linear-gradient(to bottom, ${isDarkMode ? '#4a8bbf, #2d6fa7' : '#62d9a6, #2da676'}); border-radius: 2px; vertical-align: middle;"></span>
          ${totalQueriesLabel}: <strong>${d.value.toLocaleString(this.$i18n.locale)}</strong>
        </div>
        <div style="margin: 5px 0;">
          <span style="display: inline-block; width: 12px; height: 12px; margin-right: 5px; background: #5b9bd5; border-radius: 50%; vertical-align: middle;"></span>
          ${uniqueUsersLabel}: <strong>${d.userCount.toLocaleString(this.$i18n.locale)}</strong>
        </div>
      `;

          // Position and show the tooltip
          d3.select('.d3-tooltip')
            .html(tooltipContent)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 60) + 'px');
        });
    }
  }
};
</script>

<style scoped>
.usage-trend-chart {
  position: relative;
  width: 100%;
  height: 300px;
}

.chart-container {
  width: 100%;
  height: 100%;
  background-color: var(--bg-card, #fff);
  border-radius: 8px;
  box-shadow: var(--shadow-sm, 0 2px 15px rgba(0, 0, 0, 0.1));
  padding: 10px;
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
  background: var(--bg-card, rgba(255, 255, 255, 0.8));
  opacity: 0.9;
  z-index: 1;
  border-radius: 8px;
  color: var(--text-primary, #333);
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

.error-container,
.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--text-primary, #333);
  font-style: italic;
  font-weight: 500;
  border-radius: 8px;
}

.error-message {
  color: var(--status-outage, #d32f2f);
  font-weight: 500;
}

/* Global styles for tooltip */
:global(.d3-tooltip) {
  position: absolute;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  padding: 10px;
  border-radius: 5px;
  pointer-events: none;
  opacity: 0;
  z-index: 1000;
  max-width: 250px;
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.4);
  font-weight: bold;
}

/* Fix styles for dark mode only */
[data-theme="dark"] svg text {
  fill: white !important;
}

/* Conditional dark mode styling for chart container */
[data-theme="dark"] .chart-container {
  background-color: #414141 !important;
  /* Match the main background color */
  border-radius: 0 !important;
  /* Remove border radius */
  box-shadow: none !important;
  /* Remove box shadow */
}

/* SVG background fixes - only in dark mode */
[data-theme="dark"] :deep(svg rect:first-child) {
  fill: #414141 !important;
  /* Change the SVG background to match main background */
}

/* This specifically targets the background rect added in dark mode */
[data-theme="dark"] :deep(svg rect[fill="#bbbcbe"]) {
  fill: #414141 !important;
  /* Change to match the background */
}

/* Fix chart bar colors to be light green in both modes */
:deep(.bar) {
  fill: url(#bar-gradient) !important;
}

/* Force the gradient definitions - works in both modes */
:deep(#bar-gradient stop:first-child) {
  stop-color: #62d9a6 !important;
  /* Light green top */
}

:deep(#bar-gradient stop:last-child) {
  stop-color: #2da676 !important;
  /* Darker green bottom */
}

/* In case direct targeting is needed for the bars */
:deep(rect.bar) {
  fill: #62d9a6 !important;
  /* Fallback if gradient doesn't work */
}
</style>