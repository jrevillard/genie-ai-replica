<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(
  defineProps<{
    rows?: number;
    height?: string;
  }>(),
  { rows: 5, height: '3rem' }
);
</script>

<template>
  <div class="space-y-2" aria-hidden="true">
    <BaseSkeleton v-for="n in rows" :key="n" :height="height" rounded="xl" />
  </div>
</template>
