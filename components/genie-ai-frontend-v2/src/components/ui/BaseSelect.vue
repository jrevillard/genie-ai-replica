<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/classnames';

interface Option {
  value: string | number;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    options: Option[];
    placeholder?: string;
    label?: string;
    id?: string;
    disabled?: boolean;
    error?: string | null;
    rounded?: 'md' | 'lg' | 'full';
    size?: 'sm' | 'md';
  }>(),
  { rounded: 'lg', size: 'md' }
);

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const wrapperClass = computed(() =>
  cn(
    'relative flex items-center bg-surface text-text ring-1 ring-inset ring-border transition focus-within:ring-2 focus-within:ring-accent',
    props.rounded === 'full' ? 'rounded-full' : props.rounded === 'md' ? 'rounded-md' : 'rounded-xl',
    props.size === 'sm' ? 'px-3 py-1.5 text-meta' : 'px-4 py-2.5 text-body',
    props.error && 'ring-danger/40 focus-within:ring-danger/60',
    props.disabled &&
      'cursor-not-allowed bg-surface-muted text-text-muted ring-border focus-within:ring-1 focus-within:ring-border'
  )
);
</script>

<template>
  <div>
    <label v-if="label" :for="id" class="mb-1.5 block text-body font-medium text-text">
      {{ label }}
    </label>
    <div :class="wrapperClass">
      <select
        :id="id"
        :value="modelValue"
        :disabled="disabled"
        :aria-invalid="!!error"
        class="w-full appearance-none bg-transparent pr-6 outline-none disabled:cursor-not-allowed"
        @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option
          v-for="opt in options"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.disabled"
        >
          {{ opt.label }}
        </option>
      </select>
      <svg
        class="pointer-events-none absolute right-3 h-4 w-4 text-text-subtle"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    <p v-if="error" class="mt-1 pl-2 text-caption text-danger">{{ error }}</p>
  </div>
</template>
