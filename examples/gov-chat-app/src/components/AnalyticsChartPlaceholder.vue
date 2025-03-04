<!-- src/components/AnalyticsChartPlaceholder.vue -->
<template>
  <div class="chart-placeholder">
    <h4>Example Chart Placeholder</h4>
    <div class="fake-chart">
      <div v-for="i in 5" :key="i" class="bar" :style="{ height: (i*20)+'px' }"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AnalyticsChartPlaceholder'
}
</script>

<style scoped>
.chart-placeholder {
  margin-bottom: 16px;
  padding: 12px;
  background: #f8f8f8;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.fake-chart {
  display: flex;
  align-items: flex-end;
  height: 100px;
  background: #fff;
  border: 1px solid #ccc;
  padding: 4px;
  margin-top: 8px;
}
.bar {
  width: 20px;
  background: #4e97d1;
  margin-right: 4px;
}
</style>

