<script setup lang="ts">
import { ChartLineData01Icon } from '@hugeicons/core-free-icons';
import { useT } from '../../i18n/composables';
import EmptyState from '../ui/EmptyState.vue';

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    empty?: boolean;
    emptyTitle?: string;
    emptyBody?: string;
  }>(),
  { empty: false }
);

const { t } = useT();
</script>

<template>
  <article class="flex flex-col rounded-2xl border border-border-subtle bg-surface p-5">
    <header class="mb-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-title text-text">{{ title }}</h3>
        <p v-if="subtitle" class="mt-0.5 text-meta text-text-subtle">{{ subtitle }}</p>
      </div>
      <slot name="actions" />
    </header>

    <div class="min-h-0 flex-1">
      <EmptyState
        v-if="empty"
        :icon="ChartLineData01Icon"
        :title="emptyTitle ?? t('analytics.charts.empty.title', 'No data')"
        :description="emptyBody ?? t('analytics.charts.empty.body', 'No data for the selected period.')"
      />
      <slot v-else />
    </div>
  </article>
</template>
