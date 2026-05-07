<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { SidebarLeftIcon } from '@hugeicons/core-free-icons';
import Sidebar from '../components/dashboard/Sidebar.vue';
import Icon from '../components/ui/Icon.vue';
import { useT } from '../i18n/composables';

const { t } = useT();
const collapsed = ref(false);
const mobileOpen = ref(false);
const route = useRoute();

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  }
);

function closeMobile(): void {
  mobileOpen.value = false;
}
</script>

<template>
  <div class="dash-shell">
    <Sidebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />

    <Teleport to="body">
      <Transition name="drawer-fade">
        <div
          v-if="mobileOpen"
          class="fixed inset-0 z-40 bg-black/45 md:hidden"
          aria-hidden="true"
          @click="closeMobile"
        />
      </Transition>
      <Transition name="drawer-slide">
        <div
          v-if="mobileOpen"
          class="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] md:hidden"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          @keydown.esc="closeMobile"
        >
          <Sidebar :collapsed="false" mobile @close="closeMobile" />
        </div>
      </Transition>
    </Teleport>

    <main class="dash-main">
      <!-- Inset margin shows gray behind; only the inner card scrolls (sticky chrome). -->
      <div class="dash-main__card scrollbar-thin">
        <div
          class="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur md:hidden"
        >
          <button
            type="button"
            class="grid h-9 w-9 place-items-center rounded-lg text-text-subtle transition hover:bg-surface-subtle hover:text-text"
            :aria-label="t('common.openMenu', 'Open menu')"
            @click="mobileOpen = true"
          >
            <Icon :icon="SidebarLeftIcon" :size="20" />
          </button>
          <img src="/images/logo.svg" alt="IEEE" class="h-6" />
        </div>
        <slot />
      </div>
    </main>
  </div>
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
  transition: transform 0.25s ease;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(-100%);
}
</style>
