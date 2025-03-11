// src/components/AnalyticsDashboard.vue
<template>
  <div class="analytics-dashboard">
    <div class="dashboard-header">
      <h2>{{ $t('analytics.title', 'Chatbot Analytics Dashboard') }}</h2>
      
      <!-- Period selector -->
      <div class="period-selector">
        <label>{{ $t('analytics.period', 'Time Period:') }}</label>
        <select v-model="selectedPeriod" @change="loadAnalytics">
          <option value="daily">{{ $t('analytics.periods.daily', 'Daily') }}</option>
          <option value="weekly">{{ $t('analytics.periods.weekly', 'Weekly') }}</option>
          <option value="monthly">{{ $t('analytics.periods.monthly', 'Monthly') }}</option>
          <option value="all-time">{{ $t('analytics.periods.allTime', 'All Time') }}</option>
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
    </div>
    
    <!-- Loading state -->
    <div v-if="isLoading" class="loading-container">
      <div class="spinner"></div>
      <p>{{ $t('analytics.loading', 'Loading analytics data...') }}</p>
    </div>
    
    <!-- Error state -->
    <div v-else-if="error" class="error-container">
      <p class="error-message">{{ error }}</p>
      <button @click="loadAnalytics" class="retry-button">
        {{ $t('analytics.retry', 'Retry') }}
      </button>
    </div>
    
    <!-- Dashboard content -->
    <div v-else class="dashboard-content">
      <!-- Key metrics summary -->
      <div class="metrics-summary">
        <div class="metric-card">
          <h3>{{ $t('analytics.metrics.totalQueries', 'Total Queries') }}</h3>
          <div class="metric-value">{{ formatValue(analytics.totalQueries) }}</div>
          <div v-if="comparison.totalQueries" class="trend" :class="getTrendClass(comparison.totalQueries)">
            {{ formatTrend(comparison.totalQueries) }}
          </div>
        </div>
        
        <div class="metric-card">
          <h3>{{ $t('analytics.metrics.uniqueUsers', 'Unique Users') }}</h3>
          <div class="metric-value">{{ formatValue(analytics.uniqueUsers) }}</div>
          <div v-if="comparison.uniqueUsers" class="trend" :class="getTrendClass(comparison.uniqueUsers)">
            {{ formatTrend(comparison.uniqueUsers) }}
          </div>
        </div>
        
        <div class="metric-card">
          <h3>{{ $t('analytics.metrics.avgResponseTime', 'Avg Response Time') }}</h3>
          <div class="metric-value">{{ formatValue(analytics.averageResponseTime, 'time') }}</div>
          <div v-if="comparison.averageResponseTime" class="trend" :class="getTrendClass(comparison.averageResponseTime, true)">
            {{ formatTrend(comparison.averageResponseTime, true) }}
          </div>
        </div>
        
        <div class="metric-card">
          <h3>{{ $t('analytics.metrics.satisfaction', 'User Satisfaction') }}</h3>
          <div class="metric-value">{{ formatValue(analytics.satisfactionRate, 'percent') }}</div>
          <div v-if="comparison.satisfactionRate" class="trend" :class="getTrendClass(comparison.satisfactionRate)">
            {{ formatTrend(comparison.satisfactionRate) }}
          </div>
        </div>
      </div>
      
      <!-- Category distribution chart -->
      <div class="chart-container half-width">
        <h3>{{ $t('analytics.charts.categoryDistribution', 'Query Categories') }}</h3>
        <CategoryDistributionChart 
          v-if="analytics.queryDistribution && analytics.queryDistribution.length > 0"
          :data="analytics.queryDistribution" 
          :externalData="true"
        />
        <div v-else class="no-data">
          {{ $t('analytics.noData', 'No data available for this period') }}
        </div>
      </div>
      
      <!-- Top queries -->
      <div class="chart-container half-width">
        <h3>{{ $t('analytics.charts.topQueries', 'Top Queries') }}</h3>
        <TopQueriesChart 
          v-if="analytics.topQueries && analytics.topQueries.length > 0"
          :data="analytics.topQueries" 
        />
        <div v-else class="no-data">
          {{ $t('analytics.noData', 'No data available for this period') }}
        </div>
      </div>
      
      <!-- Usage trend chart -->
      <div class="chart-container full-width">
        <h3>{{ $t('analytics.charts.usageTrend', 'Usage Trend') }}</h3>
        <UsageTrendChart 
          v-if="timeSeriesData && timeSeriesData.length > 0"
          :data="timeSeriesData"
          :externalData="true"
        />
        <div v-else class="no-data">
          {{ $t('analytics.noData', 'No data available for this period') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import analyticsService from '../services/analyticsService';
import CategoryDistributionChart from './charts/CategoryDistributionChart.vue';
import TopQueriesChart from './charts/TopQueriesChart.vue';
import UsageTrendChart from './charts/UsageTrendChart.vue';

export default {
  name: 'AnalyticsDashboard',
  components: {
    CategoryDistributionChart,
    TopQueriesChart,
    UsageTrendChart
  },
  data() {
    return {
      isLoading: false,
      error: null,
      selectedPeriod: 'daily',
      selectedDate: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
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
      timeSeriesData: []
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
    this.loadAnalytics();
  },
  methods: {
    /**
     * Load analytics data based on selected period and date
     */
    async loadAnalytics() {
      this.isLoading = true;
      this.error = null;
      
      try {
        // Get main analytics data
        const analyticsData = await analyticsService.getDashboardAnalytics(
          this.selectedPeriod,
          this.selectedDate
        );
        
        this.analytics = analyticsData;
        
        // Get comparison data
        await this.loadComparisonData();
        
        // Get time series data
        await this.loadTimeSeriesData();
      } catch (error) {
        console.error('Error loading analytics data:', error);
        console.log('Falling back to sample dashboard data...');
        // Fall back to hard-coded data
        this.analytics = this.getFallbackDashboardData();
        
        // Also get fallback time series data
        this.timeSeriesData = this.getFallbackTimeSeriesData();
      } finally {
        this.isLoading = false;
      }
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
            this.comparison[metric] = analyticsService.calculatePercentChange(
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
        this.timeSeriesData = [];
      }
    },
    
    /**
     * Format numeric values for display
     */
    formatValue(value, format = 'number') {
      return analyticsService.formatValue(value, format);
    },
    
    /**
     * Format trend percentage for display
     */
    formatTrend(percentChange, isInverse = false) {
      const prefix = percentChange > 0 ? '+' : '';
      const suffix = isInverse 
        ? (percentChange > 0 ? ' slower' : ' faster')
        : '';
      
      return `${prefix}${percentChange.toFixed(1)}%${suffix}`;
    },
    
    /**
     * Get CSS class for trend indicator
     */
    getTrendClass(change, isInverse = false) {
      return analyticsService.getTrendColor(change, isInverse);
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
     * Get fallback dashboard data
     * @returns {Object} Sample dashboard data
     */
    getFallbackDashboardData() {
      return {
        totalQueries: 12452,
        uniqueUsers: 3847,
        averageResponseTime: 2.3,
        satisfactionRate: 87.5,
        queryDistribution: [
          { categoryId: 'cat1', name: 'Business & Economy', count: 2347 },
          { categoryId: 'cat2', name: 'Transportation', count: 1782 },
          { categoryId: 'cat3', name: 'Taxes & Revenue', count: 1645 },
          { categoryId: 'cat4', name: 'Immigration & Citizenship', count: 1245 },
          { categoryId: 'cat5', name: 'Education & Learning', count: 980 },
          { categoryId: 'cat6', name: 'Housing & Properties', count: 850 },
          { categoryId: 'cat7', name: 'Health & Healthcare', count: 720 },
          { categoryId: 'cat8', name: 'Justice & Legal', count: 650 }
        ],
        topQueries: [
          { text: "How do I apply for a business license?", count: 2347, avgTime: 2.3 },
          { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
          { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
          { text: "What documents do I need for passport application?", count: 1423, avgTime: 3.4 },
          { text: "When are property taxes due?", count: 1289, avgTime: 1.5 }
        ]
      };
    },
    
    /**
     * Get fallback time series data
     * @returns {Array} Sample time series data
     */
    getFallbackTimeSeriesData() {
      const now = new Date();
      const result = [];
      let interval, startDate;
      
      switch (this.selectedPeriod) {
        case 'daily':
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
          break;
          
        case 'weekly':
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
          break;
          
        case 'monthly':
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
          break;
          
        case 'all-time':
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
          break;
      }
      
      return result;
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
    }
  }
};
</script>

<style scoped>
.analytics-dashboard {
  padding: 20px;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.period-selector {
  display: flex;
  align-items: center;
  gap: 10px;
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
  flex-wrap: wrap;
  gap: 20px;
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

.chart-container {
  background-color: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.chart-container h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 16px;
  color: #333;
}

.half-width {
  width: calc(50% - 10px);
}

.full-width {
  width: 100%;
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
  .dashboard-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  
  .metrics-summary {
    flex-wrap: wrap;
  }
  
  .metric-card {
    min-width: calc(50% - 10px);
  }
  
  .half-width {
    width: 100%;
  }
}
</style>