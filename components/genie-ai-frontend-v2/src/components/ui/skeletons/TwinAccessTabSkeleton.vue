<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(defineProps<{ rows?: number }>(), { rows: 4 });
</script>

<template>
  <div class="space-y-6" aria-hidden="true">
    <!-- Section header (title + subtitle) -->
    <div class="space-y-2">
      <BaseSkeleton height="1.25rem" width="11rem" rounded="md" />
      <BaseSkeleton height="0.875rem" width="22rem" rounded="md" />
    </div>

    <!-- Master "Restrict twin access" toggle card -->
    <div class="flex items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div class="flex items-start gap-3">
        <BaseSkeleton width="2.5rem" height="2.5rem" rounded="xl" />
        <div class="space-y-1.5">
          <BaseSkeleton height="0.875rem" width="11rem" rounded="md" />
          <BaseSkeleton height="0.75rem" width="20rem" rounded="md" />
        </div>
      </div>
      <BaseSkeleton width="3rem" height="1.75rem" rounded="full" />
    </div>

    <!-- Allowed AI Twins list section -->
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <BaseSkeleton height="1rem" width="9rem" rounded="md" />
        <BaseSkeleton height="1rem" width="3rem" rounded="full" />
      </div>

      <ul class="space-y-2">
        <li
          v-for="i in rows"
          :key="i"
          class="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-card"
        >
          <BaseSkeleton variant="circle" width="2.5rem" height="2.5rem" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <BaseSkeleton
              :width="['55%', '40%', '70%', '50%'][(i - 1) % 4]"
              height="0.875rem"
              rounded="md"
            />
            <BaseSkeleton
              :width="['80%', '65%', '90%', '60%'][(i - 1) % 4]"
              height="0.75rem"
              rounded="md"
            />
          </div>
          <BaseSkeleton width="3rem" height="1.75rem" rounded="full" />
        </li>
      </ul>
    </div>
  </div>
</template>
