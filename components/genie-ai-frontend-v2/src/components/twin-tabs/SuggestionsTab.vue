<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import {
  Add01Icon,
  ArrowReloadHorizontalIcon,
  BubbleChatQuestionIcon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  Menu08Icon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { VueDraggable } from 'vue-draggable-plus';
import Icon from '../ui/Icon.vue';
import BaseToggle from '../ui/BaseToggle.vue';
import BaseButton from '../ui/BaseButton.vue';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import SuggestionsTabSkeleton from '../ui/skeletons/SuggestionsTabSkeleton.vue';
import { extractError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import {
  createTwinSuggestedQuestion,
  deleteTwinSuggestedQuestion,
  getTwinSuggestedQuestions,
  regenerateTwinSuggestedQuestions,
  updateTwinSuggestedQuestion,
  type AiTwin,
  type TwinSuggestedQuestion,
} from '../../services/aiTwins';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

// Asks the parent to enter edit mode — row-level icons stay visible always,
// so clicking edit/delete/toggle from view mode flips edit mode on first.
const emit = defineEmits<{ (e: 'request-edit-mode'): void }>();

function ensureEditMode(): void {
  if (!props.editing) emit('request-edit-mode');
}

// Snapshot/working pattern (same as the other twin tabs): the snapshot is the
// last known server state; `working` is the local copy edited during a session;
// `save()` diffs working against the snapshot and PATCHes the difference.

const TEMP_ID_PREFIX = '__pending__';

// Hard cap on visible (enabled) questions — patients only see this many on the
// chat landing. Toggles/creates above the cap are blocked with a warning.
const MAX_VISIBLE = 3;

const loaded = ref<TwinSuggestedQuestion[]>([]);
const working = ref<TwinSuggestedQuestion[]>([]);
const pendingDeleteIds = ref<Set<string>>(new Set());

const loading = ref(false);
const regenerating = ref(false);
const error = ref<string | null>(null);

function cloneRow(q: TwinSuggestedQuestion): TwinSuggestedQuestion {
  return { ...q };
}

function snapshotForEditing(): void {
  working.value = loaded.value.map(cloneRow);
  pendingDeleteIds.value = new Set();
  cancelInlineEdit();
  closeCreate();
}

async function load(): Promise<void> {
  if (!props.twin?._key) return;
  loading.value = true;
  error.value = null;
  try {
    // `status=all` is the admin management view — includes hidden rows so
    // the visibility toggles have something to flip.
    loaded.value = await getTwinSuggestedQuestions(props.twin._key, 'all');
    if (props.editing) snapshotForEditing();
  } catch (err) {
    error.value = extractError(err, t('twins.suggestions.loadFailed', 'Failed to load suggested questions'));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => props.twin?._key,
  () => {
    loaded.value = [];
    working.value = [];
    pendingDeleteIds.value = new Set();
    cancelInlineEdit();
    closeCreate();
    void load();
  }
);

// Entering edit mode forks the working copy; leaving without save discards it.
watch(
  () => props.editing,
  (next, prev) => {
    if (next === prev) return;
    if (next) snapshotForEditing();
    else discard();
  }
);

// View mode renders the server snapshot; edit mode renders the working copy
// minus rows staged for deletion.
const displayQuestions = computed<TwinSuggestedQuestion[]>(() => {
  if (!props.editing) return loaded.value;
  return working.value
    .filter((q) => !(q._key && pendingDeleteIds.value.has(q._key)))
    .slice()
    .sort((a, b) => a.order - b.order);
});

// ─── Regenerate ───────────────────────────────────────────────────────────
// Regenerate replaces the entire list. When there are pending changes we
// confirm first, since save() would otherwise lose them.
const regenerateConfirmOpen = ref(false);

function onRegenerateClick(): void {
  if (regenerating.value || loading.value) return;
  if (props.editing && hasPendingChanges.value) {
    regenerateConfirmOpen.value = true;
    return;
  }
  void doRegenerate();
}

async function confirmRegenerate(): Promise<void> {
  regenerateConfirmOpen.value = false;
  await doRegenerate();
}

function cancelRegenerateConfirm(): void {
  if (regenerating.value) return;
  regenerateConfirmOpen.value = false;
}

async function doRegenerate(): Promise<void> {
  if (!props.twin?._key || regenerating.value) return;
  regenerating.value = true;
  error.value = null;
  try {
    await regenerateTwinSuggestedQuestions(props.twin._key);
    // Regenerate returns only the freshly-generated set; refetch with
    // `status=all` so any preserved manual rows (including ones the admin
    // previously hid) come back into the management view.
    loaded.value = await getTwinSuggestedQuestions(props.twin._key, 'all');
    if (props.editing) snapshotForEditing();
    notify.success(
      t('twins.suggestions.regenerated', 'Suggested questions regenerated'),
      t(
        'twins.suggestions.regeneratedBody',
        'A fresh set has been generated from this twin\'s knowledge base.'
      )
    );
  } catch (err) {
    notify.error(extractError(err, t('twins.suggestions.regenerateFailed', 'Failed to regenerate suggestions')));
  } finally {
    regenerating.value = false;
  }
}

// ─── Copy ─────────────────────────────────────────────────────────────────
const copiedKey = ref<string | null>(null);
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;

function rowKey(q: TwinSuggestedQuestion): string {
  return q._key ?? `${q.category}::${q.order}::${q.content}`;
}

async function copyQuestion(q: TwinSuggestedQuestion): Promise<void> {
  try {
    await navigator.clipboard.writeText(q.content);
    copiedKey.value = rowKey(q);
    if (copiedResetTimer) clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => {
      copiedKey.value = null;
    }, 1400);
  } catch {
    notify.error(t('twins.suggestions.copyFailed', 'Could not copy to clipboard'));
  }
}

function updateWorkingRow(id: string, patch: Partial<TwinSuggestedQuestion>): void {
  const idx = working.value.findIndex((q) => q._key === id);
  if (idx < 0) return;
  working.value = [
    ...working.value.slice(0, idx),
    { ...working.value[idx], ...patch },
    ...working.value.slice(idx + 1),
  ];
}

// ─── Inline edit ──────────────────────────────────────────────────────────
const editingId = ref<string | null>(null);
const editDraft = reactive({ content: '', category: '' });
const editContentEl = ref<HTMLTextAreaElement | null>(null);

function startInlineEdit(q: TwinSuggestedQuestion): void {
  if (!q._key) return;
  editingId.value = q._key;
  editDraft.content = q.content;
  editDraft.category = q.category;
  void nextTick(() => editContentEl.value?.focus());
}

function cancelInlineEdit(): void {
  editingId.value = null;
  editDraft.content = '';
  editDraft.category = '';
}

function commitInlineEdit(q: TwinSuggestedQuestion): void {
  if (!q._key) return;
  const content = editDraft.content.trim();
  const category = editDraft.category.trim();
  if (!content) {
    notify.error(t('twins.suggestions.contentRequired', 'Question content is required'));
    return;
  }
  if (!category) {
    notify.error(t('twins.suggestions.categoryRequired', 'Category is required'));
    return;
  }
  updateWorkingRow(q._key, { content, category });
  cancelInlineEdit();
}

const workingVisibleCount = computed<number>(() =>
  working.value.filter(
    (q) => q.enabled !== false && !(q._key && pendingDeleteIds.value.has(q._key))
  ).length
);

const visibleLimitReached = computed<boolean>(() => workingVisibleCount.value >= MAX_VISIBLE);

function toggleEnabled(q: TwinSuggestedQuestion, next: boolean): void {
  if (!q._key) return;
  if (next && q.enabled === false && visibleLimitReached.value) {
    notify.warning(
      t('twins.suggestions.maxVisibleTitle', 'You can only show 3 at a time'),
      t(
        'twins.suggestions.maxVisibleBody',
        `Hide one of the currently visible questions first, then you can show this one.`
      )
    );
    return;
  }
  updateWorkingRow(q._key, { enabled: next });
}

function stageDelete(q: TwinSuggestedQuestion): void {
  if (!q._key) return;
  // Unsaved rows just disappear; persisted rows queue a DELETE for save().
  if (q._key.startsWith(TEMP_ID_PREFIX)) {
    working.value = working.value.filter((row) => row._key !== q._key);
    return;
  }
  pendingDeleteIds.value = new Set(pendingDeleteIds.value).add(q._key);
}

// Drag-and-drop reorder within a category. Each card is its own sortable
// (pull/put: false), so a drag never changes the item's category — we just
// re-sequence `order` so the save() diff picks up the moved rows.
function onGroupReorder(category: string, items: TwinSuggestedQuestion[]): void {
  if (!props.editing) return;
  const next: TwinSuggestedQuestion[] = [];
  for (const g of grouped.value) {
    next.push(...(g.category === category ? items : g.items));
  }
  working.value = next.map((row, idx) => ({ ...row, order: idx + 1 }));
}

// Row-level actions stay visible always. Clicking from view mode flips edit
// mode on first (nextTick → watcher snapshots working), then runs the action.
function handleToggleClick(q: TwinSuggestedQuestion, next: boolean): void {
  if (!props.editing) {
    ensureEditMode();
    void nextTick(() => toggleEnabled(q, next));
    return;
  }
  toggleEnabled(q, next);
}

function handleEditClick(q: TwinSuggestedQuestion): void {
  if (!props.editing) {
    ensureEditMode();
    void nextTick(() => startInlineEdit(q));
    return;
  }
  startInlineEdit(q);
}

function handleDeleteClick(q: TwinSuggestedQuestion): void {
  if (!props.editing) {
    ensureEditMode();
    void nextTick(() => stageDelete(q));
    return;
  }
  stageDelete(q);
}

const createOpen = ref(false);
const createDraft = reactive({
  content: '',
  category: '',
  enabled: true,
});
const createContentEl = ref<HTMLTextAreaElement | null>(null);

function openCreate(): void {
  createDraft.content = '';
  createDraft.category = '';
  createDraft.enabled = true;
  createOpen.value = true;
  void nextTick(() => createContentEl.value?.focus());
}

function closeCreate(): void {
  createOpen.value = false;
}

const existingCategories = computed<string[]>(() => {
  const seen = new Set<string>();
  for (const q of working.value) {
    if (q.category) seen.add(q.category);
  }
  for (const q of loaded.value) {
    if (q.category) seen.add(q.category);
  }
  return Array.from(seen).sort();
});

function commitCreate(): void {
  const content = createDraft.content.trim();
  const category = createDraft.category.trim();
  if (!content) {
    notify.error(t('twins.suggestions.contentRequired', 'Question content is required'));
    return;
  }
  if (!category) {
    notify.error(t('twins.suggestions.categoryRequired', 'Category is required'));
    return;
  }
  // Past the cap: stash as hidden rather than rejecting — keeps the typed
  // content intact and lets the admin pick which existing question to swap.
  let enabled = createDraft.enabled;
  let cappedHidden = false;
  if (enabled && visibleLimitReached.value) {
    enabled = false;
    cappedHidden = true;
  }
  const maxOrder = working.value.reduce((m, q) => Math.max(m, q.order), 0);
  const tempId = `${TEMP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  working.value = [
    ...working.value,
    {
      _key: tempId,
      order: maxOrder + 1,
      content,
      category,
      enabled,
      source: 'manual',
    },
  ];
  closeCreate();
  if (cappedHidden) {
    notify.warning(
      t('twins.suggestions.maxVisibleTitle', 'You can only show 3 at a time'),
      t(
        'twins.suggestions.createdHiddenBody',
        `Only ${MAX_VISIBLE} questions can be shown at a time. Your new one was added as Hidden — toggle off another to show it.`
      )
    );
  }
}

// Diff working against the server snapshot. PATCH with only `order` is a
// pure reorder per the API spec — it does NOT promote generated → manual.
interface MutationPlan {
  deletes: string[];
  creates: TwinSuggestedQuestion[];
  updates: Array<{ id: string; payload: Partial<TwinSuggestedQuestion> }>;
}

function buildMutationPlan(): MutationPlan {
  const original = new Map(loaded.value.map((q) => [q._key, q]));
  const deletes = Array.from(pendingDeleteIds.value);
  const creates: TwinSuggestedQuestion[] = [];
  const updates: Array<{ id: string; payload: Partial<TwinSuggestedQuestion> }> = [];

  for (const row of working.value) {
    if (!row._key) continue;
    if (pendingDeleteIds.value.has(row._key)) continue;
    if (row._key.startsWith(TEMP_ID_PREFIX)) {
      creates.push(row);
      continue;
    }
    const before = original.get(row._key);
    if (!before) continue;
    const patch: Partial<TwinSuggestedQuestion> = {};
    if (row.content !== before.content) patch.content = row.content;
    if (row.category !== before.category) patch.category = row.category;
    if ((row.enabled ?? true) !== (before.enabled ?? true)) patch.enabled = row.enabled;
    if (row.order !== before.order) patch.order = row.order;
    if (Object.keys(patch).length > 0) updates.push({ id: row._key, payload: patch });
  }

  return { deletes, creates, updates };
}

const hasPendingChanges = computed<boolean>(() => {
  if (!props.editing) return false;
  const plan = buildMutationPlan();
  return plan.deletes.length > 0 || plan.creates.length > 0 || plan.updates.length > 0;
});

// Save / Cancel — called by the parent's Save Changes / Cancel buttons.
async function save(): Promise<boolean> {
  if (!props.twin?._key) return true;
  const plan = buildMutationPlan();
  if (plan.deletes.length === 0 && plan.creates.length === 0 && plan.updates.length === 0) {
    return true;
  }
  try {
    // Deletes first to free up any uniqueness slots; updates next; creates last.
    for (const id of plan.deletes) {
      await deleteTwinSuggestedQuestion(props.twin._key, id);
    }
    for (const { id, payload } of plan.updates) {
      await updateTwinSuggestedQuestion(props.twin._key, id, payload);
    }
    for (const row of plan.creates) {
      await createTwinSuggestedQuestion(props.twin._key, {
        content: row.content,
        category: row.category,
        order: row.order,
        enabled: row.enabled,
      });
    }
    // Refetch so the snapshot picks up real ids, normalised ordering, and any
    // source promotion the server applied during PATCH.
    loaded.value = await getTwinSuggestedQuestions(props.twin._key, 'all');
    pendingDeleteIds.value = new Set();
    working.value = loaded.value.map(cloneRow);
    notify.success(t('twins.suggestions.savedToast', 'Suggested questions updated'));
    return true;
  } catch (err) {
    notify.error(extractError(err, t('twins.suggestions.saveFailed', 'Failed to save changes')));
    return false;
  }
}

function discard(): void {
  working.value = loaded.value.map(cloneRow);
  pendingDeleteIds.value = new Set();
  cancelInlineEdit();
  closeCreate();
}

defineExpose({ save, discard });

interface CategoryGroup {
  category: string;
  items: TwinSuggestedQuestion[];
}

// Both within and across groups, sort by `order`. Drag-and-drop rewrites the
// field, so the user's sequence is always the source of truth.
const grouped = computed<CategoryGroup[]>(() => {
  const map = new Map<string, TwinSuggestedQuestion[]>();
  for (const q of displayQuestions.value) {
    const bucket = map.get(q.category);
    if (bucket) bucket.push(q);
    else map.set(q.category, [q]);
  }
  const groups: CategoryGroup[] = Array.from(map.entries()).map(([category, items]) => ({
    category,
    items: items.slice().sort((a, b) => a.order - b.order),
  }));
  return groups.sort((a, b) => a.items[0].order - b.items[0].order);
});

const totalCount = computed(() => displayQuestions.value.length);
const categoryCount = computed(() => grouped.value.length);
const manualCount = computed(() => displayQuestions.value.filter((q) => q.source === 'manual').length);
const visibleCount = computed(() => displayQuestions.value.filter((q) => q.enabled !== false).length);
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-title text-text">{{ t('twins.suggestions.title', 'Suggested Questions') }}</h2>
        <p class="mt-1 max-w-2xl text-caption text-text-muted">
          {{
            t(
              'twins.suggestions.subtitle',
              `Up to ${MAX_VISIBLE} starter questions shown when a new chat opens.`
            )
          }}
        </p>
        <p
          v-if="props.editing"
          class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-meta font-semibold text-amber-700 ring-1 ring-amber-100"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          {{
            hasPendingChanges
              ? t('twins.suggestions.unsavedHint', 'You have unsaved changes. Press Save Changes to apply them.')
              : t('twins.suggestions.editingHint', 'Editing mode — your changes apply once you press Save Changes.')
          }}
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          :disabled="regenerating || loading"
          :title="props.editing && hasPendingChanges
            ? t('twins.suggestions.regenerateWillDiscard', 'Your unsaved changes will be lost if you regenerate now.')
            : undefined"
          class="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60 pointer-events-auto"
          @click="onRegenerateClick"
        >
          <Icon :icon="RefreshIcon" :size="15" :class="regenerating && 'animate-spin'" />
          {{
            regenerating
              ? t('twins.suggestions.regenerating', 'Regenerating…')
              : t('twins.suggestions.regenerate', 'Regenerate')
          }}
        </button>
        <button
          v-if="props.editing"
          type="button"
          :disabled="loading"
          class="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 pointer-events-auto"
          @click="openCreate"
        >
          <Icon :icon="Add01Icon" :size="15" />
          {{ t('twins.suggestions.addBtn', 'Add question') }}
        </button>
      </div>
    </header>

    <!-- Meta strip — stat tiles -->
    <div
      v-if="!loading && !error && totalCount > 0"
      class="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <div class="rounded-2xl border border-border bg-surface px-4 py-3">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {{ t('twins.suggestions.statQuestions', 'Total') }}
        </p>
        <p class="mt-1 text-lg font-bold tabular-nums text-text">{{ totalCount }}</p>
      </div>
      <div class="rounded-2xl border border-border bg-surface px-4 py-3">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {{ t('twins.suggestions.statCategories', 'Categories') }}
        </p>
        <p class="mt-1 text-lg font-bold tabular-nums text-text">{{ categoryCount }}</p>
      </div>
      <div class="rounded-2xl border border-border bg-surface px-4 py-3">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {{ t('twins.suggestions.statManual', 'Manual') }}
        </p>
        <p class="mt-1 inline-flex items-baseline gap-1 text-lg font-bold tabular-nums text-emerald-700">
          {{ manualCount }}
          <span class="text-[10px] font-medium text-text-muted">/ {{ totalCount }}</span>
        </p>
      </div>
      <div
        class="rounded-2xl border bg-surface px-4 py-3"
        :class="visibleCount > MAX_VISIBLE ? 'border-amber-200 ring-1 ring-amber-100' : 'border-border'"
      >
        <p class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {{ t('twins.suggestions.statVisible', 'Visible to users') }}
        </p>
        <p
          class="mt-1 inline-flex items-baseline gap-1 text-lg font-bold tabular-nums"
          :class="visibleCount > MAX_VISIBLE ? 'text-amber-700' : 'text-emerald-700'"
        >
          {{ visibleCount }}
          <span class="text-[10px] font-medium text-text-muted">/ {{ MAX_VISIBLE }} {{ t('twins.suggestions.maxLabel', 'max') }}</span>
        </p>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="error"
      class="flex items-center justify-between gap-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
    >
      <span>{{ error }}</span>
      <button
        type="button"
        class="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 pointer-events-auto"
        @click="load"
      >
        {{ t('common.retry', 'Retry') }}
      </button>
    </div>

    <!-- Loading -->
    <SuggestionsTabSkeleton v-else-if="loading && displayQuestions.length === 0" />

    <!-- Empty -->
    <div
      v-else-if="!loading && totalCount === 0"
      class="suggestion-empty relative overflow-hidden rounded-3xl border border-dashed border-accent/20 bg-gradient-to-br from-accent/[0.04] via-surface to-violet-50/40 px-6 py-14 text-center"
    >
      <div class="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/[0.05] blur-2xl" aria-hidden="true" />
      <div class="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-violet-200/30 blur-2xl" aria-hidden="true" />
      <div class="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-accent shadow-card ring-1 ring-accent/10">
        <Icon :icon="BubbleChatQuestionIcon" :size="22" />
      </div>
      <h3 class="relative mt-4 text-body font-semibold text-text">
        {{ t('twins.suggestions.emptyTitle', 'No suggested questions yet') }}
      </h3>
      <p class="relative mx-auto mt-1 max-w-md text-caption text-text-muted">
        {{
          props.editing
            ? t('twins.suggestions.emptyBodyEditing', 'Press Add question to create your first one, then Save Changes to apply.')
            : t(
                'twins.suggestions.emptyBody',
                'Add files to this twin\'s Knowledge Set or hit Regenerate to ask the model for a fresh set.'
              )
        }}
      </p>
      <div class="relative mt-5 flex flex-wrap items-center justify-center gap-2">
        <BaseButton v-if="props.editing" variant="primary" rounded="full" @click="openCreate">
          <Icon :icon="Add01Icon" :size="14" />
          {{ t('twins.suggestions.addFirst', 'Add the first question') }}
        </BaseButton>
        <BaseButton v-if="!props.editing" variant="ghost" rounded="full" :disabled="regenerating" @click="onRegenerateClick">
          <Icon :icon="RefreshIcon" :size="14" :class="regenerating && 'animate-spin'" />
          {{ t('twins.suggestions.regenerate', 'Regenerate') }}
        </BaseButton>
      </div>
    </div>

    <!-- Grouped list -->
    <div v-else class="space-y-5">
      <section
        v-for="group in grouped"
        :key="group.category"
        class="suggestion-card overflow-hidden rounded-2xl border border-border bg-surface shadow-card transition-shadow hover:shadow-md"
      >
        <header class="suggestion-card__header relative flex items-center gap-3 border-b border-border bg-gradient-to-r from-accent/[0.06] via-transparent to-transparent px-5 py-3">
          <span class="absolute inset-y-0 left-0 w-1 bg-accent" aria-hidden="true" />
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="grid h-8 w-8 place-items-center rounded-xl bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgba(15,61,145,0.08)]">
              <Icon :icon="BubbleChatQuestionIcon" :size="15" />
            </span>
            <h3 class="truncate text-body font-semibold tracking-tight text-text">{{ group.category }}</h3>
          </div>
        </header>

        <VueDraggable
          :model-value="group.items"
          tag="ul"
          class="divide-y divide-border"
          :animation="180"
          :disabled="!props.editing"
          handle=".drag-handle"
          ghost-class="suggestion-row--ghost"
          chosen-class="suggestion-row--chosen"
          drag-class="suggestion-row--dragging"
          :group="{ name: `suggestions-${group.category}`, pull: false, put: false }"
          @update:model-value="(items: TwinSuggestedQuestion[]) => onGroupReorder(group.category, items)"
        >
          <li
            v-for="q in group.items"
            :key="rowKey(q)"
            class="suggestion-row group/row relative flex items-center gap-3 px-5 py-3.5 transition-colors"
            :class="[
              editingId === q._key
                ? 'bg-accent/[0.035]'
                : q.enabled === false
                  ? 'bg-slate-50/60'
                  : props.editing
                    ? 'hover:bg-surface-muted/50'
                    : '',
              q._key && q._key.startsWith(TEMP_ID_PREFIX) && 'ring-1 ring-emerald-200/60',
            ]"
          >
            <!-- Hover/edit accent rail -->
            <span
              class="suggestion-row__rail absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent opacity-0 transition-opacity"
              :class="[editingId === q._key && 'opacity-100']"
              aria-hidden="true"
            />

            <!-- Drag handle (edit mode only) -->
            <button
              v-if="props.editing && q._key"
              type="button"
              class="drag-handle -ml-1 inline-grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded text-text-muted/60 transition hover:text-text active:cursor-grabbing"
              :aria-label="t('twins.suggestions.dragHandleAria', 'Drag to reorder')"
              :title="t('twins.suggestions.dragHandleTitle', 'Drag to reorder within this category')"
            >
              <Icon :icon="Menu08Icon" :size="14" />
            </button>

            <!-- Order badge -->
            <span
              class="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-meta font-bold tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]"
              :class="[
                q.source === 'manual'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-surface-muted text-text',
                q.enabled === false && 'opacity-70',
              ]"
            >
              {{ q.order }}
            </span>

            <!-- View mode -->
            <template v-if="editingId !== q._key">
              <div class="min-w-0 flex-1" :class="q.enabled === false && 'opacity-70'">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p class="flex-1 min-w-0 text-body leading-relaxed text-text">{{ q.content }}</p>
                  <span
                    v-if="q.source"
                    :class="[
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      q.source === 'manual'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                        : 'bg-violet-50 text-violet-600 ring-1 ring-violet-100',
                    ]"
                  >
                    {{
                      q.source === 'manual'
                        ? t('twins.suggestions.sourceManual', 'Manual')
                        : t('twins.suggestions.sourceAi', 'AI')
                    }}
                  </span>
                  <span
                    v-if="q._key && q._key.startsWith(TEMP_ID_PREFIX)"
                    class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-100"
                  >
                    {{ t('twins.suggestions.pendingCreate', 'New · unsaved') }}
                  </span>
                  <span
                    v-if="q.enabled === false"
                    class="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200"
                  >
                    {{ t('twins.suggestions.disabledTag', 'Hidden') }}
                  </span>
                </div>
              </div>

              <!-- Right cluster — always visible. Clicking toggle / edit /
                   delete from view mode flips the parent into edit mode and
                   then performs the action; the rest happens normally once
                   editing is on. -->
              <div class="flex shrink-0 items-center gap-2">
                <BaseToggle
                  v-if="q._key"
                  :model-value="q.enabled !== false"
                  :aria-label="t('twins.suggestions.toggleAria', 'Show or hide this question in chat')"
                  class="suggestion-row__toggle"
                  @update:model-value="(v) => handleToggleClick(q, v)"
                />
                <span v-if="q._key" class="h-6 w-px bg-border/80" aria-hidden="true" />
                <div class="suggestion-row__actions flex items-center gap-0.5">
                  <button
                    type="button"
                    class="row-action inline-grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-muted hover:text-text pointer-events-auto"
                    :aria-label="t('twins.suggestions.copyAria', 'Copy question')"
                    :title="t('twins.suggestions.copy', 'Copy')"
                    @click="copyQuestion(q)"
                  >
                    <Icon :icon="copiedKey === rowKey(q) ? Tick02Icon : Copy01Icon" :size="14" />
                  </button>
                  <button
                    v-if="q._key"
                    type="button"
                    class="row-action inline-grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-accent/10 hover:text-accent pointer-events-auto"
                    :aria-label="t('twins.suggestions.editAria', 'Edit question')"
                    :title="props.editing ? t('common.edit', 'Edit') : t('twins.suggestions.editEnterMode', 'Edit (opens edit mode)')"
                    @click="handleEditClick(q)"
                  >
                    <Icon :icon="Edit02Icon" :size="14" />
                  </button>
                  <button
                    v-if="q._key"
                    type="button"
                    class="row-action inline-grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-danger/10 hover:text-danger pointer-events-auto"
                    :aria-label="t('twins.suggestions.deleteAria', 'Delete question')"
                    :title="props.editing ? t('common.delete', 'Delete') : t('twins.suggestions.deleteEnterMode', 'Delete (opens edit mode)')"
                    @click="handleDeleteClick(q)"
                  >
                    <Icon :icon="Delete02Icon" :size="14" />
                  </button>
                </div>
              </div>
            </template>

            <!-- Inline edit (edit-mode only) -->
            <template v-else>
              <div class="flex-1 min-w-0 space-y-2">
                <textarea
                  ref="editContentEl"
                  v-model="editDraft.content"
                  rows="3"
                  class="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-body text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  :placeholder="t('twins.suggestions.contentPlaceholder', 'What would a user ask?')"
                />
                <div class="flex flex-wrap items-center gap-2">
                  <label class="text-meta font-semibold uppercase tracking-wide text-text-muted">
                    {{ t('twins.suggestions.categoryLabel', 'Category') }}
                  </label>
                  <input
                    v-model="editDraft.category"
                    type="text"
                    list="suggestion-categories"
                    class="flex-1 min-w-[180px] rounded-full border border-border bg-surface px-3 py-1.5 text-meta text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    :placeholder="t('twins.suggestions.categoryPlaceholder', 'e.g. Hypertension')"
                  />
                  <div class="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-meta font-semibold text-text-muted transition hover:bg-surface-muted pointer-events-auto"
                      @click="cancelInlineEdit"
                    >
                      <Icon :icon="Cancel01Icon" :size="13" />
                      {{ t('common.cancel', 'Cancel') }}
                    </button>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-meta font-semibold text-white shadow-card transition hover:bg-accent/90 pointer-events-auto"
                      @click="commitInlineEdit(q)"
                    >
                      <Icon :icon="Tick02Icon" :size="13" />
                      {{ t('twins.suggestions.applyEdit', 'Apply') }}
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </li>
        </VueDraggable>
      </section>
    </div>

    <!-- Pending-deletes banner — only when at least one row is staged -->
    <div
      v-if="props.editing && pendingDeleteIds.size > 0"
      class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-meta text-amber-800"
    >
      <span class="inline-flex items-center gap-2">
        <Icon :icon="Delete02Icon" :size="14" />
        <span>
          <strong class="font-semibold">{{ pendingDeleteIds.size }}</strong>
          {{
            pendingDeleteIds.size === 1
              ? t('twins.suggestions.pendingDeleteOne', 'question marked for removal')
              : t('twins.suggestions.pendingDeleteMany', 'questions marked for removal')
          }}
        </span>
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 pointer-events-auto"
        @click="pendingDeleteIds = new Set()"
      >
        <Icon :icon="ArrowReloadHorizontalIcon" :size="12" />
        {{ t('twins.suggestions.undoStagedDelete', 'Restore them') }}
      </button>
    </div>

    <!-- Shared datalist of existing categories for the edit/create inputs -->
    <datalist id="suggestion-categories">
      <option v-for="c in existingCategories" :key="c" :value="c" />
    </datalist>

    <!-- Add-question dialog -->
    <Teleport to="body">
      <div
        v-if="createOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="absolute inset-0 bg-neutral-900/35 backdrop-blur-sm" @click="closeCreate" />
        <section class="relative z-10 w-full max-w-lg overflow-hidden rounded-[24px] bg-white shadow-[0_24px_64px_-16px_rgba(15,23,42,0.35)]">
          <header class="flex items-start justify-between gap-3 px-6 pt-6">
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-text">
                {{ t('twins.suggestions.createTitle', 'Add suggested question') }}
              </h2>
              <p class="mt-1 text-meta text-text-muted">
                {{
                  t(
                    'twins.suggestions.createSubtitleBuffered',
                    'Nothing goes live until you press Save Changes.'
                  )
                }}
              </p>
            </div>
            <button
              type="button"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-text-muted transition hover:bg-surface-muted/70 hover:text-text pointer-events-auto"
              :aria-label="t('common.close', 'Close')"
              @click="closeCreate"
            >
              <Icon :icon="Cancel01Icon" :size="15" />
            </button>
          </header>

          <form class="space-y-4 px-6 pb-6 pt-4" @submit.prevent="commitCreate">
            <div class="space-y-1.5">
              <label for="create-q-content" class="text-meta font-semibold uppercase tracking-wide text-text-muted">
                {{ t('twins.suggestions.contentLabel', 'Question') }}
              </label>
              <textarea
                id="create-q-content"
                ref="createContentEl"
                v-model="createDraft.content"
                rows="3"
                maxlength="500"
                class="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-body text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                :placeholder="t('twins.suggestions.contentPlaceholder', 'What would a user ask?')"
              />
              <div class="flex justify-end text-[11px] text-text-muted tabular-nums">
                {{ createDraft.content.length }} / 500
              </div>
            </div>

            <div class="space-y-1.5">
              <label for="create-q-category" class="text-meta font-semibold uppercase tracking-wide text-text-muted">
                {{ t('twins.suggestions.categoryLabel', 'Category') }}
              </label>
              <input
                id="create-q-category"
                v-model="createDraft.category"
                type="text"
                list="suggestion-categories"
                maxlength="80"
                class="w-full rounded-xl border border-border bg-surface px-3 py-2 text-body text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                :placeholder="t('twins.suggestions.categoryPlaceholder', 'e.g. Hypertension')"
              />
              <p class="text-[11px] text-text-muted">
                {{
                  t(
                    'twins.suggestions.categoryHint',
                    'Used to group questions on the chat landing screen. Pick an existing one or create a new label.'
                  )
                }}
              </p>
            </div>

            <div class="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/30 px-3 py-2.5">
              <div>
                <p class="text-meta font-semibold text-text">
                  {{ t('twins.suggestions.enabledLabel', 'Visible to users') }}
                </p>
                <p class="text-[11px] text-text-muted">
                  {{
                    visibleLimitReached
                      ? t(
                          'twins.suggestions.enabledHintCapped',
                          `${MAX_VISIBLE} questions are already shown — this one will be added as Hidden.`
                        )
                      : t(
                          'twins.suggestions.enabledHint',
                          'Hidden questions are saved but won\'t appear in chat.'
                        )
                  }}
                </p>
              </div>
              <BaseToggle v-model="createDraft.enabled" :disabled="visibleLimitReached" />
            </div>

            <div class="flex items-center justify-end gap-2 pt-2">
              <BaseButton variant="ghost" rounded="full" @click="closeCreate">
                {{ t('common.cancel', 'Cancel') }}
              </BaseButton>
              <BaseButton type="submit" variant="primary" rounded="full">
                <Icon :icon="Add01Icon" :size="14" />
                {{ t('twins.suggestions.stageBtn', 'Add question') }}
              </BaseButton>
            </div>
          </form>
        </section>
      </div>
    </Teleport>

    <!-- Regenerate-while-editing confirmation -->
    <ConfirmDialog
      v-model:open="regenerateConfirmOpen"
      :title="t('twins.suggestions.regenerateConfirmTitle', 'You have unsaved changes')"
      :description="t(
        'twins.suggestions.regenerateConfirmBody',
        'Regenerate will replace this whole list with a fresh one from the knowledge base. Any changes you haven\'t saved yet will be lost.'
      )"
      :confirm-label="t('twins.suggestions.regenerateConfirmCta', 'Regenerate anyway')"
      :loading="regenerating"
      @confirm="confirmRegenerate"
      @cancel="cancelRegenerateConfirm"
    />
  </div>
</template>

<style scoped>
/* Reveal the left accent rail on row hover. Pure-Tailwind would need an extra
   group/peer relationship the row already overloads, so we lean on CSS here. */
.suggestion-row:hover .suggestion-row__rail {
  opacity: 1;
}

.row-action:focus-visible {
  outline: 2px solid var(--tw-color-accent, #0b3d91);
  outline-offset: 2px;
}

/* Shrink the shared BaseToggle a touch — the default size is too dominant on
   the dense question rows. Scales the actual <button> inside the BaseToggle. */
.suggestion-row__toggle :deep(button[role='switch']) {
  height: 1.25rem;   /* 20px */
  width: 2.25rem;    /* 36px */
}
.suggestion-row__toggle :deep(button[role='switch'] > span) {
  height: 1rem;      /* 16px */
  width: 1rem;
}
.suggestion-row__toggle :deep(button[role='switch'][aria-checked='true'] > span) {
  transform: translateX(18px);
}
.suggestion-row__toggle :deep(button[role='switch'][aria-checked='false'] > span) {
  transform: translateX(2px);
}

/* SortableJS drag visuals — these class names are configured on the
   <VueDraggable> element via ghost-class / chosen-class / drag-class.
   `:deep()` is needed because SortableJS adds them outside Vue's scope. */
:deep(.suggestion-row--ghost) {
  opacity: 0.35;
  background: rgb(15 61 145 / 0.06);
}
:deep(.suggestion-row--chosen) {
  cursor: grabbing;
}
:deep(.suggestion-row--dragging) {
  background: #fff;
  box-shadow:
    0 12px 28px -8px rgb(15 23 42 / 0.18),
    0 4px 12px -4px rgb(15 23 42 / 0.10);
  border-radius: 12px;
  transform: scale(1.01);
}
</style>
