<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
    aria-hidden="true"
  >
    <header class="flex items-center gap-3">
      <BaseSkeleton variant="circle" width="3.5rem" height="3.5rem" />
      <div class="flex flex-col gap-1.5">
        <BaseSkeleton height="1rem" width="9rem" rounded="md" />
        <BaseSkeleton height="0.75rem" width="11rem" rounded="md" />
      </div>
    </header>

    <div class="grid grid-cols-2 items-center gap-x-6 rounded-2xl bg-neutral-50 px-4 py-3">
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <BaseSkeleton height="0.75rem" width="5rem" rounded="md" />
          <BaseSkeleton height="0.75rem" width="6rem" rounded="md" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <BaseSkeleton height="0.75rem" width="5rem" rounded="md" />
          <BaseSkeleton height="0.75rem" width="6rem" rounded="md" />
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 border-l border-slate-200 pl-6">
        <BaseSkeleton height="0.75rem" width="3.5rem" rounded="md" />
        <BaseSkeleton height="0.75rem" width="4rem" rounded="md" />
      </div>
    </div>

    <div class="flex justify-end">
      <BaseSkeleton height="2.25rem" width="8.5rem" rounded="full" />
    </div>
  </article>
</template>
