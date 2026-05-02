<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft01Icon, Cancel01Icon, Edit02Icon } from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { sileo } from '../lib/notify';
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
import { useAiTwinsStore } from '../stores/aiTwins';

interface EditableTab {
  save?: () => Promise<boolean> | boolean;
  discard?: () => void;
}

const route = useRoute();
const router = useRouter();
const store = useAiTwinsStore();
const { current: twin, loading, saving } = storeToRefs(store);

const active = ref(true);
const tab = ref<string>('general');
const deleteDialog = ref(false);
const deleting = ref(false);
const editing = ref(false);
const activeTab = ref<EditableTab | null>(null);

const tabs: TabItem[] = [
  { value: 'general', label: 'General' },
  { value: 'voice', label: 'Voice' },
  { value: 'personality', label: 'AI Personality' },
  { value: 'knowledge', label: 'Knowledge Set' },
  { value: 'system-prompt', label: 'System Prompt' },
  { value: 'instructions', label: 'Instructions' },
];

const twinId = computed(() => String(route.params.id ?? ''));

async function loadTwin() {
  if (!twinId.value) return;
  try {
    await store.fetchOne(twinId.value);
  } catch {
    // store.error is already set; the empty state below will render.
  }
}

onMounted(loadTwin);
watch(twinId, loadTwin);

watch(tab, () => {
  if (editing.value) {
    activeTab.value?.discard?.();
    editing.value = false;
  }
});

function goBack() {
  router.back();
}

function startEditing() {
  editing.value = true;
}

function cancelEditing() {
  activeTab.value?.discard?.();
  editing.value = false;
}

async function saveChanges() {
  const ok = await Promise.resolve(activeTab.value?.save?.() ?? true);
  if (ok) editing.value = false;
}

async function confirmDelete() {
  if (!twin.value) return;
  deleting.value = true;
  try {
    await store.remove(twin.value._key);
    deleteDialog.value = false;
    sileo.success({ title: 'AI Twin deleted' });
    router.push({ name: 'ai-twins' });
  } catch {
    sileo.error({ title: store.error ?? 'Failed to delete AI Twin' });
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-white p-6">
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
            <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="lg" />
            <span class="chip">{{ twin.name }}</span>
            <BaseToggle v-model="active" :label="active ? 'Active' : 'Inactive'" />
          </div>
          <BaseButton variant="danger" size="md" :loading="deleting" @click="deleteDialog = true">
            Delete AI Twin
          </BaseButton>
        </header>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <BaseTabs v-model="tab" :tabs="tabs" />

          <Transition name="edit-actions" mode="out-in">
            <div v-if="!editing" key="view" class="flex items-center gap-2">
              <BaseButton variant="outline" size="md" rounded="full" @click="startEditing">
                <Icon :icon="Edit02Icon" :size="16" />
                Update
              </BaseButton>
            </div>
            <div v-else key="edit" class="flex items-center gap-2">
              <span
                class="hidden items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 sm:inline-flex"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Editing
              </span>
              <BaseButton
                variant="ghost"
                size="md"
                rounded="full"
                :disabled="saving"
                @click="cancelEditing"
              >
                Cancel
              </BaseButton>
              <BaseButton
                variant="primary"
                size="md"
                rounded="full"
                :loading="saving"
                @click="saveChanges"
              >
                Save Changes
              </BaseButton>
            </div>
          </Transition>
        </div>

        <div
          :class="[
            'rounded-2xl border bg-white p-6 shadow-sm transition-colors',
            editing ? 'border-ieee-200 ring-1 ring-ieee-100' : 'border-neutral-200',
          ]"
        >
          <GeneralTab
            v-if="tab === 'general'"
            ref="activeTab"
            :twin="twin"
            :editing="editing"
          />
          <VoiceTab v-else-if="tab === 'voice'" ref="activeTab" />
          <PersonalityTab v-else-if="tab === 'personality'" ref="activeTab" />
          <KnowledgeSetTab v-else-if="tab === 'knowledge'" ref="activeTab" />
          <SystemPromptTab v-else-if="tab === 'system-prompt'" ref="activeTab" />
          <InstructionsTab v-else-if="tab === 'instructions'" ref="activeTab" />
        </div>
      </template>

      <div v-else-if="loading" class="space-y-4">
        <div class="h-16 animate-pulse rounded-2xl bg-neutral-100" />
        <div class="h-12 animate-pulse rounded-2xl bg-neutral-100" />
        <div class="h-64 animate-pulse rounded-2xl bg-neutral-100" />
      </div>

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
        size="sm"
      >
        <div class="pr-10">
          <h2 class="text-lg font-semibold text-slate-950">Delete AI Twin</h2>
          <p class="mt-2 text-sm leading-6 text-slate-500">
            This action can't be undone. All chats and call history attached to this twin will be removed.
          </p>
        </div>
        <div class="mt-7 flex justify-end">
          <BaseButton variant="danger" :loading="deleting" @click="confirmDelete">Yes, delete</BaseButton>
        </div>
      </BaseDialog>
    </section>
  </DashboardLayout>
</template>

<style scoped>
.edit-actions-enter-active,
.edit-actions-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.edit-actions-enter-from,
.edit-actions-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
