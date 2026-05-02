<script setup lang="ts">
import { computed, useSlots } from 'vue';

defineProps<{
  modelValue: string;
  label?: string;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
  required?: boolean;
  error?: string | null;
  id?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const slots = useSlots();
const hasTrailing = computed(() => !!slots.trailing);
</script>

<template>
  <div>
    <label v-if="label" :for="id" class="form-label">{{ label }}</label>
    <div class="relative">
      <input
        :id="id"
        :type="type ?? 'text'"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :required="required"
        :aria-invalid="!!error"
        :class="['input-pill', hasTrailing && 'pr-12']"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="hasTrailing" class="absolute inset-y-0 right-4 flex items-center">
        <slot name="trailing" />
      </span>
    </div>
    <p v-if="error" class="form-error">{{ error }}</p>
  </div>
</template>
