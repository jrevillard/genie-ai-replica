<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseDialog from '../components/ui/BaseDialog.vue';
import BaseTabs, { type TabItem } from '../components/ui/BaseTabs.vue';
import BaseToggle from '../components/ui/BaseToggle.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import GeneralTab from '../components/twin-tabs/GeneralTab.vue';
import VoiceTab from '../components/twin-tabs/VoiceTab.vue';
import PersonalityTab from '../components/twin-tabs/PersonalityTab.vue';
import KnowledgeSetTab from '../components/twin-tabs/KnowledgeSetTab.vue';
import SystemPromptTab from '../components/twin-tabs/SystemPromptTab.vue';
import InstructionsTab from '../components/twin-tabs/InstructionsTab.vue';
import { mockTwins } from '../lib/mockTwins';

const route = useRoute();
const router = useRouter();

const twin = computed(() => mockTwins.find((t) => t.id === route.params.id));
const active = ref(true);
const tab = ref<string>('general');
const deleteDialog = ref(false);

const tabs: TabItem[] = [
  { value: 'general', label: 'General' },
  { value: 'voice', label: 'Voice' },
  { value: 'personality', label: 'AI Personality' },
  { value: 'knowledge', label: 'Knowledge Set' },
  { value: 'system-prompt', label: 'System Prompt' },
  { value: 'instructions', label: 'Instructions' },
];

function goBack() {
  router.back();
}

function confirmDelete() {
  deleteDialog.value = false;
  router.push({ name: 'ai-twins' });
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 p-6">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100"
        @click="goBack"
      >
        <Icon :icon="ArrowLeft01Icon" :size="18" />
      </button>

      <template v-if="twin">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <BaseAvatar :src="twin.avatar" :name="twin.name" size="lg" />
            <span class="chip">IEEE Page</span>
            <BaseToggle v-model="active" :label="active ? 'Active' : 'Inactive'" />
          </div>
          <BaseButton variant="danger" size="md" @click="deleteDialog = true">
            Delete AI Twin
          </BaseButton>
        </header>

        <BaseTabs v-model="tab" :tabs="tabs" />

        <div class="rounded-2xl border border-slate-200 bg-white p-6">
          <GeneralTab v-if="tab === 'general'" :twin="twin" />
          <VoiceTab v-else-if="tab === 'voice'" />
          <PersonalityTab v-else-if="tab === 'personality'" />
          <KnowledgeSetTab v-else-if="tab === 'knowledge'" />
          <SystemPromptTab v-else-if="tab === 'system-prompt'" />
          <InstructionsTab v-else-if="tab === 'instructions'" />
        </div>
      </template>

      <EmptyState
        v-else
        :icon="Cancel01Icon"
        title="Twin not found"
        description="This AI Twin doesn't exist or has been deleted."
      >
        <BaseButton variant="primary" @click="router.push({ name: 'ai-twins' })">Back to list</BaseButton>
      </EmptyState>

      <BaseDialog
        v-model:open="deleteDialog"
        title="Delete AI Twin"
        description="This action can't be undone. All chats and call history attached to this twin will be removed."
        size="sm"
      >
        <template #footer>
          <BaseButton variant="outline" @click="deleteDialog = false">Cancel</BaseButton>
          <BaseButton variant="danger" @click="confirmDelete">Yes, delete</BaseButton>
        </template>
      </BaseDialog>
    </section>
  </DashboardLayout>
</template>
