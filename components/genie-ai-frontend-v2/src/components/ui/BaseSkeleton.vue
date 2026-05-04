<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/classnames';

const props = withDefaults(
  defineProps<{
    variant?: 'rect' | 'circle' | 'text';
    width?: string;
    height?: string;
    rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  }>(),
  { variant: 'rect', rounded: '2xl' }
);

const cls = computed(() =>
  cn(
    'animate-pulse bg-surface-subtle',
    props.variant === 'circle' && 'rounded-full aspect-square',
    props.variant === 'text' && 'rounded h-4',
    props.variant === 'rect' && `rounded-${props.rounded}`
  )
);

const style = computed(() => ({
  width: props.width,
  height: props.height,
}));
</script>

<template>
  <div :class="cls" :style="style" aria-hidden="true" />
</template>
