<!-- UnifiedAnalytics.vue - Fixed version -->
<template>
  <div class="analytics-modal" @click.self="close">
    <div class="analytics-content" :key="'analytics-content-' + currentLocale">
      <div class="analytics-header">
        <h2>{{ translate('analytics.title') }}</h2>
        <button class="close-btn" @click="close" aria-label="Close">×</button>
      </div>
      
      <div class="analytics-body">
        <!-- Period selector (for dynamic mode) -->
        <div v-if="useDynamicData" class="period-selector">
          <label>{{ translate('analytics.period') }}</label>
          <select v-model="selectedPeriod" @change="loadAnalytics">
            <option value="daily">{{ translate('analytics.periods.daily') }}</option>
            <option value="weekly">{{ translate('analytics.periods.weekly') }}</option>
            <option value="monthly">{{ translate('analytics.periods.monthly') }}</option>
            <option value="all-time">{{ translate('analytics.periods.allTime') }}</option>
          </select>
          
          <!-- Date picker (hidden for all-time) -->
          <div v-if="selectedPeriod !== 'all-time'" class="date-picker">
            <input 
              type="date" 
              v-model="selectedDate" 
              @change="loadAnalytics"
              :max="todayStr"
            />
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="isLoading" class="loading-container">
          <div class="spinner"></div>
          <p>{{ translate('analytics.loading') }}</p>
        </div>
        
        <!-- Error state -->
        <div v-else-if="error" class="error-container">
          <p class="error-message">{{ error }}</p>
          <button @click="loadAnalytics" class="retry-button">
            {{ translate('analytics.retry') }}
          </button>
        </div>
        
        <!-- Dashboard content -->
        <div v-else class="dashboard-content">
          <!-- Usage Trend Chart -->
          <div class="analytics-section">
            <usage-trend-chart 
              ref="usageTrendChart" 
              :data="timeSeriesData"
              :externalData="true"
              :showPeriodSelector="true"
              :showDualChart="true"
              @period-change="onPeriodChange"
            />
          </div>
          
          <!-- Key metrics summary -->
          <div class="metrics-summary">
            <div class="metric-card">
              <h3>{{ translate('analytics.metrics.totalQueries') }}</h3>
              <div class="metric-value">{{ formatValue(analytics.totalQueries) }}</div>
              <div v-if="comparison.totalQueries" class="trend" :class="getTrendClass(comparison.totalQueries)">
                {{ formatTrend(comparison.totalQueries) }}
              </div>
            </div>
            
            <div class="metric-card">
              <h3>{{ translate('analytics.metrics.uniqueUsers') }}</h3>
              <div class="metric-value">{{ formatValue(analytics.uniqueUsers) }}</div>
              <div v-if="comparison.uniqueUsers" class="trend" :class="getTrendClass(comparison.uniqueUsers)">
                {{ formatTrend(comparison.uniqueUsers) }}
              </div>
            </div>
            
            <div class="metric-card">
              <h3>{{ translate('analytics.metrics.avgResponseTime') }}</h3>
              <div class="metric-value">{{ formatValue(analytics.averageResponseTime, 'time') }}</div>
              <div v-if="comparison.averageResponseTime" class="trend" :class="getTrendClass(comparison.averageResponseTime, true)">
                {{ formatTrend(comparison.averageResponseTime, true) }}
              </div>
            </div>
            
            <div class="metric-card">
              <h3>{{ translate('analytics.metrics.satisfaction') }}</h3>
              <div class="metric-value">{{ formatValue(analytics.satisfactionRate, 'percent') }}</div>
              <div v-if="comparison.satisfactionRate" class="trend" :class="getTrendClass(comparison.satisfactionRate)">
                {{ formatTrend(comparison.satisfactionRate) }}
              </div>
            </div>
          </div>
          
          <div class="charts-container">
            <!-- Top Queries Section -->
            <div class="analytics-section half-width">
              <h3>{{ translate('analytics.topQueries') }}</h3>
              <top-queries-chart 
                v-if="analytics.topQueries && analytics.topQueries.length > 0"
                :data="analytics.topQueries"
                :externalData="true"
              />
              <div v-else class="no-data">
                {{ translate('analytics.noData') }}
              </div>
            </div>
            
            <!-- Service Categories Usage -->
            <div class="analytics-section half-width">
              <h3>{{ translate('analytics.serviceUsage') }}</h3>
              <category-distribution-chart 
                v-if="analytics.queryDistribution && analytics.queryDistribution.length > 0"
                :data="analytics.queryDistribution"
                :externalData="true"
              />
              <div v-else class="category-chart-container">
                <div v-if="categoryLoading" class="chart-loading">
                  {{ translate('analytics.loading') }}
                </div>
                <div v-else class="no-data">
                  {{ translate('analytics.noData') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import UsageTrendChart from './charts/UsageTrendChart.vue';
import TopQueriesChart from './charts/TopQueriesChart.vue';
import CategoryDistributionChart from './charts/CategoryDistributionChart.vue';
import analyticsService from '../services/analyticsService';

export default {
  name: 'UnifiedAnalytics',
  components: {
    UsageTrendChart,
    TopQueriesChart,
    CategoryDistributionChart
  },
  
  emits: ['close'],
  
  data() {
    return {
      // CONFIGURE HERE: Set to false for static sample data, true for API calls
      useDynamicData: true,  // false = static data, true = dynamic data
      
      isLoading: false,
      categoryLoading: false,
      error: null,
      selectedPeriod: 'monthly',
      selectedDate: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
      currentLocale: this.$i18n ? this.$i18n.locale : 'en',
      
      // Analytics data
      analytics: {
        totalQueries: 0,
        uniqueUsers: 0,
        averageResponseTime: 0,
        satisfactionRate: 0,
        queryDistribution: [],
        topQueries: []
      },
      comparison: {
        totalQueries: null,
        uniqueUsers: null,
        averageResponseTime: null,
        satisfactionRate: null
      },
      timeSeriesData: [],
      
      // Translation data
      translatedTopQueries: [],
      translatedCategories: [],
      
      // Static sample data for non-dynamic mode
      staticData: {
        totalQueries: 12452,
        uniqueUsers: 3847,
        averageResponseTime: 2.3,
        satisfactionRate: 87.5,
        queryDistribution: [
          { categoryId: 'cat1', name: 'Business & Economy', count: 2347, value: 24 },
          { categoryId: 'cat2', name: 'Transportation', count: 1782, value: 18 },
          { categoryId: 'cat3', name: 'Taxes & Revenue', count: 1645, value: 16 },
          { categoryId: 'cat4', name: 'Immigration & Citizenship', count: 1245, value: 12 },
          { categoryId: 'cat5', name: 'Education & Learning', count: 980, value: 10 },
          { categoryId: 'cat6', name: 'Housing & Properties', count: 850, value: 8 },
          { categoryId: 'cat7', name: 'Health & Healthcare', count: 720, value: 6 },
          { categoryId: 'cat8', name: 'Others', count: 650, value: 6 }
        ],
        topQueries: []
      }
    };
  },
  
  computed: {
    /**
     * Today's date in YYYY-MM-DD format
     */
    todayStr() {
      return new Date().toISOString().split('T')[0];
    }
  },
  
  created() {
    // Initialize translations
    this.translateQueries();
    this.translateCategories();
    
    // Initialize static top queries with translated queries
    this.staticData.topQueries = [...this.translatedTopQueries];
    
    if (this.useDynamicData) {
      this.loadAnalytics();
    } else {
      this.loadStaticData();
    }
    
    // Listen for locale changes
    if (this.$i18n) {
      this.currentLocale = this.$i18n.locale;
      this.$watch('$i18n.locale', (newLocale) => {
        this.currentLocale = newLocale;
        console.log('Locale changed in UnifiedAnalytics:', newLocale);
        this.translateQueries();
        this.translateCategories();
        
        // Also tell the usage chart to update
        if (this.$refs.usageTrendChart) {
          this.$refs.usageTrendChart.updateTranslations();
        }
      });
    }
  },
  
  mounted() {
    // Add resize listener
    window.addEventListener('resize', this.handleResize);
    console.log('UnifiedAnalytics mounted with locale:', this.currentLocale);
  },
  
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
  },
  
  methods: {
    /**
     * Custom translation method to ensure correct locale is used
     */
    translate(key, fallback = '') {
      if (!this.$i18n) return fallback;
      
      try {
        // Force the correct locale
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error('Translation error:', e);
        return fallback || key;
      }
    },
    
    /**
     * Handle period change from usage trend chart
     */
    onPeriodChange(period) {
      this.selectedPeriod = period;
      if (this.useDynamicData) {
        this.loadAnalytics();
      }
    },
    
    /**
     * Translate top queries based on current locale
     */
    translateQueries() {
      const sampleQueriesPerLanguage = {
        'en': [
          { text: "How do I apply for a business license?", count: 2347, avgTime: 2.3 },
          { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
          { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
          { text: "What documents do I need for passport application?", count: 1423, avgTime: 3.4 },
          { text: "When are property taxes due?", count: 1289, avgTime: 1.5 }
        ],
        'fr': [
          { text: "Comment faire une demande de licence commerciale?", count: 2347, avgTime: 2.3 },
          { text: "Où puis-je trouver des formulaires fiscaux?", count: 1982, avgTime: 1.8 },
          { text: "Comment renouveler mon permis de conduire?", count: 1645, avgTime: 2.1 },
          { text: "Quels documents me faut-il pour une demande de passeport?", count: 1423, avgTime: 3.4 },
          { text: "Quand les taxes foncières sont-elles dues?", count: 1289, avgTime: 1.5 }
        ],
        'sw': [
          { text: "Nawezaje kuomba leseni ya biashara?", count: 2347, avgTime: 2.3 },
          { text: "Naweza kupata fomu za kodi wapi?", count: 1982, avgTime: 1.8 },
          { text: "Jinsi ya kufanya upya leseni yangu ya udereva?", count: 1645, avgTime: 2.1 },
          { text: "Ni nyaraka gani ninahitaji kwa maombi ya pasipoti?", count: 1423, avgTime: 3.4 },
          { text: "Kodi za mali hulipwa lini?", count: 1289, avgTime: 1.5 }
        ]
      };
      
      // Use current locale or fall back to English
      const locale = this.currentLocale || 'en';
      this.translatedTopQueries = sampleQueriesPerLanguage[locale] || sampleQueriesPerLanguage['en'];
    },
    
    /**
     * Translate categories based on current locale
     */
    translateCategories() {
      const categoryDataPerLanguage = {
        'en': [
          { category: "Business & Economy", value: 24 },
          { category: "Transportation", value: 18 },
          { category: "Taxes & Revenue", value: 16 },
          { category: "Immigration & Citizenship", value: 12 },
          { category: "Education & Learning", value: 10 },
          { category: "Housing & Properties", value: 8 },
          { category: "Others", value: 12 }
        ],
        'fr': [
          { category: "Affaires & Économie", value: 24 },
          { category: "Transport", value: 18 },
          { category: "Impôts & Recettes", value: 16 },
          { category: "Immigration & Citoyenneté", value: 12 },
          { category: "Éducation & Apprentissage", value: 10 },
          { category: "Logement & Propriétés", value: 8 },
          { category: "Autres", value: 12 }
        ],
        'sw': [
          { category: "Biashara & Uchumi", value: 24 },
          { category: "Usafiri", value: 18 },
          { category: "Kodi & Mapato", value: 16 },
          { category: "Uhamiaji & Uraia", value: 12 },
          { category: "Elimu & Mafunzo", value: 10 },
          { category: "Makazi & Mali", value: 8 },
          { category: "Nyinginezo", value: 12 }
        ]
      };
      
      // Use current locale or fall back to English
      const locale = this.currentLocale || 'en';
      this.translatedCategories = categoryDataPerLanguage[locale] || categoryDataPerLanguage['en'];
      
      // Update static data with translated categories
      if (this.staticData.queryDistribution) {
        this.translatedCategories.forEach((item, index) => {
          if (index < this.staticData.queryDistribution.length) {
            this.staticData.queryDistribution[index].name = item.category;
          }
        });
      }
    },
    
    /**
     * Close the analytics modal
     */
    close() {
      this.$emit('close');
    },
    
    /**
     * Handle window resize
     */
    handleResize() {
      // This will trigger resizing in child components as needed
    },
    
    /**
     * Load static sample data
     */
    loadStaticData() {
      this.isLoading = true;
      
      // Simulate loading delay for consistent UX
      setTimeout(() => {
        this.analytics = { ...this.staticData };
        
        // Ensure top queries data is available
        if (!this.analytics.topQueries || this.analytics.topQueries.length === 0) {
          this.analytics.topQueries = [...this.translatedTopQueries];
        }
        
        // Generate static time series data
        this.timeSeriesData = this.getStaticTimeSeriesData();
        
        // Set some sample comparison data
        this.comparison = {
          totalQueries: 5.2,
          uniqueUsers: 3.8,
          averageResponseTime: -0.3,
          satisfactionRate: 1.2
        };
        
        this.isLoading = false;
      }, 500);
    },
    
    /**
     * Load dynamic analytics data from the API
     */
    async loadAnalytics() {
      if (!this.useDynamicData) {
        this.loadStaticData();
        return;
      }
      
      this.isLoading = true;
      this.error = null;
      
      try {
        // Get main analytics data
        const analyticsData = await analyticsService.getDashboardAnalytics(
          this.selectedPeriod,
          this.selectedDate
        );
        
        this.analytics = analyticsData;
        
        // Ensure top queries data is available - if API didn't return any, use translated queries
        if (!this.analytics.topQueries || this.analytics.topQueries.length === 0) {
          this.analytics.topQueries = [...this.translatedTopQueries];
        }
        
        // Get comparison data
        await this.loadComparisonData();
        
        // Get time series data
        await this.loadTimeSeriesData();
      } catch (error) {
        console.error('Error loading analytics data:', error);
        this.error = this.translate('analytics.errors.loading', 'Failed to load analytics data. Please try again.');
        
        // Fallback to static data if API fails
        this.loadStaticData();
      } finally {
        this.isLoading = false;
      }
    },
    
    /**
     * Generate static time series data
     */
    getStaticTimeSeriesData() {
      const now = new Date();
      const result = [];
      
      // Generate data based on selected period
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
      } else {
        // Monthly data (last 30 days)
        for (let day = 29; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);
          
          // Weekend pattern (lower on weekends)
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;
          
          // Add some random variation
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
            value: value
          });
        }
      }
      
      return result;
    },
    
    /**
     * Load comparison data for trend indicators
     */
    async loadComparisonData() {
      try {
        // Calculate the previous period based on current selection
        const { previousPeriod, previousDate } = this.calculatePreviousPeriod();
        
        // Get comparison data for all key metrics
        const metrics = ['totalQueries', 'uniqueUsers', 'averageResponseTime', 'satisfactionRate'];
        
        // Process each metric one by one
        for (const metric of metrics) {
          const comparisonData = await analyticsService.getComparisonData(
            metric,
            this.selectedPeriod,
            this.selectedDate,
            previousPeriod,
            previousDate
          );
          
          // Calculate percentage change
          if (comparisonData.previous !== null && comparisonData.previous !== undefined) {
            this.comparison[metric] = this.calculatePercentChange(
              comparisonData.current,
              comparisonData.previous
            );
          } else {
            this.comparison[metric] = null;
          }
        }
      } catch (error) {
        console.error('Error loading comparison data:', error);
        // Non-critical error, continue without comparison data
        this.comparison = {
          totalQueries: null,
          uniqueUsers: null,
          averageResponseTime: null,
          satisfactionRate: null
        };
      }
    },
    
    /**
     * Load time series data for charts
     */
    async loadTimeSeriesData() {
      try {
        // Determine the appropriate interval and date range
        const { interval, startDate, endDate } = this.calculateTimeSeriesParams();
        
        this.timeSeriesData = await analyticsService.getTimeSeriesData(
          'queries',
          interval,
          startDate,
          endDate
        );
      } catch (error) {
        console.error('Error loading time series data:', error);
        this.timeSeriesData = this.getStaticTimeSeriesData();
      }
    },
    
    /**
     * Format numeric values for display
     */
    formatValue(value, format = 'number') {
      if (value === null || value === undefined) return '—';
      
      switch (format) {
        case 'number':
          return value.toLocaleString(this.currentLocale);
          
        case 'time':
          // Format as seconds with 1 decimal place
          return `${value.toFixed(1)}s`;
          
        case 'percent':
          return `${value.toFixed(1)}%`;
          
        default:
          return String(value);
      }
    },
    
    /**
     * Format trend percentage for display
     */
    formatTrend(percentChange, isInverse = false) {
      const prefix = percentChange > 0 ? '+' : '';
      const suffix = isInverse 
        ? (percentChange > 0 ? ' ' + this.translate('analytics.slower') : ' ' + this.translate('analytics.faster'))
        : '';
      
      return `${prefix}${percentChange.toFixed(1)}%${suffix}`;
    },
    
    /**
     * Get CSS class for trend indicator
     */
    getTrendClass(change, isInverse = false) {
      if (!change) return 'neutral';
      
      const isPositive = change > 0;
      
      if (isInverse) {
        return isPositive ? 'negative' : 'positive';
      }
      
      return isPositive ? 'positive' : 'negative';
    },
    
    /**
     * Calculate previous period based on current selection
     */
    calculatePreviousPeriod() {
      const currentDate = new Date(this.selectedDate);
      let previousDate, previousPeriod;
      
      switch (this.selectedPeriod) {
        case 'daily':
          // Previous day
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 1);
          previousPeriod = 'daily';
          break;
          
        case 'weekly':
          // Previous week
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 7);
          previousPeriod = 'weekly';
          break;
          
        case 'monthly':
          // Previous month
          previousDate = new Date(currentDate);
          previousDate.setMonth(currentDate.getMonth() - 1);
          previousPeriod = 'monthly';
          break;
          
        case 'all-time':
          // Compare with previous equivalent time period
          // For all-time, we'll compare with half the total time
          previousPeriod = 'all-time';
          previousDate = null; // Not needed for all-time
          break;
      }
      
      return {
        previousPeriod,
        previousDate: previousDate ? previousDate.toISOString().split('T')[0] : null
      };
    },
    
    /**
     * Calculate time series parameters based on current selection
     */
    calculateTimeSeriesParams() {
      let interval, startDate, endDate;
      
      // End date is always selected date or today
      endDate = this.selectedDate || new Date().toISOString().split('T')[0];
      
      switch (this.selectedPeriod) {
        case 'daily':
          // For daily view, show hourly data for the selected day
          interval = 'hourly';
          startDate = endDate;
          break;
          
        case 'weekly':
          // For weekly view, show daily data for the week
          interval = 'daily';
          startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 6)).toISOString().split('T')[0];
          break;
          
        case 'monthly':
          // For monthly view, show daily data for the month
          interval = 'daily';
          startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 29)).toISOString().split('T')[0];
          break;
          
        case 'all-time':
          // For all-time view, show monthly data
          interval = 'monthly';
          startDate = '2020-01-01'; // Arbitrary start date in the past
          break;
      }
      
      return { interval, startDate, endDate };
    },
    
    /**
     * Calculate percentage change between two values
     */
    calculatePercentChange(current, previous) {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / Math.abs(previous)) * 100;
    }
  }
};
</script>

<style scoped>
.analytics-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.analytics-content {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.analytics-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
}

.analytics-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.period-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
}

.period-selector select,
.period-selector input {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  min-height: 300px;
}

.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top: 4px solid #4E97D1;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-message {
  color: #d32f2f;
  margin-bottom: 20px;
}

.retry-button {
  padding: 8px 16px;
  background-color: #4E97D1;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.retry-button:hover {
  background-color: #3a7da0;
}

.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.analytics-section {
  margin-bottom: 24px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 16px;
}

.analytics-section h3 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 1.2rem;
  color: #333;
}

.metrics-summary {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: 15px;
  margin-bottom: 20px;
}

.metric-card {
  flex: 1;
  background-color: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  text-align: center;
}

.metric-card h3 {
  margin-top: 0;
  margin-bottom: 10px;
  font-size: 14px;
  color: #666;
}

.metric-value {
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 5px;
}

.trend {
  font-size: 12px;
}

.trend.positive {
  color: #4caf50;
}

.trend.negative {
  color: #f44336;
}

.trend.neutral {
  color: #757575;
}

.charts-container {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.half-width {
  flex: 1;
  min-width: calc(50% - 10px);
}

.category-chart-container {
  position: relative;
  width: 100%;
  height: 320px;
}

.category-usage {
  width: 100%;
  height: 100%;
}

.chart-loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.8);
  font-size: 1rem;
  color: #666;
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #757575;
  font-style: italic;
}

@media (max-width: 768px) {
  .analytics-content {
    width: 95%;
    max-height: 95vh;
  }
  
  .analytics-header h2 {
    font-size: 1.3rem;
  }
  
  .charts-container {
    flex-direction: column;
  }
  
  .half-width {
    width: 100%;
  }
  
  .metrics-summary {
    flex-wrap: wrap;
  }
  
  .metric-card {
    min-width: calc(50% - 10px);
  }
}
</style>
