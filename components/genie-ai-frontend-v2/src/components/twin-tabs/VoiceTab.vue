<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PauseIcon, PlayIcon, RecordIcon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import { notify } from '../../lib/notify';
import { listVoices, previewVoice, type Voice } from '../../services/voices';

const PREVIEW_TEXT = 'Hello, this is a preview of my voice.';
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  fr: 'French',
  mnk: 'Mandinka',
  es: 'Spanish',
  ar: 'Arabic',
};

const voices = ref<Voice[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// TODO(voice-persistence): the AiTwin schema currently has no voiceId field.
// Selection lives in component state; wire to twin update once the backend
// exposes a voice column on /ai-twins.
const selectedVoiceId = ref<string | null>(null);

const playingVoiceId = ref<string | null>(null);
const previewLoadingId = ref<string | null>(null);
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

const enabledVoices = computed(() => voices.value.filter((v) => v.enabled !== false));

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
      label: LANGUAGE_LABELS[language] ?? language.toUpperCase(),
      voices: list,
    }));
});

function voiceCaption(v: Voice): string {
  const gender = v.gender ? v.gender.charAt(0).toUpperCase() + v.gender.slice(1) : '';
  const lang = LANGUAGE_LABELS[v.language] ?? v.language?.toUpperCase() ?? '';
  return [lang, gender].filter(Boolean).join(' · ');
}

const itemClass = (id: string) => [
  'flex items-center gap-3 rounded-2xl border bg-surface p-3 shadow-card transition cursor-pointer',
  selectedVoiceId.value === id
    ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/20'
    : 'border-border hover:bg-surface-muted',
];

function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  playingVoiceId.value = null;
}

async function togglePreview(voice: Voice): Promise<void> {
  if (playingVoiceId.value === voice._key) {
    stopAudio();
    return;
  }
  stopAudio();

  previewLoadingId.value = voice._key;
  try {
    const blob = await previewVoice(voice._key, PREVIEW_TEXT);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    currentAudioUrl = url;
    audio.addEventListener('ended', stopAudio);
    audio.addEventListener('error', () => {
      stopAudio();
      notify.error('Failed to play voice preview');
    });
    playingVoiceId.value = voice._key;
    await audio.play();
  } catch (err) {
    const message = (err as { response?: { data?: { message?: string } }; message?: string })
      ?.response?.data?.message ?? (err as Error)?.message ?? 'Failed to load voice preview';
    notify.error(message);
    stopAudio();
  } finally {
    previewLoadingId.value = null;
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
        ?.message ?? (err as Error)?.message ?? 'Failed to load voices';
  } finally {
    loading.value = false;
  }
}

function save(): boolean {
  // Persisting the selection on the twin is pending backend support (no
  // voiceId field on /ai-twins). Surface the choice locally for now.
  return true;
}

function discard(): void {
  // No persistent state to revert yet — see save() note.
}

defineExpose({ save, discard });

onMounted(loadVoices);
onBeforeUnmount(stopAudio);
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <h2 class="text-title text-text">Pick a Voice For Your AI Twin</h2>
    </header>

    <div v-if="loading && voices.length === 0" class="space-y-3">
      <BaseSkeleton v-for="n in 4" :key="n" height="4rem" />
    </div>

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
        Retry
      </button>
    </div>

    <EmptyState
      v-else-if="enabledVoices.length === 0"
      :icon="RecordIcon"
      title="No voices available"
      description="No voices have been enabled yet. Check back once your administrator has added some."
    />

    <div v-else class="space-y-6">
      <section v-for="group in groupedByLanguage" :key="group.language">
        <h3 class="mb-3 text-body font-semibold text-text">{{ group.label }}</h3>
        <fieldset>
          <legend class="sr-only">{{ group.label }}</legend>
          <ul class="space-y-3">
            <li v-for="v in group.voices" :key="v._key">
              <label :class="itemClass(v._key)">
                <button
                  type="button"
                  class="rounded-full bg-accent-soft p-2 text-accent transition hover:bg-ieee-100 disabled:opacity-50"
                  :aria-label="playingVoiceId === v._key ? `Stop preview of ${v.name}` : `Play preview of ${v.name}`"
                  :disabled="previewLoadingId === v._key"
                  @click.stop.prevent="togglePreview(v)"
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
                  class="h-4 w-4 cursor-pointer accent-accent"
                  @change="selectedVoiceId = v._key"
                />
              </label>
            </li>
          </ul>
        </fieldset>
      </section>
    </div>
  </div>
</template>
