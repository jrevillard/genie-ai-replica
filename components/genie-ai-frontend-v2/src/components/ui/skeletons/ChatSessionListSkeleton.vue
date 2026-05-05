<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(defineProps<{ rows?: number }>(), { rows: 6 });
</script>

<template>
  <div class="space-y-1 p-2" aria-hidden="true">
    <div
      v-for="n in rows"
      :key="n"
      class="flex items-start gap-3 rounded-xl p-2.5"
    >
      <BaseSkeleton variant="circle" width="2rem" height="2rem" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <BaseSkeleton height="0.75rem" :width="`${50 + (n % 3) * 10}%`" rounded="md" />
          <BaseSkeleton height="0.625rem" width="2.25rem" rounded="md" />
        </div>
        <div class="flex items-center gap-1.5">
          <BaseSkeleton height="0.875rem" width="3.5rem" rounded="full" />
          <BaseSkeleton height="0.625rem" :width="`${40 + (n % 4) * 12}%`" rounded="md" />
        </div>
      </div>
    </div>
  </div>
</template>
