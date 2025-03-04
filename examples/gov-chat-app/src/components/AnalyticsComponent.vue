<!-- src/components/AnalyticsComponent.vue -->
<template>
  <div class="analytics-dialog">
    <div class="overlay" @click="closeDialog"></div>
    <div class="dialog-content">
      <h2>{{ $t('analytics.title') }}</h2>
      <p class="note">{{ $t('analytics.note') }}</p>

      <div class="section">
        <h3>{{ $t('analytics.usageStats') }}</h3>
        <ul>
          <li>Total Queries: 2,345</li>
          <li>Average Response Time: 2.3s</li>
          <li>Peak Concurrent Users: 57</li>
        </ul>
      </div>

      <div class="section">
        <h3>{{ $t('analytics.feedbackSamples') }}</h3>
        <ul>
          <li>"Amazing service!" - User #101</li>
          <li>"Needs more info on building permits" - User #212</li>
        </ul>
      </div>

      <analytics-chart-placeholder />

      <div class="actions">
        <button @click="closeDialog">{{ $t('analytics.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script>
import AnalyticsChartPlaceholder from './AnalyticsChartPlaceholder.vue'

export default {
  name: 'AnalyticsComponent',
  components: { AnalyticsChartPlaceholder },
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
  width: 100%; height: 100%;
  z-index: 9999;
}
.overlay {
  position: absolute;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.5);
}
.dialog-content {
  position: relative;
  background: #fff;
  width: 600px;
  max-width: 90%;
  margin: 60px auto;
  padding: 20px;
  border-radius: 8px;
}
.note {
  margin-bottom: 16px;
}
.section {
  margin-bottom: 16px;
}
.actions {
  text-align: right;
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

