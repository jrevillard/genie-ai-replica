<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../../lib/classnames';

const props = defineProps<{
  modelValue?: string | number;
  type?: string;
  placeholder?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const classes = computed(() =>
  cn(
    'flex h-10 w-full rounded-full border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm text-neutral-950 shadow-sm transition placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700 disabled:cursor-not-allowed disabled:opacity-50'
  )
);
</script>

<template>
  <input
    :type="type ?? 'text'"
    :value="modelValue"
    :placeholder="placeholder"
    :class="classes"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
