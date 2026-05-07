<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useSlots, watch } from 'vue';
import { Cancel01Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons';
import Icon from './Icon.vue';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    badge?: string;
    icon?: unknown;
    width?: 'sm' | 'md' | 'lg';
    showMore?: boolean;
    closeOnBackdrop?: boolean;
    initialFocus?: string;
  }>(),
  {
    width: 'md',
    showMore: false,
    closeOnBackdrop: true,
  }
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
  (e: 'more'): void;
}>();

const slots = useSlots();
const panel = ref<HTMLElement | null>(null);
const previouslyFocused = ref<HTMLElement | null>(null);

function close() {
  emit('update:open', false);
  emit('close');
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
    return;
  }
  if (e.key === 'Tab') {
    trapFocus(e);
  }
}

function trapFocus(e: KeyboardEvent) {
  const root = panel.value;
  if (!root) return;
  const focusables = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown));
onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown);
  document.body.style.overflow = '';
});

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      previouslyFocused.value = (document.activeElement as HTMLElement) ?? null;
      await nextTick();
      const root = panel.value;
      if (!root) return;
      const target = props.initialFocus
        ? root.querySelector<HTMLElement>(props.initialFocus)
        : root.querySelector<HTMLElement>(
            'input:not([type="hidden"]), textarea, [data-autofocus]'
          );
      target?.focus();
    } else {
      previouslyFocused.value?.focus?.();
    }
  }
);

const widthClass = {
  sm: 'w-[min(96vw,440px)]',
  md: 'w-[min(96vw,560px)]',
  lg: 'w-[min(96vw,720px)]',
} as const;
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <div
          class="absolute inset-0 bg-text/30 backdrop-blur-[2px]"
          @click.self="closeOnBackdrop && close()"
        />

        <Transition name="drawer-slide">
          <aside
            v-if="open"
            ref="panel"
            :class="[
              'absolute right-3 top-3 bottom-3 z-10 flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-surface shadow-drawer transition-all duration-300',
              widthClass[width],
            ]"
          >
            <header
              v-if="title || $slots.header"
              class="flex items-center justify-between gap-3 border-b border-border-subtle px-6 py-4"
            >
              <slot name="header">
                <div class="flex min-w-0 items-center gap-3">
                  <span
                    v-if="icon"
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-text-muted ring-1 ring-inset ring-border"
                  >
                    <Icon :icon="icon" :size="20" />
                  </span>
                  <h2 class="truncate text-title text-text">{{ title }}</h2>
                  <span
                    v-if="badge"
                    class="hidden shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 text-caption font-medium text-text-muted ring-1 ring-inset ring-border sm:inline-flex"
                  >
                    {{ badge }}
                  </span>
                </div>
              </slot>
              <div class="flex items-center gap-1 text-text-muted">
                <button
                  v-if="showMore"
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-surface-subtle hover:text-text"
                  :aria-label="t('common.moreOptions', 'More options')"
                  @click="emit('more')"
                >
                  <Icon :icon="MoreHorizontalIcon" :size="18" />
                </button>
                <button
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-inset ring-border transition hover:bg-surface-subtle hover:text-text"
                  :aria-label="t('common.closeDrawer', 'Close drawer')"
                  @click="close"
                >
                  <Icon :icon="Cancel01Icon" :size="18" />
                </button>
              </div>
            </header>

            <div class="flex-1 overflow-y-auto px-6 py-5">
              <slot />
            </div>

            <footer
              v-if="slots.footer"
              class="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4"
            >
              <slot name="footer" />
            </footer>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
</style>
