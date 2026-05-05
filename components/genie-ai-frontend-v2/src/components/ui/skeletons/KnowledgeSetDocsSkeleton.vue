<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(defineProps<{ rows?: number }>(), { rows: 6 });
</script>

<template>
  <ul class="space-y-2" aria-hidden="true">
    <li
      v-for="i in rows"
      :key="i"
      class="flex items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3.5"
    >
      <BaseSkeleton width="1.25rem" height="1.25rem" rounded="md" />
      <BaseSkeleton width="2.5rem" height="2.5rem" rounded="lg" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <BaseSkeleton height="0.875rem" width="55%" rounded="md" />
          <BaseSkeleton height="1rem" width="3.75rem" rounded="full" />
        </div>
        <BaseSkeleton height="0.625rem" width="35%" rounded="md" />
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <BaseSkeleton width="2rem" height="2rem" rounded="lg" />
        <BaseSkeleton width="2rem" height="2rem" rounded="lg" />
      </div>
    </li>
  </ul>
</template>
