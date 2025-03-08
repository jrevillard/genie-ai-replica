// src/components/charts/CategoryDistributionChart.vue
<template>
  <div class="chart-wrapper">
    <div ref="chart" class="chart-container"></div>
  </div>
</template>

<script>
import { serviceTreeService } from '../../services';
import * as d3 from 'd3';

export default {
  name: 'CategoryDistributionChart',
  props: {
    data: {
      type: Array,
      required: true
    }
  },
  data() {
    return {
      categories: {},
      chart: null,
      width: 0,
      height: 0
    };
  },
  watch: {
    data: {
      handler() {
        this.renderChart();
      },
      deep: true
    }
  },
  async mounted() {
    // Load category names first
    await this.loadCategoryNames();
    
    // Set up chart dimensions
    this.initChartDimensions();
    
    // Create the chart
    this.renderChart();
    
    // Add resize listener
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
  },
  methods: {
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
        // Use fallback approach
        this.data.forEach(item => {
          this.categories[item.categoryId] = this.getCategoryName(item.categoryId);
        });
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
     * Render the pie chart
     */
    renderChart() {
      if (!this.data || this.data.length === 0 || !this.$refs.chart) return;
      
      // Clear previous chart
      d3.select(this.$refs.chart).selectAll('*').remove();
      
      // Prepare the data
      const chartData = this.data.map(item => ({
        categoryId: item.categoryId,
        categoryName: this.categories[item.categoryId] || this.formatCategoryId(item.categoryId),
        count: item.count
      }));
      
      // Set up chart dimensions
      const width = this.width;
      const height = this.height;
      const radius = Math.min(width, height) / 2;
      
      // Create SVG
      const svg = d3.select(this.$refs.chart)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);
      
      // Set up color scale
      const colorScale = d3.scaleOrdinal()
        .domain(chartData.map(d => d.categoryId))
        .range(d3.schemeCategory10);
      
      // Create pie layout
      const pie = d3.pie()
        .value(d => d.count)
        .sort(null);
      
      // Create arc generator
      const arc = d3.arc()
        .innerRadius(0)
        .outerRadius(radius * 0.8);
      
      // Create outer arc for labels
      const outerArc = d3.arc()
        .innerRadius(radius * 0.9)
        .outerRadius(radius * 0.9);
      
      // Create pie slices
      const slices = svg.selectAll('path')
        .data(pie(chartData))
        .enter()
        .append('path')
        .attr('d', arc)
        .attr('fill', d => colorScale(d.data.categoryId))
        .attr('stroke', 'white')
        .style('stroke-width', '2px')
        .style('opacity', 0.7)
        .on('mouseover', function() {
          d3.select(this)
            .style('opacity', 1);
        })
        .on('mouseout', function() {
          d3.select(this)
            .style('opacity', 0.7);
        });
      
      // Add labels
      const labels = svg.selectAll('text')
        .data(pie(chartData))
        .enter()
        .append('text')
        .attr('transform', d => {
          const pos = outerArc.centroid(d);
          const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
          pos[0] = radius * 0.95 * (midAngle < Math.PI ? 1 : -1);
          return `translate(${pos})`;
        })
        .style('text-anchor', d => {
          const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
          return midAngle < Math.PI ? 'start' : 'end';
        })
        .style('font-size', '12px')
        .style('font-family', 'sans-serif')
        .text(d => {
          // Show percentage and category name
          const percent = Math.round((d.data.count / d3.sum(chartData, d => d.count)) * 100);
          if (percent < 3) return ''; // Skip tiny slices
          
          // Truncate long names
          let name = d.data.categoryName;
          if (name.length > 15) {
            name = name.substring(0, 12) + '...';
          }
          
          return `${name} (${percent}%)`;
        });
      
      // Add polylines to connect slices to labels
      svg.selectAll('polyline')
        .data(pie(chartData))
        .enter()
        .append('polyline')
        .attr('points', d => {
          const pos = outerArc.centroid(d);
          const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
          pos[0] = radius * 0.95 * (midAngle < Math.PI ? 1 : -1);
          return [arc.centroid(d), outerArc.centroid(d), pos];
        })
        .style('fill', 'none')
        .style('stroke', '#999')
        .style('stroke-width', '1px')
        .style('opacity', d => {
          // Hide lines for tiny slices
          const percent = (d.data.count / d3.sum(chartData, d => d.count)) * 100;
          return percent < 3 ? 0 : 0.5;
        });
      
      // Add title
      svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', -height / 2 + 20)
        .style('font-size', '16px')
        .style('font-weight', 'bold')
        .text('Query Distribution by Category');
    }
  }
};
</script>

<style scoped>
.chart-wrapper {
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.chart-container {
  width: 100%;
  height: 100%;
}
</style>
