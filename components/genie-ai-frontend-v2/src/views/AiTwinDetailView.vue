<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft01Icon,
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
import AiTwinDetailSkeleton from '../components/ui/skeletons/AiTwinDetailSkeleton.vue';
import BaseTabs, { type TabItem } from '../components/ui/BaseTabs.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import GeneralTab from '../components/twin-tabs/GeneralTab.vue';
import VoiceTab from '../components/twin-tabs/VoiceTab.vue';
import PersonalityTab from '../components/twin-tabs/PersonalityTab.vue';
import KnowledgeSetTab from '../components/twin-tabs/KnowledgeSetTab.vue';
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

const tab = ref<string>('general');
const deleteDialog = ref(false);
const deleting = ref(false);
const removeImageDialog = ref(false);
const editing = ref(false);
const activeTab = ref<EditableTab | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const uploadingImage = ref(false);

const tabs: TabItem[] = [
  { value: 'general', label: 'General' },
  { value: 'voice', label: 'Voice' },
  { value: 'personality', label: 'AI Personality' },
  { value: 'knowledge', label: 'Knowledge Set' },
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
  router.push({ name: 'ai-twins' });
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

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function askRemoveImage() {
  if (uploadingImage.value || !twin.value?.profilePicUrl) return;
  removeImageDialog.value = true;
}

async function confirmRemoveImage() {
  if (!twin.value || uploadingImage.value || !twin.value.profilePicUrl) return;
  uploadingImage.value = true;
  try {
    await store.update(twin.value._key, { profilePicUrl: '' });
    notify.success('Profile picture removed');
    removeImageDialog.value = false;
  } catch {
    notify.error(store.error ?? 'Failed to remove profile picture');
  } finally {
    uploadingImage.value = false;
  }
}

async function onImageChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !twin.value) {
    input.value = '';
    return;
  }
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    notify.error('Image must be JPEG, PNG, WebP, or GIF');
    input.value = '';
    return;
  }
  if (file.size > MAX_AVATAR_BYTES) {
    notify.error('Image must be 5 MB or smaller');
    input.value = '';
    return;
  }

  uploadingImage.value = true;
  try {
    await store.uploadAvatar(twin.value._key, file);
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
    <section class="min-h-full space-y-6 bg-surface p-6 pb-10">
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
          <div class="flex items-center gap-4">
            <div class="relative shrink-0">
              <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="xl" />

              <button
                v-if="twin.profilePicUrl"
                type="button"
                class="absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ieee-700 text-white shadow-md ring-2 ring-white transition hover:bg-ieee-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="uploadingImage"
                aria-label="Remove profile picture"
                title="Remove profile picture"
                @click="askRemoveImage"
              >
                <Icon :icon="Cancel01Icon" :size="12" />
              </button>

              <button
                type="button"
                class="absolute -bottom-1 left-1/2 inline-flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-white text-ieee-700 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="uploadingImage"
                :aria-label="twin.profilePicUrl ? 'Change profile picture' : 'Upload profile picture'"
                :title="twin.profilePicUrl ? 'Change profile picture' : 'Upload profile picture'"
                @click="pickImage"
              >
                <Icon :icon="Camera01Icon" :size="14" />
              </button>

              <span
                v-if="uploadingImage"
                class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white"
              >
                <span class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              </span>
            </div>
            <input
              ref="imageInput"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              class="hidden"
              @change="onImageChange"
            />
            <BaseButton variant="primary" size="md" rounded="xl" @click="chatWithTwin">
              IEEE Page
            </BaseButton>
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
            <KnowledgeSetTab v-else-if="tab === 'knowledge'" ref="activeTab" :twin="twin" />
            <InstructionsTab v-else-if="tab === 'instructions'" ref="activeTab" />
          </div>
        </fieldset>
      </template>

      <AiTwinDetailSkeleton v-else-if="loading" />

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

      <BaseDialog
        v-model:open="removeImageDialog"
        size="sm"
      >
        <div class="pr-10">
          <h2 class="text-title text-text">Remove profile picture?</h2>
          <p class="mt-2 text-body leading-6 text-text-muted">
            The current profile picture will be removed and the twin will fall back to its initials.
          </p>
        </div>
        <div class="mt-7 flex justify-end gap-3">
          <BaseButton
            variant="ghost"
            :disabled="uploadingImage"
            @click="removeImageDialog = false"
          >
            Cancel
          </BaseButton>
          <BaseButton
            variant="danger"
            :loading="uploadingImage"
            @click="confirmRemoveImage"
          >
            Remove
          </BaseButton>
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
