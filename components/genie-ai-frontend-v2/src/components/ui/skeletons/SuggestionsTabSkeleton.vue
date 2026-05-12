<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <div class="space-y-6" aria-hidden="true">
    <div class="space-y-2">
      <BaseSkeleton width="12rem" height="1.5rem" rounded="md" />
      <BaseSkeleton width="32rem" height="0.875rem" rounded="md" />
    </div>

    <div v-for="i in 2" :key="i" class="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div class="flex items-center justify-between">
        <BaseSkeleton width="9rem" height="1rem" rounded="md" />
        <BaseSkeleton width="5rem" height="0.875rem" rounded="full" />
      </div>
      <div v-for="row in 3" :key="row" class="flex items-center gap-3">
        <BaseSkeleton width="1.5rem" height="1.5rem" rounded="full" />
        <BaseSkeleton width="100%" height="0.875rem" rounded="md" />
      </div>
    </div>
  </div>
</template>
