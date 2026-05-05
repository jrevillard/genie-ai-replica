<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Cancel01Icon, Search01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import UserTwinCard from '../components/dashboard/UserTwinCard.vue';
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
const { publicTwins, loading } = storeToRefs(store);

const search = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return publicTwins.value;
  return publicTwins.value.filter((tw) => tw.name.toLowerCase().includes(q));
});

function loadTwins() {
  store.fetchAllPublic().catch(() => {
    notify.error(store.error ?? t('twins.list.loadFailedToast', 'Failed to load AI Twins'));
  });
}

onMounted(loadTwins);
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h1 class="text-headline text-text">{{ t('user.twins.title', 'My AI Twins') }}</h1>
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
      </header>

      <div v-if="loading && !filtered.length" class="grid gap-4 lg:grid-cols-2">
        <AiTwinCardSkeleton v-for="n in 4" :key="n" />
      </div>

      <div v-else-if="filtered.length" class="grid gap-4 lg:grid-cols-2">
        <UserTwinCard v-for="twin in filtered" :key="twin._key" :twin="twin" />
      </div>

      <EmptyState
        v-else-if="store.error && !search.trim()"
        :icon="SparklesIcon"
        :title="t('twins.list.loadFailedTitle', `Couldn't load AI Twins`)"
        :description="store.error"
      >
        <BaseButton variant="primary" size="md" @click="loadTwins">{{ t('common.retry', 'Retry') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else-if="search.trim()"
        :icon="Search01Icon"
        :title="t('twins.list.noMatchesTitle', 'No matches')"
        :description="t('twins.list.noMatchesBody', 'No AI Twins match your search. Try a different keyword or clear the filter.')"
      >
        <BaseButton variant="outline" size="md" @click="search = ''">{{ t('twins.list.clearSearch', 'Clear search') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        :icon="SparklesIcon"
        :title="t('user.twins.emptyTitle', 'No AI Twins available')"
        :description="t('user.twins.emptyBody', 'There are no AI Twins to chat with right now. Check back later.')"
      />
    </section>
  </DashboardLayout>
</template>
