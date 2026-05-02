<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/classnames';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    rows?: number;
    label?: string;
    id?: string;
    disabled?: boolean;
    error?: string | null;
  }>(),
  { rows: 4 }
);

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const cls = computed(() =>
  cn(
    'block w-full rounded-xl border-0 bg-white px-4 py-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-ieee-300',
    props.error && 'ring-red-300 focus:ring-red-400'
  )
);
</script>

<template>
  <div>
    <label v-if="label" :for="id" class="mb-1.5 block text-sm font-medium text-slate-700">{{ label }}</label>
    <textarea
      :id="id"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
      :class="cls"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <p v-if="error" class="mt-1 pl-2 text-xs text-red-600">{{ error }}</p>
  </div>
</template>
