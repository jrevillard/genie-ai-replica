<script setup lang="ts">
import { ref } from 'vue';
import {
  AiBrain01Icon,
  Logout01Icon,
  MessageMultiple01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import BaseButton from '../ui/BaseButton.vue';
import BaseDialog from '../ui/BaseDialog.vue';
import Icon from '../ui/Icon.vue';

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

async function onLogout() {
  logoutDialogOpen.value = false;
  await auth.signOut();
  router.push({ name: 'signin' });
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
      <button
        type="button"
        class="rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-subtle hover:text-text"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
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
            'dash-nav-item w-full',
            isNavActive('/profile') && 'dash-nav-item--active',
            collapsed && 'justify-center',
          ]"
          :aria-label="collapsed ? 'Profile' : undefined"
          @click="navigate"
        >
          <Icon :icon="UserIcon" :size="20" />
          <span v-if="!collapsed" class="truncate">Profile</span>
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

    <BaseDialog
      v-model:open="logoutDialogOpen"
      size="sm"
    >
      <div class="pr-10">
        <h2 class="text-title text-text">Log out?</h2>
        <p class="mt-2 text-body leading-6 text-text-muted">
          You will be signed out of this admin workspace.
        </p>
      </div>
      <div class="mt-7 flex justify-end">
        <BaseButton variant="danger" @click="onLogout">Log Out</BaseButton>
      </div>
    </BaseDialog>
  </aside>
</template>
