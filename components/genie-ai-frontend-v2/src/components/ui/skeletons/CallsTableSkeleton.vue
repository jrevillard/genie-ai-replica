<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(defineProps<{ rows?: number }>(), { rows: 6 });
</script>

<template>
  <div class="divide-y divide-neutral-100" aria-hidden="true">
    <div
      v-for="n in rows"
      :key="n"
      class="grid grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr_1.1fr_40px] items-center gap-3 px-5 py-4"
    >
      <div class="flex items-center gap-3">
        <BaseSkeleton variant="circle" width="1.5rem" height="1.5rem" />
        <BaseSkeleton height="0.75rem" width="2.5rem" rounded="md" />
      </div>
      <BaseSkeleton height="0.75rem" width="5.5rem" rounded="md" />
      <BaseSkeleton height="0.75rem" width="3.5rem" rounded="md" />
      <BaseSkeleton height="0.75rem" width="3.5rem" rounded="md" />
      <BaseSkeleton height="0.75rem" width="3rem" rounded="md" />
      <BaseSkeleton height="0.75rem" :width="`${55 + (n % 3) * 12}%`" rounded="md" />
      <BaseSkeleton variant="circle" width="1.5rem" height="1.5rem" />
    </div>
  </div>
</template>
