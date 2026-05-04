<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();
</script>

<template>
  <label class="inline-flex cursor-pointer select-none items-center gap-2.5" :class="{ 'opacity-50': disabled }">
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      :class="modelValue ? 'bg-ieee-700' : 'bg-slate-300'"
      @click="$emit('update:modelValue', !modelValue)"
    >
      <span
        class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ease-out"
        :class="modelValue ? 'translate-x-[22px]' : 'translate-x-0.5'"
      />
    </button>
    <span v-if="label" class="text-sm font-medium text-slate-700">{{ label }}</span>
  </label>
</template>
