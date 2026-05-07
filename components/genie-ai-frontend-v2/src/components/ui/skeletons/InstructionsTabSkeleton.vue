<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

withDefaults(
  defineProps<{
    appliedRows?: number;
    suggestedRows?: number;
  }>(),
  { appliedRows: 2, suggestedRows: 3 }
);
</script>

<template>
  <div class="space-y-6" aria-hidden="true">
    <!-- Header: title + subtitle -->
    <div class="space-y-2">
      <BaseSkeleton width="14rem" height="1.5rem" rounded="md" />
      <BaseSkeleton width="22rem" height="0.875rem" rounded="md" />
    </div>

    <!-- Twin Instructions card -->
    <section class="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <!-- Section heading + count pill -->
      <div class="flex items-center gap-2">
        <BaseSkeleton width="9rem" height="1rem" rounded="md" />
        <BaseSkeleton width="1.75rem" height="1rem" rounded="full" />
      </div>

      <!-- Applied instruction rows (mimics the accent-soft pill style) -->
      <ul class="space-y-2">
        <li
          v-for="i in appliedRows"
          :key="`applied-${i}`"
          class="flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent-soft/30 px-3 py-2.5"
        >
          <BaseSkeleton variant="circle" width="1.75rem" height="1.75rem" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <BaseSkeleton :width="i % 2 === 0 ? '70%' : '85%'" height="0.875rem" rounded="md" />
            <BaseSkeleton v-if="i % 2 === 0" width="40%" height="0.75rem" rounded="md" />
          </div>
        </li>
      </ul>

      <!-- Add Instruction CTA at the bottom right -->
      <div class="flex justify-end">
        <BaseSkeleton width="9rem" height="2rem" rounded="full" />
      </div>
    </section>

    <!-- Suggested Instructions section -->
    <section class="space-y-3">
      <BaseSkeleton width="11rem" height="1rem" rounded="md" />

      <ul class="space-y-2">
        <li
          v-for="i in suggestedRows"
          :key="`suggested-${i}`"
          class="flex items-start gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-card"
        >
          <BaseSkeleton variant="circle" width="1.75rem" height="1.75rem" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <BaseSkeleton
              :width="['90%', '75%', '85%', '70%'][(i - 1) % 4]"
              height="0.875rem"
              rounded="md"
            />
            <BaseSkeleton
              v-if="i % 2 === 1"
              :width="['55%', '45%', '35%'][(i - 1) % 3]"
              height="0.75rem"
              rounded="md"
            />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
