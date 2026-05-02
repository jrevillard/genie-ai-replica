<script setup lang="ts">
import Icon from './Icon.vue';

defineProps<{
  icon?: unknown;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
    <div
      v-if="icon"
      class="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-ieee-50 text-ieee-600"
    >
      <Icon :icon="icon" :size="28" />
    </div>
    <h3 class="text-base font-semibold text-slate-900">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-md text-sm text-slate-500">{{ description }}</p>
    <div v-if="$slots.default" class="mt-6"><slot /></div>
  </div>
</template>
