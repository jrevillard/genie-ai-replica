<script setup lang="ts">
import { computed, ref } from 'vue';
import { AiBrain01Icon, PlusSignIcon, Search01Icon } from '@hugeicons/core-free-icons';
import AiTwinCard from '../components/dashboard/AiTwinCard.vue';
import CreateAiTwinDialog from '../components/dashboard/CreateAiTwinDialog.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { mockTwins, type AiTwin } from '../lib/mockTwins';

const twins = ref<AiTwin[]>([...mockTwins]);
const search = ref('');
const dialogOpen = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return twins.value;
  return twins.value.filter((t) => t.name.toLowerCase().includes(q));
});

function onCreated(payload: { name: string; description: string; avatar: string | null }) {
  twins.value.unshift({
    id: `twin-${Date.now()}`,
    name: payload.name,
    avatar: payload.avatar ?? '',
    dateEdited: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    dateCreated: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    voiceLibrary: '—',
    numberOfChats: 0,
    numberOfCalls: 0,
    active: true,
    description: payload.description,
  });
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 p-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-semibold text-slate-900">AI Twins</h1>
          <div class="w-64">
            <BaseInput
              v-model="search"
              placeholder="Search"
              size="sm"
              rounded="full"
            >
              <template #leading><Icon :icon="Search01Icon" :size="16" /></template>
            </BaseInput>
          </div>
        </div>
        <BaseButton variant="primary" size="md" rounded="lg" @click="dialogOpen = true">
          <Icon :icon="PlusSignIcon" :size="16" />
          Create AI Twin
        </BaseButton>
      </header>

      <div v-if="filtered.length" class="grid gap-4 lg:grid-cols-2">
        <AiTwinCard v-for="twin in filtered" :key="twin.id" :twin="twin" />
      </div>

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
