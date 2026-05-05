<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { PauseIcon, PlayIcon, RecordIcon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import VoiceListSkeleton from '../ui/skeletons/VoiceListSkeleton.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import { notify } from '../../lib/notify';
import { useAiTwinsStore } from '../../stores/aiTwins';
import { listVoices, previewVoice, type Voice } from '../../services/voices';
import { useT } from '../../i18n/composables';

const { t } = useT();

const PREVIEW_TEXT = 'Hello, this is a preview of my voice.';
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  fr: 'French',
  mnk: 'Mandinka',
  es: 'Spanish',
  ar: 'Arabic',
  // TODO i18n: missing key for Swahili in twins.voice.languages
  sw: 'Swahili',
};

const props = withDefaults(defineProps<{ editing?: boolean }>(), { editing: false });

const aiTwinsStore = useAiTwinsStore();
const { current: twin } = storeToRefs(aiTwinsStore);

const voices = ref<Voice[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Selection mirrors the twin's persisted voiceId; saves go through the store.
const selectedVoiceId = ref<string | null>(twin.value?.voiceId ?? null);
watch(
  () => twin.value?.voiceId ?? null,
  (next) => {
    selectedVoiceId.value = next;
  }
);

const playingVoiceId = ref<string | null>(null);
const previewLoadingId = ref<string | null>(null);
const audioCache = new Map<string, { audio: HTMLAudioElement; url: string }>();

const enabledVoices = computed(() => voices.value.filter((v) => v.enabled !== false));

function languageLabel(code: string): string {
  if (['en', 'fr', 'mnk', 'es', 'ar'].includes(code)) {
    return t(`twins.voice.languages.${code}`, LANGUAGE_LABELS[code] ?? code.toUpperCase());
  }
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

function genderLabel(g: string | undefined | null): string {
  if (!g) return '';
  const lower = g.toLowerCase();
  if (lower === 'male') return t('twins.voice.genderMale', 'Male');
  if (lower === 'female') return t('twins.voice.genderFemale', 'Female');
  return g.charAt(0).toUpperCase() + g.slice(1);
}

const groupedByLanguage = computed<Array<{ language: string; label: string; voices: Voice[] }>>(() => {
  const map = new Map<string, Voice[]>();
  for (const v of enabledVoices.value) {
    const key = v.language || 'other';
    const list = map.get(key) ?? [];
    list.push(v);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, list]) => ({
      language,
      label: languageLabel(language),
      voices: list,
    }));
});

function voiceCaption(v: Voice): string {
  const gender = genderLabel(v.gender);
  const lang = languageLabel(v.language ?? '');
  return [lang, gender].filter(Boolean).join(' · ');
}

function onVoiceRowActivate(id: string): void {
  if (!props.editing) return;
  selectedVoiceId.value = id;
}

const itemClass = (id: string) => [
  'flex items-center gap-3 rounded-2xl border bg-surface p-3 shadow-card transition',
  props.editing ? 'cursor-pointer' : 'cursor-default',
  selectedVoiceId.value === id
    ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/20'
    : 'border-border',
  props.editing && selectedVoiceId.value !== id && 'hover:bg-surface-muted',
];

function pausePlaying(): void {
  if (!playingVoiceId.value) return;
  const entry = audioCache.get(playingVoiceId.value);
  if (entry && !entry.audio.paused) entry.audio.pause();
  playingVoiceId.value = null;
}

function disposeAllPreviews(): void {
  audioCache.forEach((entry) => {
    entry.audio.onended = null;
    entry.audio.onerror = null;
    entry.audio.pause();
    entry.audio.src = '';
    URL.revokeObjectURL(entry.url);
  });
  audioCache.clear();
  playingVoiceId.value = null;
}

async function togglePreview(voice: Voice): Promise<void> {
  // Currently playing this voice → pause (allows resume on next click).
  if (playingVoiceId.value === voice._key) {
    pausePlaying();
    return;
  }

  // Switching to a different voice → pause whatever is playing, but keep
  // the cached audio so users can resume it later from where it left off.
  pausePlaying();

  let entry = audioCache.get(voice._key);
  if (!entry) {
    previewLoadingId.value = voice._key;
    try {
      const blob = await previewVoice(voice._key, PREVIEW_TEXT);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        if (playingVoiceId.value === voice._key) playingVoiceId.value = null;
        // Reset so a future click starts from the beginning of the preview.
        audio.currentTime = 0;
      };
      audio.onerror = () => {
        if (playingVoiceId.value === voice._key) playingVoiceId.value = null;
        notify.error(t('twins.voice.previewFailToast', 'Failed to play voice preview'));
      };
      entry = { audio, url };
      audioCache.set(voice._key, entry);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } }; message?: string })
        ?.response?.data?.message ?? (err as Error)?.message ?? t('twins.voice.previewFailDefault', 'Failed to load voice preview');
      notify.error(message);
      return;
    } finally {
      previewLoadingId.value = null;
    }
  }

  playingVoiceId.value = voice._key;
  try {
    await entry.audio.play();
  } catch {
    if (playingVoiceId.value === voice._key) playingVoiceId.value = null;
  }
}

async function loadVoices(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    voices.value = await listVoices();
    if (!selectedVoiceId.value) {
      const first = enabledVoices.value[0];
      if (first) selectedVoiceId.value = first._key;
    }
  } catch (err) {
    error.value =
      (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data
        ?.message ?? (err as Error)?.message ?? t('twins.voice.loadFailedDefault', 'Failed to load voices');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<boolean> {
  if (!twin.value) return true;
  if (selectedVoiceId.value === (twin.value.voiceId ?? null)) return true;
  try {
    await aiTwinsStore.update(twin.value._key, { voiceId: selectedVoiceId.value });
    // TODO i18n: missing key for "Voice updated" toast
    notify.success('Voice updated');
    return true;
  } catch {
    // TODO i18n: missing key for "Failed to save voice" toast
    notify.error(aiTwinsStore.error ?? 'Failed to save voice');
    return false;
  }
}

function discard(): void {
  selectedVoiceId.value = twin.value?.voiceId ?? null;
}

defineExpose({ save, discard });

onMounted(loadVoices);
onBeforeUnmount(disposeAllPreviews);
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <h2 class="text-title text-text">{{ t('twins.voice.title', 'Pick a Voice For Your AI Twin') }}</h2>
    </header>

    <VoiceListSkeleton v-if="loading && voices.length === 0" :rows="4" />

    <div
      v-else-if="error"
      class="flex items-center justify-between gap-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
    >
      <span>{{ error }}</span>
      <button
        type="button"
        class="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
        @click="loadVoices"
      >
        {{ t('common.retry', 'Retry') }}
      </button>
    </div>

    <EmptyState
      v-else-if="enabledVoices.length === 0"
      :icon="RecordIcon"
      :title="t('twins.voice.noVoicesTitle', 'No voices available')"
      :description="t('twins.voice.noVoicesBody', 'No voices have been enabled yet. Check back once your administrator has added some.')"
    />

    <div v-else class="space-y-6">
      <section v-for="group in groupedByLanguage" :key="group.language">
        <h3 class="mb-3 text-body font-semibold text-text">{{ group.label }}</h3>
        <fieldset>
          <legend class="sr-only">{{ group.label }}</legend>
          <ul class="space-y-3">
            <li v-for="v in group.voices" :key="v._key">
              <div
                :class="itemClass(v._key)"
                role="radio"
                :tabindex="editing ? 0 : -1"
                :aria-checked="selectedVoiceId === v._key"
                :aria-label="editing ? `Select ${v.name}` : `${v.name} (preview available with play button)`"
                @click="onVoiceRowActivate(v._key)"
                @keydown.enter.prevent="onVoiceRowActivate(v._key)"
                @keydown.space.prevent="onVoiceRowActivate(v._key)"
              >
                <button
                  type="button"
                  class="rounded-full bg-accent-soft p-2 text-accent transition hover:bg-ieee-100 disabled:opacity-50"
                  :aria-label="playingVoiceId === v._key ? `Pause preview of ${v.name}` : `Play preview of ${v.name}`"
                  :disabled="previewLoadingId === v._key"
                  @click.stop="togglePreview(v)"
                  @keydown.stop
                >
                  <span
                    v-if="previewLoadingId === v._key"
                    class="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  />
                  <Icon v-else :icon="playingVoiceId === v._key ? PauseIcon : PlayIcon" :size="14" />
                </button>
                <BaseAvatar :name="v.name" size="md" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-body font-medium text-text">{{ v.name }}</p>
                  <p class="truncate text-caption text-text-muted">{{ voiceCaption(v) }}</p>
                </div>
                <input
                  type="radio"
                  name="twin-voice"
                  :value="v._key"
                  :checked="selectedVoiceId === v._key"
                  class="h-4 w-4 accent-accent"
                  :class="editing ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
                  tabindex="-1"
                  :disabled="!editing"
                  @click.stop
                  @change="onVoiceRowActivate(v._key)"
                />
              </div>
            </li>
          </ul>
        </fieldset>
      </section>
    </div>
  </div>
</template>
