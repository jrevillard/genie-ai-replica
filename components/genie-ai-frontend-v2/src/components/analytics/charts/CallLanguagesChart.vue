<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { CATEGORY_PALETTE, CHART_COLORS, registerECharts } from '../../../lib/echarts';
import { CHAT_LANGS } from '../../../lib/chatStrings';
import type { CallLanguageItem } from '../../../services/analytics';

const LANG_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(
  CHAT_LANGS.map((opt) => [opt.code, opt.label])
);

registerECharts();

const props = defineProps<{ data: CallLanguageItem[] }>();

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
        name: humanizeLang(d.language),
        value: d.count,
      })),
    },
  ],
}));

function humanizeLang(code: string): string {
  return LANG_LABEL_BY_CODE[code] ?? code.toUpperCase();
}
</script>

<template>
  <div class="h-72 w-full">
    <VChart :option="option" autoresize />
  </div>
</template>
