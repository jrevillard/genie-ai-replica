<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/classnames';

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    label?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
  }>(),
  { modelValue: false, size: 'md' }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'change', value: boolean): void;
}>();

const boxClass = computed(() =>
  cn(
    'grid shrink-0 place-items-center rounded-md border transition',
    'group-focus-within:ring-4 group-focus-within:ring-ieee-100',
    props.size === 'sm' ? 'h-5 w-5' : 'h-6 w-6',
    props.modelValue
      ? 'border-ieee-700 bg-ieee-700 text-white shadow-sm'
      : 'border-neutral-300 bg-white text-transparent',
    props.disabled && 'cursor-not-allowed opacity-50'
  )
);

function update(value: boolean) {
  emit('update:modelValue', value);
  emit('change', value);
}
</script>

<template>
  <label
    :class="[
      'group inline-flex cursor-pointer items-center gap-3',
      disabled && 'cursor-not-allowed',
    ]"
  >
    <input
      type="checkbox"
      class="sr-only"
      :checked="modelValue"
      :disabled="disabled"
      @change="update(($event.target as HTMLInputElement).checked)"
    />
    <span :class="boxClass" aria-hidden="true">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        :class="[size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4', 'stroke-current']"
      >
        <path
          d="M3.5 8.2 6.5 11 12.5 5"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <span v-if="label" class="text-sm font-semibold text-slate-800">
      {{ label }}
    </span>
    <slot />
  </label>
</template>
