<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft01Icon,
  Camera01Icon,
  Cancel01Icon,
  Delete02Icon,
  Edit02Icon,
} from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseBadge from '../components/ui/BaseBadge.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import ConfirmDialog from '../components/ui/ConfirmDialog.vue';
import AiTwinDetailSkeleton from '../components/ui/skeletons/AiTwinDetailSkeleton.vue';
import BaseTabs, { type TabItem } from '../components/ui/BaseTabs.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import GeneralTab from '../components/twin-tabs/GeneralTab.vue';
import TwinStatsGrid from '../components/twin-tabs/TwinStatsGrid.vue';
import VoiceTab from '../components/twin-tabs/VoiceTab.vue';
import PersonalityTab from '../components/twin-tabs/PersonalityTab.vue';
import KnowledgeSetTab from '../components/twin-tabs/KnowledgeSetTab.vue';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useT } from '../i18n/composables';

const { t } = useT();

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
const imagePreviewOpen = ref(false);

const tabs = computed<TabItem[]>(() => [
  { value: 'general', label: t('twins.tabs.general', 'General') },
  { value: 'voice', label: t('twins.tabs.voice', 'Voice') },
  { value: 'personality', label: t('twins.tabs.personality', 'AI Personality') },
  { value: 'knowledge', label: t('twins.tabs.knowledge', 'Knowledge Set') },
]);

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

const savingTab = ref(false);

async function saveChanges() {
  savingTab.value = true;
  try {
    const ok = await Promise.resolve(activeTab.value?.save?.() ?? true);
    if (ok) editing.value = false;
  } finally {
    savingTab.value = false;
  }
}

function pickImage() {
  if (uploadingImage.value) return;
  imageInput.value?.click();
}

function openImagePreview() {
  if (!twin.value?.profilePicUrl) return;
  imagePreviewOpen.value = true;
}

function closeImagePreview() {
  imagePreviewOpen.value = false;
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
    notify.success(t('twins.detail.toasts.avatarRemoved', 'Profile picture removed'));
    removeImageDialog.value = false;
  } catch {
    notify.error(store.error ?? t('twins.detail.toasts.avatarRemoveFailed', 'Failed to remove profile picture'));
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
    notify.error(t('twins.detail.toasts.imageType', 'Image must be JPEG, PNG, WebP, or GIF'));
    input.value = '';
    return;
  }
  if (file.size > MAX_AVATAR_BYTES) {
    notify.error(t('twins.detail.toasts.imageSize', 'Image must be 5 MB or smaller'));
    input.value = '';
    return;
  }

  uploadingImage.value = true;
  try {
    await store.uploadAvatar(twin.value._key, file);
    notify.success(t('twins.detail.toasts.avatarUpdated', 'Profile picture updated'));
  } catch {
    notify.error(store.error ?? t('twins.detail.toasts.avatarUpdateFailed', 'Failed to update profile picture'));
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
    notify.success(t('twins.detail.toasts.twinDeleted', 'AI Twin deleted'));
    router.push({ name: 'ai-twins' });
  } catch {
    notify.error(store.error ?? t('twins.detail.toasts.deleteFailed', 'Failed to delete AI Twin'));
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
        :aria-label="t('common.goBack', 'Go back')"
        @click="goBack"
      >
        <Icon :icon="ArrowLeft01Icon" :size="18" />
      </button>

      <template v-if="twin">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="relative shrink-0">
              <button
                type="button"
                :class="[
                  'block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700/50',
                  twin.profilePicUrl ? 'cursor-zoom-in' : 'cursor-default',
                ]"
                :aria-label="twin.profilePicUrl ? 'Preview profile picture' : 'Profile picture'"
                :disabled="!twin.profilePicUrl"
                @click="openImagePreview"
              >
                <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="xl" />
              </button>

              <button
                v-if="twin.profilePicUrl"
                type="button"
                class="absolute -right-1 -top-1 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-md ring-2 ring-white transition hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="uploadingImage"
                :aria-label="t('twins.detail.avatar.remove', 'Remove profile picture')"
                :title="t('twins.detail.avatar.remove', 'Remove profile picture')"
                @click.stop="askRemoveImage"
              >
                <Icon :icon="Cancel01Icon" :size="12" />
              </button>

              <button
                type="button"
                class="absolute -bottom-1 left-1/2 z-10 inline-flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-white text-ieee-700 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="uploadingImage"
                :aria-label="twin.profilePicUrl ? t('twins.detail.avatar.change', 'Change profile picture') : t('twins.detail.avatar.upload', 'Upload profile picture')"
                :title="twin.profilePicUrl ? t('twins.detail.avatar.change', 'Change profile picture') : t('twins.detail.avatar.upload', 'Upload profile picture')"
                @click.stop="pickImage"
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
              {{ t('aiTwins.detail.chatWithTwin', 'Chat With Twin') }}
            </BaseButton>
          </div>

          <button
            v-if="!twin?.isDefault"
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-danger/30 bg-danger/5 px-4 text-sm font-semibold text-danger transition duration-200 hover:-translate-y-0.5 hover:border-danger/60 hover:bg-danger/10 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger/50 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="deleting"
            :aria-label="t('twins.detail.delete', 'Delete AI Twin')"
            :title="t('twins.detail.delete', 'Delete AI Twin')"
            @click="deleteDialog = true"
          >
              <span
                v-if="deleting"
                class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden="true"
              />
              <Icon v-else :icon="Delete02Icon" :size="16" />
              <span class="hidden sm:inline">{{ t('twins.detail.delete', 'Delete AI Twin') }}</span>
            </button>
        </header>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <BaseTabs v-model="tab" :tabs="tabs" />

          <Transition name="edit-actions" mode="out-in">
            <div v-if="!editing" key="view" class="flex items-center gap-2">
              <BaseButton variant="outline" size="md" rounded="full" @click="startEditing">
                <Icon :icon="Edit02Icon" :size="16" />
                {{ t('common.update', 'Update') }}
              </BaseButton>
            </div>
            <div v-else key="edit" class="flex items-center gap-2">
              <BaseBadge tone="warning" dot class="hidden sm:inline-flex">{{ t('twins.detail.editing', 'Editing') }}</BaseBadge>
              <BaseButton
                variant="ghost"
                size="md"
                rounded="full"
                :disabled="saving || savingTab"
                @click="cancelEditing"
              >
                {{ t('common.cancel', 'Cancel') }}
              </BaseButton>
              <BaseButton
                variant="primary"
                size="md"
                rounded="full"
                :loading="saving || savingTab"
                @click="saveChanges"
              >
                {{ t('common.saveChanges', 'Save Changes') }}
              </BaseButton>
            </div>
          </Transition>
        </div>

        <TwinStatsGrid v-if="tab === 'general'" :twin="twin" />

        <fieldset
          :disabled="!editing && tab !== 'voice'"
          :class="[
            'rounded-2xl border bg-surface p-6 shadow-card transition-colors',
            editing ? 'border-accent/30 ring-1 ring-accent/10' : 'border-border',
            !editing && tab !== 'voice' && 'opacity-70',
          ]"
        >
          <div :class="!editing && tab !== 'voice' && 'pointer-events-none select-none'">
            <GeneralTab
              v-if="tab === 'general'"
              ref="activeTab"
              :twin="twin"
              :editing="editing"
            />
            <VoiceTab v-else-if="tab === 'voice'" ref="activeTab" :editing="editing" />
            <PersonalityTab
              v-else-if="tab === 'personality'"
              ref="activeTab"
              :twin="twin"
              :editing="editing"
            />
            <KnowledgeSetTab v-else-if="tab === 'knowledge'" ref="activeTab" :twin="twin" />
          </div>
        </fieldset>
      </template>

      <AiTwinDetailSkeleton v-else-if="loading" />

      <EmptyState
        v-else-if="store.error"
        :icon="Cancel01Icon"
        :title="t('twins.detail.loadFailedTitle', `Couldn't load AI Twin`)"
        :description="store.error"
      >
        <BaseButton variant="primary" @click="loadTwin">{{ t('common.retry', 'Retry') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        :icon="Cancel01Icon"
        :title="t('twins.detail.notFoundTitle', 'Twin not found')"
        :description="t('twins.detail.notFoundBody', `This AI Twin doesn't exist or has been deleted.`)"
      >
        <BaseButton variant="primary" @click="router.push({ name: 'ai-twins' })">{{ t('twins.detail.backToList', 'Back to list') }}</BaseButton>
      </EmptyState>

      <ConfirmDialog
        v-model:open="deleteDialog"
        :title="t('twins.detail.deleteDialog.title', 'Delete AI Twin')"
        :description="t('twins.detail.deleteDialog.body', `This action can't be undone. All chats and call history attached to this twin will be removed.`)"
        :confirm-label="t('common.delete', 'Delete')"
        :loading="deleting"
        @confirm="confirmDelete"
      />

      <ConfirmDialog
        v-model:open="removeImageDialog"
        :title="t('twins.detail.removeImageDialog.title', 'Remove profile picture?')"
        :description="t('twins.detail.removeImageDialog.body', 'The current profile picture will be removed and the twin will fall back to its initials.')"
        :confirm-label="t('twins.detail.removeImageDialog.confirm', 'Remove')"
        :loading="uploadingImage"
        @confirm="confirmRemoveImage"
      />

      <Teleport to="body">
        <div
          v-if="imagePreviewOpen && twin?.profilePicUrl"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Profile picture preview"
          @click.self="closeImagePreview"
          @keydown.esc="closeImagePreview"
        >
          <button
            type="button"
            class="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            :aria-label="t('common.close', 'Close')"
            @click="closeImagePreview"
          >
            <Icon :icon="Cancel01Icon" :size="20" />
          </button>
          <img
            :src="twin.profilePicUrl"
            :alt="twin.name"
            class="max-h-[85vh] max-w-[85vw] rounded-2xl object-contain shadow-2xl"
            @click.stop
          />
        </div>
      </Teleport>
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
