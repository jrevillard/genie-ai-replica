<script setup lang="ts">
import { ChartHistogramIcon } from '@hugeicons/core-free-icons';
import BaseBadge from '../components/ui/BaseBadge.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';

interface MetricCard {
  label: string;
  value: string;
}

const metrics: MetricCard[] = [
  { label: 'Total Chats', value: '—' },
  { label: 'Total Calls', value: '—' },
  { label: 'Avg. Duration', value: '—' },
];
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-headline text-text">Statistics</h1>
          <p class="mt-1 text-body text-text-muted">
            Usage, engagement, and performance across your AI Twins.
          </p>
        </div>
        <BaseBadge tone="warning" dot>Coming soon</BaseBadge>
      </header>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div
          v-for="m in metrics"
          :key="m.label"
          class="rounded-2xl border border-border bg-surface p-5 shadow-card"
        >
          <p class="text-caption font-medium uppercase text-text-subtle">{{ m.label }}</p>
          <p class="mt-2 text-display text-text">{{ m.value }}</p>
        </div>
      </div>

      <div class="rounded-2xl border border-border bg-surface shadow-card">
        <EmptyState
          :icon="ChartHistogramIcon"
          title="No data yet"
          description="Activity charts and breakdowns will appear here as soon as your AI Twins start receiving traffic."
        />
      </div>
    </section>
  </DashboardLayout>
</template>
