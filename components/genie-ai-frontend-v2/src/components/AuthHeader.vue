<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  setLocale,
  SUPPORTED_LOCALES,
  type LocaleCode,
  type LocaleOption,
} from '../i18n';

withDefaults(
  defineProps<{
    /** Hide the language selector (e.g. on the verify-email page). */
    showLanguage?: boolean;
    /** Anchor the logo to the left vs centered. */
    align?: 'left' | 'center';
  }>(),
  { showLanguage: true, align: 'center' }
);

const { locale } = useI18n();
const open = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);

const selected = computed<LocaleOption>(
  () =>
    SUPPORTED_LOCALES.find((opt) => opt.code === locale.value) ?? SUPPORTED_LOCALES[0]
);

function toggle() {
  open.value = !open.value;
}

async function pick(code: LocaleCode) {
  await setLocale(code);
  open.value = false;
}

function onDocClick(event: MouseEvent) {
  if (!wrapperRef.value) return;
  if (!wrapperRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <header
    class="mb-10 flex items-center"
    :class="align === 'center' ? 'justify-center' : 'justify-between'"
  >
    <img src="/images/logo.svg" alt="IEEE" class="h-7" />

    <div v-if="showLanguage" ref="wrapperRef" class="relative ml-auto">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        :aria-expanded="open"
        aria-haspopup="listbox"
        @click="toggle"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
        <span class="uppercase">{{ selected.code }}</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3 transition-transform" :class="open && 'rotate-180'" aria-hidden="true">
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
          class="absolute right-0 top-full z-20 mt-2 w-48 origin-top-right overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
        >
          <li v-for="option in SUPPORTED_LOCALES" :key="option.code" role="option" :aria-selected="selected.code === option.code">
            <button
              type="button"
              :class="[
                'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                selected.code === option.code
                  ? 'bg-ieee-50 text-ieee-800 font-semibold'
                  : 'text-slate-700 hover:bg-slate-50',
              ]"
              @click="pick(option.code)"
            >
              <span>{{ option.label }}</span>
              <span class="rounded-md bg-ieee-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-ieee-700">
                {{ option.code }}
              </span>
            </button>
          </li>
        </ul>
      </Transition>
    </div>
  </header>
</template>
