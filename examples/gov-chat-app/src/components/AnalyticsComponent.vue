<!-- AnalyticsComponent.vue -->
<template>
  <div class="analytics-dialog">
    <div class="overlay" @click="closeDialog"></div>
    <div class="dialog-content">
      <h2>{{ $t('analytics.title') }}</h2>
      <p class="note">{{ $t('analytics.note') }}</p>

      <div v-if="loading" class="loading-container">
        <div class="spinner"></div>
        <p>{{ $t('analytics.loading') || 'Loading analytics data...' }}</p>
      </div>
      
      <div v-else>
        <div class="section">
          <h3>{{ $t('analytics.usageStats') }}</h3>
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-value">2,345</span>
              <span class="stat-label">{{ $t('analytics.totalQueries') || 'Total Queries' }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">2.3s</span>
              <span class="stat-label">{{ $t('analytics.avgResponseTime') || 'Avg Response Time' }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">57</span>
              <span class="stat-label">{{ $t('analytics.peakUsers') || 'Peak Users' }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">12</span>
              <span class="stat-label">{{ $t('analytics.activeChats') || 'Active Chats' }}</span>
            </div>
          </div>
        </div>
  
        <div class="section">
          <h3>{{ $t('analytics.usageTrend') || 'Usage Trend' }}</h3>
          <div class="chart-placeholder">
            <p>{{ $t('analytics.chartComingSoon') || 'Interactive chart visualization coming soon...' }}</p>
          </div>
        </div>
  
        <div class="section">
          <h3>{{ $t('analytics.topQueries') || 'Top Queries' }}</h3>
          <div class="top-queries">
            <div v-for="(query, index) in topQueries" :key="index" class="query-item">
              <span class="query-rank">{{ index + 1 }}</span>
              <span class="query-text">{{ query.text }}</span>
              <span class="query-count">{{ query.count }}</span>
            </div>
          </div>
        </div>
  
        <div class="section">
          <h3>{{ $t('analytics.feedbackSamples') || 'Recent Feedback' }}</h3>
          <div class="feedback-list">
            <div v-for="(feedback, index) in recentFeedback" :key="index" class="feedback-item">
              <div class="feedback-content">
                <p>"{{ feedback.content }}"</p>
                <div class="feedback-meta">
                  <span class="feedback-user">{{ feedback.user }}</span>
                  <span class="feedback-date">{{ feedback.date }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="actions">
        <button @click="closeDialog">{{ $t('analytics.close') || 'Close' }}</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AnalyticsComponent',
  data() {
    return {
      loading: true,
      topQueries: [
        { text: 'How do I apply for a business permit?', count: 145 },
        { text: 'What are the office hours?', count: 132 },
        { text: 'How do I renew my license?', count: 117 },
        { text: 'What documents do I need for registration?', count: 89 },
        { text: 'Where is your office located?', count: 76 }
      ],
      recentFeedback: [
        { content: 'Amazing service! Got my question answered right away.', user: 'User #101', date: '2023-06-14' },
        { content: 'Needs more info on building permits, but otherwise helpful.', user: 'User #212', date: '2023-06-13' },
        { content: 'Very intuitive interface. Easy to use.', user: 'User #178', date: '2023-06-12' },
        { content: 'Response was a bit slow, but accurate information.', user: 'User #305', date: '2023-06-10' }
      ]
    }
  },
  mounted() {
    // Simulate loading
    setTimeout(() => {
      this.loading = false
    }, 1000)
  },
  methods: {
    closeDialog() {
      this.$emit('close')
    }
  }
}
</script>

<style scoped>
.analytics-dialog {
  position: fixed;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
}

/* Dark overlay behind the dialog */
.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.5);
}

.dialog-content {
  position: relative;
  background: #fff;
  width: 700px;
  max-width: 90%;
  margin: 60px auto;
  padding: 20px;
  border-radius: 8px;
  max-height: 80vh;
  overflow-y: auto;
  /* Force black text in case a global style sets color: #fff */
  color: #000 !important;
}

.note {
  margin-bottom: 16px;
  font-style: italic;
  color: #666;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #4E97D1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.section {
  margin-bottom: 24px;
}

.section h3 {
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  background: #f5f9fd;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #4E97D1;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #666;
  text-align: center;
}

.chart-placeholder {
  height: 200px;
  background: #f5f5f5;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-style: italic;
}

.top-queries {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.query-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.query-item:last-child {
  border-bottom: none;
}

.query-rank {
  background: #4E97D1;
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-right: 12px;
  flex-shrink: 0;
}

.query-text {
  flex: 1;
}

.query-count {
  background: #f0f0f0;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: #666;
}

.feedback-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feedback-item {
  background: #f5f9fd;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.feedback-content p {
  font-style: italic;
  margin-bottom: 8px;
}

.feedback-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #666;
}

.actions {
  text-align: right;
  margin-top: 20px;
}

.actions button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background: #4E97D1;
  color: #fff;
  cursor: pointer;
}

.actions button:hover {
  background: #3a7da0;
}
</style>
