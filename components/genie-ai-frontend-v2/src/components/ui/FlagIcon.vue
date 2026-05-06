<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    // Two-letter ISO 3166-1 alpha-2 country code, lowercase. For locales
    // without a flag (e.g. Mandinka 'mnk') pass the closest country code.
    code: string;
    width?: number | string;
    // 'sm' = subtle rounded rectangle (default), 'circle' = fully round badge.
    shape?: 'sm' | 'circle';
    alt?: string;
  }>(),
  { width: 20, shape: 'sm', alt: '' }
);

const src = computed(() => `/images/flags/${props.code.toLowerCase()}.svg`);
const isCircle = computed(() => props.shape === 'circle');
</script>

<template>
  <img
    :src="src"
    :alt="alt"
    :width="width"
    :height="width"
    :class="[
      'inline-block shrink-0 object-cover ring-1 ring-black/5',
      isCircle ? 'rounded-full' : 'rounded-sm',
    ]"
    :style="{ aspectRatio: isCircle ? '1 / 1' : '4 / 3' }"
    aria-hidden="true"
    loading="lazy"
  />
</template>
