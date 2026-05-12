<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { extractError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { getTwinSystemPrompt, updateTwinSystemPrompt, getDefaultSystemPrompt, type AiTwin } from '../../services/aiTwins';
import SystemPromptTabSkeleton from '../ui/skeletons/SystemPromptTabSkeleton.vue';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

const prompt = ref('');
const baseline = ref('');
const loading = ref(false);
const saving = ref(false);
const resetting = ref(false);
const error = ref<string | null>(null);

const MAX_CHARS = 50_000;

async function load(): Promise<void> {
  if (!props.twin?._key) return;
  loading.value = true;
  error.value = null;
  try {
    const fetched = await getTwinSystemPrompt(props.twin._key);
    prompt.value = fetched;
    baseline.value = fetched;
  } catch (err) {
    error.value = extractError(err, t('twins.systemPrompt.loadFailed', 'Failed to load system prompt'));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => props.twin?._key,
  () => {
    prompt.value = '';
    baseline.value = '';
    void load();
  }
);

function isDirty(): boolean {
  return prompt.value !== baseline.value;
}

function discard(): void {
  prompt.value = baseline.value;
}

async function save(): Promise<boolean> {
  if (!isDirty()) {
    notify.success(t('twins.general.noChangesToast', 'No changes to save'));
    return true;
  }

  const trimmed = prompt.value.trim();
  if (!trimmed) {
    notify.error(t('twins.systemPrompt.emptyError', 'System prompt cannot be empty'));
    return false;
  }
  if (trimmed.length > MAX_CHARS) {
    notify.error(
      t('twins.systemPrompt.tooLong', `System prompt must be ${MAX_CHARS.toLocaleString()} characters or fewer`)
    );
    return false;
  }

  saving.value = true;
  try {
    const saved = await updateTwinSystemPrompt(props.twin._key, trimmed);
    prompt.value = saved;
    baseline.value = saved;
    notify.success(t('twins.systemPrompt.savedToast', 'System prompt saved'));
    return true;
  } catch (err) {
    notify.error(extractError(err, t('twins.systemPrompt.saveFailed', 'Failed to save system prompt')));
    return false;
  } finally {
    saving.value = false;
  }
}

async function resetToDefault(): Promise<void> {
  resetting.value = true;
  try {
    const defaultPrompt = await getDefaultSystemPrompt();
    prompt.value = defaultPrompt;
    // baseline stays unchanged so the tab correctly detects unsaved changes
    // and the user can Save or Cancel as normal.
  } catch (err) {
    notify.error(extractError(err, t('twins.systemPrompt.resetFailed', 'Failed to load default prompt')));
  } finally {
    resetting.value = false;
  }
}

defineExpose({ save, discard });
</script>

<template>
  <div class="space-y-6">
    <header>
      <h2 class="text-title text-text">{{ t('twins.systemPrompt.title', 'System Prompt') }}</h2>
      <p class="mt-0.5 text-caption text-text-muted">
        {{
          t(
            'twins.systemPrompt.subtitle',
            'The base instructions that define how this AI Twin behaves across all chat and voice interactions. Call-specific rules and context are automatically appended and cannot be edited here.'
          )
        }}
      </p>
    </header>

    <!-- Error banner -->
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

    <!-- Loading skeleton -->
    <SystemPromptTabSkeleton v-else-if="loading && !prompt" />

    <!-- Prompt editor -->
    <div v-else class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <label
          for="system-prompt-textarea"
          class="text-body font-semibold text-text"
        >
          {{ t('twins.systemPrompt.label', 'Prompt') }}
        </label>
        <div class="flex items-center gap-3">
          <span
            :class="[
              'text-meta tabular-nums',
              prompt.length > MAX_CHARS ? 'text-danger' : 'text-text-muted',
            ]"
          >
            {{ prompt.length.toLocaleString() }} / {{ MAX_CHARS.toLocaleString() }}
          </span>
          <button
            type="button"
            :disabled="resetting"
            class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-meta font-semibold text-text-muted transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:cursor-not-allowed disabled:opacity-60 pointer-events-auto"
            :title="t('twins.systemPrompt.resetTitle', 'Reset to platform default')"
            @click="resetToDefault"
          >
            <span
              v-if="resetting"
              class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            {{ t('twins.systemPrompt.resetBtn', 'Reset to default') }}
          </button>
        </div>
      </div>

      <textarea
        id="system-prompt-textarea"
        v-model="prompt"
        rows="24"
        :placeholder="t('twins.systemPrompt.placeholder', 'Enter the system prompt for this AI Twin…')"
        :disabled="!editing"
        class="w-full resize-y rounded-2xl border border-border bg-surface p-4 font-mono text-sm text-text outline-none transition placeholder:text-text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-default pointer-events-auto"
      />

      <p class="text-meta text-text-muted">
        {{
          editing
            ? t(
                'twins.systemPrompt.editingHint',
                'Only the main prompt is editable. Voice-call rules and retrieved context are automatically appended by the system.'
              )
            : t('twins.systemPrompt.viewHint', 'Click Update to edit the system prompt.')
        }}
      </p>
    </div>
  </div>
</template>
