<script setup lang="ts">
withDefaults(
  defineProps<{
    padding?: 'none' | 'sm' | 'md' | 'lg';
  }>(),
  { padding: 'md' }
);
</script>

<template>
  <div
    class="rounded-xl border border-neutral-200 bg-white shadow-sm"
    :class="{
      'p-0': padding === 'none',
      'p-3': padding === 'sm',
      'p-5': padding === 'md',
      'p-8': padding === 'lg',
    }"
  >
    <slot />
  </div>
</template>
