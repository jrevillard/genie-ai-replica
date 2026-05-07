<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(
  defineProps<{
    rows?: number;
    cols?: number;
  }>(),
  { rows: 6, cols: 6 }
);
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5"
    aria-hidden="true"
  >
    <BaseSkeleton variant="text" width="30%" height="1rem" />
    <div class="mt-2 flex flex-col gap-2">
      <div class="flex gap-3">
        <BaseSkeleton v-for="c in cols" :key="`h-${c}`" variant="text" width="100%" height="0.75rem" />
      </div>
      <div v-for="r in rows" :key="`r-${r}`" class="flex gap-3 border-t border-border-subtle pt-3">
        <BaseSkeleton v-for="c in cols" :key="`r-${r}-c-${c}`" variant="text" width="100%" height="1rem" />
      </div>
    </div>
  </article>
</template>
