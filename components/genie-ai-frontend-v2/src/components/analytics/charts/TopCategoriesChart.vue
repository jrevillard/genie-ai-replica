<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { CATEGORY_PALETTE, CHART_COLORS, registerECharts } from '../../../lib/echarts';
import type { TopCategoryItem } from '../../../services/analytics';

registerECharts();

const props = defineProps<{ data: TopCategoryItem[] }>();

const option = computed(() => {
  // Backend returns sorted desc; ECharts horizontal bars render bottom→top, so
  // reverse before plotting to get visual top-to-bottom ordering.
  const ordered = [...props.data].reverse();
  const total = ordered.reduce((sum, d) => sum + d.count, 0) || 1;
  return {
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#ffffff',
      borderColor: CHART_COLORS.grid,
      textStyle: { color: CHART_COLORS.text },
    },
    xAxis: {
      type: 'value',
      show: false,
      minInterval: 1,
    },
    yAxis: {
      type: 'category',
      data: ordered.map((d) => d.category),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: CHART_COLORS.text, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        barWidth: 10,
        itemStyle: { borderRadius: [6, 6, 6, 6] },
        label: {
          show: true,
          position: 'right',
          color: CHART_COLORS.text,
          fontWeight: 600,
          formatter: (p: { value: number }) =>
            `${p.value.toLocaleString()}  (${Math.round((p.value / total) * 100)}%)`,
        },
        data: ordered.map((d, i) => ({
          value: d.count,
          itemStyle: { color: CATEGORY_PALETTE[(ordered.length - 1 - i) % CATEGORY_PALETTE.length] },
        })),
      },
    ],
  };
});
</script>

<template>
  <div class="w-full" :style="{ height: `${Math.max(200, data.length * 44)}px` }">
    <VChart :option="option" autoresize />
  </div>
</template>
