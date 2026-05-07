<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Calendar03Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseDatePicker from '../ui/BaseDatePicker.vue';
import Icon from '../ui/Icon.vue';
import { useT } from '../../i18n/composables';
import {
  formatRangeLabel,
  presetToRange,
  type DateRange,
  type RangePreset,
} from '../../lib/analytics';

const props = defineProps<{ modelValue: DateRange }>();

const emit = defineEmits<{ (e: 'update:modelValue', value: DateRange): void }>();

const { t } = useT();
const { locale } = useI18n();

const wrapperRef = ref<HTMLElement | null>(null);
const open = ref(false);

interface PresetOption {
  key: RangePreset;
  label: string;
}

const presets = computed<PresetOption[]>(() => [
  { key: 'last7', label: t('analytics.range.last7', 'Last 7 days') },
  { key: 'last30', label: t('analytics.range.last30', 'Last 30 days') },
  { key: 'last90', label: t('analytics.range.last90', 'Last 90 days') },
  { key: 'custom', label: t('analytics.range.custom', 'Custom range') },
]);

// Pending state — staged inside the popup until the user hits Apply. Keeps
// the popup open while they tweak presets / dates so a misclick doesn't
// close it before they're done.
const pendingPreset = ref<RangePreset>(props.modelValue.preset);
const customFrom = ref(props.modelValue.from);
const customTo = ref(props.modelValue.to);

// Re-sync the staged values whenever the popup opens or the parent commits a
// new range, so opening the popup always shows the currently-applied state.
watch(
  () => [open.value, props.modelValue] as const,
  ([isOpen, v]) => {
    if (!isOpen) return;
    pendingPreset.value = v.preset;
    customFrom.value = v.from;
    customTo.value = v.to;
  },
  { immediate: true }
);

const triggerLabel = computed(() => {
  if (props.modelValue.preset === 'last7') return t('analytics.range.last7', 'Last 7 days');
  if (props.modelValue.preset === 'last30') return t('analytics.range.last30', 'Last 30 days');
  if (props.modelValue.preset === 'last90') return t('analytics.range.last90', 'Last 90 days');
  return formatRangeLabel(props.modelValue.from, props.modelValue.to, locale.value);
});

function pickPreset(p: PresetOption): void {
  pendingPreset.value = p.key;
  // Preview From/To for non-custom presets so the user sees the dates the
  // preset resolves to before committing.
  if (p.key !== 'custom') {
    const range = presetToRange(p.key);
    customFrom.value = range.from;
    customTo.value = range.to;
  }
}

const canApply = computed(() => {
  if (pendingPreset.value !== 'custom') return true;
  return Boolean(customFrom.value && customTo.value && customFrom.value <= customTo.value);
});

function apply(): void {
  if (!canApply.value) return;
  if (pendingPreset.value === 'custom') {
    emit('update:modelValue', {
      from: customFrom.value,
      to: customTo.value,
      preset: 'custom',
    });
  } else {
    emit('update:modelValue', presetToRange(pendingPreset.value));
  }
  open.value = false;
}

function onDocClick(e: MouseEvent): void {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="wrapperRef" class="relative">
    <button
      type="button"
      class="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-body text-text transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <Icon :icon="Calendar03Icon" :size="16" />
      <span class="font-medium">{{ triggerLabel }}</span>
      <svg
        viewBox="0 0 20 20"
        class="h-3.5 w-3.5 text-text-subtle transition-transform"
        :class="open && 'rotate-180'"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 8 4 4 4-4" />
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
      <div
        v-if="open"
        role="dialog"
        class="absolute right-0 top-full z-30 mt-2 w-[26rem] origin-top-right rounded-2xl border border-border bg-surface p-3 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
      >
        <ul class="space-y-1">
          <li v-for="p in presets" :key="p.key">
            <button
              type="button"
              :class="[
                'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-body transition',
                pendingPreset === p.key
                  ? 'bg-ieee-50 font-semibold text-ieee-700'
                  : 'text-text hover:bg-surface-subtle',
              ]"
              @click="pickPreset(p)"
            >
              <span>{{ p.label }}</span>
              <span
                v-if="pendingPreset === p.key"
                class="grid h-4 w-4 place-items-center rounded-full bg-ieee-700"
                aria-hidden="true"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-white" />
              </span>
            </button>
          </li>
        </ul>

        <div class="mt-3 border-t border-border-subtle pt-3">
          <div class="grid grid-cols-2 gap-2">
            <BaseDatePicker
              v-model="customFrom"
              :label="t('analytics.range.from', 'From')"
              :max="customTo"
              @update:model-value="pendingPreset = 'custom'"
            />
            <BaseDatePicker
              v-model="customTo"
              :label="t('analytics.range.to', 'To')"
              :min="customFrom"
              @update:model-value="pendingPreset = 'custom'"
            />
          </div>
          <div class="mt-3 flex justify-end">
            <BaseButton variant="primary" size="sm" :disabled="!canApply" @click="apply">
              {{ t('analytics.range.apply', 'Apply') }}
            </BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
