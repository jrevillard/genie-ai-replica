<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  File02Icon,
  Image01Icon,
  Note01Icon,
  Pdf01Icon,
  PresentationOnlineIcon,
} from '@hugeicons/core-free-icons';
import { formatFileSize } from '../../lib/files';
import { notify } from '../../lib/notify';
import BaseButton from '../ui/BaseButton.vue';
import BaseSkeleton from '../ui/skeletons/BaseSkeleton.vue';
import KnowledgeFileRow from './KnowledgeFileRow.vue';
import { useAiTwinsStore } from '../../stores/aiTwins';
import type { AiTwin } from '../../services/aiTwins';
import fileService from '../../services/files';
import type { RepoFileRow } from '../../services/files';
import { useT } from '../../i18n/composables';

const { t, locale } = useT();

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);
const store = useAiTwinsStore();

// Local staging of the linked-file list. Unlinks and Clear-all only mutate
// this ref — the API is only hit when the parent's Save Changes commits via
// `save()`. Cancel/discard simply resets it from the server state.
const pendingIds = ref<string[]>([...(props.twin.linkedKbFileIds ?? [])]);

// Re-snapshot whenever the underlying server state changes (twin switch or
// post-save refresh), but only when we're not mid-edit so we don't clobber
// the user's in-flight changes.
watch(
  () => [props.twin._key, props.twin.linkedKbFileIds] as const,
  ([, ids]) => {
    if (!props.editing) pendingIds.value = [...(ids ?? [])];
  },
  { deep: true }
);

// Entering edit mode → fresh snapshot from the last-saved state so the diff
// is meaningful even if the user toggled edit on/off.
watch(
  () => props.editing,
  (now, prev) => {
    if (now && !prev) pendingIds.value = [...(props.twin.linkedKbFileIds ?? [])];
  }
);

// Display shape used by both modes. `linked` tells the row template whether
// to render the checkbox as checked (file currently assigned to this twin)
// or empty (available to be assigned). In view mode the list is filtered to
// linked only; in edit mode every file in the repository is shown so the
// user can assign / unassign without leaving the page.
type DisplayFile = {
  fileId: string;
  fileName: string;
  extension: string | null;
  sizeLabel: string | null;
  language: string | null;
  chunkCount: number | null;
  statusRaw: string;
  statusLabel: string;
  uploadedLabel: string | null;
  labels: string[];
  author: string | null;
  sourceUrl: string | null;
  linked: boolean;
};

// All files known to the document repository. Loaded once on mount so the
// edit-mode toggle list is ready when the user clicks Update. We don't gate
// the fetch on `editing` to avoid a noticeable delay on the first click into
// edit mode — list responses are tiny.
const allFiles = ref<RepoFileRow[]>([]);
const allFilesLoading = ref(false);

async function loadAllFiles(): Promise<void> {
  allFilesLoading.value = true;
  try {
    // GET /api/files?page=1&limit=50 — same endpoint and page size the
    // global /knowledge-set view uses, so both surfaces show a consistent
    // catalog snapshot.
    const res = await fileService.listFiles({ page: 1, limit: 50 });
    allFiles.value = res.files;
  } catch {
    // Non-fatal — the user can still see currently-linked files; the
    // assign-unassigned UI will just be empty until they reload.
  } finally {
    allFilesLoading.value = false;
  }
}

onMounted(loadAllFiles);

// Reload when entering edit mode so freshly-ingested files show up without a
// full page refresh.
watch(
  () => props.editing,
  (now, prev) => {
    if (now && !prev) void loadAllFiles();
  }
);

function makeDisplayFromRepoRow(
  row: RepoFileRow,
  linkedMeta: NonNullable<AiTwin['linkedKbFiles']>[number] | undefined,
  linked: boolean
): DisplayFile {
  // Prefer the twin-scoped `linkedKbFiles` metadata when available (it's
  // already tailored to this twin); fall back to the canonical repository
  // row for everything else.
  const fileName = linkedMeta?.fileName || linkedMeta?.originalName || linkedMeta?.title || row.file_name || row.file_id;
  const sizeBytes = linkedMeta?.fileSize ?? linkedMeta?.size ?? row.file_size ?? null;
  const statusRaw = linkedMeta?.status || row.dataprep?.status || '';
  const uploadedRaw = linkedMeta?.uploadedDate || linkedMeta?.createDate || linkedMeta?.createdAt || row.uploaded_date || null;
  const langRaw = linkedMeta?.language || row.language || null;
  const chunks =
    typeof linkedMeta?.chunkCount === 'number'
      ? linkedMeta.chunkCount
      : typeof row.chunk_count === 'number'
        ? row.chunk_count
        : null;
  const labels =
    (Array.isArray(linkedMeta?.labels) && linkedMeta.labels.filter(Boolean)) ||
    (Array.isArray(row.labels) && row.labels.filter(Boolean)) ||
    [];
  return {
    fileId: row.file_id,
    fileName,
    extension: extractExtension(fileName, linkedMeta?.fileType ?? (row.file_type as string | undefined), linkedMeta?.mimeType),
    sizeLabel: formatFileSize(sizeBytes ?? null),
    language: langRaw ? String(langRaw).toLowerCase() : null,
    chunkCount: chunks,
    statusRaw,
    statusLabel: mapDataprepToLabel(statusRaw),
    uploadedLabel: formatDateLabel(uploadedRaw),
    labels,
    author: linkedMeta?.author ? String(linkedMeta.author) : null,
    sourceUrl: linkedMeta?.sourceUrl ? String(linkedMeta.sourceUrl) : (typeof row.source_url === 'string' ? row.source_url : null),
    linked,
  };
}

// Indexed accessors used by both section computeds.
const linkedMetaMap = computed<Map<string, NonNullable<AiTwin['linkedKbFiles']>[number]>>(() => {
  const m = new Map<string, NonNullable<AiTwin['linkedKbFiles']>[number]>();
  for (const f of props.twin.linkedKbFiles ?? []) {
    if (f?.fileId) m.set(f.fileId, f);
  }
  return m;
});

// "Assigned" section: every file the twin currently links to, in the order
// it appears in `pendingIds`. Falls back to a synthesized row when the repo
// hasn't returned metadata yet (rare; usually stale KB refs).
const assignedFiles = computed<DisplayFile[]>(() => {
  const rowsById = new Map<string, RepoFileRow>();
  for (const row of allFiles.value) rowsById.set(row.file_id, row);
  return pendingIds.value.map((fileId) => {
    const row =
      rowsById.get(fileId) ??
      ({
        file_id: fileId,
        file_name: linkedMetaMap.value.get(fileId)?.fileName || fileId,
      } as RepoFileRow);
    return makeDisplayFromRepoRow(row, linkedMetaMap.value.get(fileId), true);
  });
});

// "Not assigned" section: every file in the repository that isn't currently
// linked. Alphabetical by filename so the list is predictable as the user
// toggles entries on/off.
const notAssignedFiles = computed<DisplayFile[]>(() => {
  const linkedSet = new Set(pendingIds.value);
  const out: DisplayFile[] = [];
  for (const row of allFiles.value) {
    if (linkedSet.has(row.file_id)) continue;
    out.push(makeDisplayFromRepoRow(row, linkedMetaMap.value.get(row.file_id), false));
  }
  out.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return out;
});

// File counters surfaced in the header so the user can see "X of Y linked"
// at a glance when in edit mode.
const linkedCount = computed(() => pendingIds.value.length);
const totalAvailable = computed(() => {
  // Union of repository files and currently-linked ids (in case any aren't
  // in the repo response — see synthesized rows above).
  const set = new Set(allFiles.value.map((f) => f.file_id));
  for (const id of pendingIds.value) set.add(id);
  return set.size;
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

// Mirrors `docIconClasses` from `KnowledgeSetView.vue` so the row tiles read
// the same regardless of which screen the user is on.
function fileIconClasses(ext: string | null): string {
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
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'img':
      return 'bg-fuchsia-50 text-fuchsia-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

// Maps the dataprep status string the backend persists to a translated label
// and a BaseBadge tone. Keep in sync with `statusTone` / `mapDataprepToLabel`
// in `views/KnowledgeSetView.vue`.
function mapDataprepToLabel(raw: string): string {
  const n = (raw || '').toLowerCase();
  if (!n) return t('knowledgeSet.statusPending', 'Pending');
  if (n.includes('error')) return t('knowledgeSet.statusError', 'Ingestion error');
  if (n.includes('warning')) return t('knowledgeSet.statusWarning', 'Ingested with warnings');
  if (n.includes('ingesting')) return t('knowledgeSet.statusIngesting', 'Ingesting');
  if (n.includes('ingested')) return t('knowledgeSet.statusIngested', 'Ingested');
  if (n.includes('retracted')) return t('knowledgeSet.statusRetracted', 'Retracted');
  if (n.includes('killed')) return t('knowledgeSet.statusKilled', 'Stopped');
  if (n.includes('pending')) return t('knowledgeSet.statusPending', 'Pending');
  return raw?.trim() || t('knowledgeSet.statusPending', 'Pending');
}

function statusTone(
  statusRaw: string
): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const n = (statusRaw || '').toLowerCase();
  if (n.includes('error')) return 'danger';
  if (n.includes('killed')) return 'danger';
  if (n.includes('warning')) return 'warning';
  if (n.includes('pending')) return 'warning';
  if (n.includes('ingesting')) return 'accent';
  if (n.includes('ingested')) return 'success';
  return 'neutral';
}

function formatDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const localeTag = locale.value === 'mnk' ? 'en-GB' : locale.value;
  return d.toLocaleDateString(localeTag, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function languageLabel(code: string | null): string | null {
  if (!code) return null;
  // Use the browser's localized language display name when available so
  // "en" reads as "English" in the active UI locale. Falls back to the raw
  // code if the runtime can't resolve it.
  try {
    const display = new Intl.DisplayNames([locale.value], { type: 'language' });
    return display.of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

// Click on a row in edit mode → flip the link state for that file. Pure
// local staging; the parent's Save Changes commits everything in one
// `replaceKbFiles` call.
function toggleLink(file: DisplayFile): void {
  if (!props.editing) return;
  if (file.linked) {
    pendingIds.value = pendingIds.value.filter((id) => id !== file.fileId);
  } else {
    pendingIds.value = [...pendingIds.value, file.fileId];
  }
}

// "Clear all" → stage the empty list locally. Same staging contract.
function clearAllLocal() {
  if (!props.editing) return;
  pendingIds.value = [];
}

function isDirty(): boolean {
  const a = pendingIds.value;
  const b = props.twin.linkedKbFileIds ?? [];
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

// Parent's Save Changes → commit the staged list with one replaceKbFiles call.
async function save(): Promise<boolean> {
  if (!isDirty()) return true;
  try {
    await store.replaceKbFiles(props.twin._key, [...pendingIds.value]);
    notify.success(t('twins.knowledge.toasts.saved', 'Knowledge set saved'));
    return true;
  } catch {
    notify.error(
      store.error ?? t('twins.knowledge.toasts.saveFailed', 'Failed to save knowledge set')
    );
    return false;
  }
}

// Parent's Cancel → drop the staged list, snap back to the last-saved state.
function discard(): void {
  pendingIds.value = [...(props.twin.linkedKbFileIds ?? [])];
}
defineExpose({ save, discard });
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-title text-text">{{ t('twins.knowledge.title', 'Edit Your Knowledge Set') }}</h2>
          <span
            v-if="props.editing"
            class="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent"
          >
            {{
              t(
                'twins.knowledge.linkedOfTotal',
                { linked: linkedCount, total: totalAvailable },
                '{linked} of {total} linked'
              )
            }}
          </span>
          <span
            v-else-if="linkedCount"
            class="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent"
          >
            {{ linkedCount }}
          </span>
        </div>
        <p class="mt-0.5 text-caption text-text-muted">
          {{
            props.editing
              ? t('twins.knowledge.subtitleEditing', 'Toggle files on or off — saved when you click Save Changes.')
              : t('twins.knowledge.subtitle', "Files linked here are used to answer with this AI Twin's specific knowledge.")
          }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton
          v-if="linkedCount"
          variant="ghost"
          size="sm"
          rounded="full"
          :disabled="!props.editing"
          @click="clearAllLocal"
        >
          {{ t('twins.knowledge.clearAll', 'Clear all') }}
        </BaseButton>
      </div>
    </header>

    <!-- "Assigned" section — files currently linked to this twin. Always
         rendered so the user can see the diff (assigned vs available) at a
         glance, even in view mode. Empty state shows when nothing's linked. -->
    <section class="space-y-3">
      <header class="flex items-center gap-2">
        <h3 class="text-body font-semibold text-text">
          {{ t('twins.knowledge.sectionAssigned', 'Assigned to this twin') }}
        </h3>
        <span class="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent">
          {{ assignedFiles.length }}
        </span>
      </header>

      <ul v-if="assignedFiles.length" class="space-y-2">
        <KnowledgeFileRow
          v-for="file in assignedFiles"
          :key="`a-${file.fileId}`"
          :file="file"
          :editing="props.editing"
          @toggle="toggleLink"
        />
      </ul>
      <p
        v-else
        class="rounded-2xl border border-dashed border-border bg-surface-muted/40 px-4 py-3 text-caption text-text-muted"
      >
        {{ t('twins.knowledge.assignedEmpty', 'Nothing assigned yet. Pick from the list below.') }}
      </p>
    </section>

    <!-- "Not assigned" section — every other file in the repository, so the
         user can see what's available even while not editing. Click-to-link
         is gated to edit mode inside the row component. -->
    <section class="space-y-3">
      <header class="flex items-center gap-2">
        <h3 class="text-body font-semibold text-text">
          {{ t('twins.knowledge.sectionNotAssigned', 'Not assigned') }}
        </h3>
        <span class="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-meta font-semibold text-text-muted">
          {{ notAssignedFiles.length }}
        </span>
      </header>

      <ul v-if="notAssignedFiles.length" class="space-y-2">
        <KnowledgeFileRow
          v-for="file in notAssignedFiles"
          :key="`u-${file.fileId}`"
          :file="file"
          :editing="props.editing"
          @toggle="toggleLink"
        />
      </ul>
      <!-- Skeleton placeholder rows while the first /api/files call resolves.
           Shape mirrors the real row (icon tile + name + meta + checkbox)
           so the layout doesn't shift when real data arrives. -->
      <ul v-else-if="allFilesLoading" class="space-y-2" aria-hidden="true">
        <li
          v-for="i in 3"
          :key="`skel-u-${i}`"
          class="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card"
        >
          <BaseSkeleton width="2.5rem" height="2.5rem" rounded="lg" />
          <div class="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <div class="flex items-center gap-2">
              <BaseSkeleton :width="['55%', '70%', '48%'][(i - 1) % 3]" height="0.875rem" rounded="md" />
              <BaseSkeleton width="2.5rem" height="0.875rem" rounded="md" />
              <BaseSkeleton width="4rem" height="1rem" rounded="full" />
            </div>
            <div class="flex items-center gap-2">
              <BaseSkeleton width="3.5rem" height="0.875rem" rounded="full" />
              <BaseSkeleton width="3rem" height="0.625rem" rounded="md" />
              <BaseSkeleton width="5rem" height="0.625rem" rounded="md" />
            </div>
          </div>
          <BaseSkeleton v-if="props.editing" width="1.5rem" height="1.5rem" rounded="md" />
        </li>
      </ul>
      <p
        v-else
        class="rounded-2xl border border-dashed border-border bg-surface-muted/40 px-4 py-3 text-caption text-text-muted"
      >
        {{ t('twins.knowledge.allAssigned', 'Every available file is already assigned.') }}
      </p>
    </section>



  </div>
</template>
