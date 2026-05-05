<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../../lib/classnames';

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
    'skeleton-shimmer relative overflow-hidden bg-slate-200/70',
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

<style scoped>
.skeleton-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 100%
  );
  animation: skeleton-shimmer 1.4s linear infinite;
  transform: translateX(-100%);
}
@keyframes skeleton-shimmer {
  100% { transform: translateX(100%); }
}
</style>
