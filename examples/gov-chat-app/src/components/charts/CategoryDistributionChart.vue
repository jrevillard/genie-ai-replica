<template>
  <div class="chart-wrapper">
    <div ref="chart" class="chart-container"></div>
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <span>{{ $t('analytics.status.loading') }}</span>
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
    },
    // Watch for renderKey (locale) changes to force complete re-render
    renderKey: {
      handler() {
        // First clean up old tooltips
        d3.selectAll('.d3-tooltip').remove();
        
        // Then reload category names with new locale
        this.loadCategoryNames().then(() => {
          if (this.chartData && this.chartData.length > 0) {
            // Force complete recreation of chart
            d3.select(this.$refs.chart).selectAll('*').remove();
            this.renderChart();
          }
        });
      }
    }
  },
  mounted() {
    // Load category names first
    this.loadCategoryNames().then(() => {
      // Set up chart dimensions
      this.initChartDimensions();
      
      // Use data from props or fetch from API
      if (this.externalData && this.data.length > 0) {
        this.chartData = this.data;
        this.renderChart();
      } else if (!this.externalData) {
        this.fetchData();
      }
    });
    
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
        
        // Get current locale from i18n and ensure it's passed to the service
        const locale = this.$i18n.locale;
        console.log(`[DEBUG] fetchData: Current locale is "${locale}"`);
        
        // Make sure analyticsService has the locale information
        if (!analyticsService.$i18n) {
          console.log(`[DEBUG] Setting i18n instance on analyticsService`);
          analyticsService.$i18n = this.$i18n;
        }
        
        // Fetch dashboard analytics with explicit locale
        const dashboardData = await analyticsService.getDashboardAnalytics(
          this.period, 
          this.selectedDate
        );
        
        if (dashboardData && dashboardData.queryDistribution) {
          // Debug: Log category names from API
          console.log(`[DEBUG] Category data received from API:`, 
            dashboardData.queryDistribution.map(item => ({
              id: item.categoryId,
              name: item.name,
              count: item.count
            }))
          );
          
          this.chartData = dashboardData.queryDistribution;
          this.renderChart();
          
          // Debug: Check language of received category names
          this.logCategoryLanguageInfo();
        } else {
          console.error(`[DEBUG] No queryDistribution in response`);
          this.error = this.$t('analytics.status.noData');
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
        
        // Create a lookup object for category names by ID
        categories.forEach(category => {
          // Extract the numeric ID from serviceCategories/123 (full path)
          // or just use the raw _key (which is typically just the number) 
          const id = category._key || 
                     (category._id && category._id.split('/')[1]) || 
                     category.catKey || 
                     category.categoryId;
          
          if (id) {
            // Use the appropriate translation based on current locale
            const currentLocale = this.$i18n.locale;
            
            // Use nameXX based on locale or fall back to nameEN
            let name = null;
            if (currentLocale === 'fr' && category.nameFR) {
              name = category.nameFR;
              console.log(`[DEBUG] Using French name for category ${id}: ${name}`);
            } else if (currentLocale === 'sw' && category.nameSW) {
              name = category.nameSW;
              console.log(`[DEBUG] Using Swahili name for category ${id}: ${name}`);
            } else {
              name = category.nameEN || category.name || null;
              console.log(`[DEBUG] Using default/English name for category ${id}: ${name}`);
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
        
        console.log(`[DEBUG] Loaded ${Object.keys(this.categories).length} category names for locale: ${this.$i18n.locale}`);
      } catch (error) {
        console.error('Error loading category names:', error);
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
        '1': { nameEN: 'Identity & Civil Registration', nameFR: 'Identité et état civil', nameSW: 'Utambulisho na Usajili wa Kiraia' },
        '2': { nameEN: 'Transportation', nameFR: 'Transport', nameSW: 'Usafiri' },
        '3': { nameEN: 'Taxes & Revenue', nameFR: 'Impôts et Revenus', nameSW: 'Kodi na Mapato' },
        '4': { nameEN: 'Immigration & Citizenship', nameFR: 'Immigration et Citoyenneté', nameSW: 'Uhamiaji na Uraia' },
        '5': { nameEN: 'Education & Learning', nameFR: 'Éducation et Apprentissage', nameSW: 'Elimu na Mafunzo' },
        '6': { nameEN: 'Housing & Properties', nameFR: 'Logement et Propriétés', nameSW: 'Nyumba na Mali' },
        '7': { nameEN: 'Health & Healthcare', nameFR: 'Santé et Soins Médicaux', nameSW: 'Afya na Huduma za Afya' },
        '8': { nameEN: 'Public Safety', nameFR: 'Sécurité Publique', nameSW: 'Usalama wa Umma' },
        '9': { nameEN: 'Business & Economy', nameFR: 'Entreprise et Économie', nameSW: 'Biashara na Uchumi' },
        '10': { nameEN: 'Social Services', nameFR: 'Services Sociaux', nameSW: 'Huduma za Kijamii' },
        '11': { nameEN: 'Environment', nameFR: 'Environnement', nameSW: 'Mazingira' },
        '12': { nameEN: 'Culture & Recreation', nameFR: 'Culture et Loisirs', nameSW: 'Utamaduni na Burudani' },
        '13': { nameEN: 'Legal Services', nameFR: 'Services Juridiques', nameSW: 'Huduma za Kisheria' }
      };
      
      // Determine the current locale
      const currentLocale = this.$i18n.locale;
      console.log(`[DEBUG] Using fallback categories for locale: ${currentLocale}`);
      
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
      let idDisplay = categoryId;
      if (categoryId.includes('/')) {
        idDisplay = categoryId.split('/').pop();
      } else {
        idDisplay = categoryId.replace(/^(serviceCategorie|cat)/i, '');
      }
      
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
      // Get current locale
      const currentLocale = this.$i18n.locale;
      
      // Define multi-language names
      const categoryNames = {
        'cat1': {
          en: 'Identity & Civil Registry',
          fr: 'Identité et Registre Civil',
          sw: 'Utambulisho na Usajili wa Kiraia'
        },
        'cat2': {
          en: 'Healthcare & Social Services',
          fr: 'Santé et Services Sociaux',
          sw: 'Huduma za Afya na Jamii'
        },
        'cat3': {
          en: 'Education & Learning',
          fr: 'Éducation et Apprentissage',
          sw: 'Elimu na Mafunzo'
        },
        'cat4': {
          en: 'Employment & Labor Services',
          fr: 'Emploi et Services du Travail',
          sw: 'Ajira na Huduma za Kazi'
        },
        'cat5': {
          en: 'Taxes & Revenue',
          fr: 'Impôts et Revenus',
          sw: 'Kodi na Mapato'
        },
        'cat6': {
          en: 'Public Safety & Justice',
          fr: 'Sécurité Publique et Justice',
          sw: 'Usalama wa Umma na Haki'
        },
        'cat7': {
          en: 'Transportation & Mobility',
          fr: 'Transport et Mobilité',
          sw: 'Usafiri na Uhamaji'
        },
        'cat8': {
          en: 'Housing & Urban Development',
          fr: 'Logement et Développement Urbain',
          sw: 'Nyumba na Maendeleo ya Miji'
        }
      };
      
      // Select language based on locale
      const lang = currentLocale === 'fr' ? 'fr' : 
                  (currentLocale === 'sw' ? 'sw' : 'en');
      
      console.log(`[DEBUG] Using fallback data with language: ${lang}`);
      
      // Create fallback data with appropriate language
      return [
        { categoryId: 'cat1', name: categoryNames.cat1[lang], count: 2347, value: 23 },
        { categoryId: 'cat2', name: categoryNames.cat2[lang], count: 1782, value: 17 },
        { categoryId: 'cat3', name: categoryNames.cat3[lang], count: 1645, value: 16 },
        { categoryId: 'cat4', name: categoryNames.cat4[lang], count: 1245, value: 12 },
        { categoryId: 'cat5', name: categoryNames.cat5[lang], count: 980, value: 10 },
        { categoryId: 'cat6', name: categoryNames.cat6[lang], count: 850, value: 8 },
        { categoryId: 'cat7', name: categoryNames.cat7[lang], count: 720, value: 7 },
        { categoryId: 'cat8', name: categoryNames.cat8[lang], count: 650, value: 6 }
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
     * Analyze if category names are in the correct language
     * Helps debug if the API is returning names in the wrong language
     */
    logCategoryLanguageInfo() {
      if (!this.chartData || !this.chartData.length) {
        console.log('[DEBUG] No chart data available to check language');
        return;
      }
      
      const locale = this.$i18n.locale;
      console.log(`[DEBUG] Analyzing category names for locale: "${locale}"`);
      
      // Simple word patterns to detect language
      const patterns = {
        en: ['and', 'of', 'services', 'identity', 'civil', 'education', 'business'],
        sw: ['na', 'ya', 'huduma', 'utambulisho', 'elimu', 'biashara'],
        fr: ['et', 'de', 'services', 'identité', 'civil', 'éducation']
      };
      
      let matchCount = 0;
      let totalWithNames = 0;
      
      this.chartData.forEach(cat => {
        if (!cat.name) {
          console.log(`[DEBUG] Missing name for category: ${cat.categoryId}`);
          return;
        }
        
        totalWithNames++;
        
        // Check each language
        const results = {};
        Object.entries(patterns).forEach(([lang, words]) => {
          const nameLower = cat.name.toLowerCase();
          const matches = words.filter(word => nameLower.includes(word.toLowerCase()));
          results[lang] = matches.length;
        });
        
        // Determine likely language
        let likelyLang = 'unknown';
        let highestCount = 0;
        
        Object.entries(results).forEach(([lang, count]) => {
          if (count > highestCount) {
            highestCount = count;
            likelyLang = lang;
          }
        });
        
        const isMatch = likelyLang === locale;
        if (isMatch) {
          matchCount++;
        }
        
        console.log(`[DEBUG] Category "${cat.categoryId}" name: "${cat.name}" - likely language: ${likelyLang} (match with current locale: ${isMatch ? 'YES' : 'NO'})`);
      });
      
      // Summary statistics
      if (totalWithNames > 0) {
        const matchPercent = Math.round((matchCount / totalWithNames) * 100);
        console.log(`[DEBUG] Language match summary: ${matchCount}/${totalWithNames} (${matchPercent}%) names match current locale "${locale}"`);
      }
    },
    
    /**
     * Render the pie chart
     */
    renderChart() {
      if (!this.chartData || this.chartData.length === 0 || !this.$refs.chart) return;
      
      console.log(`[DEBUG] Rendering chart with locale: ${this.$i18n.locale}`);
      
      // Clear previous chart
      d3.select(this.$refs.chart).selectAll('*').remove();
      
      // CRITICAL FIX: Process the data and ensure we prioritize names from the API directly
      const chartData = this.chartData.map(item => {
        // Ensure the value property exists and is a valid number
        const value = Number(item.value) || Number(item.count) || 1;
        
        // CRITICAL FIX: Prioritize the name directly from the API response
        // instead of trying to translate or look up from categories
        let displayName = '';
        
        if (item.name && item.name !== item.categoryId && !item.name.startsWith('Category ')) {
          // Use the name directly from the API which should already be in the correct language
          displayName = item.name;
          console.log(`[DEBUG] Using API-provided name: "${displayName}" for ${item.categoryId}`);
        } 
        // Only fall back to category lookup if API didn't provide a usable name
        else {
          displayName = this.getCategoryDisplayName(item.categoryId);
          console.log(`[DEBUG] Using looked-up name: "${displayName}" for ${item.categoryId}`);
        }
        
        return {
          categoryId: item.categoryId,
          categoryName: displayName,
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
        .text(this.$t('analytics.chartLabels.serviceCategories'));
      
      centerText.append('text')
        .attr('y', 10)
        .style('font-size', '12px')
        .text(this.$t('analytics.chartLabels.byUsage'));
      
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
        .text(this.$t('analytics.chartLabels.categories'));
      
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
      
      // CRITICAL FIX: Add category names using the direct API-provided names
      legendItems.append('text')
        .attr('x', 20)
        .attr('y', 12)
        .style('font-size', '12px')
        .text(d => {
          // Calculate percentage for display
          const percent = Math.round((d.value / total) * 100);
          
          // Log the category name being used in the legend
          console.log(`[DEBUG] Legend showing for ${d.categoryId}: "${d.categoryName}"`);
          
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
      
      // CRITICAL FIX: Update tooltip to use direct API-provided names
      slices.on('mouseover', (event, d) => {
        tooltip.transition()
          .duration(200)
          .style('opacity', 0.9);
        
        const percent = Math.round((d.data.value / total) * 100);
        
        // Log the tooltip content for debugging
        console.log(`[DEBUG] Tooltip showing for ${d.data.categoryId}: "${d.data.categoryName}"`);
        
        tooltip.html(`
          <div><strong>${d.data.categoryName}</strong></div>
          <div>${this.$t('analytics.table.count')}: ${d.data.count ? d.data.count.toLocaleString() : 'N/A'}</div>
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