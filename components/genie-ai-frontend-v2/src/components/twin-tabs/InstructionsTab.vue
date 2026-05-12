<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { PlusSignIcon, Tag01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseSkeleton from '../ui/skeletons/BaseSkeleton.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import InstructionsTabSkeleton from '../ui/skeletons/InstructionsTabSkeleton.vue';
import { extractError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import {
  getSuggestedInstructions,
  type AiTwin,
} from '../../services/aiTwins';
import { useAiTwinsStore } from '../../stores/aiTwins';
import { useT } from '../../i18n/composables';

const { t } = useT();
const aiTwinsStore = useAiTwinsStore();

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

// Seeded synchronously from the twin payload (the privileged GET already
// returns `instructions[]`), so the very first render shows the correct
// list — no skeleton flash on tab switch.
function seedFromTwin(): string[] {
  return [...(props.twin?.instructions ?? [])];
}

// `applied` is the local working copy the user mutates while editing.
// `baseline` is the last server-confirmed list — used for discard() and to
// detect "no-op save" so we don't fire an unnecessary POST.
const applied = ref<string[]>(seedFromTwin());
const baseline = ref<string[]>(seedFromTwin());
const suggested = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const adding = ref(false);
const draft = ref('');
const draftRef = ref<HTMLTextAreaElement | null>(null);

const hasInstructions = computed(() => applied.value.length > 0);
// The suggestion pool unions the server's curated list with whatever the twin
// already had applied at the last server sync (`baseline`). The server
// endpoint only returns suggestions that aren't already applied, so without
// folding `baseline` in we couldn't restore an instruction the moment the
// user removes it — the user would have to Save first to refetch. By keeping
// `baseline` in the pool, removing a previously-applied entry makes it pop
// straight back into "Suggested Instructions" without a round-trip.
const visibleSuggestions = computed(() => {
  const appliedSet = new Set(applied.value);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...suggested.value, ...baseline.value]) {
    if (!s || appliedSet.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
});
const hasSuggestions = computed(() => visibleSuggestions.value.length > 0);

async function load(): Promise<void> {
  if (!props.twin?._key) return;
  loading.value = true;
  error.value = null;
  try {
    suggested.value = await getSuggestedInstructions(props.twin._key);
  } catch (err) {
    error.value = extractError(err, t('twins.instructions.loadFailed', 'Failed to load instructions'));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => props.twin?._key,
  () => {
    // Twin switched — reseed synchronously so the rows don't flash the
    // previous twin's list while the new fetch is in flight. Clearing
    // `suggested` lets the inline skeleton render until the new pool lands;
    // otherwise the user briefly sees the previous twin's suggestions.
    applied.value = seedFromTwin();
    baseline.value = seedFromTwin();
    suggested.value = [];
    void load();
  }
);

// When the parent flips out of edit mode without going through Save (e.g.
// switching tabs), the AiTwinDetailView watcher calls discard() — but if it
// flips for any other reason we also drop the inline draft so the next time
// the user enters edit mode, they don't see a stale textarea.
watch(
  () => props.editing,
  (now) => {
    if (!now) cancelAdding();
  }
);

function addInstruction(text: string): void {
  if (!props.editing) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  if (applied.value.includes(trimmed)) {
    notify.error(t('twins.instructions.duplicate', 'That instruction is already applied'));
    return;
  }
  applied.value = [...applied.value, trimmed];
}

function removeInstruction(text: string): void {
  if (!props.editing) return;
  applied.value = applied.value.filter((x) => x !== text);
}

function startAdding(): void {
  if (!props.editing) return;
  adding.value = true;
  requestAnimationFrame(() => draftRef.value?.focus());
}

function cancelAdding(): void {
  adding.value = false;
  draft.value = '';
}

function submitDraft(): void {
  const text = draft.value.trim();
  if (!text) return;
  addInstruction(text);
  cancelAdding();
}

function isDirty(): boolean {
  if (applied.value.length !== baseline.value.length) return true;
  for (let i = 0; i < applied.value.length; i++) {
    if (applied.value[i] !== baseline.value[i]) return true;
  }
  return false;
}

function discard(): void {
  applied.value = [...baseline.value];
  cancelAdding();
}

async function save(): Promise<boolean> {
  // Persist any unsubmitted draft text first so the user doesn't lose it.
  if (adding.value && draft.value.trim()) {
    addInstruction(draft.value.trim());
    cancelAdding();
  } else {
    cancelAdding();
  }

  if (!isDirty()) {
    notify.success(t('twins.general.noChangesToast', 'No changes to save'));
    return true;
  }

  try {
    // Save through the store so `current.instructions` stays in sync; without
    // this the parent's `twin` prop keeps the pre-save list and any consumer
    // reading from it sees stale data.
    const saved = await aiTwinsStore.replaceInstructions(props.twin._key, applied.value);
    // Fetch the refreshed suggestion pool *before* committing local state so
    // the UI transitions in a single render — applied/baseline/suggested all
    // flip together, no intermediate flicker between "save completed" and
    // "suggestions refetched".
    let freshSuggested = suggested.value;
    try {
      freshSuggested = await getSuggestedInstructions(props.twin._key);
    } catch {
      // Non-blocking — main save succeeded.
    }
    applied.value = [...saved];
    baseline.value = [...saved];
    suggested.value = freshSuggested;
    notify.success(t('twins.instructions.savedToast', 'Instructions saved'));
    return true;
  } catch (err) {
    notify.error(extractError(err, t('twins.instructions.saveFailed', 'Failed to save instructions')));
    return false;
  }
}

defineExpose({ save, discard });
</script>

<template>
  <InstructionsTabSkeleton v-if="loading && applied.length === 0 && suggested.length === 0" />

  <div v-else class="space-y-6">
    <header>
      <h2 class="text-title text-text">{{ t('twins.instructions.title', 'Edit Your Instructions') }}</h2>
      <p class="mt-0.5 text-caption text-text-muted">
        {{ t('twins.instructions.subtitle', "Specific dos and don'ts your AI Twin will follow during conversations.") }}
      </p>
    </header>

    <div
      v-if="error"
      class="flex items-center justify-between gap-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
    >
      <span>{{ error }}</span>
      <button
        type="button"
        class="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
        @click="load"
      >
        {{ t('common.retry', 'Retry') }}
      </button>
    </div>

    <!-- Twin Instructions (currently applied). Always rendered; the fieldset
         in AiTwinDetailView disables every button below when !editing. -->
    <section class="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <h3 class="text-body font-semibold text-text">
            {{ t('twins.instructions.appliedTitle', 'Twin Instructions') }}
          </h3>
          <span
            v-if="hasInstructions"
            class="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent"
          >
            {{ applied.length }}
          </span>
        </div>
      </div>

      <ul v-if="hasInstructions" class="space-y-2">
        <li
          v-for="text in applied"
          :key="text"
          :class="[
            'group flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent-soft/30 px-3 py-2.5 transition',
            editing
              ? 'cursor-pointer hover:border-accent/40 focus-within:border-accent/40'
              : '',
          ]"
          :role="editing ? 'checkbox' : undefined"
          :aria-checked="editing ? true : undefined"
          :tabindex="editing ? 0 : undefined"
          :aria-label="editing ? t('twins.instructions.remove', 'Remove instruction') : undefined"
          @click="editing && removeInstruction(text)"
          @keydown.enter.prevent="editing && removeInstruction(text)"
          @keydown.space.prevent="editing && removeInstruction(text)"
        >
          <span
            :class="[
              'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 border-accent bg-accent text-white transition',
              editing && 'group-hover:border-red-500 group-hover:bg-red-500',
            ]"
            :title="editing ? t('twins.instructions.remove', 'Remove instruction') : t('twins.instructions.appliedBadge', 'Applied')"
            aria-hidden="true"
          >
            <svg
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
          <p class="flex-1 text-body text-text">{{ text }}</p>
        </li>
      </ul>

      <div
        v-else-if="!loading"
        class="rounded-2xl border border-dashed border-border bg-surface-muted/40 px-4 py-3 text-caption text-text-muted"
      >
        {{
          editing
            ? t('twins.instructions.appliedEmptyEditing', 'No instructions yet — add one below or pick from the suggestions.')
            : t('twins.instructions.appliedEmptyView', 'No instructions configured. Click Update to add some.')
        }}
      </div>

      <Transition name="draft" mode="out-in">
        <div v-if="adding" key="form" class="space-y-2">
          <textarea
            ref="draftRef"
            v-model="draft"
            rows="3"
            :placeholder="t('twins.instructions.draftPlaceholder', 'Be concise and practical in your answers.')"
            class="w-full resize-y rounded-2xl border border-border bg-surface p-3 text-body text-text outline-none transition placeholder:text-text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
            @keydown.meta.enter.prevent="submitDraft"
            @keydown.ctrl.enter.prevent="submitDraft"
            @keydown.esc.prevent="cancelAdding"
          />
          <div class="flex items-center justify-between gap-2">
            <p class="text-meta text-text-muted">
              {{ t('twins.instructions.draftHint', 'Press ⌘ + Enter to add · Esc to cancel') }}
            </p>
            <div class="flex items-center gap-2">
              <BaseButton variant="ghost" size="sm" rounded="full" @click="cancelAdding">
                {{ t('common.cancel', 'Cancel') }}
              </BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                rounded="full"
                :disabled="!draft.trim()"
                @click="submitDraft"
              >
                {{ t('twins.instructions.stage', 'Add to list') }}
              </BaseButton>
            </div>
          </div>
        </div>
        <div v-else key="trigger" class="flex justify-end">
          <BaseButton
            variant="primary"
            size="sm"
            rounded="full"
            :disabled="!editing"
            @click="startAdding"
          >
            <Icon :icon="PlusSignIcon" :size="14" />
            {{ t('twins.instructions.add', 'Add Instruction') }}
          </BaseButton>
        </div>
      </Transition>
    </section>

    <!-- Suggestions skeleton while the curated list is in flight. Shows only
         when we don't have suggestions to render yet, so a re-fetch after a
         save doesn't flash the existing list back to placeholders. -->
    <section
      v-if="loading && suggested.length === 0 && !error"
      class="space-y-3"
      aria-hidden="true"
    >
      <BaseSkeleton width="11rem" height="1rem" rounded="md" />
      <ul class="space-y-2">
        <li
          v-for="i in 3"
          :key="`sug-skel-${i}`"
          class="flex items-start gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-card"
        >
          <BaseSkeleton variant="circle" width="1.75rem" height="1.75rem" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <BaseSkeleton
              :width="['90%', '75%', '85%'][(i - 1) % 3]"
              height="0.875rem"
              rounded="md"
            />
            <BaseSkeleton
              v-if="i % 2 === 1"
              :width="['55%', '45%', '35%'][(i - 1) % 3]"
              height="0.75rem"
              rounded="md"
            />
          </div>
        </li>
      </ul>
    </section>

    <!-- Suggested Instructions — always visible; the fieldset disables the
         + buttons until the user clicks Update, mirroring the rest of the page. -->
    <section v-else-if="hasSuggestions" class="space-y-3">
      <h3 class="text-body font-semibold text-text">
        {{ t('twins.instructions.suggestedTitle', 'Suggested Instructions') }}
      </h3>

      <ul class="space-y-2">
        <li
          v-for="text in visibleSuggestions"
          :key="text"
          class="group flex items-start gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-card transition"
          :class="editing && 'hover:border-accent/40 hover:shadow-md'"
        >
          <button
            type="button"
            class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-white transition disabled:cursor-not-allowed"
            :class="editing && 'hover:scale-105'"
            :disabled="!editing"
            :aria-label="t('twins.instructions.applySuggestion', 'Add this suggestion')"
            :title="editing ? t('twins.instructions.applySuggestion', 'Add this suggestion') : t('twins.instructions.readOnlyHint', 'Click Update to edit')"
            @click="addInstruction(text)"
          >
            <Icon :icon="PlusSignIcon" :size="16" />
          </button>
          <p class="flex-1 text-body text-text">{{ text }}</p>
        </li>
      </ul>
    </section>

    <EmptyState
      v-else-if="!loading && !hasInstructions && !error"
      :icon="Tag01Icon"
      :title="t('twins.instructions.emptyTitle', 'No instructions yet')"
      :description="t('twins.instructions.emptyBody', 'Click Update to start adding rules your AI Twin will follow during conversations.')"
    />
  </div>
</template>

<style scoped>
.draft-enter-active,
.draft-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.draft-enter-from,
.draft-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
