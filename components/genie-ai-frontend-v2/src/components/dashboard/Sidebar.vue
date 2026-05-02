<script setup lang="ts">
import {
  AiBrain01Icon,
  ChartHistogramIcon,
  Logout01Icon,
  MessageMultiple01Icon,
  Mortarboard02Icon,
  SidebarLeftIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import Icon from '../ui/Icon.vue';

defineProps<{
  collapsed: boolean;
}>();

defineEmits<{
  (e: 'toggle'): void;
}>();

const router = useRouter();
const auth = useAuthStore();

interface NavItem {
  label: string;
  icon: unknown;
  to: string;
}

const items: NavItem[] = [
  { label: 'AI Twins', icon: AiBrain01Icon, to: '/ai-twins' },
  { label: 'Chat/Call History', icon: MessageMultiple01Icon, to: '/chat-history' },
  { label: 'Knowledge Set', icon: Mortarboard02Icon, to: '/knowledge-set' },
  { label: 'Statistics', icon: ChartHistogramIcon, to: '/statistics' },
];

async function onLogout() {
  await auth.signOut();
  router.push({ name: 'signin' });
}
</script>

<template>
  <aside :class="['dash-sidebar', collapsed && 'dash-sidebar--collapsed']">
    <header class="flex items-center justify-between gap-2 border-b border-slate-100 p-4">
      <img v-if="!collapsed" src="/images/logo.svg" alt="IEEE" class="h-7" />
      <img v-else src="/images/logo.svg" alt="IEEE" class="h-7 w-full object-contain" />
      <button
        type="button"
        class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        :title="collapsed ? 'Expand' : 'Collapse'"
        @click="$emit('toggle')"
      >
        <Icon :icon="SidebarLeftIcon" :size="18" />
      </button>
    </header>

    <nav class="flex-1 space-y-1 p-3">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ isActive, navigate }"
      >
        <button
          type="button"
          :class="['dash-nav-item w-full', isActive && 'dash-nav-item--active', collapsed && 'justify-center']"
          @click="navigate"
        >
          <Icon :icon="item.icon" :size="20" />
          <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        </button>
      </RouterLink>
    </nav>

    <footer class="border-t border-slate-100 p-3">
      <button
        type="button"
        :class="[
          'flex w-full items-center gap-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100',
          collapsed && 'justify-center',
        ]"
        @click="onLogout"
      >
        <Icon :icon="Logout01Icon" :size="20" />
        <span v-if="!collapsed">Log Out</span>
      </button>
    </footer>
  </aside>
</template>
