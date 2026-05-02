<script setup lang="ts">
export interface TabItem {
  value: string;
  label: string;
  disabled?: boolean;
}

defineProps<{
  modelValue: string;
  tabs: TabItem[];
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();
</script>

<template>
  <div class="overflow-x-auto">
    <div class="inline-flex gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        :disabled="tab.disabled"
        :class="[
          'whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium transition',
          modelValue === tab.value
            ? 'bg-white text-ieee-700 shadow-sm'
            : 'text-slate-500 hover:text-slate-800 disabled:opacity-50',
        ]"
        @click="!tab.disabled && $emit('update:modelValue', tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>
  </div>
</template>
