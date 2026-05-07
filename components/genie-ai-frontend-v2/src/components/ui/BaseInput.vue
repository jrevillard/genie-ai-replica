<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { cn } from '../../lib/classnames';

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    type?: string;
    placeholder?: string;
    autocomplete?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string | null;
    id?: string;
    label?: string;
    rounded?: 'md' | 'lg' | 'full';
    size?: 'sm' | 'md';
  }>(),
  { type: 'text', rounded: 'full', size: 'md' }
);

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const slots = useSlots();
const hasLeading = computed(() => !!slots.leading);
const hasTrailing = computed(() => !!slots.trailing);

const wrapperClass = computed(() =>
  cn(
    'relative flex items-center bg-white text-neutral-950 ring-1 ring-inset ring-neutral-200 transition focus-within:ring-2 focus-within:ring-ieee-700',
    props.rounded === 'full' ? 'rounded-full' : props.rounded === 'md' ? 'rounded-md' : 'rounded-xl',
    props.size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
    props.error && 'ring-red-300 focus-within:ring-red-400',
    props.disabled &&
      'cursor-not-allowed bg-slate-50 text-slate-600 ring-neutral-200 focus-within:ring-1 focus-within:ring-neutral-200'
  )
);
</script>

<template>
  <div>
    <label v-if="label" :for="id" class="mb-1.5 block text-sm font-medium text-slate-700">{{ label }}</label>
    <div :class="wrapperClass">
      <span v-if="hasLeading" class="mr-2 text-slate-400">
        <slot name="leading" />
      </span>
      <input
        :id="id"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :required="required"
        :disabled="disabled"
        :aria-invalid="!!error"
        class="w-full bg-transparent placeholder-slate-400 outline-none disabled:cursor-not-allowed"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="hasTrailing" class="ml-2 text-slate-400">
        <slot name="trailing" />
      </span>
    </div>
    <p v-if="error" class="mt-1 pl-2 text-xs text-red-600">{{ error }}</p>
  </div>
</template>
