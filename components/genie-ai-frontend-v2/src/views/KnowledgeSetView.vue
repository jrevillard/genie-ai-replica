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
  MoreVerticalIcon,
  PauseIcon,
  Pdf01Icon,
  PlayIcon,
  Search01Icon,
  StopCircleIcon,
  Tick02Icon,
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
import AddKnowledgeDrawer from '../components/dashboard/AddKnowledgeDrawer.vue';
import CreateAiTwinDialog from '../components/dashboard/CreateAiTwinDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import TranslatedText from '../components/ui/TranslatedText.vue';
import TwinAvatarStack from '../components/ui/TwinAvatarStack.vue';
import AiTwinCardSkeleton from '../components/ui/skeletons/AiTwinCardSkeleton.vue';
import KnowledgeSetDocsSkeleton from '../components/ui/skeletons/KnowledgeSetDocsSkeleton.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useT } from '../i18n/composables';
import { notify } from '../lib/notify';
import fileService from '../services/files';
import type { CrawlJob, CrawlLogEntry, CrawlMetrics, IngestionLogEntry, RepoFileRow } from '../services/files';
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
  /** Twin IDs that link this file — used by `TwinAvatarStack`. */
  linkedTwinIds: string[];
};

const { t, locale } = useT();
const aiStore = useAiTwinsStore();
const { twins: storeTwins, loading: twinsLoading } = storeToRefs(aiStore);

const mode = ref<'documents' | 'twins'>('documents');
const documents = ref<DocumentRow[]>([]);
const documentsLoading = ref(false);
const uploadOpen = ref(false);
const documentSearch = ref('');
const twinSearch = ref('');
const pendingLinkIds = ref<string[]>([]);
const selectedTwinKey = ref<string | null>(null);
const FILES_PAGE_LIMIT = 50;

type DocViewMode = 'list' | 'grid';
const DOC_VIEW_STORAGE_KEY = 'knowledgeSet.viewMode.v1';
function readPersistedViewMode(): DocViewMode {
  if (typeof window === 'undefined') return 'grid';
  const stored = window.localStorage.getItem(DOC_VIEW_STORAGE_KEY);
  if (stored === 'list') return 'list';
  if (stored === 'grid') return 'grid';
  return 'grid';
}
const docViewMode = ref<DocViewMode>(readPersistedViewMode());
function setDocViewMode(next: DocViewMode): void {
  docViewMode.value = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DOC_VIEW_STORAGE_KEY, next);
  }
}

const createTwinOpen = ref(false);
const creatingTwin = ref(false);

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
  crawlJob: CrawlJob | null;
  crawlMetrics: CrawlMetrics | null;
  crawlLogs: CrawlLogEntry[];
  crawlError: string | null;
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
    crawlLogs: [],
    crawlError: null,
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

// Resolves an ISO-639-1 code to a human-readable language name in the
// active UI locale ("en" → "English" / "Anglais" / etc). Falls back to the
// upper-cased code when the runtime can't resolve it. Mirrors the helper
// used in `KnowledgeSetTab.vue` so both surfaces read the same way.
function languageLabel(code: string | null | undefined): string {
  if (!code) return '';
  try {
    const display = new Intl.DisplayNames([locale.value], { type: 'language' });
    return display.of(String(code)) || String(code).toUpperCase();
  } catch {
    return String(code).toUpperCase();
  }
}

function fileSubtitle(row: RepoFileRow): string {
  const lang = row.language ? languageLabel(row.language) : '';
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
    linkedTwinIds: Array.isArray(f.linkedTwinIds)
      ? f.linkedTwinIds.filter((id): id is string => typeof id === 'string')
      : [],
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

function onUploadComplete(): void {
  // The drawer fires `uploaded` once the request succeeds — refresh the file
  // list so the new entry appears at the top.
  void loadDocuments();
}

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

// Show currently-ingesting files first, then ingested, then the rest.
// Within each bucket, preserve the backend's original order.
function statusSortRank(statusRaw: string): number {
  const s = statusRaw.toLowerCase();
  if (s.includes('ingesting')) return 0;
  if (s.includes('ingested')) return 1;
  return 2;
}

const filteredDocuments = computed(() =>
  documents.value
    .map((d, idx) => ({ d, idx }))
    .sort((a, b) => {
      const r = statusSortRank(a.d.statusRaw) - statusSortRank(b.d.statusRaw);
      return r !== 0 ? r : a.idx - b.idx;
    })
    .map((x) => x.d)
);

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
  if (n.includes('killed')) return 'danger';
  if (n.includes('warning')) return 'warning';
  if (n.includes('pending')) return 'warning';
  if (n.includes('ingesting')) return 'accent';
  if (n.includes('ingested')) return 'success';
  return 'neutral';
}

function docIcon(name: string) {
  return name.toLowerCase().endsWith('.pdf') ? Pdf01Icon : File02Icon;
}

// Per-extension tile colour so users can scan the list by file type at a
// glance instead of every row looking like a PDF.
function docIconClasses(name: string): string {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  switch (ext) {
    case 'pdf':
      return 'bg-rose-50 text-rose-600';
    case 'md':
    case 'markdown':
      return 'bg-sky-50 text-sky-600';
    case 'doc':
    case 'docx':
      return 'bg-indigo-50 text-indigo-600';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'bg-emerald-50 text-emerald-600';
    case 'ppt':
    case 'pptx':
      return 'bg-orange-50 text-orange-600';
    case 'html':
    case 'htm':
      return 'bg-amber-50 text-amber-600';
    case 'txt':
      return 'bg-slate-100 text-slate-600';
    case 'json':
    case 'yaml':
    case 'yml':
      return 'bg-violet-50 text-violet-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function toggleDocument(doc: DocumentRow) {
  doc.selected = !doc.selected;
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

// Per-twin diff between the pending file selection and the twin's current
// `linkedKbFileIds`. Drives the disabled state of redundant twin cards
// (selecting a twin that already has every chosen file would be a no-op
// re-link, so we surface that visually and refuse the click).
function twinLinkState(twin: AiTwin): {
  alreadyLinked: number;
  totalPending: number;
  newLinks: number;
  fullyRedundant: boolean;
} {
  const have = new Set(twin.linkedKbFileIds ?? []);
  const pending = pendingLinkIds.value;
  let alreadyLinked = 0;
  for (const id of pending) {
    if (have.has(id)) alreadyLinked++;
  }
  const newLinks = pending.length - alreadyLinked;
  return {
    alreadyLinked,
    totalPending: pending.length,
    newLinks,
    fullyRedundant: pending.length > 0 && newLinks === 0,
  };
}

function selectTwinRow(twin: AiTwin) {
  // Cards for twins that already have every selected file are non-actionable.
  if (twinLinkState(twin).fullyRedundant) return;
  selectedTwinKey.value = twin._key;
}

// Document rows for the files currently staged for linking. Drives the
// preview chips on the twin-picker page so the user always sees *what* is
// being linked, not just a count.
const pendingFileRows = computed(() => {
  const ids = new Set(pendingLinkIds.value);
  return documents.value.filter((d) => ids.has(d.fileId));
});

// Per-twin breakdown of which pending files are already linked vs new. Used
// to render the per-card detail strip so the user can answer "which one is
// already linked?" without leaving the picker.
function linkBreakdown(twin: AiTwin): {
  alreadyLinkedFiles: { fileId: string; name: string }[];
  newFiles: { fileId: string; name: string }[];
} {
  const have = new Set(twin.linkedKbFileIds ?? []);
  const alreadyLinkedFiles: { fileId: string; name: string }[] = [];
  const newFiles: { fileId: string; name: string }[] = [];
  for (const row of pendingFileRows.value) {
    const entry = { fileId: row.fileId, name: row.name };
    if (have.has(row.fileId)) alreadyLinkedFiles.push(entry);
    else newFiles.push(entry);
  }
  return { alreadyLinkedFiles, newFiles };
}

// Bucket-then-alpha sort:
//   1. Best fit (zero overlap) — every selected file is new for this twin.
//   2. Partial overlap — some already linked, some new.
//   3. Fully redundant — already has every selected file (disabled).
// Within each bucket twins keep their natural alphabetical order so the
// list doesn't reshuffle as a redundancy bucket grows/shrinks.
const sortedTwinsForLink = computed<AiTwin[]>(() => {
  const rank = (twin: AiTwin): number => {
    const s = twinLinkState(twin);
    if (s.fullyRedundant) return 2;
    if (s.alreadyLinked > 0) return 1;
    return 0;
  };
  return [...filteredTwins.value].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (a.name || '').localeCompare(b.name || '');
  });
});

// Tracks the twin currently being linked via the per-row quick-link button so
// we can show a row-scoped loading spinner without freezing the rest of the
// list.
const linkingToTwinId = ref<string | null>(null);

async function quickLinkToTwin(twin: AiTwin): Promise<void> {
  if (twinLinkState(twin).fullyRedundant) return;
  if (linkingToTwinId.value) return;
  selectedTwinKey.value = twin._key;
  linkingToTwinId.value = twin._key;
  try {
    await confirmLinkToTwin();
  } finally {
    linkingToTwinId.value = null;
  }
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
  } catch (err) {
    // Surface the backend's reason — usually "Unknown KB file id(s): …" when
    // a selected file isn't in the document-repository `files` collection.
    notify.error(
      t('knowledgeSet.toasts.linkFailed', 'Failed to link files to twin'),
      extractServerError(err) ?? aiStore.error ?? undefined
    );
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

// Abort controller for the in-flight create-twin request, so closing the
// dialog mid-flight kills the network call.
let activeCreateTwinRequest: AbortController | null = null;

function isCreateAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return (
    e?.name === 'CanceledError' ||
    e?.name === 'AbortError' ||
    e?.code === 'ERR_CANCELED'
  );
}

watch(createTwinOpen, (open) => {
  if (!open && creatingTwin.value && activeCreateTwinRequest) {
    activeCreateTwinRequest.abort();
  }
});

async function onTwinCreated(payload: {
  name: string;
  description: string;
  avatarFile: File | null;
}): Promise<void> {
  if (creatingTwin.value) return;
  creatingTwin.value = true;
  activeCreateTwinRequest = new AbortController();
  const { signal } = activeCreateTwinRequest;
  try {
    const twin = await aiStore.create(
      {
        name: payload.name,
        description: payload.description,
        profilePicUrl: null,
      },
      signal
    );
    if (payload.avatarFile) {
      try {
        await aiStore.uploadAvatar(twin._key, payload.avatarFile, signal);
      } catch (err) {
        if (isCreateAbortError(err)) throw err;
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
  } catch (err) {
    if (!isCreateAbortError(err)) {
      notify.error(aiStore.error ?? t('twins.list.createFailedToast', 'Failed to create AI Twin'));
    }
  } finally {
    activeCreateTwinRequest = null;
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

function parseLabelList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
  if (s.includes('killed')) return { label: 'Stopped', tone: 'danger' };
  if (s.includes('warning')) return { label: 'Ingested with warnings', tone: 'warning' };
  if (s.includes('ingesting')) return { label: 'Ingesting', tone: 'accent' };
  if (s.includes('ingested')) return { label: 'Ingested', tone: 'success' };
  if (s.includes('retract')) return { label: 'Retracted', tone: 'neutral' };
  return { label: 'Pending', tone: 'warning' };
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
  const status = (details.value.crawlJob?.status ?? '').toLowerCase();
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

// ─── Crawl tab presentation ────────────────────────────────────────────────

function crawlStatusInfo(raw: string | undefined | null): {
  label: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
} {
  const s = (raw || '').toLowerCase();
  if (s === 'succeeded' || s === 'completed') return { label: 'Completed', tone: 'success' };
  if (s === 'running') return { label: 'Running', tone: 'accent' };
  if (s === 'pending') return { label: 'Pending', tone: 'neutral' };
  if (s === 'failed' || s === 'error') return { label: 'Failed', tone: 'danger' };
  if (s === 'killed' || s === 'stopped') return { label: 'Stopped', tone: 'neutral' };
  return { label: raw || 'Unknown', tone: 'neutral' };
}

interface CrawlSummary {
  url: string;
  status: ReturnType<typeof crawlStatusInfo>;
  depth: number | string;
  pagesCrawled: string;
  startedAt: string;
  finishedAt: string;
  duration: string;
  errorMessage: string | null;
  // Live metrics (only meaningful while running, but harmless to show after)
  processed: string;
  internalLinks: string;
  externalLinks: string;
  queueSize: string;
  crawlRate: string;
  errorRate: string;
}

function fmtNum(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString(locale.value);
}

const crawlSummary = computed<CrawlSummary | null>(() => {
  const job = details.value.crawlJob;
  if (!job) return null;
  const m = details.value.crawlMetrics ?? {};
  const startedTs = job.started_at ? new Date(job.started_at).getTime() : NaN;
  const finishedTs = job.finished_at ? new Date(job.finished_at).getTime() : NaN;
  const durationMs =
    Number.isFinite(startedTs) && Number.isFinite(finishedTs)
      ? finishedTs - startedTs
      : null;
  const pages =
    typeof job.pages_crawled === 'number'
      ? typeof job.max_pages === 'number'
        ? `${fmtNum(job.pages_crawled)} / ${fmtNum(job.max_pages)}`
        : fmtNum(job.pages_crawled)
      : '—';
  return {
    url: job.url,
    status: crawlStatusInfo(job.status),
    depth: typeof job.depth === 'number' ? job.depth : '—',
    pagesCrawled: pages,
    startedAt: formatMetaDate(job.started_at),
    finishedAt: formatMetaDate(job.finished_at),
    duration: durationMs != null ? formatDurationMs(durationMs) : '—',
    errorMessage: job.error_message?.trim() || null,
    processed: fmtNum(m.processed),
    internalLinks: fmtNum(m.links_internal),
    externalLinks: fmtNum(m.links_external),
    queueSize: fmtNum(m.queue_size),
    crawlRate:
      typeof m.crawl_rate === 'number' && Number.isFinite(m.crawl_rate)
        ? `${m.crawl_rate.toFixed(2)} /s`
        : '—',
    errorRate:
      typeof m.error_rate === 'number' && Number.isFinite(m.error_rate)
        ? `${(m.error_rate * 100).toFixed(1)}%`
        : '—',
  };
});

// Reuse the ingestion-log filter machinery for crawl logs — same shape, same UX.
const crawlLogStageFilter = ref<string>('all');
const crawlLogLevelFilter = ref<string>('all');
const crawlLogSearch = ref<string>('');

watch(
  () => details.value.fileId,
  () => {
    crawlLogStageFilter.value = 'all';
    crawlLogLevelFilter.value = 'all';
    crawlLogSearch.value = '';
  }
);

const crawlLogStages = computed<string[]>(() => {
  const stages = new Set<string>();
  for (const entry of details.value.crawlLogs) {
    if (entry.stage) stages.add(entry.stage);
  }
  return Array.from(stages);
});

const filteredCrawlLogs = computed<CrawlLogEntry[]>(() => {
  const stage = crawlLogStageFilter.value;
  const level = crawlLogLevelFilter.value.toUpperCase();
  const q = crawlLogSearch.value.trim().toLowerCase();
  return details.value.crawlLogs.filter((entry) => {
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
  details.value.crawlError = null;
  try {
    const [job, metrics, logs] = await Promise.all([
      fileService.getCrawlJob(fileId).catch(() => null),
      fileService.getCrawlMetrics(fileId).catch(() => null),
      fileService.getCrawlLogs(fileId).catch(() => [] as CrawlLogEntry[]),
    ]);
    details.value.crawlJob = job;
    details.value.crawlMetrics = metrics;
    details.value.crawlLogs = logs;
  } catch (err) {
    details.value.crawlError =
      extractServerError(err) ??
      t('knowledgeSet.crawl.loadFailed', 'Could not load crawl status.');
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
          <header class="mb-4">
            <h1 class="text-headline text-text">{{ t('knowledgeSet.title', 'Knowledge Set') }}</h1>
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
            <div class="flex flex-wrap items-center gap-2">
              <div
                role="group"
                :aria-label="t('knowledgeSet.viewToggleAria', 'Switch document layout')"
                class="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface p-1"
              >
                <button
                  type="button"
                  :class="[
                    'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
                    docViewMode === 'list'
                      ? 'bg-accent text-text-inverse shadow-sm'
                      : 'text-text-muted hover:bg-surface-subtle hover:text-text',
                  ]"
                  :aria-pressed="docViewMode === 'list'"
                  :aria-label="t('knowledgeSet.viewList', 'List view')"
                  :title="t('knowledgeSet.viewList', 'List view')"
                  @click="setDocViewMode('list')"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                <button
                  type="button"
                  :class="[
                    'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
                    docViewMode === 'grid'
                      ? 'bg-accent text-text-inverse shadow-sm'
                      : 'text-text-muted hover:bg-surface-subtle hover:text-text',
                  ]"
                  :aria-pressed="docViewMode === 'grid'"
                  :aria-label="t('knowledgeSet.viewGrid', 'Grid view')"
                  :title="t('knowledgeSet.viewGrid', 'Grid view')"
                  @click="setDocViewMode('grid')"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </button>
              </div>
              <BaseButton variant="primary" rounded="full" @click="uploadOpen = true">
                <Icon :icon="Upload01Icon" :size="16" />
                {{ t('knowledgeSet.addKnowledge', 'Add Knowledge') }}
              </BaseButton>
            </div>
          </div>

          <div
            v-if="currentlyIngesting"
            class="mb-3 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-caption text-text"
            role="status"
            aria-live="polite"
          >
            <span
              class="block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-warning border-t-transparent"
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
            <ul v-if="filteredDocuments.length && docViewMode === 'list'" class="space-y-2" role="list">
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
                  :class="[
                    'grid h-10 w-10 shrink-0 place-items-center rounded-lg',
                    docIconClasses(document.name),
                  ]"
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

                <TwinAvatarStack
                  v-if="document.linkedTwinIds.length"
                  :twin-ids="document.linkedTwinIds"
                  :max="3"
                  class="shrink-0"
                  @click.stop
                />

                <div class="relative flex shrink-0 items-center gap-0.5" data-row-menu>
                  <button
                    v-if="canStop(document)"
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
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
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
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
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text"
                    :aria-label="t('knowledgeSet.downloadAria', 'Download document')"
                    @click.stop="downloadDoc(document)"
                  >
                    <Icon :icon="Download04Icon" :size="16" />
                  </button>
                  <button
                    type="button"
                    :class="[
                      'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-surface-subtle hover:text-text',
                      rowMenuOpenFor === document.fileId
                        ? 'bg-surface-subtle text-text'
                        : 'text-text-muted',
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
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                      :disabled="canRetract(document)"
                      :title="canRetract(document) ? t('knowledgeSet.menu.deleteBlockedRetractFirst', 'Retract this file before deleting') : ''"
                      @click="closeRowMenu(); askDelete(document)"
                    >
                      <Icon :icon="Delete02Icon" :size="14" />
                      {{ t('knowledgeSet.menu.delete', 'Delete') }}
                    </button>
                  </div>
                </div>
              </li>
            </ul>

            <div
              v-else-if="filteredDocuments.length && docViewMode === 'grid'"
              role="list"
              class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              <div
                v-for="document in filteredDocuments"
                :key="document.fileId"
                role="checkbox"
                tabindex="0"
                :aria-checked="!!document.selected"
                :class="[
                  'group relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-surface p-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  document.selected
                    ? 'border-accent bg-accent-soft/40'
                    : 'border-border hover:border-border-strong hover:bg-surface-subtle',
                ]"
                @click="toggleDocument(document)"
                @keydown.enter.prevent="toggleDocument(document)"
                @keydown.space.prevent="toggleDocument(document)"
              >
                <div class="flex items-start justify-between gap-2">
                  <span
                    :class="[
                      'grid h-12 w-12 shrink-0 place-items-center rounded-xl',
                      docIconClasses(document.name),
                    ]"
                    aria-hidden="true"
                  >
                    <Icon :icon="docIcon(document.name)" :size="24" />
                  </span>
                  <div class="relative flex items-center gap-1" data-row-menu>
                    <span
                      :class="[
                        'grid h-4 w-4 shrink-0 place-items-center rounded border transition',
                        document.selected
                          ? 'border-accent bg-accent text-text-inverse opacity-100'
                          : selectedCount > 0
                            ? 'border-border bg-surface text-text opacity-100'
                            : 'border-border bg-surface text-text opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                      ]"
                      :aria-hidden="true"
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
                        class="h-2.5 w-2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      :class="[
                        'grid h-7 w-7 place-items-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
                        rowMenuOpenFor === document.fileId
                          ? 'bg-surface-subtle text-text'
                          : 'text-text-muted hover:bg-surface-subtle hover:text-text',
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
                      class="absolute right-3 top-12 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-popover"
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
                      <button
                        type="button"
                        role="menuitem"
                        class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text transition hover:bg-surface-subtle"
                        @click.stop="downloadDoc(document); closeRowMenu()"
                      >
                        <Icon :icon="Download04Icon" :size="14" />
                        {{ t('knowledgeSet.downloadAria', 'Download document') }}
                      </button>
                      <div class="my-1 border-t border-border-subtle" />
                      <button
                        type="button"
                        role="menuitem"
                        class="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                        :disabled="canRetract(document)"
                        :title="canRetract(document) ? t('knowledgeSet.menu.deleteBlockedRetractFirst', 'Retract this file before deleting') : ''"
                        @click="closeRowMenu(); askDelete(document)"
                      >
                        <Icon :icon="Delete02Icon" :size="14" />
                        {{ t('knowledgeSet.menu.delete', 'Delete') }}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="flex min-w-0 flex-col gap-1.5">
                  <h2 class="line-clamp-2 text-body font-medium text-text" :title="document.name">
                    <TranslatedText :text="document.name" :lang="document.lang" />
                  </h2>
                  <BaseBadge :tone="statusTone(document.statusRaw)" dot class="self-start">
                    {{ document.statusLabel }}
                  </BaseBadge>
                  <p class="truncate text-meta text-text-muted">
                    <span>{{ document.dateLabel }}</span>
                    <span v-if="document.subtitle" aria-hidden="true" class="mx-1.5">·</span>
                    <span>{{ document.subtitle }}</span>
                  </p>
                  <TwinAvatarStack
                    v-if="document.linkedTwinIds.length"
                    :twin-ids="document.linkedTwinIds"
                    :max="3"
                    class="mt-1 self-start"
                    @click.stop
                  />
                </div>
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

          <!-- Pending file preview — keeps "what" visible the entire time the
               user is picking the target twin. Shows up to 6 file chips with
               a "+N more" overflow chip when the selection is larger. -->
          <section
            v-if="pendingFileRows.length"
            class="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/15 bg-gradient-to-br from-accent-soft/40 via-surface to-surface px-4 py-3 shadow-sm"
            :aria-label="t('knowledgeSet.linkingHintAria', 'Files being linked')"
          >
            <span class="inline-flex items-center gap-2 text-caption font-semibold text-accent">
              <span class="grid h-6 w-6 place-items-center rounded-full bg-accent text-text-inverse">
                <Icon :icon="File02Icon" :size="13" />
              </span>
              {{
                t(
                  'knowledgeSet.linkingFilesLabel',
                  { count: pendingFileRows.length },
                  'Linking {count} file(s):'
                )
              }}
            </span>
            <span
              v-for="row in pendingFileRows.slice(0, 6)"
              :key="row.fileId"
              class="inline-flex max-w-[18rem] items-center gap-1.5 truncate rounded-full border border-border bg-surface px-2.5 py-1 text-caption font-medium text-text shadow-sm"
              :title="row.name"
            >
              {{ row.name }}
            </span>
            <span
              v-if="pendingFileRows.length > 6"
              class="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-caption font-semibold text-text-inverse shadow-sm"
            >
              +{{ pendingFileRows.length - 6 }}
            </span>
          </section>

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
            <div v-if="sortedTwinsForLink.length" class="grid gap-4 lg:grid-cols-2">
              <div
                v-for="twin in sortedTwinsForLink"
                :key="twin._key"
                role="button"
                :tabindex="twinLinkState(twin).fullyRedundant ? -1 : 0"
                :aria-pressed="selectedTwinKey === twin._key"
                :aria-disabled="twinLinkState(twin).fullyRedundant || undefined"
                :title="
                  twinLinkState(twin).fullyRedundant
                    ? t('knowledgeSet.twinAllLinked', 'This twin already has every selected file')
                    : ''
                "
                :class="[
                  'group relative flex flex-col gap-3.5 overflow-hidden rounded-2xl border bg-surface p-5 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  twinLinkState(twin).fullyRedundant
                    ? 'cursor-not-allowed border-border-subtle bg-surface-muted/30 opacity-70'
                    : twinLinkState(twin).alreadyLinked === 0 && twinLinkState(twin).totalPending > 0
                      ? 'cursor-pointer border-accent/40 shadow-card hover:-translate-y-0.5 hover:border-accent hover:shadow-md'
                      : 'cursor-pointer border-border shadow-card hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
                ]"
                @click="selectTwinRow(twin)"
                @keydown.enter.prevent="selectTwinRow(twin)"
                @keydown.space.prevent="selectTwinRow(twin)"
              >
                <!-- Subtle accent rail on best-fit cards — every selected
                     file would be new for this twin, so the user's most
                     useful targets get a visual nudge without shouting. -->
                <span
                  v-if="twinLinkState(twin).alreadyLinked === 0 && twinLinkState(twin).totalPending > 0"
                  class="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-accent via-accent to-accent/60"
                  aria-hidden="true"
                />

                <!-- "Best fit" hint chip in the top-right. Light, optional,
                     never appears for partial or redundant cards. -->
                <span
                  v-if="twinLinkState(twin).alreadyLinked === 0 && twinLinkState(twin).totalPending > 0"
                  class="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-accent"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                  {{ t('knowledgeSet.bestFit', 'Best fit') }}
                </span>
                <div class="flex items-start gap-3">
                  <BaseAvatar
                    :src="twin.profilePicUrl ?? ''"
                    :name="twin.name"
                    size="lg"
                  />
                  <div class="min-w-0 flex-1 pr-20">
                    <h2 class="truncate text-title font-semibold text-text">
                      <TranslatedText :text="twin.name" />
                    </h2>
                    <p
                      v-if="twin.description"
                      class="mt-1 line-clamp-2 text-caption text-text-muted"
                    >
                      {{ twin.description }}
                    </p>
                    <p v-else class="mt-1 text-caption italic text-text-subtle">
                      {{ t('knowledgeSet.noDescription', 'No description') }}
                    </p>
                  </div>
                </div>

                <div
                  v-if="twinLinkState(twin).alreadyLinked > 0"
                  class="flex flex-col gap-1.5"
                >
                  <span
                    v-if="twinLinkState(twin).fullyRedundant"
                    class="inline-flex w-fit items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-meta font-semibold text-warning"
                  >
                    {{
                      t(
                        'knowledgeSet.twinAllLinkedBadge',
                        { count: twinLinkState(twin).totalPending },
                        'Already has all {count} selected'
                      )
                    }}
                  </span>
                  <span
                    v-else
                    class="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent"
                  >
                    {{
                      t(
                        'knowledgeSet.twinPartiallyLinked',
                        {
                          alreadyLinked: twinLinkState(twin).alreadyLinked,
                          newLinks: twinLinkState(twin).newLinks,
                        },
                        '{alreadyLinked} already linked · {newLinks} new'
                      )
                    }}
                  </span>

                  <!-- Per-file breakdown so the user knows *which* selected
                       files are already linked vs which would be added.
                       Suppressed for fully-redundant cards — those are
                       disabled, so the per-file list is just clutter (the
                       file chips at the top of the page already show the
                       full selection). -->
                  <div
                    v-if="!twinLinkState(twin).fullyRedundant"
                    class="flex flex-col gap-1 text-meta"
                  >
                    <div
                      v-if="linkBreakdown(twin).alreadyLinkedFiles.length"
                      class="flex flex-wrap items-center gap-1"
                    >
                      <Icon :icon="Tick02Icon" :size="12" class="text-warning" />
                      <span class="text-text-muted">
                        {{ t('knowledgeSet.breakdownAlready', 'Already on twin:') }}
                      </span>
                      <template v-for="(f, idx) in linkBreakdown(twin).alreadyLinkedFiles" :key="f.fileId">
                        <span aria-hidden="true" v-if="idx > 0" class="text-border-strong">·</span>
                        <span class="max-w-[12rem] truncate text-warning" :title="f.name">{{ f.name }}</span>
                      </template>
                    </div>
                    <div
                      v-if="linkBreakdown(twin).newFiles.length"
                      class="flex flex-wrap items-center gap-1"
                    >
                      <Icon :icon="AddCircleIcon" :size="12" class="text-success" />
                      <span class="text-text-muted">
                        {{ t('knowledgeSet.breakdownNew', 'Will be added:') }}
                      </span>
                      <template v-for="(f, idx) in linkBreakdown(twin).newFiles" :key="f.fileId">
                        <span aria-hidden="true" v-if="idx > 0" class="text-border-strong">·</span>
                        <span class="max-w-[12rem] truncate text-success" :title="f.name">{{ f.name }}</span>
                      </template>
                    </div>
                  </div>
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

                <div class="mt-auto flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
                  <BaseButton
                    variant="primary"
                    rounded="full"
                    :disabled="twinLinkState(twin).fullyRedundant || (linkingToTwinId !== null && linkingToTwinId !== twin._key)"
                    :loading="linkingToTwinId === twin._key"
                    @click.stop="quickLinkToTwin(twin)"
                  >
                    <Icon :icon="AddCircleIcon" :size="16" />
                    {{
                      twinLinkState(twin).newLinks > 0
                        ? t(
                            'knowledgeSet.linkNewCount',
                            { count: twinLinkState(twin).newLinks },
                            'Link {count} file(s)'
                          )
                        : t('knowledgeSet.linkBtn', 'Link')
                    }}
                  </BaseButton>
                </div>
              </div>
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

          <footer class="mt-5 flex items-center justify-start">
            <BaseButton variant="outline" rounded="full" @click="mode = 'documents'">
              {{ t('common.back', 'Back') }}
            </BaseButton>
          </footer>
        </template>
      </div>

      <AddKnowledgeDrawer v-model:open="uploadOpen" @uploaded="onUploadComplete" />

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

          <p v-if="details.crawlError" class="text-caption text-danger">
            {{ details.crawlError }}
          </p>

          <!-- Hero card: site + status at a glance -->
          <section
            v-if="crawlSummary"
            class="flex flex-col gap-2 rounded-2xl border border-border bg-surface-muted px-4 py-4"
          >
            <div class="flex flex-wrap items-center gap-2">
              <a
                :href="crawlSummary.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-w-0 items-center gap-1.5 truncate text-body font-semibold text-accent transition hover:underline"
              >
                <Icon :icon="Globe02Icon" :size="16" />
                <span class="truncate">{{ crawlSummary.url }}</span>
              </a>
              <BaseBadge :tone="crawlSummary.status.tone" dot class="ml-auto shrink-0">
                {{ crawlSummary.status.label }}
              </BaseBadge>
            </div>
            <p
              v-if="crawlSummary.errorMessage"
              class="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-meta text-danger"
            >
              {{ crawlSummary.errorMessage }}
            </p>
          </section>

          <!-- Job snapshot -->
          <dl
            v-if="crawlSummary"
            class="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border-subtle text-meta sm:grid-cols-4"
          >
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.pages', 'Pages crawled') }}
              </dt>
              <dd class="text-body font-semibold text-text">{{ crawlSummary.pagesCrawled }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.depth', 'Depth') }}
              </dt>
              <dd class="text-body font-semibold text-text">{{ crawlSummary.depth }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.duration', 'Duration') }}
              </dt>
              <dd class="text-body font-semibold text-text">{{ crawlSummary.duration }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.rate', 'Crawl rate') }}
              </dt>
              <dd class="text-body font-semibold text-text">{{ crawlSummary.crawlRate }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.startedAt', 'Started') }}
              </dt>
              <dd class="text-text">{{ crawlSummary.startedAt }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.finishedAt', 'Finished') }}
              </dt>
              <dd class="text-text">{{ crawlSummary.finishedAt }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.linksInternal', 'Internal links') }}
              </dt>
              <dd class="text-body font-semibold text-text">{{ crawlSummary.internalLinks }}</dd>
            </div>
            <div class="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <dt class="font-semibold uppercase tracking-wide text-text-subtle">
                {{ t('knowledgeSet.crawl.linksExternal', 'External links') }}
              </dt>
              <dd class="text-body font-semibold text-text">{{ crawlSummary.externalLinks }}</dd>
            </div>
          </dl>

          <!-- Logs -->
          <div v-if="details.crawlLogs.length" class="flex flex-col gap-2">
            <BaseInput
              v-model="crawlLogSearch"
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
                  crawlLogStageFilter === 'all'
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-muted text-text-muted hover:bg-surface-subtle',
                ]"
                @click="crawlLogStageFilter = 'all'"
              >
                {{ t('knowledgeSet.logs.allStages', 'All stages') }}
              </button>
              <button
                v-for="stage in crawlLogStages"
                :key="stage"
                type="button"
                :class="[
                  'rounded-full px-2.5 py-1 text-meta font-semibold transition',
                  crawlLogStageFilter === stage
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-muted text-text-muted hover:bg-surface-subtle',
                ]"
                @click="crawlLogStageFilter = stage"
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
                  crawlLogLevelFilter === lvl
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-muted text-text-muted hover:bg-surface-subtle',
                ]"
                @click="crawlLogLevelFilter = lvl"
              >
                {{ lvl === 'all' ? t('knowledgeSet.logs.allLevels', 'All levels') : lvl }}
              </button>
            </div>
          </div>

          <p
            v-if="!details.crawlLogs.length && !details.crawlLoading"
            class="rounded-xl border border-border bg-surface-muted px-3 py-2 text-meta text-text-muted"
          >
            {{ t('knowledgeSet.logs.empty', 'No log output yet.') }}
          </p>
          <p
            v-else-if="details.crawlLogs.length && !filteredCrawlLogs.length"
            class="rounded-xl border border-border bg-surface-muted px-3 py-2 text-meta text-text-muted"
          >
            {{ t('knowledgeSet.logs.noMatches', 'No log entries match your filters.') }}
          </p>
          <ol
            v-else-if="filteredCrawlLogs.length"
            class="max-h-[28rem] overflow-y-auto rounded-2xl border border-border-subtle"
            role="list"
          >
            <li
              v-for="(entry, idx) in filteredCrawlLogs"
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
                <BaseBadge :tone="logLevelTone(entry.level)" size="sm">{{ entry.level }}</BaseBadge>
                <BaseBadge tone="neutral" size="sm">{{ entry.stage }}</BaseBadge>
              </div>
              <p class="min-w-0 flex-1 break-words text-caption text-text">{{ entry.message }}</p>
            </li>
          </ol>
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
