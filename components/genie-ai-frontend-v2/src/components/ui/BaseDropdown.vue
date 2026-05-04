<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface Option {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: Option[];
    placeholder?: string;
    width?: string;
  }>(),
  { placeholder: 'Select…', width: 'w-44' }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const open = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.placeholder
);

function toggle(): void {
  open.value = !open.value;
}

function pick(option: Option): void {
  emit('update:modelValue', option.value);
  open.value = false;
}

function onDocClick(event: MouseEvent): void {
  if (!wrapperRef.value) return;
  if (!wrapperRef.value.contains(event.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="wrapperRef" :class="['relative', width]">
    <button
      type="button"
      class="flex h-10 w-full items-center justify-between gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700/40"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span :class="['truncate', !modelValue && 'text-slate-400']">{{ selectedLabel }}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        class="h-3 w-3 shrink-0 transition-transform"
        :class="open && 'rotate-180'"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-1 scale-95"
    >
      <ul
        v-if="open"
        role="listbox"
        class="absolute left-0 top-full z-30 mt-2 w-full origin-top overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
      >
        <li
          v-for="option in options"
          :key="option.value"
          role="option"
          :aria-selected="modelValue === option.value"
        >
          <button
            type="button"
            :class="[
              'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition',
              modelValue === option.value
                ? 'bg-ieee-50 text-ieee-800 font-semibold'
                : 'text-slate-700 hover:bg-slate-50',
            ]"
            @click="pick(option)"
          >
            <span class="truncate">{{ option.label }}</span>
            <span
              v-if="modelValue === option.value"
              class="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <svg viewBox="0 0 20 20" fill="none" class="h-4 w-4" stroke="currentColor" stroke-width="2.2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m5 10 3 3 7-7" />
              </svg>
            </span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>
