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
import BaseInput from '../components/ui/BaseInput.vue';
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
import type { RepoFileRow } from '../services/files';
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
const crawlMaxPages = ref<number | ''>(50);
const crawlLanguage = ref('');

const rowMenuOpenFor = ref<string | null>(null);
const ingestingId = ref<string | null>(null);
const retractingId = ref<string | null>(null);
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
  ingestionLog: string;
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
    ingestionLog: '',
    ingestionLogLoading: false,
    crawlJob: null,
    crawlMetrics: null,
    crawlLogs: '',
    crawlLoading: false,
    killing: false,
  };
}

const deleteDialogOpen = ref(false);
const deleteTarget = ref<{ fileId: string; name: string } | null>(null);
const deleteSubmitting = ref(false);
const deleteDialogDescription = computed(() =>
  t(
    'knowledgeSet.deleteConfirmBody',
    {
      name: deleteTarget.value?.name ?? '',
    },
    'This removes the file from the repository. Linked AI Twins will stop using it.\n{name}'
  )
);

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

const filteredTwins = computed(() => {
  const visible = storeTwins.value.filter((tw) => !tw.isDefault);
  const q = twinSearch.value.trim().toLowerCase();
  if (!q) return visible;
  return visible.filter((tw) => tw.name.toLowerCase().includes(q));
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
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.deleteFailed', 'Delete failed'),
      extractServerError(err)
    );
  } finally {
    deleteSubmitting.value = false;
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
  ingestingId.value = doc.fileId;
  try {
    await fileService.ingestFile(doc.fileId);
    notify.success(t('knowledgeSet.toasts.ingestQueued', 'Ingestion started'));
    await loadDocuments();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.ingestFailed', 'Failed to start ingestion'),
      extractServerError(err)
    );
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
  const ids = selectedFileIds.value;
  if (!ids.length || bulkBusy.value) return;
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
    notify.error(
      t('knowledgeSet.toasts.bulkIngestFailed', 'Bulk ingestion failed'),
      extractServerError(err)
    );
  } finally {
    bulkBusy.value = false;
  }
}

async function retractSelected(): Promise<void> {
  const ids = selectedFileIds.value;
  if (!ids.length || bulkBusy.value) return;
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
      maxPages: typeof crawlMaxPages.value === 'number' ? crawlMaxPages.value : undefined,
      language: crawlLanguage.value.trim() || undefined,
    });
    notify.success(t('knowledgeSet.toasts.crawlScheduled', 'Crawl scheduled'));
    crawlUrl.value = '';
    crawlLanguage.value = '';
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
  try {
    const log = await fileService.getIngestionLogs(fileId);
    details.value.ingestionLog = asString(log);
  } catch {
    details.value.ingestionLog = t(
      'knowledgeSet.logs.loadFailed',
      'Could not load logs.'
    );
  } finally {
    details.value.ingestionLogLoading = false;
  }
}

async function killIngestion(): Promise<void> {
  const fileId = details.value.fileId;
  if (!fileId || details.value.killing) return;
  details.value.killing = true;
  try {
    await fileService.killIngestion(fileId);
    notify.success(t('knowledgeSet.toasts.killSuccess', 'Process stopped'));
    await loadIngestionLog();
    await loadDocuments();
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
    await loadCrawlState();
    await loadDocuments();
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
    if (tab === 'ingestion' && !details.value.ingestionLog && !details.value.ingestionLogLoading) {
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
                :disabled="bulkBusy"
                @click="ingestSelected"
              >
                <Icon :icon="PlayIcon" :size="14" />
                {{ t('knowledgeSet.ingestSelectedAction', 'Ingest') }}
              </button>
              <button
                v-if="selectedCount > 0"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-caption font-semibold text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="bulkBusy"
                @click="retractSelected"
              >
                <Icon :icon="PauseIcon" :size="14" />
                {{ t('knowledgeSet.retractSelectedAction', 'Retract') }}
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
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted opacity-0 transition hover:bg-surface-subtle hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    :aria-label="t('knowledgeSet.ingestAria', 'Ingest now')"
                    :disabled="ingestingId === document.fileId"
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
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="ingestingId === document.fileId"
                      @click="ingestOne(document)"
                    >
                      <Icon :icon="PlayIcon" :size="14" />
                      {{ t('knowledgeSet.menu.ingest', 'Ingest now') }}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="retractingId === document.fileId"
                      @click="retractOne(document)"
                    >
                      <Icon :icon="PauseIcon" :size="14" />
                      {{ t('knowledgeSet.menu.retract', 'Retract') }}
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
              rounded="md"
            />
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">
                {{ t('knowledgeSet.languageField', 'Language') }}
              </span>
              <BaseInput
                v-model="linkLanguage"
                :placeholder="t('knowledgeSet.languagePlaceholder', 'e.g. en, fr')"
                rounded="md"
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">
                {{ t('knowledgeSet.labelsField', 'Labels') }}
              </span>
              <BaseInput
                v-model="linkLabels"
                :placeholder="t('knowledgeSet.labelsPlaceholder', 'comma, separated')"
                rounded="md"
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
              rounded="md"
            />
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">
                {{ t('knowledgeSet.crawlMaxDepth', 'Max depth') }}
              </span>
              <BaseInput v-model.number="crawlMaxDepth" type="number" min="1" max="10" rounded="md" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">
                {{ t('knowledgeSet.crawlMaxPages', 'Max pages') }}
              </span>
              <BaseInput v-model.number="crawlMaxPages" type="number" min="1" max="500" rounded="md" />
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.languageField', 'Language') }}
            </span>
            <BaseInput
              v-model="crawlLanguage"
              :placeholder="t('knowledgeSet.languagePlaceholder', 'e.g. en, fr')"
              rounded="md"
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
        :title="t('knowledgeSet.deleteConfirmTitle', 'Delete this file?')"
        :description="deleteDialogDescription"
        :confirm-label="t('knowledgeSet.deleteAction', 'Delete')"
        :cancel-label="t('knowledgeSet.cancel', 'Cancel')"
        :loading="deleteSubmitting"
        @confirm="confirmDelete"
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
            v-for="tab in (['details', 'edit', 'ingestion', 'crawl'] as const)"
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

        <dl
          v-else-if="details.tab === 'details'"
          class="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border-subtle text-meta sm:grid-cols-2"
        >
          <div
            v-for="(v, k) in (details.metadata ?? {})"
            :key="String(k)"
            class="flex flex-col gap-0.5 bg-surface-muted px-3 py-2.5"
          >
            <dt class="font-semibold uppercase tracking-wide text-text-subtle">{{ k }}</dt>
            <dd class="break-words text-text">{{ asString(v) }}</dd>
          </div>
        </dl>

        <div v-else-if="details.tab === 'edit'" class="flex flex-col gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.fileNameField', 'File name') }}</span>
            <BaseInput v-model="details.editName" rounded="md" />
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.languageField', 'Language') }}</span>
              <BaseInput v-model="details.editLanguage" rounded="md" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.authorField', 'Author') }}</span>
              <BaseInput v-model="details.editAuthor" rounded="md" />
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-caption font-semibold text-text">{{ t('knowledgeSet.labelsField', 'Labels') }}</span>
            <BaseInput
              v-model="details.editLabels"
              :placeholder="t('knowledgeSet.labelsPlaceholder', 'comma, separated')"
              rounded="md"
            />
          </label>
        </div>

        <div v-else-if="details.tab === 'ingestion'" class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.ingestionLogTitle', 'Ingestion log') }}
            </span>
            <div class="flex items-center gap-2">
              <BaseButton variant="soft" size="sm" rounded="full" :loading="details.ingestionLogLoading" @click="loadIngestionLog">
                {{ t('knowledgeSet.refresh', 'Refresh') }}
              </BaseButton>
              <BaseButton variant="outline" size="sm" rounded="full" :loading="details.killing" @click="killIngestion">
                <Icon :icon="StopCircleIcon" :size="14" />
                {{ t('knowledgeSet.killIngest', 'Kill ingest') }}
              </BaseButton>
            </div>
          </div>
          <pre class="max-h-80 overflow-auto rounded-xl border border-border bg-surface-muted px-3 py-2 text-meta leading-relaxed text-text">{{ details.ingestionLog || t('knowledgeSet.logs.empty', 'No log output yet.') }}</pre>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-caption font-semibold text-text">
              {{ t('knowledgeSet.crawlStatusTitle', 'Crawl status') }}
            </span>
            <div class="flex items-center gap-2">
              <BaseButton variant="soft" size="sm" rounded="full" :loading="details.crawlLoading" @click="loadCrawlState">
                {{ t('knowledgeSet.refresh', 'Refresh') }}
              </BaseButton>
              <BaseButton variant="outline" size="sm" rounded="full" :loading="details.killing" @click="killCrawl">
                <Icon :icon="StopCircleIcon" :size="14" />
                {{ t('knowledgeSet.killCrawl', 'Kill crawl') }}
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
