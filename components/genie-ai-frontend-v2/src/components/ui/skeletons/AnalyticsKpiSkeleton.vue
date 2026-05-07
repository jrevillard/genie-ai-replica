<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <article
      v-for="i in 7"
      :key="i"
      class="rounded-2xl border border-border-subtle bg-surface p-5"
      aria-hidden="true"
    >
      <div class="flex items-center gap-4">
        <BaseSkeleton variant="rect" width="3rem" height="3rem" rounded="2xl" />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <BaseSkeleton variant="text" width="60%" />
          <BaseSkeleton variant="text" width="40%" height="1.5rem" />
        </div>
      </div>
    </article>
  </section>
</template>
