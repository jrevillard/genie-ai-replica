<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    // Two-letter ISO 3166-1 alpha-2 country code, lowercase. For locales
    // without a flag (e.g. Mandinka 'mnk') pass the closest country code.
    code: string;
    width?: number | string;
    rounded?: boolean;
    alt?: string;
  }>(),
  { width: 20, rounded: true, alt: '' }
);

const src = computed(() => `https://flagcdn.com/${props.code.toLowerCase()}.svg`);
</script>

<template>
  <img
    :src="src"
    :alt="alt"
    :width="width"
    :class="[
      'inline-block shrink-0 object-cover ring-1 ring-black/5',
      rounded ? 'rounded-sm' : '',
    ]"
    :style="{ aspectRatio: '4 / 3' }"
    aria-hidden="true"
    loading="lazy"
  />
</template>
