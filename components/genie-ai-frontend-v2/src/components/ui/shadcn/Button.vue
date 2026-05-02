<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../../lib/classnames';

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset';
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
  }>(),
  {
    type: 'button',
    variant: 'default',
    size: 'md',
  }
);

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    props.variant === 'default' && 'bg-ieee-700 text-white shadow hover:bg-ieee-800',
    props.variant === 'secondary' && 'bg-ieee-700 text-white shadow hover:bg-ieee-800',
    props.variant === 'outline' && 'border border-neutral-300 bg-neutral-50 text-neutral-900 shadow-sm hover:bg-neutral-200/60',
    props.variant === 'ghost' && 'text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-950',
    props.variant === 'destructive' && 'bg-red-600 text-white shadow hover:bg-red-700',
    props.size === 'sm' && 'h-10 px-5 text-sm',
    props.size === 'md' && 'h-10 px-5 text-sm',
    props.size === 'lg' && 'h-10 px-5 text-sm',
    props.size === 'icon' && 'h-9 w-9'
  )
);
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
