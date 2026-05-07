<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { CheckmarkCircle02Icon, PlusSignIcon, Tag01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import InstructionsTabSkeleton from '../ui/skeletons/InstructionsTabSkeleton.vue';
import { extractError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import {
  getSuggestedInstructions,
  replaceTwinInstructions,
  type AiTwin,
} from '../../services/aiTwins';
import { useT } from '../../i18n/composables';

const { t } = useT();

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
// Suggestions list excludes anything already staged locally so the UI stays
// truthful even before the next save round-trip refreshes the server view.
const visibleSuggestions = computed(() => {
  const set = new Set(applied.value);
  return suggested.value.filter((s) => !set.has(s));
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
    // previous twin's list while the new fetch is in flight.
    applied.value = seedFromTwin();
    baseline.value = seedFromTwin();
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
    const saved = await replaceTwinInstructions(props.twin._key, applied.value);
    applied.value = [...saved];
    baseline.value = [...saved];
    // Refresh suggestions so newly-applied entries fall off and removed ones
    // reappear if they're part of the curated set.
    try {
      suggested.value = await getSuggestedInstructions(props.twin._key);
    } catch {
      // Non-blocking — main save succeeded.
    }
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
          class="group flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent-soft/30 px-3 py-2.5 transition"
          :class="editing && 'hover:border-accent/40'"
        >
          <button
            type="button"
            class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-white transition disabled:cursor-not-allowed"
            :class="editing ? 'hover:bg-red-500' : 'cursor-default'"
            :disabled="!editing"
            :aria-label="t('twins.instructions.remove', 'Remove instruction')"
            :title="editing ? t('twins.instructions.remove', 'Remove instruction') : t('twins.instructions.appliedBadge', 'Applied')"
            @click="removeInstruction(text)"
          >
            <Icon :icon="CheckmarkCircle02Icon" :size="16" />
          </button>
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

    <!-- Suggested Instructions — always visible; the fieldset disables the
         + buttons until the user clicks Update, mirroring the rest of the page. -->
    <section v-if="hasSuggestions" class="space-y-3">
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
