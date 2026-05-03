<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft01Icon,
  BubbleChatIcon,
  Camera01Icon,
  Cancel01Icon,
  Edit02Icon,
} from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseBadge from '../components/ui/BaseBadge.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseDialog from '../components/ui/BaseDialog.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
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
const imageInput = ref<HTMLInputElement | null>(null);
const uploadingImage = ref(false);

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

function chatWithTwin() {
  if (!twin.value) return;
  const href = router.resolve({ name: 'chat', params: { twinId: twin.value._key } }).href;
  window.open(href, '_blank', 'noopener');
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

function pickImage() {
  if (uploadingImage.value) return;
  imageInput.value?.click();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

async function onImageChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !twin.value) {
    input.value = '';
    return;
  }
  if (!file.type.startsWith('image/')) {
    notify.error('Please select an image file');
    input.value = '';
    return;
  }

  uploadingImage.value = true;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await store.update(twin.value._key, { profilePicUrl: dataUrl });
    notify.success('Profile picture updated');
  } catch {
    notify.error(store.error ?? 'Failed to update profile picture');
  } finally {
    uploadingImage.value = false;
    input.value = '';
  }
}

async function confirmDelete() {
  if (!twin.value) return;
  deleting.value = true;
  try {
    await store.remove(twin.value._key);
    deleteDialog.value = false;
    notify.success('AI Twin deleted');
    router.push({ name: 'ai-twins' });
  } catch {
    notify.error(store.error ?? 'Failed to delete AI Twin');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full bg-surface-muted p-2 text-text-muted transition hover:bg-surface-subtle hover:text-text"
        aria-label="Go back"
        @click="goBack"
      >
        <Icon :icon="ArrowLeft01Icon" :size="18" />
      </button>

      <template v-if="twin">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="group relative inline-flex shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed"
              :aria-label="twin.profilePicUrl ? 'Change profile picture' : 'Upload profile picture'"
              :title="twin.profilePicUrl ? 'Change profile picture' : 'Upload profile picture'"
              :disabled="uploadingImage"
              @click="pickImage"
            >
              <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="lg" />
              <span
                class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-full bg-black/55 text-white opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <Icon :icon="Camera01Icon" :size="18" />
                <span class="text-[10px] font-medium leading-none">Change</span>
              </span>
              <span
                v-if="uploadingImage"
                class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white"
              >
                <span class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              </span>
            </button>
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onImageChange"
            />
            <BaseButton variant="primary" size="md" rounded="full" @click="chatWithTwin">
              <Icon :icon="BubbleChatIcon" :size="16" />
              Chat
            </BaseButton>
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
              <BaseBadge tone="warning" dot class="hidden sm:inline-flex">Editing</BaseBadge>
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

        <fieldset
          :disabled="!editing"
          :class="[
            'rounded-2xl border bg-surface p-6 shadow-card transition-colors',
            editing ? 'border-accent/30 ring-1 ring-accent/10' : 'border-border',
            !editing && 'opacity-70',
          ]"
        >
          <div :class="!editing && 'pointer-events-none select-none'">
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
        </fieldset>
      </template>

      <div v-else-if="loading" class="space-y-4">
        <BaseSkeleton height="4rem" />
        <BaseSkeleton height="3rem" />
        <BaseSkeleton height="16rem" />
      </div>

      <EmptyState
        v-else-if="store.error"
        :icon="Cancel01Icon"
        title="Couldn't load AI Twin"
        :description="store.error"
      >
        <BaseButton variant="primary" @click="loadTwin">Retry</BaseButton>
      </EmptyState>

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
          <h2 class="text-title text-text">Delete AI Twin</h2>
          <p class="mt-2 text-body leading-6 text-text-muted">
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
