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
  <label class="inline-flex cursor-pointer items-center gap-2 select-none" :class="{ 'opacity-50': disabled }">
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-300"
      :class="modelValue ? 'bg-ieee-600' : 'bg-slate-300'"
      @click="$emit('update:modelValue', !modelValue)"
    >
      <span
        class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition"
        :class="modelValue ? 'translate-x-4' : 'translate-x-0.5'"
      />
    </button>
    <span v-if="label" class="text-sm text-slate-700">{{ label }}</span>
  </label>
</template>
