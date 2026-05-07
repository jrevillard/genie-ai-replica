<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{
  open: boolean;
  title?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
}>();

function close() {
  emit('update:open', false);
  emit('close');
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close();
}

onMounted(() => document.addEventListener('keydown', onKeyDown));
onUnmounted(() => document.removeEventListener('keydown', onKeyDown));

// Prevent body scroll while modal is open.
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
    <Transition name="dialog">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="absolute inset-0 bg-neutral-900/35 backdrop-blur-sm" @click="close" />
        <div
          :class="[
            'relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl',
            size === 'sm' && 'max-w-sm',
            size === 'lg' && 'max-w-2xl',
            size === 'xl' && 'max-w-4xl',
            (!size || size === 'md') && 'max-w-md',
          ]"
        >
          <button
            type="button"
            class="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
            :aria-label="t('common.closeDialog', 'Close dialog')"
            @click="close"
          >
            <span class="-mt-px block text-2xl leading-none">&times;</span>
          </button>
          <header v-if="title || description" class="border-b border-neutral-100 px-6 py-4">
            <h2 v-if="title" class="text-base font-semibold text-slate-900">{{ title }}</h2>
            <p v-if="description" class="mt-1 text-sm text-slate-500">{{ description }}</p>
          </header>
          <div class="flex-1 overflow-y-auto px-6 py-5">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-enter-active, .dialog-leave-active {
  transition: opacity 0.18s ease;
}
.dialog-enter-from, .dialog-leave-to {
  opacity: 0;
}
</style>
