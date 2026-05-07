<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import BaseRadioCard from '../ui/BaseRadioCard.vue';
import { extractError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { useT } from '../../i18n/composables';
import {
  getTwinPersonality,
  updateTwinPersonality,
  type AiTwin,
  type LanguageStyle,
  type ResponseLength,
  type TwinPersonality,
} from '../../services/aiTwins';

const { t } = useT();

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

const DEFAULTS: TwinPersonality = {
  languageStyle: 'casual',
  responseLength: 'medium',
};

// Seeded from the parent-supplied twin payload (the privileged GET already
// returns `personality`) so the first render shows the correct radio
// selection — no flicker. The async fetch below still runs as a safety net
// for the rare case where the twin object lacks the field.
function seedFromTwin(): TwinPersonality {
  const p = props.twin?.personality;
  return {
    languageStyle: p?.languageStyle ?? DEFAULTS.languageStyle,
    responseLength: p?.responseLength ?? DEFAULTS.responseLength,
  };
}

const initialSeed = seedFromTwin();
const form = reactive<TwinPersonality>({ ...initialSeed });
const baseline = ref<TwinPersonality>({ ...initialSeed });
const loading = ref(false);
const saving = ref(false);
// Suppresses the "load failed" toast when the twin payload already supplied
// `personality` — the UI is correct, so a refresh failure is just noise.
const hydrated = ref(!!props.twin?.personality);

async function load(): Promise<void> {
  if (!props.twin?._key) return;
  loading.value = true;
  try {
    const data = await getTwinPersonality(props.twin._key);
    Object.assign(form, data);
    baseline.value = { ...data };
    hydrated.value = true;
  } catch {
    if (!hydrated.value) {
      notify.error(t('twins.personality.loadFailedToast', 'Failed to load AI Personality'));
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => props.twin?._key,
  () => {
    // Twin switched — reseed synchronously so the radios don't flash the
    // previous twin's selection while the new fetch is in flight.
    const seed = seedFromTwin();
    Object.assign(form, seed);
    baseline.value = { ...seed };
    hydrated.value = !!props.twin?.personality;
    void load();
  }
);

function isDirty(): boolean {
  return (
    form.languageStyle !== baseline.value.languageStyle ||
    form.responseLength !== baseline.value.responseLength
  );
}

function changedFields(): Partial<TwinPersonality> {
  const diff: Partial<TwinPersonality> = {};
  if (form.languageStyle !== baseline.value.languageStyle) diff.languageStyle = form.languageStyle;
  if (form.responseLength !== baseline.value.responseLength) diff.responseLength = form.responseLength;
  return diff;
}

function discard(): void {
  Object.assign(form, baseline.value);
}

async function save(): Promise<boolean> {
  if (!props.twin?._key) return true;
  if (!isDirty()) {
    notify.success(t('twins.personality.noChangesToast', 'No changes to save'));
    return true;
  }
  saving.value = true;
  try {
    const updated = await updateTwinPersonality(props.twin._key, changedFields());
    Object.assign(form, updated);
    baseline.value = { ...updated };
    notify.success(t('twins.personality.savedToast', 'Personality updated'));
    return true;
  } catch (err) {
    notify.error(extractError(err, t('twins.personality.saveFailedToast', 'Failed to update personality')));
    return false;
  } finally {
    saving.value = false;
  }
}

defineExpose({ save, discard });

const languageStyles: { value: LanguageStyle; label: string }[] = [
  { value: 'slang', label: t('twins.personality.slang', 'Slang Use') },
  { value: 'casual', label: t('twins.personality.casual', 'Casual') },
  { value: 'professional', label: t('twins.personality.professional', 'Professional') },
];

const responseLengths: { value: ResponseLength; label: string; description: string }[] = [
  {
    value: 'short',
    label: t('twins.personality.short', 'Short'),
    description: t('twins.personality.shortDesc', 'i.e. concise, brief statements'),
  },
  {
    value: 'medium',
    label: t('twins.personality.medium', 'Medium'),
    description: t('twins.personality.mediumDesc', 'i.e. moderately lengthy statements'),
  },
  {
    value: 'long',
    label: t('twins.personality.long', 'Long'),
    description: t('twins.personality.longDesc', 'i.e. detailed, thorough explanations'),
  },
];
</script>

<template>
  <div class="space-y-8">
    <h2 class="text-title text-text">{{ t('twins.personality.title', 'Edit Your AI Personality') }}</h2>

    <section>
      <header class="mb-3">
        <h3 class="text-body font-semibold text-text">{{ t('twins.personality.languageStyleTitle', 'Language Style') }}</h3>
        <p class="text-caption text-text-muted">{{ t('twins.personality.languageStyleSubtitle', 'Choose how you want your AI Twin to communicate') }}</p>
      </header>
      <div class="space-y-3">
        <BaseRadioCard
          v-for="opt in languageStyles"
          :key="opt.value"
          v-model="form.languageStyle"
          :value="opt.value"
          :label="opt.label"
          :disabled="!editing || loading || saving"
        />
      </div>
    </section>

    <section>
      <header class="mb-3">
        <h3 class="text-body font-semibold text-text">{{ t('twins.personality.lengthTitle', 'Response Length') }}</h3>
        <p class="text-caption text-text-muted">{{ t('twins.personality.lengthSubtitle', 'Choose how long your AI Twin responses should be') }}</p>
      </header>
      <div class="space-y-3">
        <BaseRadioCard
          v-for="opt in responseLengths"
          :key="opt.value"
          v-model="form.responseLength"
          :value="opt.value"
          :label="opt.label"
          :description="opt.description"
          :disabled="!editing || loading || saving"
        />
      </div>
    </section>
  </div>
</template>
