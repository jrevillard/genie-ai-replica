<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { useT } from '../../../i18n/composables';
import { CHART_COLORS, registerECharts } from '../../../lib/echarts';
import type { ActivityByDayPoint } from '../../../services/analytics';

registerECharts();

const props = defineProps<{ data: ActivityByDayPoint[] }>();

const { t } = useT();

const option = computed(() => {
  const days = props.data.map((p) => p.day);
  // Friendly axis label: "Apr 5".
  const axisLabels = days.map((d) => {
    const date = new Date(`${d}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? d
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
  return {
    grid: { left: 32, right: 16, top: 32, bottom: 32, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      backgroundColor: '#ffffff',
      borderColor: CHART_COLORS.grid,
      textStyle: { color: CHART_COLORS.text },
    },
    legend: {
      top: 0,
      right: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: CHART_COLORS.text, fontSize: 12 },
    },
    xAxis: {
      type: 'category',
      data: axisLabels,
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
        name: t('analytics.charts.legendChat', 'Chat Sessions'),
        type: 'line',
        smooth: true,
        symbolSize: 6,
        showSymbol: false,
        itemStyle: { color: CHART_COLORS.primary },
        lineStyle: { color: CHART_COLORS.primary, width: 2 },
        areaStyle: { color: 'rgba(0, 82, 128, 0.08)' },
        data: props.data.map((p) => p.chatSessions),
      },
      {
        name: t('analytics.charts.legendCall', 'Calls'),
        type: 'line',
        smooth: true,
        symbolSize: 6,
        showSymbol: false,
        itemStyle: { color: CHART_COLORS.secondary },
        lineStyle: { color: CHART_COLORS.secondary, width: 2 },
        areaStyle: { color: 'rgba(239, 108, 79, 0.08)' },
        data: props.data.map((p) => p.calls),
      },
    ],
  };
});
</script>

<template>
  <div class="h-72 w-full">
    <VChart :option="option" autoresize />
  </div>
</template>
