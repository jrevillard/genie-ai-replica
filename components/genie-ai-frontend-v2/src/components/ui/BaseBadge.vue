<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/classnames';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
type Size = 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    tone?: Tone;
    size?: Size;
    dot?: boolean;
  }>(),
  { tone: 'neutral', size: 'sm' }
);

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-subtle text-text-muted ring-border',
  accent: 'bg-accent-soft text-accent-hover ring-accent/20',
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
};

const dotColor: Record<Tone, string> = {
  neutral: 'bg-text-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const cls = computed(() =>
  cn(
    'inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset',
    toneClass[props.tone],
    props.size === 'sm' ? 'px-2 py-0.5 text-caption' : 'px-2.5 py-1 text-meta'
  )
);
</script>

<template>
  <span :class="cls">
    <span v-if="dot" :class="['h-1.5 w-1.5 rounded-full', dotColor[tone]]" />
    <slot />
  </span>
</template>
