<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/classnames';

type Variant = 'primary' | 'secondary' | 'soft' | 'danger' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset';
    variant?: Variant;
    size?: Size;
    block?: boolean;
    loading?: boolean;
    disabled?: boolean;
    rounded?: 'md' | 'lg' | 'xl' | 'full';
  }>(),
  {
    type: 'button',
    variant: 'primary',
    size: 'md',
    rounded: 'full',
  }
);

const variantClass: Record<Variant, string> = {
  primary: 'bg-ieee-700 text-white shadow-sm hover:bg-ieee-800 focus-visible:outline-ieee-700',
  secondary: 'bg-ieee-700 text-white hover:bg-ieee-800 focus-visible:outline-ieee-800',
  soft: 'bg-ieee-50 text-ieee-800 hover:bg-ieee-100 focus-visible:outline-ieee-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-slate-200',
  outline:
    'bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus-visible:outline-slate-300',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-10 px-5 text-sm',
  md: 'h-10 px-5 text-sm',
  lg: 'h-10 px-5 text-sm',
};

const roundedClass = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
    variantClass[props.variant],
    sizeClass[props.size],
    roundedClass[props.rounded],
    props.block && 'w-full'
  )
);
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading">
    <span
      v-if="loading"
      class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
