// One-time ECharts module registration. Importing this file from any chart
// component activates the renderers and components below. Keep it tree-shaken
// — only register modules used by the analytics dashboard.

import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';

let registered = false;

export function registerECharts(): void {
  if (registered) return;
  use([
    CanvasRenderer,
    BarChart,
    LineChart,
    PieChart,
    GridComponent,
    LegendComponent,
    TitleComponent,
    TooltipComponent,
  ]);
  registered = true;
}

// Brand-aligned palette for chart series. Pulled from tailwind.config.cjs
// (ieee-700 primary, complementary accents). Keeping these as hex avoids
// runtime CSS-var lookups inside ECharts option builders.
export const CHART_COLORS = {
  primary: '#005280',     // ieee-700 (chat / chats)
  primarySoft: '#99c7e3', // ieee-200 (legend background, light fills)
  secondary: '#ef6c4f',   // coral — calls (per design brief: "muted coral/orange")
  tertiary: '#10b981',    // emerald-500 (whatsapp)
  accent: '#a855f7',      // violet-500 (categories #1)
  warm: '#f59e0b',        // amber-500 (categories #2)
  cool: '#0ea5e9',        // sky-500 (categories #3)
  rose: '#f43f5e',        // rose-500 (categories #4)
  text: '#475569',        // text-muted
  axis: '#94a3b8',        // text-subtle
  grid: '#e2e8f0',        // slate-200 (grid lines)
} as const;

// Categorical palette used by donuts and horizontal bars.
export const CATEGORY_PALETTE: string[] = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.tertiary,
  CHART_COLORS.accent,
  CHART_COLORS.warm,
  CHART_COLORS.cool,
  CHART_COLORS.rose,
  '#64748b', // slate-500
  '#0d9488', // teal-600
  '#d946ef', // fuchsia-500
];
