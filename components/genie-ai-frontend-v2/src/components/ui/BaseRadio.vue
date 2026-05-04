<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string | number | boolean;
  value: string | number | boolean;
  name?: string;
  label?: string;
  description?: string;
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string | number | boolean): void;
}>();

const checked = computed(() => props.modelValue === props.value);
</script>

<template>
  <label
    :class="[
      'flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-3 transition',
      checked ? 'border-accent ring-1 ring-accent/30 bg-accent-soft/40' : 'border-border hover:bg-surface-muted',
      disabled && 'cursor-not-allowed opacity-60',
    ]"
  >
    <input
      type="radio"
      class="mt-0.5 h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
      :name="name"
      :value="value"
      :checked="checked"
      :disabled="disabled"
      @change="$emit('update:modelValue', value)"
    />
    <span class="flex flex-col">
      <span v-if="label" class="text-body font-medium text-text">{{ label }}</span>
      <span v-if="description" class="text-caption text-text-muted">{{ description }}</span>
      <slot />
    </span>
  </label>
</template>
