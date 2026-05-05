<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface" aria-hidden="true">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-6 py-4">
      <div class="flex items-center gap-3">
        <BaseSkeleton variant="circle" width="2.25rem" height="2.25rem" />
        <BaseSkeleton variant="circle" width="2.5rem" height="2.5rem" />
        <div class="flex flex-col gap-1.5">
          <BaseSkeleton height="0.875rem" width="9rem" rounded="md" />
          <BaseSkeleton height="0.625rem" width="14rem" rounded="md" />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <BaseSkeleton height="2.25rem" width="4.5rem" rounded="full" />
        <BaseSkeleton height="2.5rem" width="6.5rem" rounded="full" />
        <BaseSkeleton height="2.5rem" width="6.5rem" rounded="full" />
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col px-6 py-6">
      <div class="mx-auto flex w-full max-w-3xl">
        <div class="flex gap-3">
          <BaseSkeleton variant="circle" width="2rem" height="2rem" />
          <div class="flex w-72 flex-col gap-2 rounded-2xl bg-surface-muted px-5 py-3.5 shadow-card">
            <BaseSkeleton height="0.75rem" width="100%" rounded="md" />
            <BaseSkeleton height="0.75rem" width="85%" rounded="md" />
            <BaseSkeleton height="0.75rem" width="55%" rounded="md" />
          </div>
        </div>
      </div>
    </div>

    <footer class="border-t border-border-subtle bg-surface px-6 py-4">
      <div class="mx-auto w-full max-w-3xl">
        <div class="flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-card">
          <BaseSkeleton height="2.25rem" width="100%" rounded="xl" class="flex-1" />
          <BaseSkeleton variant="circle" width="2.5rem" height="2.5rem" />
          <BaseSkeleton variant="circle" width="2.75rem" height="2.75rem" />
        </div>
        <div class="mt-3 flex justify-center">
          <BaseSkeleton height="0.625rem" width="22rem" rounded="md" />
        </div>
      </div>
    </footer>
  </div>
</template>
