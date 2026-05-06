<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import FlagIcon from './FlagIcon.vue';

interface Option {
  value: string;
  label: string;
  // ISO 3166-1 alpha-2 country code; when set, a rounded flag is rendered
  // before the label in both the trigger and the option list.
  flag?: string;
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
const menuRef = ref<HTMLElement | null>(null);

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  placement: 'bottom' | 'top';
}
const menuPosition = ref<MenuPosition>({ top: 0, left: 0, width: 0, placement: 'bottom' });

const selectedOption = computed(() =>
  props.options.find((o) => o.value === props.modelValue) ?? null
);
const selectedLabel = computed(() => selectedOption.value?.label ?? props.placeholder);

const menuStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${menuPosition.value.top}px`,
  left: `${menuPosition.value.left}px`,
  width: `${menuPosition.value.width}px`,
}));

function recomputePosition(): void {
  const trigger = wrapperRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  // Estimate menu height — flips upward only if there isn't room below.
  const estimated = Math.min(280, props.options.length * 40 + 16);
  const gap = 8;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const placement: 'bottom' | 'top' =
    spaceBelow >= estimated + gap || spaceBelow >= spaceAbove ? 'bottom' : 'top';
  menuPosition.value = {
    top: placement === 'bottom' ? rect.bottom + gap : rect.top - gap - estimated,
    left: rect.left,
    width: rect.width,
    placement,
  };
}

function openMenu(): void {
  recomputePosition();
  open.value = true;
  nextTick(() => recomputePosition());
}

function toggle(): void {
  if (open.value) {
    open.value = false;
  } else {
    openMenu();
  }
}

function pick(option: Option): void {
  emit('update:modelValue', option.value);
  open.value = false;
}

function onDocClick(event: MouseEvent): void {
  const target = event.target as Node;
  if (wrapperRef.value?.contains(target)) return;
  if (menuRef.value?.contains(target)) return;
  open.value = false;
}

function onWindowChange(): void {
  if (open.value) recomputePosition();
}

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('scroll', onWindowChange, true);
    window.addEventListener('resize', onWindowChange);
  } else {
    window.removeEventListener('scroll', onWindowChange, true);
    window.removeEventListener('resize', onWindowChange);
  }
});

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  window.removeEventListener('scroll', onWindowChange, true);
  window.removeEventListener('resize', onWindowChange);
});
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
      <span class="flex min-w-0 items-center gap-2">
        <FlagIcon v-if="selectedOption?.flag" :code="selectedOption.flag" :width="16" shape="circle" />
        <span :class="['truncate', !modelValue && 'text-slate-400']">{{ selectedLabel }}</span>
      </span>
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

    <Teleport to="body">
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
          ref="menuRef"
          role="listbox"
          :style="menuStyle"
          :class="[
            'z-50 max-h-[280px] origin-top overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]',
            menuPosition.placement === 'top' && 'origin-bottom',
          ]"
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
            <span class="flex min-w-0 items-center gap-2">
              <FlagIcon v-if="option.flag" :code="option.flag" :width="16" shape="circle" />
              <span class="truncate">{{ option.label }}</span>
            </span>
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
    </Teleport>
  </div>
</template>
