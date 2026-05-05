<script setup lang="ts">
import { ref } from 'vue';
import {
  AiBrain01Icon,
  Delete02Icon,
  File02Icon,
  Link01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { notify } from '../../lib/notify';
import BaseButton from '../ui/BaseButton.vue';
import BaseDialog from '../ui/BaseDialog.vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import BaseInput from '../ui/BaseInput.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import { useAiTwinsStore } from '../../stores/aiTwins';
import type { AiTwin } from '../../services/aiTwins';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ twin: AiTwin }>();
const store = useAiTwinsStore();

const linkDialogOpen = ref(false);
const newFileId = ref('');
const linking = ref(false);

const removeDialogOpen = ref(false);
const fileIdToRemove = ref<string | null>(null);
const removing = ref(false);

const clearDialogOpen = ref(false);
const clearing = ref(false);

function openLinkDialog() {
  newFileId.value = '';
  linkDialogOpen.value = true;
}

async function linkFile() {
  const id = newFileId.value.trim();
  if (!id || linking.value) return;
  if (props.twin.linkedKbFileIds.includes(id)) {
    notify.warning(t('twins.knowledge.toasts.duplicate', 'That file is already linked to this twin'));
    return;
  }
  linking.value = true;
  try {
    await store.linkKbFile(props.twin._key, id);
    notify.success(t('twins.knowledge.toasts.linked', 'File linked'));
    linkDialogOpen.value = false;
    newFileId.value = '';
  } catch {
    notify.error(store.error ?? t('twins.knowledge.toasts.linkFailed', 'Failed to link file'));
  } finally {
    linking.value = false;
  }
}

function askRemove(fileId: string) {
  fileIdToRemove.value = fileId;
  removeDialogOpen.value = true;
}

async function confirmRemove() {
  const id = fileIdToRemove.value;
  if (!id || removing.value) return;
  removing.value = true;
  try {
    await store.unlinkKbFile(props.twin._key, id);
    notify.success(t('twins.knowledge.toasts.unlinked', 'File unlinked'));
    removeDialogOpen.value = false;
    fileIdToRemove.value = null;
  } catch {
    notify.error(store.error ?? t('twins.knowledge.toasts.unlinkFailed', 'Failed to unlink file'));
  } finally {
    removing.value = false;
  }
}

async function confirmClearAll() {
  if (clearing.value) return;
  clearing.value = true;
  try {
    await store.replaceKbFiles(props.twin._key, []);
    notify.success(t('twins.knowledge.toasts.cleared', 'Cleared all linked files'));
    clearDialogOpen.value = false;
  } catch {
    notify.error(store.error ?? t('twins.knowledge.toasts.clearFailed', 'Failed to clear files'));
  } finally {
    clearing.value = false;
  }
}

// KB linking is its own atomic mutation, independent of the General-tab edit
// cycle — nothing to commit/discard via the parent's Save flow.
function save(): boolean {
  return true;
}
function discard(): void {}
defineExpose({ save, discard });
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-title text-text">{{ t('twins.knowledge.title', 'Knowledge Files') }}</h2>
        <p class="mt-0.5 text-caption text-text-muted">
          {{ t('twins.knowledge.subtitle', "Files linked here are used to answer with this AI Twin's specific knowledge.") }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton
          v-if="twin.linkedKbFileIds.length"
          variant="ghost"
          size="sm"
          rounded="full"
          @click="clearDialogOpen = true"
        >
          {{ t('twins.knowledge.clearAll', 'Clear all') }}
        </BaseButton>
        <BaseButton variant="primary" size="sm" rounded="full" @click="openLinkDialog">
          <Icon :icon="PlusSignIcon" :size="14" /> {{ t('twins.knowledge.linkFile', 'Link File') }}
        </BaseButton>
      </div>
    </header>

    <ul v-if="twin.linkedKbFileIds.length" class="space-y-2">
      <li
        v-for="fileId in twin.linkedKbFileIds"
        :key="fileId"
        class="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card"
      >
        <div class="rounded-full bg-accent-soft p-2 text-accent">
          <Icon :icon="File02Icon" :size="18" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-body font-medium text-text">{{ fileId }}</p>
          <p class="text-caption text-text-muted">{{ t('twins.knowledge.docId', 'Document repository ID') }}</p>
        </div>
        <button
          type="button"
          class="grid h-9 w-9 place-items-center rounded-full text-text-muted transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="removing"
          :aria-label="t('twins.knowledge.removeDialog.confirm', 'Unlink')"
          @click="askRemove(fileId)"
        >
          <Icon :icon="Delete02Icon" :size="18" />
        </button>
      </li>
    </ul>

    <EmptyState
      v-else
      :icon="AiBrain01Icon"
      :title="t('twins.knowledge.emptyTitle', 'No knowledge files linked yet')"
      :description="t('twins.knowledge.emptyBody', 'Link document-repository file IDs so this AI Twin can use them when answering.')"
    >
      <BaseButton variant="primary" rounded="full" @click="openLinkDialog">
        <Icon :icon="PlusSignIcon" :size="14" /> {{ t('twins.knowledge.linkFile', 'Link File') }}
      </BaseButton>
    </EmptyState>

    <BaseDrawer
      v-model:open="linkDialogOpen"
      :title="t('twins.knowledge.linkDrawer.title', 'Link a knowledge file')"
      :icon="Link01Icon"
      width="md"
    >
      <p class="mb-4 text-caption text-text-muted">
        {{ t('twins.knowledge.linkDrawer.body', 'Paste a file ID from the Document Repository. Any optional files/ prefix is stripped automatically.') }}
      </p>
      <BaseInput
        id="kb-file-id"
        v-model="newFileId"
        :label="t('twins.knowledge.linkDrawer.idLabel', 'File ID')"
        :placeholder="t('twins.knowledge.linkDrawer.idPlaceholder', 'e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890')"
        rounded="lg"
        @keydown.enter.prevent="linkFile"
      />

      <template #footer>
        <button
          type="button"
          class="text-body font-semibold text-text-muted transition hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="linking"
          @click="linkDialogOpen = false"
        >
          {{ t('common.cancel', 'Cancel') }}
        </button>
        <BaseButton variant="primary" :loading="linking" @click="linkFile">
          {{ t('twins.knowledge.linkFile', 'Link File') }}
        </BaseButton>
      </template>
    </BaseDrawer>

    <BaseDialog v-model:open="removeDialogOpen" size="sm">
      <div class="pr-10">
        <h2 class="text-title text-text">{{ t('twins.knowledge.removeDialog.title', 'Unlink this file?') }}</h2>
        <p class="mt-2 text-body leading-6 text-text-muted">
          {{ t('twins.knowledge.removeDialog.body', 'This twin will stop using the file for retrieval. The file itself stays in the Document Repository.') }}
        </p>
      </div>
      <div class="mt-7 flex justify-end gap-3">
        <BaseButton
          variant="ghost"
          :disabled="removing"
          @click="removeDialogOpen = false"
        >
          {{ t('common.cancel', 'Cancel') }}
        </BaseButton>
        <BaseButton variant="danger" :loading="removing" @click="confirmRemove">
          {{ t('twins.knowledge.removeDialog.confirm', 'Unlink') }}
        </BaseButton>
      </div>
    </BaseDialog>

    <BaseDialog v-model:open="clearDialogOpen" size="sm">
      <div class="pr-10">
        <h2 class="text-title text-text">{{ t('twins.knowledge.clearDialog.title', 'Clear all linked files?') }}</h2>
        <p class="mt-2 text-body leading-6 text-text-muted">
          {{ t('twins.knowledge.clearDialog.body', { count: twin.linkedKbFileIds.length }, '{count} file(s) will be unlinked from this twin. The files themselves stay in the Document Repository.') }}
        </p>
      </div>
      <div class="mt-7 flex justify-end gap-3">
        <BaseButton
          variant="ghost"
          :disabled="clearing"
          @click="clearDialogOpen = false"
        >
          {{ t('common.cancel', 'Cancel') }}
        </BaseButton>
        <BaseButton variant="danger" :loading="clearing" @click="confirmClearAll">
          {{ t('twins.knowledge.clearDialog.confirm', 'Clear all') }}
        </BaseButton>
      </div>
    </BaseDialog>
  </div>
</template>
