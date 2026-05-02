<script setup lang="ts">
defineProps<{
  modelValue: string;
  value: string;
  label?: string;
  description?: string;
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="group flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-ieee-200 disabled:cursor-not-allowed disabled:opacity-60"
    :class="{
      'border-ieee-500 bg-ieee-50/40 ring-1 ring-ieee-200': modelValue === value,
    }"
    @click="!disabled && $emit('update:modelValue', value)"
  >
    <span
      class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition"
      :class="modelValue === value ? 'border-ieee-600 bg-ieee-600' : 'border-slate-300 bg-white'"
    >
      <span v-if="modelValue === value" class="h-2 w-2 rounded-full bg-white" />
    </span>
    <span class="min-w-0 flex-1">
      <span v-if="label" class="block text-sm font-medium text-slate-900">{{ label }}</span>
      <span v-if="description" class="mt-1 block text-xs leading-relaxed text-slate-500">{{ description }}</span>
      <slot />
    </span>
  </button>
</template>
