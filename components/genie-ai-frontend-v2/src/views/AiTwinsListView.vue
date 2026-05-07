<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Cancel01Icon, PlusSignIcon, Search01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import AiTwinCard from '../components/dashboard/AiTwinCard.vue';
import CreateAiTwinDialog from '../components/dashboard/CreateAiTwinDialog.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import AiTwinCardSkeleton from '../components/ui/skeletons/AiTwinCardSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useT } from '../i18n/composables';

const { t } = useT();
const store = useAiTwinsStore();
const { twins, loading } = storeToRefs(store);

const search = ref('');
const dialogOpen = ref(false);
const creating = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const matches = q
    ? twins.value.filter((t) => t.name.toLowerCase().includes(q))
    : twins.value.slice();
  // Sort by creation date (newest first). Backend returns by updatedAt by
  // default, but the list reads more naturally as a chronological roster of
  // when each twin was added.
  return matches.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime() || 0;
    const tb = new Date(b.createdAt || 0).getTime() || 0;
    return tb - ta;
  });
});

function loadTwins() {
  store.fetchAll().catch(() => {
    notify.error(store.error ?? t('twins.list.loadFailedToast', 'Failed to load AI Twins'));
  });
}

onMounted(loadTwins);

async function onCreated(payload: { name: string; description: string; avatarFile: File | null }) {
  if (creating.value) return;
  creating.value = true;
  try {
    const twin = await store.create({
      name: payload.name,
      description: payload.description,
      profilePicUrl: null,
    });
    if (payload.avatarFile) {
      try {
        await store.uploadAvatar(twin._key, payload.avatarFile);
      } catch {
        notify.error(store.error ?? t('twins.list.avatarFailedToast', 'Twin created, but the avatar upload failed.'));
      }
    }
    notify.success(t('twins.list.createdToast', 'AI Twin created'));
    dialogOpen.value = false;
  } catch {
    notify.error(store.error ?? t('twins.list.createFailedToast', 'Failed to create AI Twin'));
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h1 class="text-headline text-text">{{ t('twins.list.title', 'AI Twins') }}</h1>
          <div class="w-full sm:w-[360px]">
            <BaseInput
              v-model="search"
              :placeholder="t('twins.list.searchPlaceholder', 'Search')"
              size="md"
              rounded="full"
            >
              <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
              <template v-if="search" #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-7 w-7 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-text"
                  :aria-label="t('twins.list.clearSearch', 'Clear search')"
                  @click="search = ''"
                >
                  <Icon :icon="Cancel01Icon" :size="14" />
                </button>
              </template>
            </BaseInput>
          </div>
        </div>
        <BaseButton variant="primary" size="md" rounded="full" @click="dialogOpen = true">
          <Icon :icon="PlusSignIcon" :size="16" />
          {{ t('twins.list.create', 'Create AI Twin') }}
        </BaseButton>
      </header>

      <div v-if="loading && !filtered.length" class="grid gap-4 lg:grid-cols-2">
        <AiTwinCardSkeleton v-for="n in 4" :key="n" />
      </div>

      <div v-else-if="filtered.length" class="grid gap-4 lg:grid-cols-2">
        <AiTwinCard v-for="twin in filtered" :key="twin._key" :twin="twin" />
      </div>

      <EmptyState
        v-else-if="store.error && !search.trim()"
        full-height
        :icon="SparklesIcon"
        :title="t('twins.list.loadFailedTitle', `Couldn't load AI Twins`)"
        :description="store.error"
      >
        <BaseButton variant="primary" size="md" @click="loadTwins">{{ t('common.retry', 'Retry') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else-if="search.trim()"
        full-height
        :icon="Search01Icon"
        :title="t('twins.list.noMatchesTitle', 'No matches')"
        :description="t('twins.list.noMatchesBody', 'No AI Twins match your search. Try a different keyword or clear the filter.')"
      >
        <BaseButton variant="outline" size="md" @click="search = ''">{{ t('twins.list.clearSearch', 'Clear search') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        full-height
        :icon="SparklesIcon"
        :title="t('twins.list.emptyTitle', 'No AI Twins yet')"
        :description="t('twins.list.emptyBody', 'Create your first AI Twin to start chatting and tracking conversations.')"
      >
        <BaseButton variant="primary" size="md" @click="dialogOpen = true">
          <Icon :icon="PlusSignIcon" :size="16" />
          {{ t('twins.list.create', 'Create AI Twin') }}
        </BaseButton>
      </EmptyState>
    </section>

    <CreateAiTwinDialog v-model:open="dialogOpen" :submitting="creating" @created="onCreated" />
  </DashboardLayout>
</template>
