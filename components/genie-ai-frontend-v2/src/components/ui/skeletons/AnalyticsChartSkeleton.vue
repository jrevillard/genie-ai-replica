<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <article
    class="flex flex-col rounded-2xl border border-border-subtle bg-surface p-5"
    aria-hidden="true"
  >
    <header class="mb-4 flex flex-col gap-2">
      <BaseSkeleton variant="text" width="40%" height="1rem" />
      <BaseSkeleton variant="text" width="55%" height="0.75rem" />
    </header>
    <BaseSkeleton variant="rect" height="16rem" rounded="xl" />
  </article>
</template>
