<script setup lang="ts">
import { ChartHistogramIcon } from '@hugeicons/core-free-icons';
import EmptyState from '../components/ui/EmptyState.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-white p-6">
      <header>
        <h1 class="text-xl font-semibold text-slate-900">Statistics</h1>
        <p class="mt-1 text-sm text-slate-500">Usage, engagement, and performance across your AI Twins.</p>
      </header>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-400">Total Chats</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">—</p>
        </div>
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-400">Total Calls</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">—</p>
        </div>
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-400">Avg. Duration</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">—</p>
        </div>
      </div>

      <div class="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <EmptyState
          :icon="ChartHistogramIcon"
          title="No data yet"
          description="Activity charts and breakdowns will appear here as soon as your AI Twins start receiving traffic."
        />
      </div>
    </section>
  </DashboardLayout>
</template>
