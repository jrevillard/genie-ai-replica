<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../../lib/classnames';

type Variant = 'default' | 'secondary' | 'outline';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
  }>(),
  { variant: 'default' }
);

const classes = computed(() =>
  cn(
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
    props.variant === 'default' && 'bg-ieee-50 text-ieee-800',
    props.variant === 'secondary' && 'bg-ieee-100 text-ieee-800',
    props.variant === 'outline' && 'border border-neutral-200 text-neutral-700'
  )
);
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>
