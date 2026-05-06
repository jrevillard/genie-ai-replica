<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useDebounceFn } from '@vueuse/core';
import {
  AddCircleIcon,
  Cancel01Icon,
  CloudUploadIcon,
  Delete02Icon,
  Download04Icon,
  File02Icon,
  Globe02Icon,
  Link01Icon,
  MoreVerticalIcon,
  PauseIcon,
  Pdf01Icon,
  PlayIcon,
  Search01Icon,
  StopCircleIcon,
  Upload01Icon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseBadge from '../components/ui/BaseBadge.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCheckbox from '../components/ui/BaseCheckbox.vue';
import ConfirmDialog from '../components/ui/ConfirmDialog.vue';
import BaseDrawer from '../components/ui/BaseDrawer.vue';
import BaseDropdown from '../components/ui/BaseDropdown.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import { CHAT_LANGS } from '../lib/chatStrings';
import CreateAiTwinDialog from '../components/dashboard/CreateAiTwinDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import TranslatedText from '../components/ui/TranslatedText.vue';
import AiTwinCardSkeleton from '../components/ui/skeletons/AiTwinCardSkeleton.vue';
import KnowledgeSetDocsSkeleton from '../components/ui/skeletons/KnowledgeSetDocsSkeleton.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useT } from '../i18n/composables';
import { notify } from '../lib/notify';
import fileService from '../services/files';
import type { IngestionLogEntry, RepoFileRow } from '../services/files';
import type { AiTwin } from '../services/aiTwins';
import { useAiTwinsStore } from '../stores/aiTwins';

type DocumentRow = {
  fileId: string;
  name: string;
  /** ISO-639-1 language tag for the file name; drives dynamic translation. */
  lang: string;
  dateLabel: string;
  statusLabel: string;
  statusRaw: string;
  subtitle: string;
  selected: boolean;
};

const { t, locale } = useT();
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
const FILES_PAGE_LIMIT = 50;

const createTwinOpen = ref(false);
const creatingTwin = ref(false);

const uploadTab = ref<'files' | 'url' | 'crawl'>('files');
const linkUrl = ref('');
const linkLanguage = ref('');
const linkLabels = ref('');
const crawlUrl = ref('');
const crawlMaxDepth = ref<number | ''>(2);

const rowMenuOpenFor = ref<string | null>(null);
const ingestingId = ref<string | null>(null);
const retractingId = ref<string | null>(null);
const killingId = ref<string | null>(null);
const bulkBusy = ref(false);

interface FileDetailsState {
  open: boolean;
  fileId: string | null;
  name: string;
  loadingMeta: boolean;
  metaError: string | null;
  metadata: Record<string, unknown> | null;
  // Edit form fields (kept separate from metadata so we can revert).
  editName: string;
  editLanguage: string;
  editLabels: string;
  editAuthor: string;
  saving: boolean;
  // Logs tabs
  tab: 'details' | 'edit' | 'ingestion' | 'crawl';
  ingestionLog: IngestionLogEntry[];
  ingestionLogError: string | null;
  ingestionLogLoading: boolean;
  crawlJob: unknown;
  crawlMetrics: unknown;
  crawlLogs: string;
  crawlLoading: boolean;
  killing: boolean;
}

const details = ref<FileDetailsState>(emptyDetails());

function emptyDetails(): FileDetailsState {
  return {
    open: false,
    fileId: null,
    name: '',
    loadingMeta: false,
    metaError: null,
    metadata: null,
    editName: '',
    editLanguage: '',
    editLabels: '',
    editAuthor: '',
    saving: false,
    tab: 'details',
    ingestionLog: [],
    ingestionLogError: null,
    ingestionLogLoading: false,
    crawlJob: null,
    crawlMetrics: null,
    crawlLogs: '',
    crawlLoading: false,
    killing: false,
  };
}

const deleteDialogOpen = ref(false);
const deleteTarget = ref<{ fileId: string; name: string; statusRaw: string } | null>(null);
const deleteSubmitting = ref(false);
// Deleting a file that the dataprep worker is still processing leaves the
// running job orphaned (chunks pointing at a deleted file_id). The delete
// dialog refuses the action and offers to stop ingestion first.
const deleteTargetIngesting = computed(() =>
  (deleteTarget.value?.statusRaw ?? '').toLowerCase().includes('ingesting')
);
const deleteDialogTitle = computed(() =>
  deleteTargetIngesting.value
    ? t('knowledgeSet.stopBeforeDeleteTitle', 'Stop ingestion before deleting')
    : t('knowledgeSet.deleteConfirmTitle', 'Delete this file?')
);
const deleteDialogConfirmLabel = computed(() =>
  deleteTargetIngesting.value
    ? t('knowledgeSet.stopIngestionAction', 'Stop ingestion')
    : t('knowledgeSet.deleteAction', 'Delete')
);
const deleteDialogTone = computed<'danger' | 'primary'>(() =>
  deleteTargetIngesting.value ? 'primary' : 'danger'
);
const deleteDialogDescription = computed(() => {
  if (deleteTargetIngesting.value) {
    return t(
      'knowledgeSet.stopBeforeDeleteBody',
      { name: deleteTarget.value?.name ?? '' },
      `"{name}" is currently being ingested. Stop the ingestion job first, then delete the file once it has stopped.`
    );
  }
  return t(
    'knowledgeSet.deleteConfirmBody',
    { name: deleteTarget.value?.name ?? '' },
    'This removes the file from the repository. Linked AI Twins will stop using it.\n{name}'
  );
});

function extractServerError(err: unknown, fallback?: string): string | undefined {
  const e = err as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    e?.response?.data?.message ??
    e?.response?.data?.error ??
    e?.message ??
    fallback
  );
}

function formatDateLabel(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function mapDataprepToLabel(raw: string | undefined): string {
  const n = (raw || '').toLowerCase();
  if (n.includes('error')) return t('knowledgeSet.statusError', 'Ingestion error');
  if (n.includes('warning')) return t('knowledgeSet.statusWarning', 'Ingested with warnings');
  if (n.includes('ingesting')) return t('knowledgeSet.statusIngesting', 'Ingesting');
  if (n.includes('ingested')) return t('knowledgeSet.statusIngested', 'Ingested');
  if (n.includes('retracted')) return t('knowledgeSet.statusRetracted', 'Retracted');
  if (n.includes('killed')) return t('knowledgeSet.statusKilled', 'Stopped');
  if (n.includes('pending')) return t('knowledgeSet.statusPending', 'Pending');
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
    lang: (f.language ? String(f.language) : 'en').toLowerCase(),
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
      limit: FILES_PAGE_LIMIT,
      ...(q ? { search: q } : {}),
    });
    documents.value = files.map((f) => mapRepoToRow(f, selectedMap));
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.loadFailed', 'Failed to load documents'),
      extractServerError(err)
    );
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

function onDocumentClick(e: MouseEvent): void {
  if (!rowMenuOpenFor.value) return;
  const target = e.target as Element | null;
  if (!target?.closest('[data-row-menu]')) {
    rowMenuOpenFor.value = null;
  }
}

onMounted(() => {
  void loadDocuments();
  void aiStore.fetchAll();
  document.addEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
});

const filteredDocuments = computed(() => documents.value);

// The dataprep service only runs one job at a time (returns 429 otherwise),
// so we surface whichever file is currently in the "Ingesting" state to set
// the user's expectations and explain why a 429 fires on a second click.
const currentlyIngesting = computed<DocumentRow | null>(
  () =>
    documents.value.find((d) => d.statusRaw.toLowerCase().includes('ingesting')) ??
    null
);

function isBusyError(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 429;
}

function busyMessage(): string {
  const inFlight = currentlyIngesting.value;
  if (inFlight) {
    return t(
      'knowledgeSet.toasts.ingestBusyNamed',
      { name: inFlight.name },
      `"${inFlight.name}" is still being ingested. Wait until it finishes before queueing another.`
    );
  }
  return t(
    'knowledgeSet.toasts.ingestBusy',
    'Another ingestion job is still running. Wait for it to finish before queueing another.'
  );
}

// Capability helpers — single source of truth for what each row can do based
// on its dataprep status. Mirrors the valid backend transitions so the UI
// never offers an action that's guaranteed to fail.
const INGESTABLE_STATUSES = ['pending', 'retracted', 'killed'];
function statusKey(doc: DocumentRow): string {
  return doc.statusRaw.toLowerCase();
}
function isIngesting(doc: DocumentRow): boolean {
  return statusKey(doc).includes('ingesting');
}
function canIngest(doc: DocumentRow): boolean {
  const s = statusKey(doc);
  // "Ingestion Error" is recoverable — allow retry. "Ingested" is already
  // indexed; user must Retract first to re-ingest.
  return INGESTABLE_STATUSES.some((x) => s === x) || s.includes('error');
}
function canRetract(doc: DocumentRow): boolean {
  const s = statusKey(doc);
  return s.includes('ingested') && !s.includes('ingesting');
}
function canStop(doc: DocumentRow): boolean {
  return isIngesting(doc);
}

const isGloballyBusy = computed(() => !!currentlyIngesting.value);
const ingestBlockedReason = computed(() =>
  isGloballyBusy.value
    ? t(
        'knowledgeSet.tooltips.busyJob',
        { name: currentlyIngesting.value?.name ?? '' },
        'Wait — "{name}" is still ingesting.'
      )
    : ''
);

const selectedDocs = computed(() => documents.value.filter((d) => d.selected));
const selectedIngestable = computed(() => selectedDocs.value.filter(canIngest));
const selectedRetractable = computed(() => selectedDocs.value.filter(canRetract));

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

function statusTone(
  statusRaw: string
): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const n = statusRaw.toLowerCase();
  if (n.includes('error')) return 'danger';
  if (n.includes('warning')) return 'warning';
  if (n.includes('ingesting')) return 'accent';
  if (n.includes('ingested')) return 'success';
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

function removeDrawerFile(index: number): void {
  drawerFiles.value = drawerFiles.value.filter((_, i) => i !== index);
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const drawerFilesTotalSize = computed(() =>
  drawerFiles.value.reduce((sum, f) => sum + (f.size || 0), 0)
);

function fileTypeIcon(name: string) {
  return name.toLowerCase().endsWith('.pdf') ? Pdf01Icon : File02Icon;
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
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.uploadFailed', 'Upload failed'),
      extractServerError(err)
    );
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
  deleteTarget.value = {
    fileId: doc.fileId,
    name: doc.name,
    statusRaw: doc.statusRaw,
  };
  deleteDialogOpen.value = true;
}

async function confirmDeleteOrKill() {
  const target = deleteTarget.value;
  if (!target || deleteSubmitting.value) return;
  deleteSubmitting.value = true;
  try {
    if (deleteTargetIngesting.value) {
      // Refuse delete while dataprep is still working on the file.
      // Send the stop signal, close the dialog, and let the user re-attempt
      // delete once the row drops out of the Ingesting state.
      await fileService.killIngestion(target.fileId);
      notify.success(
        t(
          'knowledgeSet.toasts.killSent',
          'Stop signal sent. You can delete the file once it has stopped.'
        )
      );
    } else {
      await fileService.deleteFile(target.fileId);
      notify.success(t('knowledgeSet.toasts.deleteSuccess', 'File deleted'));
    }
    deleteDialogOpen.value = false;
    deleteTarget.value = null;
    await loadDocuments();
  } catch (err) {
    notify.error(
      deleteTargetIngesting.value
        ? t('knowledgeSet.toasts.killFailed', 'Could not stop ingestion')
        : t('knowledgeSet.toasts.deleteFailed', 'Delete failed'),
      extractServerError(err)
    );
  } finally {
    deleteSubmitting.value = false;
  }
}

async function killIngestionRow(doc: DocumentRow): Promise<void> {
  closeRowMenu();
  if (killingId.value) return;
  killingId.value = doc.fileId;
  try {
    await fileService.killIngestion(doc.fileId);
    notify.success(
      t('knowledgeSet.toasts.killSent', 'Stop signal sent. You can delete the file once it has stopped.')
    );
    await loadDocuments();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.killFailed', 'Could not stop ingestion'),
      extractServerError(err)
    );
  } finally {
    killingId.value = null;
  }
}

async function downloadDoc(doc: DocumentRow) {
  try {
    await fileService.downloadFile(doc.fileId, doc.name);
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.downloadFailed', 'Download failed'),
      extractServerError(err)
    );
  }
}

function openCreateTwin() {
  createTwinOpen.value = true;
}

async function onTwinCreated(payload: {
  name: string;
  description: string;
  avatarFile: File | null;
}): Promise<void> {
  if (creatingTwin.value) return;
  creatingTwin.value = true;
  try {
    const twin = await aiStore.create({
      name: payload.name,
      description: payload.description,
      profilePicUrl: null,
    });
    if (payload.avatarFile) {
      try {
        await aiStore.uploadAvatar(twin._key, payload.avatarFile);
      } catch {
        notify.error(
          aiStore.error ?? t('twins.list.avatarFailedToast', 'Twin created, but the avatar upload failed.')
        );
      }
    }
    notify.success(t('twins.list.createdToast', 'AI Twin created'));
    createTwinOpen.value = false;
    // Auto-select the freshly-created twin so the user can link straight away.
    selectedTwinKey.value = twin._key;
    // Make sure the list reflects any server-side enrichment (counts, defaults).
    await aiStore.fetchAll().catch(() => {});
  } catch {
    notify.error(aiStore.error ?? t('twins.list.createFailedToast', 'Failed to create AI Twin'));
  } finally {
    creatingTwin.value = false;
  }
}

function clearDocumentSelections() {
  documentSearch.value = '';
  documents.value.forEach((d) => {
    d.selected = false;
  });
  pendingLinkIds.value = [];
}

// ─── Per-row actions ───────────────────────────────────────────────────────

function toggleRowMenu(fileId: string, e?: Event): void {
  e?.stopPropagation();
  rowMenuOpenFor.value = rowMenuOpenFor.value === fileId ? null : fileId;
}

function closeRowMenu(): void {
  rowMenuOpenFor.value = null;
}

async function ingestOne(doc: DocumentRow): Promise<void> {
  closeRowMenu();
  if (ingestingId.value) return;
  if (!canIngest(doc)) {
    notify.warning(
      t(
        'knowledgeSet.toasts.cannotIngest',
        { status: doc.statusLabel },
        `Cannot ingest a file in "{status}" state.`
      )
    );
    return;
  }
  if (isGloballyBusy.value) {
    notify.warning(
      t('knowledgeSet.toasts.ingestBusyTitle', 'Ingestion in progress'),
      busyMessage()
    );
    return;
  }
  ingestingId.value = doc.fileId;
  try {
    await fileService.ingestFile(doc.fileId);
    notify.success(t('knowledgeSet.toasts.ingestQueued', 'Ingestion started'));
    await loadDocuments();
  } catch (err) {
    if (isBusyError(err)) {
      notify.warning(
        t('knowledgeSet.toasts.ingestBusyTitle', 'Ingestion in progress'),
        busyMessage()
      );
    } else {
      notify.error(
        t('knowledgeSet.toasts.ingestFailed', 'Failed to start ingestion'),
        extractServerError(err)
      );
    }
  } finally {
    ingestingId.value = null;
  }
}

async function retractOne(doc: DocumentRow): Promise<void> {
  closeRowMenu();
  if (retractingId.value) return;
  retractingId.value = doc.fileId;
  try {
    const res = await fileService.retractMultipleFiles([doc.fileId]);
    const failed = res.results.find((r) => !r.success);
    if (failed) {
      notify.error(
        t('knowledgeSet.toasts.retractFailed', 'Retract failed'),
        failed.message || failed.error
      );
    } else {
      notify.success(t('knowledgeSet.toasts.retractSuccess', 'File retracted'));
    }
    await loadDocuments();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.retractFailed', 'Retract failed'),
      extractServerError(err)
    );
  } finally {
    retractingId.value = null;
  }
}

// ─── Bulk actions ──────────────────────────────────────────────────────────

const selectedFileIds = computed(() =>
  documents.value.filter((d) => d.selected).map((d) => d.fileId)
);

// The bulk endpoints return HTTP 200 with a per-file `results: [{ success, error }]`
// array, so a 200 response can still contain failures. Categorise the results
// and surface a precise toast (full success / partial / full failure).
function reportBulkResult(
  res: { results: { success: boolean; error?: string; message?: string }[] },
  successFallback: string,
  failureFallback: string
): void {
  const total = res.results.length;
  const failed = res.results.filter((r) => !r.success);
  const succeeded = total - failed.length;
  const firstError = failed[0]?.message || failed[0]?.error;

  if (failed.length === 0) {
    notify.success(successFallback);
    return;
  }
  if (succeeded === 0) {
    notify.error(failureFallback, firstError);
    return;
  }
  notify.warning(
    t(
      'knowledgeSet.toasts.partial',
      { ok: succeeded, fail: failed.length },
      '{ok} succeeded, {fail} failed'
    ),
    firstError
  );
}

async function ingestSelected(): Promise<void> {
  if (bulkBusy.value) return;
  if (isGloballyBusy.value) {
    notify.warning(
      t('knowledgeSet.toasts.ingestBusyTitle', 'Ingestion in progress'),
      busyMessage()
    );
    return;
  }
  // Skip selected files that aren't in an ingestable state — telling the user
  // up front beats letting the backend reject row-by-row.
  const ids = selectedIngestable.value.map((d) => d.fileId);
  const skipped = selectedDocs.value.length - ids.length;
  if (!ids.length) {
    notify.warning(
      t(
        'knowledgeSet.toasts.noIngestable',
        'None of the selected files are in a state that can be ingested.'
      )
    );
    return;
  }
  if (skipped > 0) {
    notify.info(
      t(
        'knowledgeSet.toasts.ingestSkipped',
        { count: skipped },
        '{count} file(s) skipped — already ingested or currently ingesting.'
      )
    );
  }
  bulkBusy.value = true;
  try {
    const res = await fileService.ingestMultipleFiles(ids);
    reportBulkResult(
      res,
      t(
        'knowledgeSet.toasts.bulkIngestSuccess',
        { count: ids.length },
        'Ingestion started for {count} file(s)'
      ),
      t('knowledgeSet.toasts.bulkIngestFailed', 'Bulk ingestion failed')
    );
    await loadDocuments();
  } catch (err) {
    if (isBusyError(err)) {
      notify.warning(
        t('knowledgeSet.toasts.ingestBusyTitle', 'Ingestion in progress'),
        busyMessage()
      );
    } else {
      notify.error(
        t('knowledgeSet.toasts.bulkIngestFailed', 'Bulk ingestion failed'),
        extractServerError(err)
      );
    }
  } finally {
    bulkBusy.value = false;
  }
}

async function retractSelected(): Promise<void> {
  if (bulkBusy.value) return;
  const ids = selectedRetractable.value.map((d) => d.fileId);
  const skipped = selectedDocs.value.length - ids.length;
  if (!ids.length) {
    notify.warning(
      t(
        'knowledgeSet.toasts.noRetractable',
        'None of the selected files are ingested, so nothing can be retracted.'
      )
    );
    return;
  }
  if (skipped > 0) {
    notify.info(
      t(
        'knowledgeSet.toasts.retractSkipped',
        { count: skipped },
        '{count} file(s) skipped — not currently ingested.'
      )
    );
  }
  bulkBusy.value = true;
  try {
    const res = await fileService.retractMultipleFiles(ids);
    reportBulkResult(
      res,
      t(
        'knowledgeSet.toasts.bulkRetractSuccess',
        { count: ids.length },
        '{count} file(s) retracted'
      ),
      t('knowledgeSet.toasts.bulkRetractFailed', 'Bulk retract failed')
    );
    documents.value.forEach((d) => {
      d.selected = false;
    });
    await loadDocuments();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.bulkRetractFailed', 'Bulk retract failed'),
      extractServerError(err)
    );
  } finally {
    bulkBusy.value = false;
  }
}

// ─── Add from URL / site crawl (drawer tabs) ──────────────────────────────

function parseLabelList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function submitLinkUpload(): Promise<void> {
  const url = linkUrl.value.trim();
  if (!url) {
    notify.warning(t('knowledgeSet.toasts.urlRequired', 'Enter a URL'));
    return;
  }
  if (uploadSubmitting.value) return;
  uploadSubmitting.value = true;
  try {
    await fileService.uploadLink({
      url,
      language: linkLanguage.value.trim() || undefined,
      labels: parseLabelList(linkLabels.value),
    });
    notify.success(t('knowledgeSet.toasts.linkAdded', 'Link added to repository'));
    linkUrl.value = '';
    linkLanguage.value = '';
    linkLabels.value = '';
    uploadOpen.value = false;
    await loadDocuments();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.linkFailed', 'Could not add link'),
      extractServerError(err)
    );
  } finally {
    uploadSubmitting.value = false;
  }
}

async function submitCrawl(): Promise<void> {
  const url = crawlUrl.value.trim();
  if (!url) {
    notify.warning(t('knowledgeSet.toasts.urlRequired', 'Enter a URL'));
    return;
  }
  if (uploadSubmitting.value) return;
  uploadSubmitting.value = true;
  try {
    await fileService.scheduleSiteCrawl({
      url,
      maxDepth: typeof crawlMaxDepth.value === 'number' ? crawlMaxDepth.value : undefined,
    });
    notify.success(t('knowledgeSet.toasts.crawlScheduled', 'Crawl scheduled'));
    crawlUrl.value = '';
    uploadOpen.value = false;
    await loadDocuments();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.crawlFailed', 'Could not schedule crawl'),
      extractServerError(err)
    );
  } finally {
    uploadSubmitting.value = false;
  }
}

// ─── File details drawer (metadata, edit, ingestion log, crawl) ───────────

function asString(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

// Hide raw plumbing fields from the friendly Details view; users don't need
// _key / _id / _rev / file_hash / storage_path to make decisions about a file.
const TECHNICAL_META_KEYS = new Set([
  '_key',
  '_id',
  '_rev',
  'file_hash',
  'storage_path',
  'file_id',
  'create_date',
]);

const showAdvancedMeta = ref(false);

function formatMetaDate(value: unknown): string {
  const s = asString(value);
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });
}

function friendlyFileType(mime: string, name: string): string {
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf') return 'PDF document';
  if (m === 'text/markdown') return 'Markdown document';
  if (m === 'text/plain') return 'Plain text';
  if (m === 'text/html') return 'HTML page';
  if (m.startsWith('image/')) return 'Image';
  if (m.includes('word')) return 'Word document';
  if (m.includes('spreadsheet') || m.includes('excel')) return 'Spreadsheet';
  const ext = name.split('.').pop()?.toUpperCase();
  return ext ? `${ext} file` : 'File';
}

function statusInfo(raw: unknown): { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' } {
  const s = asString(raw).toLowerCase();
  if (s.includes('error')) return { label: 'Ingestion error', tone: 'danger' };
  if (s.includes('warning')) return { label: 'Ingested with warnings', tone: 'warning' };
  if (s.includes('ingesting')) return { label: 'Ingesting', tone: 'accent' };
  if (s.includes('ingested')) return { label: 'Ingested', tone: 'success' };
  if (s.includes('retract')) return { label: 'Retracted', tone: 'neutral' };
  if (s.includes('killed')) return { label: 'Stopped', tone: 'neutral' };
  return { label: 'Pending', tone: 'neutral' };
}

interface MetaSummary {
  fileName: string;
  fileTypeLabel: string;
  fileSizeLabel: string;
  status: ReturnType<typeof statusInfo>;
  uploaded: string;
  ingested: string;
  retracted: string;
  language: string;
  author: string;
  labels: string[];
  sourceUrl: string;
  chunkCount: string;
}

const metaSummary = computed<MetaSummary | null>(() => {
  const m = details.value.metadata;
  if (!m) return null;
  const dataprep = (m.dataprep ?? {}) as Record<string, unknown>;
  const sizeRaw = Number(m.file_size ?? 0);
  return {
    fileName: asString(m.file_name) || details.value.name,
    fileTypeLabel: friendlyFileType(asString(m.file_type), asString(m.file_name)),
    fileSizeLabel: Number.isFinite(sizeRaw) && sizeRaw > 0 ? formatFileSize(sizeRaw) : '—',
    status: statusInfo(dataprep.status),
    uploaded: formatMetaDate(m.uploaded_date),
    ingested: formatMetaDate(dataprep.ingest_date),
    retracted: formatMetaDate(dataprep.retract_date),
    language: asString(m.language) || '—',
    author: asString(m.author) || '—',
    labels: Array.isArray(m.labels) ? (m.labels as string[]) : [],
    sourceUrl: asString(m.source_url),
    chunkCount: asString(m.chunk_count) || '0',
  };
});

const advancedMetaEntries = computed(() => {
  const m = details.value.metadata ?? {};
  return Object.entries(m).filter(([k]) => TECHNICAL_META_KEYS.has(k));
});

// Reuse the same canonical language list the chat backend supports — matching
// languages here means a file's `language` value will line up with the chat
// language dropdown elsewhere. Sorted alphabetically for scannability and
// prefixed with an empty option so the user can clear an existing selection.
const languageOptions = computed(() => {
  const sorted = [...CHAT_LANGS].sort((a, b) => a.label.localeCompare(b.label));
  return [
    { value: '', label: t('knowledgeSet.languageAuto', 'Auto-detect / unset'), flag: '' },
    ...sorted.map((l) => ({ value: l.code, label: l.label, flag: l.flag })),
  ];
});

// Live status of the file open in the drawer — used to gate the "Kill ingest"
// button so it disappears as soon as the job leaves the Ingesting state.
const detailsIsIngesting = computed(() => {
  const status = asString((details.value.metadata?.dataprep as Record<string, unknown> | undefined)?.status);
  return status.toLowerCase().includes('ingesting');
});

// A file shows the Crawl tab only if it actually came from a site crawl.
// `source_url` is the most reliable marker — the crawler always sets it,
// regular uploads never do.
const detailsIsCrawled = computed(() =>
  Boolean(asString(details.value.metadata?.source_url))
);

// Active crawl detection — drives the "Kill crawl" button. The crawl_job
// document carries `status` ∈ {Pending, Running, Completed, Failed, Killed}.
const detailsCrawlActive = computed(() => {
  const job = details.value.crawlJob as { status?: unknown } | null;
  const status = asString(job?.status).toLowerCase();
  return status === 'pending' || status === 'running';
});

const detailsTabs = computed<Array<'details' | 'edit' | 'ingestion' | 'crawl'>>(() =>
  detailsIsCrawled.value
    ? ['details', 'edit', 'ingestion', 'crawl']
    : ['details', 'edit', 'ingestion']
);

watch(detailsTabs, (tabs) => {
  if (!tabs.includes(details.value.tab)) {
    details.value.tab = 'details';
  }
});

// ─── Ingestion log filters & summary ───────────────────────────────────────

const logStageFilter = ref<string>('all');
const logLevelFilter = ref<string>('all');
const logSearch = ref<string>('');

watch(
  () => details.value.fileId,
  () => {
    logStageFilter.value = 'all';
    logLevelFilter.value = 'all';
    logSearch.value = '';
  }
);

function logLevelTone(level: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const l = (level || '').toUpperCase();
  if (l === 'ERROR' || l === 'CRITICAL') return 'danger';
  if (l === 'WARN' || l === 'WARNING') return 'warning';
  if (l === 'DEBUG') return 'neutral';
  return 'accent'; // INFO and unknown → accent (informational)
}

function logTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function logDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' });
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const logStages = computed<string[]>(() => {
  const stages = new Set<string>();
  for (const entry of details.value.ingestionLog) {
    if (entry.stage) stages.add(entry.stage);
  }
  return Array.from(stages);
});

const filteredLogEntries = computed<IngestionLogEntry[]>(() => {
  const stage = logStageFilter.value;
  const level = logLevelFilter.value.toUpperCase();
  const q = logSearch.value.trim().toLowerCase();
  return details.value.ingestionLog.filter((entry) => {
    if (stage !== 'all' && entry.stage !== stage) return false;
    if (level !== 'ALL') {
      const l = (entry.level || '').toUpperCase();
      if (level === 'WARN') {
        if (l !== 'WARN' && l !== 'WARNING') return false;
      } else if (level === 'ERROR') {
        if (l !== 'ERROR' && l !== 'CRITICAL') return false;
      } else if (l !== level) return false;
    }
    if (q && !entry.message.toLowerCase().includes(q)) return false;
    return true;
  });
});

interface LogSummary {
  total: number;
  warnings: number;
  errors: number;
  latestStage: string;
  elapsed: string;
}

const logSummary = computed<LogSummary | null>(() => {
  const entries = details.value.ingestionLog;
  if (!entries.length) return null;
  let warnings = 0;
  let errors = 0;
  let firstTs = Infinity;
  let lastTs = -Infinity;
  let latestStage = '';
  let latestTs = -Infinity;
  for (const e of entries) {
    const l = (e.level || '').toUpperCase();
    if (l === 'WARN' || l === 'WARNING') warnings++;
    else if (l === 'ERROR' || l === 'CRITICAL') errors++;
    const ts = new Date(e.timestamp).getTime();
    if (Number.isFinite(ts)) {
      if (ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
      if (ts > latestTs) {
        latestTs = ts;
        latestStage = e.stage || '';
      }
    }
  }
  return {
    total: entries.length,
    warnings,
    errors,
    latestStage,
    elapsed: Number.isFinite(firstTs) && Number.isFinite(lastTs)
      ? formatDurationMs(lastTs - firstTs)
      : '0s',
  };
});

async function openFileDetails(doc: DocumentRow): Promise<void> {
  closeRowMenu();
  details.value = { ...emptyDetails(), open: true, fileId: doc.fileId, name: doc.name };
  details.value.loadingMeta = true;
  try {
    const meta = (await fileService.getFileMetadata(doc.fileId)) as Record<string, unknown> | null;
    details.value.metadata = meta ?? null;
    details.value.editName = asString(meta?.file_name) || doc.name;
    details.value.editLanguage = asString(meta?.language);
    details.value.editLabels = Array.isArray(meta?.labels)
      ? (meta?.labels as string[]).join(', ')
      : '';
    details.value.editAuthor = asString(meta?.author);
  } catch (e) {
    details.value.metaError =
      (e as { message?: string })?.message ??
      t('knowledgeSet.toasts.metaFailed', 'Failed to load file details');
  } finally {
    details.value.loadingMeta = false;
  }
}

function closeFileDetails(): void {
  details.value.open = false;
}

async function saveMetadataEdit(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId || details.value.saving) return;
  details.value.saving = true;
  try {
    await fileService.updateFile(fileId, {
      file_name: details.value.editName.trim() || undefined,
      language: details.value.editLanguage.trim() || undefined,
      labels: parseLabelList(details.value.editLabels),
      author: details.value.editAuthor.trim() || undefined,
    });
    notify.success(t('knowledgeSet.toasts.metaSaved', 'File metadata updated'));
    await loadDocuments();
    // Refresh the metadata view from the server.
    const meta = (await fileService.getFileMetadata(fileId)) as Record<string, unknown> | null;
    details.value.metadata = meta ?? null;
    details.value.tab = 'details';
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.metaSaveFailed', 'Failed to update file'),
      extractServerError(err)
    );
  } finally {
    details.value.saving = false;
  }
}

async function loadIngestionLog(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId) return;
  details.value.ingestionLogLoading = true;
  details.value.ingestionLogError = null;
  try {
    details.value.ingestionLog = await fileService.getIngestionLogs(fileId);
  } catch (err) {
    details.value.ingestionLog = [];
    details.value.ingestionLogError =
      extractServerError(err) ?? t('knowledgeSet.logs.loadFailed', 'Could not load logs.');
  } finally {
    details.value.ingestionLogLoading = false;
  }
}

async function refreshDrawerMetadata(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId) return;
  try {
    const meta = (await fileService.getFileMetadata(fileId)) as Record<string, unknown> | null;
    details.value.metadata = meta ?? null;
  } catch {
    // Stale metadata is non-fatal — the drawer keeps what it had.
  }
}

async function killIngestion(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId || details.value.killing) return;
  details.value.killing = true;
  try {
    await fileService.killIngestion(fileId);
    notify.success(t('knowledgeSet.toasts.killSuccess', 'Process stopped'));
    // Refresh in parallel — log + new dataprep status + the row in the list
    // all need to reflect the kill.
    await Promise.all([loadIngestionLog(), refreshDrawerMetadata(), loadDocuments()]);
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.killFailed', 'Could not stop process'),
      extractServerError(err)
    );
  } finally {
    details.value.killing = false;
  }
}

async function loadCrawlState(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId) return;
  details.value.crawlLoading = true;
  try {
    const [job, metrics, logs] = await Promise.all([
      fileService.getCrawlJob(fileId).catch(() => null),
      fileService.getCrawlMetrics(fileId).catch(() => null),
      fileService.getCrawlLogs(fileId).catch(() => null),
    ]);
    details.value.crawlJob = job;
    details.value.crawlMetrics = metrics;
    details.value.crawlLogs = asString(logs);
  } finally {
    details.value.crawlLoading = false;
  }
}

async function killCrawl(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId || details.value.killing) return;
  details.value.killing = true;
  try {
    await fileService.killCrawl(fileId);
    notify.success(t('knowledgeSet.toasts.killSuccess', 'Process stopped'));
    await Promise.all([loadCrawlState(), refreshDrawerMetadata(), loadDocuments()]);
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.killFailed', 'Could not stop process'),
      extractServerError(err)
    );
  } finally {
    details.value.killing = false;
  }
}

watch(
  () => [details.value.open, details.value.tab] as const,
  ([open, tab]) => {
    if (!open || !details.value.fileId) return;
    if (
      tab === 'ingestion' &&
      details.value.ingestionLog.length === 0 &&
      !details.value.ingestionLogLoading
    ) {
      void loadIngestionLog();
    }
    if (tab === 'crawl' && !details.value.crawlLogs && !details.value.crawlLoading) {
      void loadCrawlState();
    }
  }
);
</script>

<template>
  <DashboardLayout>
    <section class="h-full min-h-0 bg-surface p-4 md:p-6">
      <div class="flex h-full min-h-[700px] flex-col">
        <template v-if="mode === 'documents'">
          <header class="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h1 class="text-headline text-text">{{ t('knowledgeSet.title', 'Knowledge Set') }}</h1>
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

          <div
            v-if="currentlyIngesting"
            class="mb-3 flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-2 text-caption text-text"
            role="status"
            aria-live="polite"
          >
            <span
              class="block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span class="font-semibold">
                {{ t('knowledgeSet.ingestingNowLabel', 'Ingesting now:') }}
              </span>
              <span class="ml-1 truncate">{{ currentlyIngesting.name }}</span>
            </span>
            <span class="shrink-0 text-meta text-text-muted">
              {{
                t(
                  'knowledgeSet.ingestingNowHint',
                  'Only one job can run at a time. Other ingests will queue after this finishes.'
                )
              }}
            </span>
          </div>

          <div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2">
            <BaseCheckbox v-model="allDocumentsSelected" size="sm" class="min-w-0">
              <span class="truncate text-caption font-medium text-text-muted">
                {{ t('knowledgeSet.selectHint', 'Select files to link them to an AI Twin') }}
              </span>
            </BaseCheckbox>
            <div class="flex flex-wrap items-center gap-2">
              <span
                v-if="selectedCount > 0"
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-caption font-semibold text-accent"
              >
                {{
                  t(
                    'knowledgeSet.selectedCount',
                    { count: selectedCount },
                    '{count} selected'
                  )
                }}
              </span>
              <button
                v-if="selectedCount > 0"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-caption font-semibold text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="bulkBusy || isGloballyBusy || selectedIngestable.length === 0"
                :title="
                  isGloballyBusy
                    ? ingestBlockedReason
                    : selectedIngestable.length === 0
                      ? t(
                          'knowledgeSet.tooltips.noIngestable',
                          'None of the selected files can be ingested in their current state.'
                        )
                      : ''
                "
                @click="ingestSelected"
              >
                <Icon :icon="PlayIcon" :size="14" />
                <span>{{ t('knowledgeSet.ingestSelectedAction', 'Ingest') }}</span>
                <span
                  v-if="selectedIngestable.length && selectedIngestable.length !== selectedCount"
                  class="rounded-full bg-accent-soft px-1.5 text-meta font-semibold text-accent"
                >
                  {{ selectedIngestable.length }}
                </span>
              </button>
              <button
                v-if="selectedCount > 0"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-caption font-semibold text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="bulkBusy || selectedRetractable.length === 0"
                :title="
                  selectedRetractable.length === 0
                    ? t(
                        'knowledgeSet.tooltips.noRetractable',
                        'None of the selected files are ingested, so nothing can be retracted.'
                      )
                    : ''
                "
                @click="retractSelected"
              >
                <Icon :icon="PauseIcon" :size="14" />
                <span>{{ t('knowledgeSet.retractSelectedAction', 'Retract') }}</span>
                <span
                  v-if="selectedRetractable.length && selectedRetractable.length !== selectedCount"
                  class="rounded-full bg-accent-soft px-1.5 text-meta font-semibold text-accent"
                >
                  {{ selectedRetractable.length }}
                </span>
              </button>
            </div>
          </div>

          <div
            v-if="documentsLoading"
            class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 py-1"
            :aria-busy="true"
            :aria-label="t('knowledgeSet.loadingDocs', 'Loading documents…')"
          >
            <KnowledgeSetDocsSkeleton :rows="6" />
          </div>

          <div v-else class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 py-1">
            <ul v-if="filteredDocuments.length" class="space-y-2" role="list">
              <li
                v-for="document in filteredDocuments"
                :key="document.fileId"
                role="checkbox"
                tabindex="0"
                :aria-checked="!!document.selected"
                :class="[
                  'group relative flex cursor-pointer items-center gap-3.5 rounded-xl border bg-surface px-4 py-3.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  document.selected
                    ? 'border-accent bg-accent-soft/40'
                    : 'border-border hover:border-border-strong hover:bg-surface-subtle',
                ]"
                @click="toggleDocument(document)"
                @keydown.enter.prevent="toggleDocument(document)"
                @keydown.space.prevent="toggleDocument(document)"
              >
                <span
                  :class="[
                    'grid h-5 w-5 shrink-0 place-items-center rounded border transition',
                    document.selected
                      ? 'border-accent bg-accent text-text-inverse'
                      : 'border-border bg-surface',
                  ]"
                  aria-hidden="true"
                >
                  <svg
                    v-if="document.selected"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="h-3 w-3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>

                <span
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger"
                  aria-hidden="true"
                >
                  <Icon :icon="docIcon(document.name)" :size="20" />
                </span>

                <div class="flex min-w-0 flex-1 flex-col">
                  <div class="flex min-w-0 items-center gap-2">
                    <h2 class="truncate text-body font-medium text-text">
                      <TranslatedText :text="document.name" :lang="document.lang" />
                    </h2>
                    <BaseBadge :tone="statusTone(document.statusRaw)" dot class="shrink-0">
                      {{ document.statusLabel }}
                    </BaseBadge>
                  </div>
                  <p class="truncate text-meta text-text-muted">
                    <span>{{ document.dateLabel }}</span>
                    <span v-if="document.subtitle" aria-hidden="true" class="mx-1.5">·</span>
                    <span>{{ document.subtitle }}</span>
                  </p>
                </div>

                <div class="relative flex shrink-0 items-center gap-0.5" data-row-menu>
                  <button
                    v-if="canStop(document)"
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted opacity-0 transition hover:bg-surface-subtle hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    :aria-label="t('knowledgeSet.stopAria', 'Stop ingestion')"
                    :title="t('knowledgeSet.stopAria', 'Stop ingestion')"
                    :disabled="killingId === document.fileId"
                    @click.stop="killIngestionRow(document)"
                  >
                    <span
                      v-if="killingId === document.fileId"
                      class="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                      aria-hidden="true"
                    />
                    <Icon v-else :icon="StopCircleIcon" :size="16" />
                  </button>
                  <button
                    v-else-if="canIngest(document)"
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted opacity-0 transition hover:bg-surface-subtle hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    :aria-label="t('knowledgeSet.ingestAria', 'Ingest now')"
                    :title="
                      isGloballyBusy
                        ? ingestBlockedReason
                        : t('knowledgeSet.ingestAria', 'Ingest now')
                    "
                    :disabled="ingestingId === document.fileId || isGloballyBusy"
                    @click.stop="ingestOne(document)"
                  >
                    <span
                      v-if="ingestingId === document.fileId"
                      class="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                      aria-hidden="true"
                    />
                    <Icon v-else :icon="PlayIcon" :size="16" />
                  </button>
                  <button
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted opacity-0 transition hover:bg-surface-subtle hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                    :aria-label="t('knowledgeSet.downloadAria', 'Download document')"
                    @click.stop="downloadDoc(document)"
                  >
                    <Icon :icon="Download04Icon" :size="16" />
                  </button>
                  <button
                    type="button"
                    :class="[
                      'grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text',
                      rowMenuOpenFor === document.fileId
                        ? 'opacity-100 bg-surface-subtle text-text'
                        : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    ]"
                    :aria-label="t('knowledgeSet.moreAria', 'More actions')"
                    :aria-expanded="rowMenuOpenFor === document.fileId"
                    aria-haspopup="menu"
                    @click.stop="toggleRowMenu(document.fileId, $event)"
                  >
                    <Icon :icon="MoreVerticalIcon" :size="16" />
                  </button>

                  <div
                    v-if="rowMenuOpenFor === document.fileId"
                    role="menu"
                    class="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-popover"
                    @click.stop
                  >
                    <button
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle"
                      @click="openFileDetails(document)"
                    >
                      <Icon :icon="File02Icon" :size="14" />
                      {{ t('knowledgeSet.menu.details', 'View details') }}
                    </button>
                    <div class="my-1 border-t border-border-subtle" />
                    <button
                      v-if="canIngest(document)"
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="ingestingId === document.fileId || isGloballyBusy"
                      :title="isGloballyBusy ? ingestBlockedReason : ''"
                      @click="ingestOne(document)"
                    >
                      <Icon :icon="PlayIcon" :size="14" />
                      {{ t('knowledgeSet.menu.ingest', 'Ingest now') }}
                    </button>
                    <button
                      v-if="canRetract(document)"
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="retractingId === document.fileId"
                      @click="retractOne(document)"
                    >
                      <Icon :icon="PauseIcon" :size="14" />
                      {{ t('knowledgeSet.menu.retract', 'Retract') }}
                    </button>
                    <button
                      v-if="canStop(document)"
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="killingId === document.fileId"
                      @click="killIngestionRow(document)"
                    >
                      <Icon :icon="StopCircleIcon" :size="14" />
                      {{ t('knowledgeSet.menu.stopIngestion', 'Stop ingestion') }}
                    </button>
                    <div class="my-1 border-t border-border-subtle" />
                    <button
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-danger transition hover:bg-danger-soft"
                      @click="closeRowMenu(); askDelete(document)"
                    >
                      <Icon :icon="Delete02Icon" :size="14" />
                      {{ t('knowledgeSet.menu.delete', 'Delete') }}
                    </button>
                  </div>
                </div>
              </li>
            </ul>

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

          <footer
            v-if="selectedCount > 0"
            class="mt-5 flex items-center justify-end gap-3"
          >
            <BaseButton variant="outline" rounded="full" @click="clearDocumentSelections">
              {{ t('knowledgeSet.cancel', 'Cancel') }}
            </BaseButton>
            <BaseButton
              variant="primary"
              rounded="full"
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
          </footer>
        </template>

        <template v-else>
          <header class="mb-4 flex flex-col gap-3">
            <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex min-w-0 flex-col gap-1">
                <h1 class="text-headline text-text">
                  {{ t('knowledgeSet.selectAiTwinsTitle', 'Select an AI Twin') }}
                </h1>
                <p v-if="pendingLinkIds.length" class="text-caption text-text-muted">
                  {{
                    t(
                      'knowledgeSet.linkingHint',
                      { count: pendingLinkIds.length },
                      'Linking {count} file(s) to the chosen twin.'
                    )
                  }}
                </p>
              </div>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div class="w-full sm:w-72 lg:w-96">
                  <BaseInput
                    v-model="twinSearch"
                    :placeholder="t('knowledgeSet.twinSearchPlaceholder', 'Search twins')"
                    rounded="full"
                  >
                    <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
                  </BaseInput>
                </div>
                <BaseButton variant="primary" rounded="full" @click="openCreateTwin">
                  <Icon :icon="AddCircleIcon" :size="17" />
                  {{ t('knowledgeSet.createAiTwin', 'Create AI Twin') }}
                </BaseButton>
              </div>
            </div>
          </header>

          <div
            v-if="twinsLoading"
            class="min-h-0 flex-1 overflow-y-auto pr-1"
            :aria-busy="true"
            :aria-label="t('knowledgeSet.loadingTwins', 'Loading AI Twins…')"
          >
            <div class="grid gap-4 xl:grid-cols-2">
              <AiTwinCardSkeleton v-for="i in 4" :key="i" />
            </div>
          </div>
          <div v-else class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div v-if="filteredTwins.length" class="grid gap-3 lg:grid-cols-2">
              <button
                v-for="twin in filteredTwins"
                :key="twin._key"
                type="button"
                :aria-pressed="selectedTwinKey === twin._key"
                :class="[
                  'group flex flex-col gap-3 rounded-xl border bg-surface p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  selectedTwinKey === twin._key
                    ? 'border-accent bg-accent-soft/30 shadow-card'
                    : 'border-border shadow-card hover:border-border-strong hover:bg-surface-subtle',
                ]"
                @click="selectTwinRow(twin)"
              >
                <div class="flex items-start gap-3">
                  <BaseAvatar
                    :src="twin.profilePicUrl ?? ''"
                    :name="twin.name"
                    size="lg"
                  />
                  <div class="min-w-0 flex-1">
                    <h2 class="truncate text-body font-semibold text-text">
                      <TranslatedText :text="twin.name" />
                    </h2>
                    <p
                      v-if="twin.description"
                      class="mt-0.5 line-clamp-2 text-meta text-text-muted"
                    >
                      {{ twin.description }}
                    </p>
                    <p v-else class="mt-0.5 text-meta italic text-text-subtle">
                      {{ t('knowledgeSet.noDescription', 'No description') }}
                    </p>
                  </div>
                  <span
                    :class="[
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full border transition',
                      selectedTwinKey === twin._key
                        ? 'border-accent bg-accent text-text-inverse'
                        : 'border-border-strong group-hover:border-text-muted',
                    ]"
                    aria-hidden="true"
                  >
                    <span v-if="selectedTwinKey === twin._key" class="block h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-muted">
                  <span class="inline-flex items-center gap-1.5">
                    <Icon :icon="File02Icon" :size="14" />
                    {{
                      t(
                        'knowledgeSet.linkedFilesCount',
                        { count: twin.linkedKbFileIds.length },
                        '{count} linked'
                      )
                    }}
                  </span>
                  <span aria-hidden="true" class="text-border-strong">·</span>
                  <span
                    :class="[
                      'inline-flex items-center gap-1.5',
                      twin.voiceId ? 'text-text-muted' : 'text-text-subtle',
                    ]"
                  >
                    <span
                      :class="[
                        'h-1.5 w-1.5 rounded-full',
                        twin.voiceId ? 'bg-success' : 'bg-text-subtle',
                      ]"
                      aria-hidden="true"
                    />
                    {{
                      twin.voiceId
                        ? t('knowledgeSet.voiceReady', 'Voice ready')
                        : t('knowledgeSet.voiceNone', 'No voice')
                    }}
                  </span>
                  <span aria-hidden="true" class="text-border-strong">·</span>
                  <span class="truncate">
                    {{
                      t(
                        'knowledgeSet.updatedRelative',
                        { date: formatDateLabel(twin.updatedAt) },
                        'Updated {date}'
                      )
                    }}
                  </span>
                </div>
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
              {{ t('common.back', 'Back') }}
            </BaseButton>
            <BaseButton
              variant="primary"
              rounded="full"
              :disabled="!selectedTwinKey"
              @click="confirmLinkToTwin"
            >
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
        <p class="mb-3 text-caption text-text-muted">
          {{ t('knowledgeSet.drawerIntro', 'Upload files to the document repository.') }}
        </p>

        <div
          class="mb-4 inline-flex w-full gap-1 rounded-full bg-surface-muted p-1"
          role="tablist"
          :aria-label="t('knowledgeSet.drawerTabsLabel', 'Upload source')"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="uploadTab === 'files'"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition',
              uploadTab === 'files' ? 'bg-surface text-text shadow-card' : 'text-text-muted',
            ]"
            @click="uploadTab = 'files'"
          >
            <Icon :icon="Upload01Icon" :size="14" />
            {{ t('knowledgeSet.tabFiles', 'Files') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="uploadTab === 'url'"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition',
              uploadTab === 'url' ? 'bg-surface text-text shadow-card' : 'text-text-muted',
            ]"
            @click="uploadTab = 'url'"
          >
            <Icon :icon="Link01Icon" :size="14" />
            {{ t('knowledgeSet.tabUrl', 'URL') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="uploadTab === 'crawl'"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition',
              uploadTab === 'crawl' ? 'bg-surface text-text shadow-card' : 'text-text-muted',
            ]"
            @click="uploadTab = 'crawl'"
          >
            <Icon :icon="Globe02Icon" :size="14" />
            {{ t('knowledgeSet.tabCrawl', 'Site crawl') }}
          </button>
        </div>

        <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />

        <!-- Files tab -->
        <div v-if="uploadTab === 'files'">
        <!-- Empty state — large dropzone -->
        <div
          v-if="!drawerFiles.length"
          :class="[
            'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition',
            dragOver ? 'border-accent bg-accent-soft' : 'border-border bg-surface-muted',
          ]"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop="onDrop"
        >
          <span class="grid h-12 w-12 place-items-center rounded-full bg-surface text-text-muted shadow-card">
            <Icon :icon="CloudUploadIcon" :size="24" />
          </span>
          <p class="text-body font-medium text-text">{{ t('knowledgeSet.uploadFile', 'Drag & drop files here') }}</p>
          <p class="max-w-xs text-caption text-text-muted">
            {{ t('knowledgeSet.allowedTypes', 'PDF, Word, CSV, TXT, DOCX') }}
          </p>
          <BaseButton variant="soft" size="sm" rounded="full" @click="pickFile">
            {{ t('knowledgeSet.browseFiles', 'Browse files') }}
          </BaseButton>
        </div>

        <!-- Has files — header + staged list + compact "add more" zone -->
        <div v-else class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <span class="text-caption font-semibold text-text">
              {{
                drawerFiles.length === 1
                  ? t('knowledgeSet.fileReadyOne', '1 file ready')
                  : t(
                      'knowledgeSet.fileReadyMany',
                      { count: drawerFiles.length },
                      '{count} files ready'
                    )
              }}
              <span class="ml-1 font-normal text-text-muted">· {{ formatFileSize(drawerFilesTotalSize) }}</span>
            </span>
            <button
              type="button"
              class="text-meta font-semibold text-text-muted transition hover:text-danger"
              :disabled="uploadSubmitting"
              @click="drawerFiles = []"
            >
              {{ t('knowledgeSet.clearAll', 'Clear all') }}
            </button>
          </div>

          <ul class="flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5" role="list">
            <li
              v-for="(file, index) in drawerFiles"
              :key="`${file.name}-${index}`"
              class="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger"
                aria-hidden="true"
              >
                <Icon :icon="fileTypeIcon(file.name)" :size="18" />
              </span>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-caption font-medium text-text">{{ file.name }}</span>
                <span class="text-meta text-text-muted">{{ formatFileSize(file.size) }}</span>
              </div>
              <button
                type="button"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                :aria-label="t('knowledgeSet.removeFileAria', 'Remove file')"
                :disabled="uploadSubmitting"
                @click="removeDrawerFile(index)"
              >
                <Icon :icon="Cancel01Icon" :size="16" />
              </button>
            </li>
          </ul>

          <button
            type="button"
            :class="[
              'flex items-center justify-center gap-2 rounded-xl border-2 border-dashed py-3 text-caption font-medium transition',
              dragOver
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border bg-surface-muted text-text-muted hover:border-border-strong hover:text-text',
            ]"
            :disabled="uploadSubmitting"
            @click="pickFile"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop="onDrop"
          >
            <Icon :icon="CloudUploadIcon" :size="16" />
            {{ t('knowledgeSet.addMoreFiles', 'Add more files or drop here') }}
          </button>
        </div>
        </div>

        <!-- URL tab -->
        <div v-else-if="uploadTab === 'url'" class="flex flex-col gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.urlField', 'URL') }}
            </span>
            <BaseInput
              v-model="linkUrl"
              type="url"
              :placeholder="t('knowledgeSet.urlPlaceholder', 'https://example.com/document.pdf')"
              rounded="full"
            />
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">
                {{ t('knowledgeSet.languageField', 'Language') }}
              </span>
              <BaseDropdown
                v-model="linkLanguage"
                :options="languageOptions"
                :placeholder="t('knowledgeSet.languagePlaceholder', 'Select a language')"
                width="w-full"
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">
                {{ t('knowledgeSet.labelsField', 'Labels') }}
              </span>
              <BaseInput
                v-model="linkLabels"
                :placeholder="t('knowledgeSet.labelsPlaceholder', 'comma, separated')"
                rounded="full"
              />
            </label>
          </div>
          <p class="text-meta text-text-muted">
            {{ t('knowledgeSet.urlHint', 'We download the page contents and ingest them like a normal upload.') }}
          </p>
        </div>

        <!-- Site crawl tab -->
        <div v-else class="flex flex-col gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.crawlUrlField', 'Start URL') }}
            </span>
            <BaseInput
              v-model="crawlUrl"
              type="url"
              :placeholder="t('knowledgeSet.crawlUrlPlaceholder', 'https://example.com')"
              rounded="full"
            />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.crawlMaxDepth', 'Max depth') }}
            </span>
            <BaseInput
              v-model.number="crawlMaxDepth"
              type="number"
              min="1"
              max="20"
              :placeholder="t('knowledgeSet.crawlMaxDepthPlaceholder', '2 (recommended)')"
              rounded="full"
            />
          </label>
          <p class="text-meta text-text-muted">
            {{
              t(
                'knowledgeSet.crawlHint',
                'We schedule a background crawl. Track progress from the file row → Crawl status.'
              )
            }}
          </p>
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
          <BaseButton
            v-if="uploadTab === 'files'"
            variant="primary"
            :loading="uploadSubmitting"
            :disabled="!drawerFiles.length"
            @click="submitDrawerUpload"
          >
            {{
              drawerFiles.length > 1
                ? t(
                    'knowledgeSet.uploadCount',
                    { count: drawerFiles.length },
                    'Upload {count} files'
                  )
                : t('knowledgeSet.addKnowledge', 'Upload')
            }}
          </BaseButton>
          <BaseButton
            v-else-if="uploadTab === 'url'"
            variant="primary"
            :loading="uploadSubmitting"
            :disabled="!linkUrl.trim()"
            @click="submitLinkUpload"
          >
            <Icon :icon="Link01Icon" :size="14" />
            {{ t('knowledgeSet.urlSubmit', 'Add link') }}
          </BaseButton>
          <BaseButton
            v-else
            variant="primary"
            :loading="uploadSubmitting"
            :disabled="!crawlUrl.trim()"
            @click="submitCrawl"
          >
            <Icon :icon="Globe02Icon" :size="14" />
            {{ t('knowledgeSet.crawlSubmit', 'Schedule crawl') }}
          </BaseButton>
        </template>
      </BaseDrawer>

      <ConfirmDialog
        v-model:open="deleteDialogOpen"
        :title="deleteDialogTitle"
        :description="deleteDialogDescription"
        :confirm-label="deleteDialogConfirmLabel"
        :cancel-label="t('knowledgeSet.cancel', 'Cancel')"
        :tone="deleteDialogTone"
        :loading="deleteSubmitting"
        @confirm="confirmDeleteOrKill"
      />

      <CreateAiTwinDialog
        v-model:open="createTwinOpen"
        :submitting="creatingTwin"
        @created="onTwinCreated"
      />

      <BaseDrawer
        :open="details.open"
        :title="details.name || t('knowledgeSet.detailsTitle', 'File details')"
        :icon="File02Icon"
        width="md"
        @update:open="(v) => (details.open = v)"
      >
        <div
          class="mb-4 inline-flex w-full gap-1 rounded-full bg-surface-muted p-1"
          role="tablist"
          :aria-label="t('knowledgeSet.detailsTabsLabel', 'File details tabs')"
        >
          <button
            v-for="tab in detailsTabs"
            :key="tab"
            type="button"
            role="tab"
            :aria-selected="details.tab === tab"
            :class="[
              'flex flex-1 items-center justify-center rounded-full px-3 py-1.5 text-caption font-semibold transition',
              details.tab === tab ? 'bg-surface text-text shadow-card' : 'text-text-muted',
            ]"
            @click="details.tab = tab"
          >
            {{
              tab === 'details'
                ? t('knowledgeSet.detailsTab', 'Details')
                : tab === 'edit'
                  ? t('knowledgeSet.editTab', 'Edit')
                  : tab === 'ingestion'
                    ? t('knowledgeSet.ingestionTab', 'Ingestion')
                    : t('knowledgeSet.crawlTab', 'Crawl')
            }}
          </button>
        </div>

        <div v-if="details.loadingMeta" class="space-y-2">
          <div class="h-4 w-1/3 animate-pulse rounded bg-surface-subtle" />
          <div class="h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
          <div class="h-4 w-1/2 animate-pulse rounded bg-surface-subtle" />
        </div>
        <p v-else-if="details.metaError" class="text-caption text-danger">{{ details.metaError }}</p>

        <div v-else-if="details.tab === 'details' && metaSummary" class="flex flex-col gap-4">
          <!-- Hero card: file + status at a glance -->
          <section class="flex flex-col gap-4 rounded-2xl border border-border bg-surface-muted px-4 py-4 sm:flex-row sm:items-center">
            <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger">
              <Icon :icon="docIcon(metaSummary.fileName)" :size="24" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <h3 class="truncate text-body font-semibold text-text">
                {{ metaSummary.fileName }}
              </h3>
              <p class="truncate text-meta text-text-muted">
                {{ metaSummary.fileTypeLabel }} · {{ metaSummary.fileSizeLabel }}
              </p>
            </div>
            <BaseBadge :tone="metaSummary.status.tone" dot class="shrink-0">
              {{ metaSummary.status.label }}
            </BaseBadge>
          </section>

          <!-- Properties grid: only the fields a non-technical user cares about -->
          <dl class="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-border-subtle text-caption sm:grid-cols-2">
            <div class="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.uploaded', 'Uploaded') }}
              </dt>
              <dd class="text-text">{{ metaSummary.uploaded }}</dd>
            </div>
            <div class="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.lastIngested', 'Last ingested') }}
              </dt>
              <dd class="text-text">{{ metaSummary.ingested }}</dd>
            </div>
            <div class="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.author', 'Author') }}
              </dt>
              <dd class="text-text">{{ metaSummary.author }}</dd>
            </div>
            <div class="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.language', 'Language') }}
              </dt>
              <dd class="text-text">{{ metaSummary.language }}</dd>
            </div>
            <div class="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.chunks', 'Chunks indexed') }}
              </dt>
              <dd class="text-text">{{ metaSummary.chunkCount }}</dd>
            </div>
            <div
              v-if="metaSummary.status.label === 'Retracted'"
              class="flex flex-col gap-1 bg-surface px-4 py-3"
            >
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.retracted', 'Retracted') }}
              </dt>
              <dd class="text-text">{{ metaSummary.retracted }}</dd>
            </div>
            <div
              v-if="metaSummary.sourceUrl"
              class="col-span-full flex flex-col gap-1 bg-surface px-4 py-3"
            >
              <dt class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.detailsField.source', 'Source URL') }}
              </dt>
              <dd class="truncate text-text">
                <a
                  :href="metaSummary.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-accent transition hover:underline"
                >
                  <Icon :icon="Globe02Icon" :size="14" />
                  <span class="truncate">{{ metaSummary.sourceUrl }}</span>
                </a>
              </dd>
            </div>
          </dl>

          <!-- Labels chips -->
          <section v-if="metaSummary.labels.length" class="flex flex-col gap-2">
            <h4 class="text-meta font-semibold uppercase tracking-wide text-text-subtle">
              {{ t('knowledgeSet.detailsField.labels', 'Labels') }}
            </h4>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="label in metaSummary.labels"
                :key="label"
                class="rounded-full bg-surface-muted px-2.5 py-0.5 text-meta font-medium text-text"
              >
                {{ label }}
              </span>
            </div>
          </section>

          <!-- Advanced disclosure: keeps raw IDs / hash / storage path one click away
               for power users without polluting the friendly view. -->
          <section v-if="advancedMetaEntries.length" class="rounded-2xl border border-border-subtle">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-caption font-semibold text-text-muted transition hover:text-text"
              :aria-expanded="showAdvancedMeta"
              @click="showAdvancedMeta = !showAdvancedMeta"
            >
              <span>{{ t('knowledgeSet.advancedDetails', 'Advanced (technical)') }}</span>
              <span aria-hidden="true">{{ showAdvancedMeta ? '−' : '+' }}</span>
            </button>
            <dl
              v-if="showAdvancedMeta"
              class="grid grid-cols-1 gap-px overflow-hidden rounded-b-2xl bg-border-subtle text-meta sm:grid-cols-2"
            >
              <div
                v-for="[k, v] in advancedMetaEntries"
                :key="k"
                class="flex flex-col gap-0.5 bg-surface-muted px-3 py-2.5"
              >
                <dt class="font-semibold uppercase tracking-wide text-text-subtle">{{ k }}</dt>
                <dd class="break-all text-text">{{ asString(v) }}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div v-else-if="details.tab === 'edit'" class="flex flex-col gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.fileNameField', 'File name') }}</span>
            <BaseInput
              v-model="details.editName"
              :placeholder="t('knowledgeSet.fileNamePlaceholder', 'Document file name')"
              rounded="full"
            />
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.languageField', 'Language') }}</span>
              <BaseDropdown
                v-model="details.editLanguage"
                :options="languageOptions"
                :placeholder="t('knowledgeSet.languagePlaceholder', 'Select a language')"
                width="w-full"
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.authorField', 'Author') }}</span>
              <BaseInput
                v-model="details.editAuthor"
                :placeholder="t('knowledgeSet.authorPlaceholder', 'Author or organization')"
                rounded="full"
              />
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.labelsField', 'Labels') }}</span>
            <BaseInput
              v-model="details.editLabels"
              :placeholder="t('knowledgeSet.labelsPlaceholder', 'comma, separated')"
              rounded="full"
            />
          </label>
        </div>

        <div v-else-if="details.tab === 'ingestion'" class="flex flex-col gap-4">
          <!-- Toolbar: title + refresh / stop -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.ingestionLogTitle', 'Ingestion log') }}
            </span>
            <div class="flex items-center gap-2">
              <BaseButton variant="soft" size="sm" rounded="full" :loading="details.ingestionLogLoading" @click="loadIngestionLog">
                {{ t('knowledgeSet.refresh', 'Refresh') }}
              </BaseButton>
              <BaseButton
                v-if="detailsIsIngesting"
                variant="outline"
                size="sm"
                rounded="full"
                :loading="details.killing"
                @click="killIngestion"
              >
                <Icon :icon="StopCircleIcon" :size="14" />
                {{ t('knowledgeSet.killIngest', 'Stop ingestion') }}
              </BaseButton>
            </div>
          </div>

          <!-- Summary card -->
          <section
            v-if="logSummary"
            class="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border-subtle text-meta sm:grid-cols-4"
          >
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <span class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.logs.totalEntries', 'Entries') }}
              </span>
              <span class="text-body font-semibold text-text">{{ logSummary.total }}</span>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <span class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.logs.warnings', 'Warnings') }}
              </span>
              <span :class="['text-body font-semibold', logSummary.warnings ? 'text-warning' : 'text-text']">
                {{ logSummary.warnings }}
              </span>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <span class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.logs.errors', 'Errors') }}
              </span>
              <span :class="['text-body font-semibold', logSummary.errors ? 'text-danger' : 'text-text']">
                {{ logSummary.errors }}
              </span>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <span class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.logs.elapsed', 'Elapsed') }}
              </span>
              <span class="text-body font-semibold text-text">{{ logSummary.elapsed }}</span>
            </div>
            <div
              v-if="logSummary.latestStage"
              class="col-span-2 flex flex-col gap-0.5 bg-surface px-3 py-2.5 sm:col-span-4"
            >
              <span class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.logs.latestStage', 'Latest stage') }}
              </span>
              <span class="text-body font-semibold text-text">{{ logSummary.latestStage }}</span>
            </div>
          </section>

          <!-- Filters -->
          <div v-if="details.ingestionLog.length" class="flex flex-col gap-2">
            <BaseInput
              v-model="logSearch"
              :placeholder="t('knowledgeSet.logs.searchPlaceholder', 'Search messages…')"
              size="sm"
              rounded="full"
            >
              <template #leading><Icon :icon="Search01Icon" :size="14" /></template>
            </BaseInput>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                :class="[
                  'rounded-full px-2.5 py-1 text-meta font-semibold transition',
                  logStageFilter === 'all'
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-muted text-text-muted hover:bg-surface-subtle',
                ]"
                @click="logStageFilter = 'all'"
              >
                {{ t('knowledgeSet.logs.allStages', 'All stages') }}
              </button>
              <button
                v-for="stage in logStages"
                :key="stage"
                type="button"
                :class="[
                  'rounded-full px-2.5 py-1 text-meta font-semibold transition',
                  logStageFilter === stage
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-muted text-text-muted hover:bg-surface-subtle',
                ]"
                @click="logStageFilter = stage"
              >
                {{ stage }}
              </button>
              <span class="mx-1 h-4 w-px bg-border-subtle" aria-hidden="true" />
              <button
                v-for="lvl in (['all', 'INFO', 'WARN', 'ERROR'] as const)"
                :key="lvl"
                type="button"
                :class="[
                  'rounded-full px-2.5 py-1 text-meta font-semibold transition',
                  logLevelFilter === lvl
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-muted text-text-muted hover:bg-surface-subtle',
                ]"
                @click="logLevelFilter = lvl"
              >
                {{
                  lvl === 'all'
                    ? t('knowledgeSet.logs.allLevels', 'All levels')
                    : lvl
                }}
              </button>
            </div>
          </div>

          <!-- Entries -->
          <div v-if="details.ingestionLogLoading && !details.ingestionLog.length" class="space-y-2">
            <div class="h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
            <div class="h-4 w-1/2 animate-pulse rounded bg-surface-subtle" />
            <div class="h-4 w-3/4 animate-pulse rounded bg-surface-subtle" />
          </div>
          <p v-else-if="details.ingestionLogError" class="text-caption text-danger">
            {{ details.ingestionLogError }}
          </p>
          <p
            v-else-if="!details.ingestionLog.length"
            class="rounded-xl border border-border bg-surface-muted px-3 py-2 text-meta text-text-muted"
          >
            {{ t('knowledgeSet.logs.empty', 'No log output yet.') }}
          </p>
          <p
            v-else-if="!filteredLogEntries.length"
            class="rounded-xl border border-border bg-surface-muted px-3 py-2 text-meta text-text-muted"
          >
            {{ t('knowledgeSet.logs.noMatches', 'No log entries match your filters.') }}
          </p>
          <ol
            v-else
            class="max-h-[28rem] overflow-y-auto rounded-2xl border border-border-subtle"
            role="list"
          >
            <li
              v-for="(entry, idx) in filteredLogEntries"
              :key="entry._key ?? `${entry.timestamp}-${idx}`"
              class="flex flex-col gap-1 border-b border-border-subtle px-3 py-2 last:border-b-0 sm:flex-row sm:items-start sm:gap-3"
            >
              <time
                class="shrink-0 font-mono text-meta tabular-nums text-text-muted sm:w-32"
                :datetime="entry.timestamp"
                :title="entry.timestamp"
              >
                {{ logTime(entry.timestamp) }}
                <span class="text-text-subtle">· {{ logDate(entry.timestamp) }}</span>
              </time>
              <div class="flex shrink-0 items-center gap-1.5 sm:w-44">
                <BaseBadge :tone="logLevelTone(entry.level)" size="sm">
                  {{ entry.level }}
                </BaseBadge>
                <BaseBadge tone="neutral" size="sm">{{ entry.stage }}</BaseBadge>
              </div>
              <p class="min-w-0 flex-1 break-words text-caption text-text">
                {{ entry.message }}
              </p>
            </li>
          </ol>
        </div>

        <div v-else-if="details.tab === 'crawl'" class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.crawlStatusTitle', 'Crawl status') }}
            </span>
            <div class="flex items-center gap-2">
              <BaseButton variant="soft" size="sm" rounded="full" :loading="details.crawlLoading" @click="loadCrawlState">
                {{ t('knowledgeSet.refresh', 'Refresh') }}
              </BaseButton>
              <BaseButton
                v-if="detailsCrawlActive"
                variant="outline"
                size="sm"
                rounded="full"
                :loading="details.killing"
                @click="killCrawl"
              >
                <Icon :icon="StopCircleIcon" :size="14" />
                {{ t('knowledgeSet.killCrawl', 'Stop crawl') }}
              </BaseButton>
            </div>
          </div>

          <section v-if="details.crawlJob" class="rounded-xl border border-border bg-surface-muted px-3 py-2.5">
            <h3 class="mb-1 text-caption font-semibold text-text">{{ t('knowledgeSet.crawlJob', 'Job') }}</h3>
            <pre class="max-h-40 overflow-auto text-meta text-text">{{ asString(details.crawlJob) }}</pre>
          </section>
          <section v-if="details.crawlMetrics" class="rounded-xl border border-border bg-surface-muted px-3 py-2.5">
            <h3 class="mb-1 text-caption font-semibold text-text">{{ t('knowledgeSet.crawlMetrics', 'Metrics') }}</h3>
            <pre class="max-h-40 overflow-auto text-meta text-text">{{ asString(details.crawlMetrics) }}</pre>
          </section>
          <section class="rounded-xl border border-border bg-surface-muted px-3 py-2.5">
            <h3 class="mb-1 text-caption font-semibold text-text">{{ t('knowledgeSet.crawlLogs', 'Logs') }}</h3>
            <pre class="max-h-60 overflow-auto text-meta leading-relaxed text-text">{{ details.crawlLogs || t('knowledgeSet.logs.empty', 'No log output yet.') }}</pre>
          </section>
        </div>

        <template #footer>
          <button
            type="button"
            class="text-body font-semibold text-text-muted transition hover:text-text"
            @click="closeFileDetails"
          >
            {{ t('knowledgeSet.close', 'Close') }}
          </button>
          <BaseButton
            v-if="details.tab === 'edit'"
            variant="primary"
            :loading="details.saving"
            :disabled="!details.editName.trim()"
            @click="saveMetadataEdit"
          >
            {{ t('knowledgeSet.saveChanges', 'Save changes') }}
          </BaseButton>
        </template>
      </BaseDrawer>
    </section>
  </DashboardLayout>
</template>
