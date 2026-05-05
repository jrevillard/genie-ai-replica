<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

const turns = [
  { lines: 2, width: '4rem' },
  { lines: 3, width: '3rem' },
  { lines: 1, width: '4rem' },
] as const;
</script>

<template>
  <div class="min-h-[260px] py-4" aria-hidden="true">
    <div v-for="(t, i) in turns" :key="i" class="mb-4">
      <BaseSkeleton height="0.75rem" :width="t.width" rounded="md" class="mb-2" />
      <div class="space-y-1.5">
        <BaseSkeleton v-for="ln in t.lines" :key="ln" height="0.625rem" :width="ln === t.lines ? '60%' : '100%'" rounded="md" />
      </div>
    </div>
  </div>
</template>
