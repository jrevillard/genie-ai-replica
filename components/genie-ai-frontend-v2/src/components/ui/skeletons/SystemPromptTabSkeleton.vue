<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <div class="space-y-6" aria-hidden="true">
    <!-- Header: title + subtitle -->
    <div class="space-y-2">
      <BaseSkeleton width="10rem" height="1.5rem" rounded="md" />
      <BaseSkeleton width="28rem" height="0.875rem" rounded="md" />
      <BaseSkeleton width="20rem" height="0.875rem" rounded="md" />
    </div>

    <!-- Label row: "Prompt" label + char counter + reset button -->
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <BaseSkeleton width="4rem" height="1rem" rounded="md" />
        <div class="flex items-center gap-3">
          <BaseSkeleton width="6rem" height="0.875rem" rounded="md" />
          <BaseSkeleton width="8.5rem" height="1.75rem" rounded="full" />
        </div>
      </div>

      <!-- Textarea body -->
      <BaseSkeleton width="100%" height="24rem" rounded="2xl" />

      <!-- Hint text -->
      <BaseSkeleton width="22rem" height="0.75rem" rounded="md" />
    </div>
  </div>
</template>
