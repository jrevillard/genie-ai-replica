<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ArrowDown01Icon,
  Notification03Icon,
  PlusSignIcon,
  Settings01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'vue-router';
import BaseAvatar from '../ui/BaseAvatar.vue';
import Icon from '../ui/Icon.vue';
import { useAuthStore } from '../../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const prompt = ref('');
const menuOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);

const displayName = computed(
  () => auth.user?.fullName || auth.user?.loginName || auth.user?.email || 'User name'
);

function onClickOutside(e: MouseEvent) {
  if (!menuRef.value) return;
  if (!menuRef.value.contains(e.target as Node)) menuOpen.value = false;
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside));

async function onSignOut() {
  menuOpen.value = false;
  await auth.signOut();
  router.push({ name: 'signin' });
}
</script>

<template>
  <header class="flex items-center gap-4 border-b border-slate-100 px-6 py-3">
    <!-- Ask me Anything prompt input -->
    <label class="flex flex-1 items-center gap-2 rounded-full bg-slate-50 px-4 py-2.5 ring-1 ring-inset ring-slate-200 focus-within:ring-2 focus-within:ring-ieee-300">
      <span class="text-ieee-600"><Icon :icon="PlusSignIcon" :size="18" /></span>
      <input
        v-model="prompt"
        type="text"
        placeholder="Ask me Anything"
        class="w-full bg-transparent text-sm placeholder-slate-400 outline-none"
      />
    </label>

    <!-- User dropdown -->
    <div ref="menuRef" class="relative">
      <button
        type="button"
        class="flex items-center gap-2 rounded-full bg-white px-2 py-1 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50"
        @click="menuOpen = !menuOpen"
      >
        <BaseAvatar size="sm" :src="(auth.user?.avatar as string) || 'https://i.pravatar.cc/40?img=12'" :name="displayName" />
        <span class="hidden flex-col items-start leading-tight md:flex">
          <span class="text-sm font-medium text-slate-900">{{ displayName }}</span>
          <span class="text-[11px] text-slate-500">Company Admin</span>
        </span>
        <Icon :icon="ArrowDown01Icon" :size="16" />
      </button>

      <Transition name="dropdown">
        <div
          v-if="menuOpen"
          class="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          <div class="border-b border-slate-100 px-4 py-3">
            <p class="truncate text-sm font-semibold text-slate-900">{{ displayName }}</p>
            <p class="truncate text-xs text-slate-500">{{ auth.user?.email || '—' }}</p>
          </div>
          <div class="p-1">
            <button class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <Icon :icon="UserIcon" :size="16" /> Profile
            </button>
            <button class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <Icon :icon="Settings01Icon" :size="16" /> Settings
            </button>
          </div>
          <div class="border-t border-slate-100 p-1">
            <button
              class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              @click="onSignOut"
            >
              Sign out
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Notification bell -->
    <button
      type="button"
      class="relative rounded-full bg-white p-2 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50"
      aria-label="Notifications"
    >
      <Icon :icon="Notification03Icon" :size="18" />
      <span class="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
    </button>
  </header>
</template>

<style scoped>
.dropdown-enter-active, .dropdown-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
