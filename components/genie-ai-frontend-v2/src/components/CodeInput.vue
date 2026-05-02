<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    length?: number;
    disabled?: boolean;
  }>(),
  { length: 6 }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'complete', value: string): void;
}>();

const digits = ref<string[]>(Array.from({ length: props.length }, (_, i) => props.modelValue[i] ?? ''));
const inputs = ref<Array<HTMLInputElement | null>>([]);

watch(
  () => props.modelValue,
  (val) => {
    digits.value = Array.from({ length: props.length }, (_, i) => val[i] ?? '');
  }
);

const joined = computed(() => digits.value.join(''));

function emitChange() {
  const value = joined.value;
  emit('update:modelValue', value);
  if (value.length === props.length && !value.includes('')) {
    emit('complete', value);
  }
}

function onInput(idx: number, ev: Event) {
  const target = ev.target as HTMLInputElement;
  // Allow alphanumeric — backend tokens are hex; Figma shows a code-style box
  // so we accept what users type rather than restricting to digits only.
  const cleaned = target.value.replace(/[^a-zA-Z0-9]/g, '').slice(-1).toUpperCase();
  digits.value[idx] = cleaned;
  target.value = cleaned;
  emitChange();
  if (cleaned && idx < props.length - 1) {
    inputs.value[idx + 1]?.focus();
  }
}

function onKeydown(idx: number, ev: KeyboardEvent) {
  if (ev.key === 'Backspace' && !digits.value[idx] && idx > 0) {
    inputs.value[idx - 1]?.focus();
  }
  if (ev.key === 'ArrowLeft' && idx > 0) inputs.value[idx - 1]?.focus();
  if (ev.key === 'ArrowRight' && idx < props.length - 1) inputs.value[idx + 1]?.focus();
}

function onPaste(ev: ClipboardEvent) {
  const pasted = (ev.clipboardData?.getData('text') ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!pasted) return;
  ev.preventDefault();
  for (let i = 0; i < props.length; i++) {
    digits.value[i] = pasted[i] ?? '';
  }
  emitChange();
  const nextEmpty = digits.value.findIndex((d) => !d);
  const focusIdx = nextEmpty === -1 ? props.length - 1 : nextEmpty;
  inputs.value[focusIdx]?.focus();
}
</script>

<template>
  <div class="flex justify-center gap-2 sm:gap-3" @paste="onPaste">
    <input
      v-for="(_, idx) in length"
      :key="idx"
      :ref="(el) => (inputs[idx] = el as HTMLInputElement | null)"
      :value="digits[idx]"
      :disabled="disabled"
      maxlength="1"
      inputmode="text"
      autocomplete="one-time-code"
      class="h-12 w-10 rounded-2xl border border-neutral-300 bg-white text-center text-lg font-semibold text-slate-900 transition focus:border-ieee-700 focus:outline-none focus:ring-2 focus:ring-ieee-100 disabled:bg-slate-100 sm:h-14 sm:w-12"
      @input="onInput(idx, $event)"
      @keydown="onKeydown(idx, $event)"
    />
  </div>
</template>
