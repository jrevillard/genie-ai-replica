<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  AiBrain01Icon,
  ArrowRight01Icon,
  ChartHistogramIcon,
  MessageMultiple01Icon,
  Notification03Icon,
  Search01Icon,
  Settings01Icon,
  SparklesIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import Icon from '../ui/Icon.vue';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const search = ref('');
const commandOpen = ref(false);

const items = [
  { group: 'Pages', label: 'AI Twins', description: 'Create and manage AI Twins', to: '/ai-twins', icon: SparklesIcon },
  { group: 'Pages', label: 'Chat/Call History', description: 'Review chats, calls, transcripts, and summaries', to: '/chat-history', icon: MessageMultiple01Icon },
  { group: 'Pages', label: 'Knowledge Set', description: 'Upload and ingest files for AI Twins', to: '/knowledge-set', icon: AiBrain01Icon },
  { group: 'Pages', label: 'Statistics', description: 'Usage and engagement metrics', to: '/statistics', icon: ChartHistogramIcon },
  { group: 'Useful routes', label: 'Profile', description: 'User profile area', to: '/ai-twins', icon: UserIcon },
  { group: 'Useful routes', label: 'Settings', description: 'Workspace configuration', to: '/ai-twins', icon: Settings01Icon },
];

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    `${item.label} ${item.description} ${item.group}`.toLowerCase().includes(q)
  );
});

const groupedItems = computed(() => {
  return filteredItems.value.reduce<Record<string, typeof items>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});
});

function openCommand() {
  commandOpen.value = true;
}

function closeCommand() {
  commandOpen.value = false;
}

function navigate(to: string) {
  closeCommand();
  router.push(to);
}
</script>

<template>
  <header class="flex shrink-0 items-center gap-4 border-b border-neutral-300 bg-neutral-100 px-6 py-3">
    <label class="flex w-full max-w-md items-center gap-2 rounded-full border border-neutral-300 bg-neutral-50 px-4 py-2.5 shadow-sm transition focus-within:ring-2 focus-within:ring-ieee-700">
      <span class="text-ieee-700"><Icon :icon="Search01Icon" :size="18" /></span>
      <input
        v-model="search"
        type="text"
        placeholder="Search dashboard..."
        class="w-full bg-transparent text-sm placeholder-slate-400 outline-none"
        @focus="openCommand"
        @click="openCommand"
      />
    </label>

    <div class="flex-1" />

    <div class="flex items-center gap-2 rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1 shadow-sm">
      <BaseAvatar size="sm" :src="auth.user?.avatar ?? null" :name="auth.displayName" />
      <span class="hidden flex-col items-start leading-tight md:flex">
        <span class="text-sm font-medium text-slate-900">{{ auth.displayName }}</span>
        <span v-if="auth.email" class="text-[11px] text-slate-500">{{ auth.email }}</span>
      </span>
      <span
        v-if="auth.role"
        class="hidden rounded-full bg-ieee-50 px-2 py-0.5 text-[11px] font-semibold text-ieee-700 md:inline"
      >
        {{ auth.role }}
      </span>
    </div>

    <button
      type="button"
      class="relative rounded-full border border-neutral-300 bg-neutral-50 p-2 shadow-sm transition hover:bg-neutral-200/70"
      aria-label="Notifications"
    >
      <Icon :icon="Notification03Icon" :size="18" />
      <span class="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-neutral-50" />
    </button>

    <Teleport to="body">
      <div v-if="commandOpen" class="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/25 px-4 pt-20 backdrop-blur-sm" @click.self="closeCommand">
        <section class="w-full max-w-2xl overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-2xl">
          <div class="border-b border-neutral-100 p-3">
            <label class="flex h-12 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4">
              <Icon :icon="Search01Icon" :size="19" class="text-neutral-500" />
              <input
                v-model="search"
                type="text"
                placeholder="Search documentation..."
                class="w-full bg-transparent text-base text-neutral-950 outline-none placeholder:text-neutral-500"
                autofocus
                @keydown.esc="closeCommand"
              />
            </label>
          </div>

          <div class="max-h-[520px] overflow-y-auto p-3">
            <div v-if="filteredItems.length" class="space-y-5">
              <section v-for="(groupItems, group) in groupedItems" :key="group">
                <h2 class="px-3 pb-2 text-sm font-medium text-neutral-500">{{ group }}</h2>
                <div class="space-y-1">
                  <button
                    v-for="item in groupItems"
                    :key="`${group}-${item.label}`"
                    type="button"
                    class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-neutral-100"
                    @click="navigate(item.to)"
                  >
                    <span class="grid h-8 w-8 place-items-center rounded-full bg-ieee-50 text-ieee-700">
                      <Icon :icon="item.icon" :size="17" />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-semibold text-neutral-950">{{ item.label }}</span>
                      <span class="block truncate text-xs text-neutral-500">{{ item.description }}</span>
                    </span>
                    <Icon :icon="ArrowRight01Icon" :size="17" class="text-neutral-400" />
                  </button>
                </div>
              </section>
            </div>
            <p v-else class="px-3 py-10 text-center text-sm text-neutral-500">No routes found.</p>
          </div>
        </section>
      </div>
    </Teleport>
  </header>
</template>
