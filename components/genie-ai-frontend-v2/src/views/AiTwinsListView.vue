<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { AiBrain01Icon, PlusSignIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import AiTwinCard from '../components/dashboard/AiTwinCard.vue';
import CreateAiTwinDialog from '../components/dashboard/CreateAiTwinDialog.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useAiTwinsStore } from '../stores/aiTwins';

const store = useAiTwinsStore();
const { twins, loading } = storeToRefs(store);

const search = ref('');
const dialogOpen = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return twins.value;
  return twins.value.filter((t) => t.name.toLowerCase().includes(q));
});

function loadTwins() {
  store.fetchAll().catch(() => {
    notify.error(store.error ?? 'Failed to load AI Twins');
  });
}

onMounted(loadTwins);

async function onCreated(payload: { name: string; description: string; avatar: string | null }) {
  try {
    await store.create({
      name: payload.name,
      description: payload.description,
      profilePicUrl: payload.avatar,
    });
    notify.success('AI Twin created');
  } catch {
    notify.error(store.error ?? 'Failed to create AI Twin');
  }
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h1 class="text-headline text-text">AI Twins</h1>
          <div class="w-full sm:w-[360px]">
            <BaseInput
              v-model="search"
              placeholder="Search"
              size="md"
              rounded="full"
            >
              <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
            </BaseInput>
          </div>
        </div>
        <BaseButton variant="primary" size="md" rounded="full" @click="dialogOpen = true">
          <Icon :icon="PlusSignIcon" :size="16" />
          Create AI Twin
        </BaseButton>
      </header>

      <div v-if="loading && !filtered.length" class="grid gap-4 lg:grid-cols-2">
        <BaseSkeleton v-for="n in 4" :key="n" height="11rem" />
      </div>

      <div v-else-if="filtered.length" class="grid gap-4 lg:grid-cols-2">
        <AiTwinCard v-for="twin in filtered" :key="twin._key" :twin="twin" />
      </div>

      <EmptyState
        v-else-if="store.error && !search.trim()"
        :icon="AiBrain01Icon"
        title="Couldn't load AI Twins"
        :description="store.error"
      >
        <BaseButton variant="primary" size="md" @click="loadTwins">Retry</BaseButton>
      </EmptyState>

      <EmptyState
        v-else-if="search.trim()"
        :icon="Search01Icon"
        title="No matches"
        description="No AI Twins match your search. Try a different keyword or clear the filter."
      >
        <BaseButton variant="outline" size="md" @click="search = ''">Clear search</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        :icon="AiBrain01Icon"
        title="No AI Twins yet"
        description="Create your first AI Twin to start chatting and tracking conversations."
      >
        <BaseButton variant="primary" size="md" @click="dialogOpen = true">
          <Icon :icon="PlusSignIcon" :size="16" />
          Create AI Twin
        </BaseButton>
      </EmptyState>
    </section>

    <CreateAiTwinDialog v-model:open="dialogOpen" @created="onCreated" />
  </DashboardLayout>
</template>
