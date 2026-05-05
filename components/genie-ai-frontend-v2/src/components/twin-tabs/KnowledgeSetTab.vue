<script setup lang="ts">
import { ref } from 'vue';
import {
  AiBrain01Icon,
  Delete02Icon,
  File02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { notify } from '../../lib/notify';
import BaseButton from '../ui/BaseButton.vue';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import AddKnowledgeDrawer from '../dashboard/AddKnowledgeDrawer.vue';
import { useAiTwinsStore } from '../../stores/aiTwins';
import type { AiTwin } from '../../services/aiTwins';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ twin: AiTwin }>();
const store = useAiTwinsStore();

const uploadOpen = ref(false);

const removeDialogOpen = ref(false);
const fileIdToRemove = ref<string | null>(null);
const removing = ref(false);

const clearDialogOpen = ref(false);
const clearing = ref(false);

async function onUploaded(fileIds: string[]): Promise<void> {
  // Crawl uploads return no synchronous IDs — nothing to link yet.
  if (!fileIds.length) return;
  const alreadyLinked = new Set(props.twin.linkedKbFileIds);
  const fresh = fileIds.filter((id) => id && !alreadyLinked.has(id));
  if (!fresh.length) return;
  try {
    for (const id of fresh) {
      // The backend treats KB linking as idempotent atomic adds; sequential
      // calls keep the response payload simple and let one failure not block
      // the others entirely.
      await store.linkKbFile(props.twin._key, id);
    }
    notify.success(
      fresh.length === 1
        ? t('twins.knowledge.toasts.linked', 'File linked')
        : t(
            'twins.knowledge.toasts.linkedMany',
            { count: fresh.length },
            '{count} files linked'
          )
    );
  } catch {
    notify.error(store.error ?? t('twins.knowledge.toasts.linkFailed', 'Failed to link file'));
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
        <BaseButton variant="primary" size="sm" rounded="full" @click="uploadOpen = true">
          <Icon :icon="PlusSignIcon" :size="14" />
          {{ t('knowledgeSet.addKnowledge', 'Add Knowledge') }}
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
      <BaseButton variant="primary" rounded="full" @click="uploadOpen = true">
        <Icon :icon="PlusSignIcon" :size="14" />
        {{ t('knowledgeSet.addKnowledge', 'Add Knowledge') }}
      </BaseButton>
    </EmptyState>

    <AddKnowledgeDrawer v-model:open="uploadOpen" @uploaded="onUploaded" />

    <ConfirmDialog
      v-model:open="removeDialogOpen"
      :title="t('twins.knowledge.removeDialog.title', 'Unlink this file?')"
      :description="
        t(
          'twins.knowledge.removeDialog.body',
          'This twin will stop using the file for retrieval. The file itself stays in the Document Repository.'
        )
      "
      :confirm-label="t('twins.knowledge.removeDialog.confirm', 'Unlink')"
      :cancel-label="t('common.cancel', 'Cancel')"
      :loading="removing"
      @confirm="confirmRemove"
    />

    <ConfirmDialog
      v-model:open="clearDialogOpen"
      :title="t('twins.knowledge.clearDialog.title', 'Clear all linked files?')"
      :description="
        t(
          'twins.knowledge.clearDialog.body',
          { count: twin.linkedKbFileIds.length },
          '{count} file(s) will be unlinked from this twin. The files themselves stay in the Document Repository.'
        )
      "
      :confirm-label="t('twins.knowledge.clearDialog.confirm', 'Clear all')"
      :cancel-label="t('common.cancel', 'Cancel')"
      :loading="clearing"
      @confirm="confirmClearAll"
    />
  </div>
</template>
