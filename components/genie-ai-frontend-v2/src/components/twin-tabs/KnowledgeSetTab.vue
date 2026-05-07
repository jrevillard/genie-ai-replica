<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  AiBrain01Icon,
  Delete02Icon,
  File02Icon,
  Image01Icon,
  Note01Icon,
  Pdf01Icon,
  PlusSignIcon,
  PresentationOnlineIcon,
  Tag01Icon,
} from '@hugeicons/core-free-icons';
import { formatFileSize } from '../../lib/files';
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
const fileNameToRemove = ref<string | null>(null);
const removing = ref(false);

const clearDialogOpen = ref(false);
const clearing = ref(false);

// Merge the rich `linkedKbFiles` metadata with the canonical
// `linkedKbFileIds` order. When the backend hasn't returned metadata for an
// ID yet, fall back to the ID as the display name so freshly-linked files
// still render immediately.
type DisplayFile = {
  fileId: string;
  fileName: string;
  extension: string | null;
  sizeLabel: string | null;
};

const displayFiles = computed<DisplayFile[]>(() => {
  const meta = new Map<string, NonNullable<AiTwin['linkedKbFiles']>[number]>();
  for (const f of props.twin.linkedKbFiles ?? []) {
    if (f?.fileId) meta.set(f.fileId, f);
  }
  return props.twin.linkedKbFileIds.map((fileId) => {
    const m = meta.get(fileId);
    const fileName = m?.fileName || m?.originalName || m?.title || fileId;
    return {
      fileId,
      fileName,
      extension: extractExtension(fileName, m?.fileType, m?.mimeType),
      sizeLabel: formatFileSize(m?.size ?? null),
    };
  });
});

function extractExtension(
  name: string,
  fileType: string | null | undefined,
  mimeType: string | null | undefined
): string | null {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  const mime = (fileType || mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('word')) return 'doc';
  if (mime.includes('sheet') || mime.includes('excel')) return 'xls';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'ppt';
  if (mime.startsWith('image/')) return mime.split('/')[1] ?? 'img';
  if (mime.includes('text') || mime.includes('markdown')) return 'txt';
  return null;
}

function fileIcon(ext: string | null) {
  switch (ext) {
    case 'pdf':
      return Pdf01Icon;
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
    case 'rtf':
      return Note01Icon;
    case 'ppt':
    case 'pptx':
      return PresentationOnlineIcon;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'img':
      return Image01Icon;
    default:
      return File02Icon;
  }
}

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

function askRemove(file: DisplayFile) {
  fileIdToRemove.value = file.fileId;
  fileNameToRemove.value = file.fileName;
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
    fileNameToRemove.value = null;
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
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-title text-text">{{ t('twins.knowledge.title', 'Edit Your Knowledge Set') }}</h2>
          <span
            v-if="displayFiles.length"
            class="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent"
          >
            {{ displayFiles.length }}
          </span>
        </div>
        <p class="mt-0.5 text-caption text-text-muted">
          {{ t('twins.knowledge.subtitle', "Files linked here are used to answer with this AI Twin's specific knowledge.") }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton
          v-if="displayFiles.length"
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

    <ul v-if="displayFiles.length" class="space-y-2">
      <li
        v-for="file in displayFiles"
        :key="file.fileId"
        class="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card transition hover:border-accent/40 hover:shadow-md"
      >
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon :icon="fileIcon(file.extension)" :size="20" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-body font-medium text-text" :title="file.fileName">
              {{ file.fileName }}
            </p>
            <span
              v-if="file.extension"
              class="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-text-muted"
            >
              {{ file.extension }}
            </span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-caption text-text-muted">
            <span v-if="file.sizeLabel">{{ file.sizeLabel }}</span>
            <span v-if="file.sizeLabel" aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-1">
              <Icon :icon="Tag01Icon" :size="12" />
              <span class="truncate font-mono text-meta">{{ file.fileId }}</span>
            </span>
          </div>
        </div>
        <button
          type="button"
          class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-muted transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="removing"
          :aria-label="t('twins.knowledge.removeDialog.confirm', 'Unlink')"
          @click="askRemove(file)"
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
    />

    <AddKnowledgeDrawer v-model:open="uploadOpen" @uploaded="onUploaded" />

    <ConfirmDialog
      v-model:open="removeDialogOpen"
      :title="
        fileNameToRemove
          ? t('twins.knowledge.removeDialog.titleNamed', { name: fileNameToRemove }, 'Unlink “{name}”?')
          : t('twins.knowledge.removeDialog.title', 'Unlink this file?')
      "
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
