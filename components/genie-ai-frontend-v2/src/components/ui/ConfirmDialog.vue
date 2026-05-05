<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'primary';
    loading?: boolean;
  }>(),
  {
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    tone: 'danger',
    loading: false,
  }
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function close() {
  if (props.loading) return;
  emit('update:open', false);
  emit('cancel');
}

function onConfirm() {
  if (props.loading) return;
  emit('confirm');
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') close();
  if (e.key === 'Enter') onConfirm();
}

onMounted(() => document.addEventListener('keydown', onKeyDown));
onUnmounted(() => document.removeEventListener('keydown', onKeyDown));

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="absolute inset-0 bg-neutral-900/35 backdrop-blur-sm"
          @click="close"
        />
        <div
          class="relative z-10 w-full max-w-[380px] rounded-[28px] bg-white p-6 text-center shadow-[0_24px_64px_-16px_rgba(15,23,42,0.35)]"
        >
          <h2 class="text-lg font-semibold text-slate-900">{{ title }}</h2>
          <p v-if="description" class="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-slate-500">
            {{ description }}
          </p>

          <div class="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              class="flex-1 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="loading"
              @click="close"
            >
              {{ cancelLabel }}
            </button>
            <button
              type="button"
              :class="[
                'flex-1 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                tone === 'danger'
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : 'bg-ieee-700 text-white hover:bg-ieee-800',
              ]"
              :disabled="loading"
              @click="onConfirm"
            >
              <span
                v-if="loading"
                class="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden="true"
              />
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}
.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
.confirm-enter-active > div:last-child,
.confirm-leave-active > div:last-child {
  transition: transform 0.18s ease;
}
.confirm-enter-from > div:last-child {
  transform: scale(0.96);
}
.confirm-leave-to > div:last-child {
  transform: scale(0.96);
}
</style>
