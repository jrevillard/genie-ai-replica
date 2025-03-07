<!-- AnalyticsComponent.vue - Fixed Version -->
<template>
  <div class="analytics-modal" @click.self="close">
    <div class="analytics-content">
      <div class="analytics-header">
        <h2>{{ $t('analytics.title', 'Analytics Dashboard') }}</h2>
        <button class="close-btn" @click="close" aria-label="Close">×</button>
      </div>
      
      <div class="analytics-body">
        <!-- Usage Trend Chart -->
        <usage-trend-chart />
        
        <!-- Top Queries Section -->
        <div class="analytics-section">
          <h3>{{ $t('analytics.topQueries', 'Top Queries') }}</h3>
          <div class="top-queries">
            <table>
              <thead>
                <tr>
                  <th>{{ $t('analytics.rank', 'Rank') }}</th>
                  <th>{{ $t('analytics.query', 'Query') }}</th>
                  <th>{{ $t('analytics.count', 'Count') }}</th>
                  <th>{{ $t('analytics.avgTime', 'Avg. Time') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(query, index) in topQueries" :key="index">
                  <td>{{ index + 1 }}</td>
                  <td>{{ query.text }}</td>
                  <td>{{ query.count.toLocaleString() }}</td>
                  <td>{{ query.avgTime }}s</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- Service Categories Usage -->
        <div class="analytics-section">
          <h3>{{ $t('analytics.serviceUsage', 'Service Categories Usage') }}</h3>
          <div class="category-chart-container">
            <div ref="categoryChart" class="category-usage"></div>
            <div v-if="loading" class="chart-loading">
              {{ $t('analytics.loading', 'Loading chart data...') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import UsageTrendChart from './UsageTrendChart.vue'

export default {
  name: 'AnalyticsComponent',
  components: {
    UsageTrendChart
  },
  
  emits: ['close'],
  
  data() {
    return {
      loading: true,
      chart: null,
      
      // Sample data for top queries
      topQueries: [
        { text: "How do I apply for a business license?", count: 2347, avgTime: 2.3 },
        { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
        { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
        { text: "What documents do I need for passport application?", count: 1423, avgTime: 3.4 },
        { text: "When are property taxes due?", count: 1289, avgTime: 1.5 }
      ],
      
      // Sample data for category usage
      categoryData: [
        { category: "Business & Economy", value: 24 },
        { category: "Transportation", value: 18 },
        { category: "Taxes & Revenue", value: 16 },
        { category: "Immigration & Citizenship", value: 12 },
        { category: "Education & Learning", value: 10 },
        { category: "Housing & Properties", value: 8 },
        { category: "Others", value: 12 }
      ]
    };
  },
  
  mounted() {
    this.initCategoryChart();
    window.addEventListener('resize', this.handleResize);
  },
  
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    this.disposeChart();
  },
  
  methods: {
    async initCategoryChart() {
      try {
        const echarts = await import('echarts');
        this.renderCategoryChart(echarts);
      } catch (error) {
        console.error('Failed to load chart library:', error);
        this.loading = false;
      }
    },
    
    async renderCategoryChart(echartLib = null) {
      if (!this.$refs.categoryChart) return;
      
      this.loading = true;
      
      // Use a timeout to ensure UI updates before chart rendering
      setTimeout(async () => {
        try {
          // Dispose of old chart properly before creating a new one
          this.disposeChart();
          
          // Load echarts library if not provided
          const echarts = echartLib || await import('echarts');
          
          // Create new chart instance
          this.chart = echarts.init(this.$refs.categoryChart);
          
          // Set chart options
          const option = {
            tooltip: {
              trigger: 'item',
              formatter: '{a} <br/>{b}: {c} ({d}%)'
            },
            legend: {
              orient: 'vertical',
              right: 10,
              top: 'center',
              data: this.categoryData.map(item => item.category)
            },
            series: [
              {
                name: 'Usage',
                type: 'pie',
                radius: ['50%', '70%'],
                avoidLabelOverlap: false,
                label: {
                  show: false,
                  position: 'center'
                },
                emphasis: {
                  label: {
                    show: true,
                    fontSize: '16',
                    fontWeight: 'bold'
                  }
                },
                labelLine: {
                  show: false
                },
                data: this.categoryData.map(item => ({
                  name: item.category,
                  value: item.value
                })),
                itemStyle: {
                  borderRadius: 5,
                  borderColor: '#fff',
                  borderWidth: 2
                }
              }
            ],
            color: [
              '#5470c6', '#91cc75', '#fac858', '#ee6666',
              '#73c0de', '#3ba272', '#fc8452'
            ]
          };
          
          // Apply the chart configuration
          this.chart.setOption(option);
          
          // End loading
          this.loading = false;
        } catch (error) {
          console.error('Error rendering category chart:', error);
          this.loading = false;
        }
      }, 100);
    },
    
    disposeChart() {
      if (this.chart) {
        try {
          this.chart.dispose();
        } catch (e) {
          console.warn('Error while disposing chart:', e);
        }
        this.chart = null;
      }
    },
    
    handleResize() {
      if (this.chart) {
        try {
          this.chart.resize();
        } catch (e) {
          console.warn('Error resizing chart:', e);
          // If resize fails, try re-rendering
          this.renderCategoryChart();
        }
      }
    },
    
    close() {
      this.disposeChart();
      this.$emit('close');
    }
  }
}
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

.top-queries {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  padding: 12px;
  background: #f5f7fa;
  color: #333;
  font-weight: 600;
}

td {
  padding: 12px;
  border-top: 1px solid #eee;
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

@media (max-width: 768px) {
  .analytics-content {
    width: 95%;
    max-height: 95vh;
  }
  
  .analytics-header h2 {
    font-size: 1.3rem;
  }
}
</style>
