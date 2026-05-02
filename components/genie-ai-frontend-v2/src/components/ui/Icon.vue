<script setup lang="ts">
import { HugeiconsIcon } from '@hugeicons/vue';

defineProps<{
  icon: unknown;
  size?: number | string;
  strokeWidth?: number;
  color?: string;
}>();
</script>

<template>
  <HugeiconsIcon
    :icon="icon as any"
    :size="size ?? 20"
    :strokeWidth="strokeWidth ?? 1.6"
    :color="color"
    aria-hidden="true"
  />
</template>
