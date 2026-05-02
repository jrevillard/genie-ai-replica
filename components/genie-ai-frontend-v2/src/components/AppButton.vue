<script setup lang="ts">
defineProps<{
  type?: 'submit' | 'button' | 'reset';
  variant?: 'primary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
}>();
</script>

<template>
  <button
    :type="type ?? 'button'"
    :class="variant === 'ghost' ? 'btn-ghost' : 'btn-primary'"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
    <slot />
  </button>
</template>
