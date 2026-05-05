<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  AiBrain01Icon,
  Logout01Icon,
  MessageMultiple01Icon,
  Search01Icon,
  SidebarLeftIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { notify } from '../../lib/notify';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import Icon from '../ui/Icon.vue';
import CommandPalette from './CommandPalette.vue';

defineProps<{
  collapsed: boolean;
}>();

defineEmits<{
  (e: 'toggle'): void;
}>();

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const logoutDialogOpen = ref(false);
const paletteOpen = ref(false);

interface NavItem {
  label: string;
  icon: unknown;
  to: string;
}

const items: NavItem[] = [
  { label: 'AI Twins', icon: SparklesIcon, to: '/ai-twins' },
  { label: 'Chat/Call History', icon: MessageMultiple01Icon, to: '/chat-history' },
  { label: 'Knowledge Set', icon: AiBrain01Icon, to: '/knowledge-set' },
];

const userInitials = computed(() => {
  const source = auth.displayName || auth.email || '';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || '?';
});

async function onLogout() {
  logoutDialogOpen.value = false;
  try {
    await auth.signOut();
    notify.success('Signed out', 'See you soon!');
  } catch (err) {
    const e = err as { message?: string };
    notify.error('Sign-out failed', e?.message ?? 'Could not complete sign-out.');
  } finally {
    router.push({ name: 'signin' });
  }
}

function isNavActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`);
}
</script>

<template>
  <aside :class="['dash-sidebar', collapsed && 'dash-sidebar--collapsed']">
    <header
      :class="[
        'gap-2 border-b border-border-subtle p-4',
        collapsed ? 'flex flex-col items-center' : 'flex items-center justify-between',
      ]"
    >
      <img v-if="!collapsed" src="/images/logo.svg" alt="IEEE" class="h-7" />
      <img v-else src="/images/logo.svg" alt="IEEE" class="h-7 w-full object-contain" />
      <div :class="collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'">
        <button
          type="button"
          class="rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-subtle hover:text-text"
          title="Search"
          aria-label="Search"
          @click="paletteOpen = true"
        >
          <Icon :icon="Search01Icon" :size="18" />
        </button>
        <button
          type="button"
          class="rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-subtle hover:text-text"
          :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="$emit('toggle')"
        >
          <Icon :icon="SidebarLeftIcon" :size="18" />
        </button>
      </div>
    </header>

    <nav class="flex-1 space-y-1 p-3">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ navigate }"
      >
        <button
          type="button"
          :class="['dash-nav-item w-full', isNavActive(item.to) && 'dash-nav-item--active', collapsed && 'justify-center']"
          @click="navigate"
        >
          <Icon :icon="item.icon" :size="20" />
          <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        </button>
      </RouterLink>
    </nav>

    <footer class="space-y-2 border-t border-border-subtle p-3">
      <RouterLink
        to="/profile"
        custom
        v-slot="{ navigate }"
      >
        <button
          type="button"
          :class="[
            'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-surface-subtle',
            isNavActive('/profile') && 'bg-surface-subtle',
            collapsed && 'justify-center px-0',
          ]"
          :aria-label="collapsed ? 'Profile' : undefined"
          @click="navigate"
        >
          <span
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ieee-50 text-xs font-semibold uppercase text-ieee-700"
            aria-hidden="true"
          >
            {{ userInitials }}
          </span>
          <span v-if="!collapsed" class="flex min-w-0 flex-1 flex-col leading-tight">
            <span class="truncate text-sm font-semibold text-text">{{ auth.displayName }}</span>
            <span v-if="auth.email" class="truncate text-[11px] text-text-subtle">{{ auth.email }}</span>
          </span>
        </button>
      </RouterLink>

      <button
        type="button"
        :class="[
          'flex w-full items-center gap-3 rounded-xl bg-danger-soft px-3 py-2.5 text-body font-semibold text-danger transition hover:bg-danger/10',
          collapsed && 'justify-center',
        ]"
        :aria-label="collapsed ? 'Log out' : undefined"
        @click="logoutDialogOpen = true"
      >
        <Icon :icon="Logout01Icon" :size="20" />
        <span v-if="!collapsed">Log Out</span>
      </button>
    </footer>

    <ConfirmDialog
      v-model:open="logoutDialogOpen"
      title="Log out?"
      description="You will be signed out of this admin workspace."
      confirm-label="Log Out"
      @confirm="onLogout"
    />

    <CommandPalette v-model:open="paletteOpen" />
  </aside>
</template>
