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
  <label class="inline-flex cursor-pointer select-none items-center gap-3" :class="{ 'opacity-50': disabled }">
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 shadow-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      :class="modelValue ? 'bg-ieee-700' : 'bg-neutral-900'"
      @click="$emit('update:modelValue', !modelValue)"
    >
      <span
        class="block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
        :class="modelValue ? 'translate-x-5' : 'translate-x-0'"
      />
    </button>
    <span v-if="label" class="text-sm text-slate-700">{{ label }}</span>
  </label>
</template>
