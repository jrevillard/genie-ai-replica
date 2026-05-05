<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(defineProps<{ rows?: number }>(), { rows: 4 });
</script>

<template>
  <div class="space-y-3" aria-hidden="true">
    <div
      v-for="n in rows"
      :key="n"
      class="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-3 shadow-card"
    >
      <div class="flex items-center gap-3">
        <BaseSkeleton variant="circle" width="2.5rem" height="2.5rem" />
        <div class="space-y-2">
          <BaseSkeleton height="0.875rem" width="9rem" rounded="md" />
          <BaseSkeleton height="0.75rem" width="6rem" rounded="md" />
        </div>
      </div>
      <BaseSkeleton height="2rem" width="2rem" rounded="full" />
    </div>
  </div>
</template>
