<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { useT } from '../../../i18n/composables';
import { CATEGORY_PALETTE, CHART_COLORS, registerECharts } from '../../../lib/echarts';
import type { ChannelSplitItem } from '../../../services/analytics';

registerECharts();

const props = defineProps<{ data: ChannelSplitItem[] }>();

const { t } = useT();

const total = computed(() => props.data.reduce((sum, d) => sum + d.count, 0));

const option = computed(() => ({
  tooltip: {
    trigger: 'item',
    backgroundColor: '#ffffff',
    borderColor: CHART_COLORS.grid,
    textStyle: { color: CHART_COLORS.text },
    formatter: (p: { name: string; value: number; percent: number }) =>
      `${p.name}<br/><strong>${p.value.toLocaleString()}</strong> (${p.percent}%)`,
  },
  legend: {
    bottom: 0,
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: CHART_COLORS.text, fontSize: 12 },
  },
  color: CATEGORY_PALETTE,
  series: [
    {
      type: 'pie',
      radius: ['58%', '82%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#ffffff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: props.data.map((d) => ({
        name: t(`analytics.charts.channels.${d.channel}`, d.channel),
        value: d.count,
      })),
    },
  ],
}));
</script>

<template>
  <div class="relative h-72 w-full">
    <VChart :option="option" autoresize />
    <div class="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-[calc(50%+12px)] text-center">
      <p class="text-meta uppercase tracking-[0.08em] text-text-subtle">Total</p>
      <p class="mt-0.5 text-2xl font-bold tabular-nums text-text">
        {{ total.toLocaleString() }}
      </p>
    </div>
  </div>
</template>
