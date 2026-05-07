<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import VChart from 'vue-echarts';
import { CHART_COLORS, registerECharts } from '../../../lib/echarts';
import { formatHourLabel } from '../../../lib/analytics';
import type { HourlyDistributionPoint } from '../../../services/analytics';

registerECharts();

const props = defineProps<{ data: HourlyDistributionPoint[] }>();

const { locale } = useI18n();

const peakHour = computed(() => {
  let max = -1;
  let peak = 0;
  for (const p of props.data) {
    if (p.count > max) {
      max = p.count;
      peak = p.hour;
    }
  }
  return peak;
});

const option = computed(() => {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  // Sparse labels every 3 hours so the axis stays legible.
  const labels = hours.map((h) => (h % 3 === 0 ? formatHourLabel(h, locale.value) : ''));
  const counts = hours.map((h) => {
    const found = props.data.find((p) => p.hour === h);
    return found ? found.count : 0;
  });
  return {
    grid: { left: 32, right: 16, top: 24, bottom: 32, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#ffffff',
      borderColor: CHART_COLORS.grid,
      textStyle: { color: CHART_COLORS.text },
      formatter: (items: Array<{ dataIndex: number; value: number }>) => {
        const i = items[0]?.dataIndex ?? 0;
        return `${formatHourLabel(i, locale.value)}<br/><strong>${items[0]?.value ?? 0}</strong>`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
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
        barMaxWidth: 24,
        data: counts.map((value, i) => ({
          value,
          itemStyle: {
            color: i === peakHour.value ? CHART_COLORS.secondary : CHART_COLORS.primary,
            borderRadius: [4, 4, 0, 0],
          },
        })),
      },
    ],
  };
});
</script>

<template>
  <div class="h-64 w-full">
    <VChart :option="option" autoresize />
  </div>
</template>
