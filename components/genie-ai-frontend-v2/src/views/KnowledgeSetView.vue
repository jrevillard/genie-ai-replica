<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useDebounceFn } from '@vueuse/core';
import {
  AddCircleIcon,
  CloudUploadIcon,
  Delete02Icon,
  Download04Icon,
  File02Icon,
  Pdf01Icon,
  Search01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseBadge from '../components/ui/BaseBadge.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCheckbox from '../components/ui/BaseCheckbox.vue';
import BaseDialog from '../components/ui/BaseDialog.vue';
import BaseDrawer from '../components/ui/BaseDrawer.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useT } from '../i18n/composables';
import { notify } from '../lib/notify';
import fileService from '../services/files';
import type { RepoFileRow } from '../services/files';
import type { AiTwin } from '../services/aiTwins';
import { useAiTwinsStore } from '../stores/aiTwins';

type DocumentRow = {
  fileId: string;
  name: string;
  dateLabel: string;
  statusLabel: string;
  statusRaw: string;
  subtitle: string;
  selected: boolean;
};

const { t, locale } = useT();
const router = useRouter();
const aiStore = useAiTwinsStore();
const { twins: storeTwins, loading: twinsLoading } = storeToRefs(aiStore);

const mode = ref<'documents' | 'twins'>('documents');
const documents = ref<DocumentRow[]>([]);
const documentsLoading = ref(false);
const uploadOpen = ref(false);
const uploadSubmitting = ref(false);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const drawerFiles = ref<File[]>([]);
const documentSearch = ref('');
const twinSearch = ref('');
const pendingLinkIds = ref<string[]>([]);
const selectedTwinKey = ref<string | null>(null);

const deleteDialogOpen = ref(false);
const deleteTarget = ref<{ fileId: string; name: string } | null>(null);
const deleteSubmitting = ref(false);

function formatDateLabel(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(locale.value, { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

function mapDataprepToLabel(raw: string | undefined): string {
  const n = (raw || '').toLowerCase();
  if (n.includes('pending')) return t('knowledgeSet.statusPending', 'Pending');
  if (n.includes('ingesting')) return t('knowledgeSet.statusIngesting', 'Ingesting');
  if (n.includes('ingested')) return t('knowledgeSet.statusIngested', 'Ingested');
  return raw?.trim() || t('knowledgeSet.statusPending', 'Pending');
}

function fileSubtitle(row: RepoFileRow): string {
  const lang = row.language ? String(row.language) : '';
  const chunks =
    row.chunk_count != null && row.chunk_count !== undefined
      ? String(row.chunk_count)
      : '';
  if (lang && chunks) {
    return t(
      'knowledgeSet.fileMetaLine',
      { language: lang, chunks },
      '{language} · {chunks} chunks'
    );
  }
  if (lang) return lang;
  if (chunks) return `${chunks} chunks`;
  return t('knowledgeSet.noDescription', 'No extra details for this file.');
}

function mapRepoToRow(f: RepoFileRow, selectedMap: Map<string, boolean>): DocumentRow {
  const fileId = f.file_id;
  const raw = f.dataprep?.status;
  return {
    fileId,
    name: f.file_name || fileId,
    dateLabel: formatDateLabel(f.uploaded_date),
    statusLabel: mapDataprepToLabel(raw),
    statusRaw: raw || '',
    subtitle: fileSubtitle(f),
    selected: selectedMap.get(fileId) ?? false,
  };
}

async function loadDocuments(): Promise<void> {
  documentsLoading.value = true;
  const selectedMap = new Map(
    documents.value.filter((d) => d.selected).map((d) => [d.fileId, true])
  );
  try {
    const q = documentSearch.value.trim();
    const { files } = await fileService.listFiles({
      page: 1,
      limit: 100,
      ...(q ? { search: q } : {}),
    });
    documents.value = files.map((f) => mapRepoToRow(f, selectedMap));
  } catch {
    notify.error(t('knowledgeSet.toasts.loadFailed', 'Failed to load documents'));
  } finally {
    documentsLoading.value = false;
  }
}

const debouncedReload = useDebounceFn(() => void loadDocuments(), 400);
watch(documentSearch, () => {
  void debouncedReload();
});

watch(uploadOpen, (open) => {
  if (!open) drawerFiles.value = [];
});

onMounted(() => {
  void loadDocuments();
  void aiStore.fetchAll();
});

const filteredDocuments = computed(() => documents.value);

const filteredTwins = computed(() => {
  const q = twinSearch.value.trim().toLowerCase();
  if (!q) return storeTwins.value;
  return storeTwins.value.filter((tw) => tw.name.toLowerCase().includes(q));
});

const allDocumentsSelected = computed({
  get: () => documents.value.length > 0 && documents.value.every((d) => d.selected),
  set: (value: boolean) => {
    documents.value.forEach((d) => {
      d.selected = value;
    });
  },
});

const selectedCount = computed(() => documents.value.filter((d) => d.selected).length);

function statusTone(statusRaw: string): 'neutral' | 'accent' | 'success' {
  const n = statusRaw.toLowerCase();
  if (n.includes('ingested')) return 'success';
  if (n.includes('ingesting')) return 'accent';
  return 'neutral';
}

function docIcon(name: string) {
  return name.toLowerCase().endsWith('.pdf') ? Pdf01Icon : File02Icon;
}

function toggleDocument(doc: DocumentRow) {
  doc.selected = !doc.selected;
}

function pickFile() {
  fileInput.value?.click();
}

function appendDrawerFiles(list: FileList | File[] | null | undefined) {
  if (!list?.length) return;
  const next = [...drawerFiles.value];
  Array.from(list).forEach((f) => next.push(f));
  drawerFiles.value = next;
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  appendDrawerFiles(input.files);
  input.value = '';
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  appendDrawerFiles(e.dataTransfer?.files);
}

async function submitDrawerUpload() {
  if (!drawerFiles.value.length) {
    notify.warning(t('knowledgeSet.drawerNoFiles', 'Add at least one file to upload.'));
    return;
  }
  if (uploadSubmitting.value) return;
  uploadSubmitting.value = true;
  try {
    if (drawerFiles.value.length === 1) {
      await fileService.uploadFile(drawerFiles.value[0]);
    } else {
      await fileService.uploadMultipleFiles(drawerFiles.value);
    }
    notify.success(t('knowledgeSet.toasts.uploadSuccess', 'Upload complete'));
    drawerFiles.value = [];
    uploadOpen.value = false;
    await loadDocuments();
  } catch {
    notify.error(t('knowledgeSet.toasts.uploadFailed', 'Upload failed'));
  } finally {
    uploadSubmitting.value = false;
  }
}

function goToTwinPicker() {
  pendingLinkIds.value = documents.value.filter((d) => d.selected).map((d) => d.fileId);
  mode.value = 'twins';
  selectedTwinKey.value = null;
  void aiStore.fetchAll();
}

function continueWithSelected() {
  if (selectedCount.value === 0) {
    notify.warning(t('knowledgeSet.toasts.noFilesSelected', 'Select at least one file'));
    return;
  }
  goToTwinPicker();
}

function selectTwinRow(twin: AiTwin) {
  selectedTwinKey.value = twin._key;
}

async function confirmLinkToTwin() {
  const twinId = selectedTwinKey.value;
  if (!twinId) {
    notify.warning(t('knowledgeSet.toasts.noTwinSelected', 'Select an AI Twin first'));
    return;
  }
  const fromPending = pendingLinkIds.value.length > 0;
  const ids = fromPending
    ? [...pendingLinkIds.value]
    : documents.value.filter((d) => d.selected).map((d) => d.fileId);
  if (!ids.length) {
    notify.warning(t('knowledgeSet.toasts.noFilesSelected', 'Select at least one file'));
    return;
  }
  const twin = storeTwins.value.find((x) => x._key === twinId);
  if (!twin) return;
  const merged = [...new Set([...twin.linkedKbFileIds, ...ids])];
  try {
    await aiStore.replaceKbFiles(twinId, merged);
    notify.success(t('knowledgeSet.toasts.linkSuccess', 'Knowledge files linked to twin'));
    pendingLinkIds.value = [];
    documents.value.forEach((d) => {
      d.selected = false;
    });
    mode.value = 'documents';
    await loadDocuments();
    await aiStore.fetchAll();
  } catch {
    notify.error(aiStore.error ?? t('knowledgeSet.toasts.linkFailed', 'Failed to link files to twin'));
  }
}

function askDelete(doc: DocumentRow) {
  deleteTarget.value = { fileId: doc.fileId, name: doc.name };
  deleteDialogOpen.value = true;
}

async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target || deleteSubmitting.value) return;
  deleteSubmitting.value = true;
  try {
    await fileService.deleteFile(target.fileId);
    notify.success(t('knowledgeSet.toasts.deleteSuccess', 'File deleted'));
    deleteDialogOpen.value = false;
    deleteTarget.value = null;
    await loadDocuments();
  } catch {
    notify.error(t('knowledgeSet.toasts.deleteFailed', 'Delete failed'));
  } finally {
    deleteSubmitting.value = false;
  }
}

async function downloadDoc(doc: DocumentRow) {
  try {
    await fileService.downloadFile(doc.fileId, doc.name);
  } catch {
    notify.error(t('knowledgeSet.toasts.downloadFailed', 'Download failed'));
  }
}

function goCreateTwin() {
  void router.push({ name: 'ai-twins' });
}

function clearDocumentSelections() {
  documentSearch.value = '';
  documents.value.forEach((d) => {
    d.selected = false;
  });
  pendingLinkIds.value = [];
}
</script>

<template>
  <DashboardLayout>
    <section class="h-full min-h-0 bg-surface p-4 md:p-6">
      <div class="flex h-full min-h-[700px] flex-col">
        <template v-if="mode === 'documents'">
          <header class="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h1 class="text-headline text-text">{{ t('knowledgeSet.title', 'Document Management') }}</h1>
            <BaseButton variant="primary" rounded="full" @click="uploadOpen = true">
              <Icon :icon="Upload01Icon" :size="16" />
              {{ t('knowledgeSet.addKnowledge', 'Add Knowledge') }}
            </BaseButton>
          </header>

          <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="w-full max-w-md">
              <BaseInput
                v-model="documentSearch"
                :placeholder="t('knowledgeSet.searchPlaceholder', 'Search by file name')"
                rounded="full"
              >
                <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
              </BaseInput>
            </div>
          </div>

          <div class="mb-5 flex items-center justify-between gap-3">
            <BaseCheckbox v-model="allDocumentsSelected" size="sm" class="min-w-0">
              <span class="truncate text-body font-semibold text-text">
                {{ t('knowledgeSet.selectHint', 'Select files to link them to an AI Twin') }}
              </span>
            </BaseCheckbox>
            <BaseButton
              variant="primary"
              rounded="full"
              :disabled="selectedCount === 0"
              class="hidden shrink-0 sm:inline-flex"
              @click="continueWithSelected"
            >
              {{
                t(
                  'knowledgeSet.ingestSelected',
                  { count: selectedCount },
                  'Continue with selected ({count})'
                )
              }}
            </BaseButton>
          </div>

          <div v-if="documentsLoading" class="text-body text-text-muted">
            {{ t('knowledgeSet.loadingDocs', 'Loading documents…') }}
          </div>

          <div v-else class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 py-1">
            <div v-if="filteredDocuments.length" class="space-y-4">
              <div
                v-for="document in filteredDocuments"
                :key="document.fileId"
                role="checkbox"
                tabindex="0"
                :aria-checked="!!document.selected"
                :class="[
                  'cursor-pointer rounded-xl border bg-surface p-4 shadow-card transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  document.selected
                    ? 'border-accent ring-1 ring-accent bg-accent-soft/30'
                    : 'border-border hover:border-border-strong hover:bg-surface-subtle',
                ]"
                @click="toggleDocument(document)"
                @keydown.enter.prevent="toggleDocument(document)"
                @keydown.space.prevent="toggleDocument(document)"
              >
                <div class="mb-3 flex items-start justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <span
                      class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger text-text-inverse"
                    >
                      <Icon :icon="docIcon(document.name)" :size="22" />
                    </span>
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <h2 class="truncate text-body font-semibold text-text">{{ document.name }}</h2>
                        <BaseBadge :tone="statusTone(document.statusRaw)" dot>
                          {{ document.statusLabel }}
                        </BaseBadge>
                      </div>
                      <p class="text-caption text-text-muted">{{ document.dateLabel }}</p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="grid h-8 w-8 place-items-center rounded-lg text-danger transition hover:bg-danger-soft"
                      :aria-label="t('knowledgeSet.deleteAria', 'Delete document')"
                      @click.stop="askDelete(document)"
                    >
                      <Icon :icon="Delete02Icon" :size="18" />
                    </button>
                    <button
                      type="button"
                      class="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text"
                      :aria-label="t('knowledgeSet.downloadAria', 'Download document')"
                      @click.stop="downloadDoc(document)"
                    >
                      <Icon :icon="Download04Icon" :size="18" />
                    </button>
                  </div>
                </div>
                <p class="text-caption leading-relaxed text-text-muted">
                  {{ document.subtitle }}
                </p>
              </div>
            </div>

            <EmptyState
              v-else-if="documentSearch.trim()"
              :icon="Search01Icon"
              :title="t('knowledgeSet.docNoMatchesTitle', 'No matches')"
              :description="t('knowledgeSet.docNoMatchesBody', 'No documents match your search.')"
            >
              <BaseButton variant="outline" @click="documentSearch = ''">
                {{ t('knowledgeSet.clearSearch', 'Clear search') }}
              </BaseButton>
            </EmptyState>

            <EmptyState
              v-else
              :icon="CloudUploadIcon"
              :title="t('knowledgeSet.emptyNoDocsTitle', 'No documents yet')"
              :description="t('knowledgeSet.emptyNoDocsBody', 'Upload knowledge files.')"
            >
              <BaseButton variant="primary" @click="uploadOpen = true">
                <Icon :icon="Upload01Icon" :size="16" />
                {{ t('knowledgeSet.addKnowledge', 'Add Knowledge') }}
              </BaseButton>
            </EmptyState>
          </div>

          <footer class="mt-5 flex items-center justify-between">
            <BaseButton variant="outline" rounded="full" @click="clearDocumentSelections">
              {{ t('knowledgeSet.cancel', 'Cancel') }}
            </BaseButton>
            <BaseButton variant="primary" rounded="full" @click="goToTwinPicker">
              {{ t('knowledgeSet.select', 'Continue') }}
            </BaseButton>
          </footer>
        </template>

        <template v-else>
          <header class="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <h1 class="text-headline text-text">
              {{ t('knowledgeSet.selectAiTwinsTitle', 'Select an AI Twin') }}
            </h1>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="w-full sm:w-80 lg:w-[460px]">
                <BaseInput
                  v-model="twinSearch"
                  :placeholder="t('knowledgeSet.twinSearchPlaceholder', 'Search twins')"
                  rounded="full"
                >
                  <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
                </BaseInput>
              </div>
              <BaseButton variant="primary" rounded="full" @click="goCreateTwin">
                <Icon :icon="AddCircleIcon" :size="17" />
                {{ t('knowledgeSet.createAiTwin', 'Create AI Twin') }}
              </BaseButton>
            </div>
          </header>

          <div v-if="twinsLoading" class="text-body text-text-muted">
            {{ t('knowledgeSet.loadingTwins', 'Loading AI Twins…') }}
          </div>
          <div v-else class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div v-if="filteredTwins.length" class="grid gap-4 xl:grid-cols-2">
              <button
                v-for="twin in filteredTwins"
                :key="twin._key"
                type="button"
                :class="[
                  'rounded-xl border bg-surface p-4 text-left shadow-card transition',
                  selectedTwinKey === twin._key
                    ? 'border-accent ring-1 ring-accent'
                    : 'border-border hover:border-border-strong',
                ]"
                @click="selectTwinRow(twin)"
              >
                <div class="mb-5 flex items-start justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-4">
                    <BaseAvatar
                      :src="twin.profilePicUrl ?? ''"
                      :name="twin.name"
                      size="lg"
                    />
                    <h2 class="truncate text-title text-text">{{ twin.name }}</h2>
                  </div>
                  <span
                    :class="[
                      'mt-3 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                      selectedTwinKey === twin._key
                        ? 'border-accent ring-4 ring-accent-soft'
                        : 'border-text-subtle',
                    ]"
                    aria-hidden="true"
                  >
                    <span v-if="selectedTwinKey === twin._key" class="h-2 w-2 rounded-full bg-accent" />
                  </span>
                </div>

                <div class="mb-4 flex items-center justify-between gap-4 text-meta">
                  <span class="font-semibold text-text">{{ t('knowledgeSet.dateEdited', 'Date edited') }}</span>
                  <span class="text-text-muted">{{ formatDateLabel(twin.updatedAt) }}</span>
                </div>

                <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border-subtle text-meta">
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">{{ t('knowledgeSet.voiceId', 'Voice') }}</dt>
                    <dd class="truncate text-text-muted">
                      {{ twin.voiceId || t('knowledgeSet.noVoice', 'None') }}
                    </dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">{{ t('knowledgeSet.linkedFiles', 'Linked knowledge files') }}</dt>
                    <dd class="text-right text-text-muted">{{ twin.linkedKbFileIds.length }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">{{ t('knowledgeSet.dateCreated', 'Date created') }}</dt>
                    <dd class="text-text-muted">{{ formatDateLabel(twin.createdAt) }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">{{ t('knowledgeSet.twinIdShort', 'Twin ID') }}</dt>
                    <dd class="truncate text-right text-text-muted">{{ twin._key }}</dd>
                  </div>
                </dl>
              </button>
            </div>

            <EmptyState
              v-else
              :icon="Search01Icon"
              :title="t('knowledgeSet.twinsNoMatchesTitle', 'No matches')"
              :description="t('knowledgeSet.twinsNoMatchesBody', 'No AI Twins match your search.')"
            >
              <BaseButton variant="outline" @click="twinSearch = ''">
                {{ t('knowledgeSet.clearSearch', 'Clear search') }}
              </BaseButton>
            </EmptyState>
          </div>

          <footer class="mt-5 flex items-center justify-between">
            <BaseButton variant="outline" rounded="full" @click="mode = 'documents'">
              {{ t('knowledgeSet.cancel', 'Cancel') }}
            </BaseButton>
            <BaseButton variant="primary" rounded="full" @click="confirmLinkToTwin">
              {{ t('knowledgeSet.selectTwin', 'Link files to twin') }}
            </BaseButton>
          </footer>
        </template>
      </div>

      <BaseDrawer
        v-model:open="uploadOpen"
        :title="t('knowledgeSet.drawerTitle', 'Add knowledge')"
        :icon="Upload01Icon"
        width="md"
      >
        <p class="mb-4 text-caption text-text-muted">
          {{ t('knowledgeSet.drawerIntro', 'Upload files to the document repository.') }}
        </p>
        <p v-if="drawerFiles.length" class="mb-2 text-caption font-medium text-text">
          {{ drawerFiles.length }} file(s) ready
        </p>
        <div
          :class="[
            'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition',
            dragOver ? 'border-accent bg-accent-soft' : 'border-border bg-surface-muted',
          ]"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop="onDrop"
        >
          <Icon :icon="Upload01Icon" :size="28" class="text-text-subtle" />
          <p class="text-body font-medium text-text">{{ t('knowledgeSet.uploadFile', 'Upload file') }}</p>
          <p class="max-w-xs text-caption text-text-muted">
            {{ t('knowledgeSet.allowedTypes', 'Allowed types…') }}
          </p>
          <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />
          <BaseButton variant="soft" size="sm" rounded="full" @click="pickFile">
            {{ t('knowledgeSet.browseFiles', 'Browse files') }}
          </BaseButton>
        </div>

        <template #footer>
          <button
            type="button"
            class="text-body font-semibold text-text-muted transition hover:text-text"
            :disabled="uploadSubmitting"
            @click="uploadOpen = false"
          >
            {{ t('knowledgeSet.cancel', 'Cancel') }}
          </button>
          <BaseButton variant="primary" :loading="uploadSubmitting" @click="submitDrawerUpload">
            {{ t('knowledgeSet.addKnowledge', 'Add Knowledge') }}
          </BaseButton>
        </template>
      </BaseDrawer>

      <BaseDialog v-model:open="deleteDialogOpen" size="sm">
        <div class="pr-10">
          <h2 class="text-title text-text">{{ t('knowledgeSet.deleteConfirmTitle', 'Delete this file?') }}</h2>
          <p class="mt-2 text-body leading-6 text-text-muted">
            {{ t('knowledgeSet.deleteConfirmBody', 'This removes the file from the repository.') }}
          </p>
          <p v-if="deleteTarget" class="mt-2 truncate text-caption text-text-muted">{{ deleteTarget.name }}</p>
        </div>
        <div class="mt-7 flex justify-end gap-3">
          <BaseButton variant="ghost" :disabled="deleteSubmitting" @click="deleteDialogOpen = false">
            {{ t('knowledgeSet.cancel', 'Cancel') }}
          </BaseButton>
          <BaseButton variant="danger" :loading="deleteSubmitting" @click="confirmDelete">
            {{ t('knowledgeSet.deleteAction', 'Delete') }}
          </BaseButton>
        </div>
      </BaseDialog>
    </section>
  </DashboardLayout>
</template>
