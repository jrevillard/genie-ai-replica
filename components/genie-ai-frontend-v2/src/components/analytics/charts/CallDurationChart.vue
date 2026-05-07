<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { CHART_COLORS, registerECharts } from '../../../lib/echarts';
import type { CallDurationDistribution } from '../../../services/analytics';

registerECharts();

const props = defineProps<{ data: CallDurationDistribution[] }>();

const BUCKET_LABEL: Record<string, string> = {
  '<1min': '< 1 min',
  '1-5min': '1–5 min',
  '5-15min': '5–15 min',
  '15+min': '15+ min',
};

const option = computed(() => ({
  grid: { left: 32, right: 16, top: 24, bottom: 32, containLabel: true },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    backgroundColor: '#ffffff',
    borderColor: CHART_COLORS.grid,
    textStyle: { color: CHART_COLORS.text },
  },
  xAxis: {
    type: 'category',
    data: props.data.map((d) => BUCKET_LABEL[d.bucket] ?? d.bucket),
    axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    axisLabel: { color: CHART_COLORS.axis, fontSize: 11 },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    axisLine: { show: false },
    axisLabel: { color: CHART_COLORS.axis, fontSize: 11 },
    splitLine: { lineStyle: { color: CHART_COLORS.grid, type: 'dashed' } },
  },
  series: [
    {
      type: 'bar',
      barMaxWidth: 56,
      itemStyle: { color: CHART_COLORS.secondary, borderRadius: [6, 6, 0, 0] },
      data: props.data.map((d) => d.count),
    },
  ],
}));
</script>

<template>
  <div class="h-64 w-full">
    <VChart :option="option" autoresize />
  </div>
</template>
