<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <div class="space-y-6" aria-hidden="true">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <BaseSkeleton variant="circle" width="5rem" height="5rem" />
        <BaseSkeleton height="2.5rem" width="6.5rem" rounded="xl" />
      </div>
      <BaseSkeleton height="2.5rem" width="9rem" rounded="xl" />
    </header>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-2 rounded-full bg-surface-muted p-1">
        <BaseSkeleton v-for="n in 5" :key="n" height="2.25rem" width="6rem" rounded="full" />
      </div>
      <BaseSkeleton height="2.5rem" width="6.5rem" rounded="full" />
    </div>

    <div class="rounded-2xl border border-border bg-surface p-6 shadow-card">
      <BaseSkeleton height="1.5rem" width="20rem" rounded="md" class="mb-5" />

      <div class="space-y-5">
        <div class="space-y-2">
          <BaseSkeleton height="0.875rem" width="6rem" rounded="md" />
          <BaseSkeleton height="2.5rem" width="100%" rounded="xl" />
        </div>
        <div class="space-y-2">
          <BaseSkeleton height="0.875rem" width="6rem" rounded="md" />
          <BaseSkeleton height="6.5rem" width="100%" rounded="xl" />
        </div>
        <div class="space-y-2">
          <BaseSkeleton height="0.875rem" width="8rem" rounded="md" />
          <BaseSkeleton height="2.5rem" width="100%" rounded="xl" />
        </div>
      </div>
    </div>
  </div>
</template>
