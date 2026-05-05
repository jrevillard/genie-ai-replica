<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  AiBrain01Icon,
  ArrowRight01Icon,
  MessageMultiple01Icon,
  Search01Icon,
  SparklesIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const router = useRouter();
const search = ref('');

interface PaletteItem {
  group: string;
  label: string;
  description: string;
  to: string;
  icon: unknown;
}

const items: PaletteItem[] = [
  { group: 'Pages', label: 'AI Twins', description: 'Create and manage AI Twins', to: '/ai-twins', icon: SparklesIcon },
  { group: 'Pages', label: 'Chat/Call History', description: 'Review chats, calls, transcripts, and summaries', to: '/chat-history', icon: MessageMultiple01Icon },
  { group: 'Pages', label: 'Knowledge Set', description: 'Upload and ingest files for AI Twins', to: '/knowledge-set', icon: AiBrain01Icon },
  { group: 'Useful routes', label: 'Profile', description: 'User profile area', to: '/profile', icon: UserIcon },
];

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    `${item.label} ${item.description} ${item.group}`.toLowerCase().includes(q)
  );
});

const groupedItems = computed(() => {
  return filteredItems.value.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});
});

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) search.value = '';
  }
);

function close() {
  emit('update:open', false);
}

function navigate(to: string) {
  close();
  router.push(to);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/25 px-4 pt-20 backdrop-blur-sm"
      @click.self="close"
    >
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
              @keydown.esc="close"
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
</template>
