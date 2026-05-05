<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <div class="space-y-2" aria-hidden="true">
    <BaseSkeleton height="1.5rem" width="14rem" rounded="md" />
    <BaseSkeleton height="1rem" width="10rem" rounded="md" />
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <BaseSkeleton height="1.5rem" width="4.5rem" rounded="full" />
      <BaseSkeleton height="1.5rem" width="6rem" rounded="full" />
    </div>
  </div>
</template>
