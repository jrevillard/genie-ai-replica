<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  ArrowLeft01Icon,
  BubbleChatIcon,
  CallIcon,
  Cancel01Icon,
  Copy01Icon,
  Mic01Icon,
  PauseIcon,
  PlayIcon,
  SentIcon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons';

import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import ChatMessageBody from '../components/chat/ChatMessageBody.vue';
import ChatPageSkeleton from '../components/ui/skeletons/ChatPageSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import { CHAT_LANGS, chatStrings, flagForLang, flagUrl, type ChatLang } from '../lib/chatStrings';
import { getChatLanguages, type ChatLanguage } from '../services/chatSessions';
import { playRecordStartChime, playRecordStopChime } from '../lib/chimes';
import { notify } from '../lib/notify';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { useT } from '../i18n/composables';

const { t: tt } = useT();

const route = useRoute();
const router = useRouter();

const aiTwinsStore = useAiTwinsStore();
const chatStore = useChatStore();
const { current: twin, loading: twinLoading, error: twinError } = storeToRefs(aiTwinsStore);
const { messages, sending, lang } = storeToRefs(chatStore);

const showTwinSkeleton = computed(
  () => Boolean(twinId.value) && twinLoading.value && !twin.value
);
const showTwinError = computed(
  () => Boolean(twinId.value) && !twinLoading.value && !twin.value && Boolean(twinError.value)
);

// Single English source — the API will return localised strings later.
const t = chatStrings;

// Static waveform shape for the user's voice-note bubble. A precomputed
// peaks-and-valleys pattern reads like a real recorded snippet without
// recomputing pseudo-random heights on every render.
const VOICE_WAVE_HEIGHTS = [
  30, 50, 70, 60, 45, 60, 80, 55, 35, 50, 75, 95, 70, 55, 40, 60,
  85, 65, 45, 30, 55, 80, 70, 50, 35, 50, 70, 90, 65, 45, 55, 75,
  60, 40, 25, 45,
] as const;

const twinId = computed(() => {
  const raw = route.params.twinId;
  return Array.isArray(raw) ? raw[0] : (raw ?? '');
});

const draft = ref('');
const composer = ref<HTMLTextAreaElement | null>(null);
const messagesEnd = ref<HTMLDivElement | null>(null);
const langOpen = ref(false);
const langButton = ref<HTMLButtonElement | null>(null);

interface LangPickerOption {
  code: ChatLang;
  label: string;
  flag: string;
}

// Local table is used only as a fallback if the languages API is unavailable
// (e.g. brief network failure on first load). The API is the source of truth.
const FALLBACK_LANG_OPTIONS: LangPickerOption[] = CHAT_LANGS.map((opt) => ({
  code: opt.code,
  label: opt.label,
  flag: opt.flag,
}));

const languageOptions = ref<LangPickerOption[]>(FALLBACK_LANG_OPTIONS);
const languagesLoading = ref(false);

async function loadLanguages(): Promise<void> {
  languagesLoading.value = true;
  try {
    const list: ChatLanguage[] = await getChatLanguages();
    if (list.length > 0) {
      languageOptions.value = list.map((l) => ({
        code: l.code,
        label: l.name,
        flag: flagForLang(l.code),
      }));
    }
  } catch {
    // Keep the fallback list — the picker stays usable even if the API is
    // briefly unreachable.
  } finally {
    languagesLoading.value = false;
  }
}

async function loadTwin(): Promise<void> {
  if (!twinId.value) return;
  chatStore.setTwinContext(twinId.value);
  try {
    await aiTwinsStore.fetchOne(twinId.value);
  } catch {
    // store.error renders into the empty fallback below.
  }
}

watch(twinId, loadTwin);

function autoSize(): void {
  const el = composer.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
}

watch(draft, () => nextTick(autoSize));

function scrollToBottom(): void {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}

watch(
  () => messages.value.length,
  () => {
    scrollToBottom();
    // Preload duration for any user voice notes so their bubble shows the
    // real length without forcing the listener to hit play first.
    for (const m of messages.value) {
      if (m.role === 'user' && m.serverId && isDirectAudioUrl(m.audioUrl)) {
        preloadAudioDuration(m.serverId, m.audioUrl);
      }
    }
  },
);

watch(
  () => messages.value.map((m) => m.text).join('|'),
  () => scrollToBottom()
);

async function send(text?: string): Promise<void> {
  const value = (text ?? draft.value).trim();
  if (!value || sending.value) return;
  draft.value = '';
  await nextTick(autoSize);
  await chatStore.sendMessage(value);
}

function onComposerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

function newConversation(): void {
  chatStore.resetConversation();
  draft.value = '';
  nextTick(() => composer.value?.focus());
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push({ name: 'ai-twins' });
  }
}

async function copyMessage(m: ChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(m.text);
    notify.success(t.copied);
  } catch {
    notify.error('Copy failed');
  }
}

// ─── Voice recording ────────────────────────────────────────────────────────
const isRecording = ref(false);
const recordingSeconds = ref(0);
const processingVoice = ref(false);
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordingStream: MediaStream | null = null;
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordingCancelled = false;

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((tp) => MediaRecorder.isTypeSupported(tp)) ?? '';
}

function formatRecordingClock(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function stopRecordingStream(): void {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
}

async function startRecording(): Promise<void> {
  if (isRecording.value || sending.value) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    notify.error('Recording not supported', 'Your browser cannot record audio.');
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    notify.error(
      'Microphone unavailable',
      e?.name === 'NotAllowedError'
        ? 'Permission denied. Allow microphone access and try again.'
        : e?.message ?? 'Could not access the microphone.',
    );
    return;
  }

  const mimeType = pickRecorderMimeType();
  recordedChunks = [];
  recordingCancelled = false;
  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(recordingStream, { mimeType })
      : new MediaRecorder(recordingStream);
  } catch {
    stopRecordingStream();
    notify.error('Recording failed', 'Could not initialize the recorder.');
    return;
  }

  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
    stopRecordingStream();
    mediaRecorder = null;
    isRecording.value = false;
    if (recordingCancelled || blob.size === 0) {
      recordingSeconds.value = 0;
      return;
    }
    submitVoiceMessage(blob).finally(() => {
      recordingSeconds.value = 0;
    });
  };

  mediaRecorder.start();
  isRecording.value = true;
  recordingSeconds.value = 0;
  playRecordStartChime();
  recordingTimer = setInterval(() => {
    recordingSeconds.value += 1;
    if (recordingSeconds.value >= 600) stopRecording();
  }, 1000);
}

function stopRecording(): void {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  playRecordStopChime();
  try {
    mediaRecorder.stop();
  } catch {
    stopRecordingStream();
    isRecording.value = false;
  }
}

function cancelRecording(): void {
  if (!mediaRecorder) return;
  recordingCancelled = true;
  playRecordStopChime();
  try {
    mediaRecorder.stop();
  } catch {
    stopRecordingStream();
    isRecording.value = false;
    recordingSeconds.value = 0;
  }
}

async function submitVoiceMessage(blob: Blob): Promise<void> {
  processingVoice.value = true;
  try {
    await chatStore.sendVoice(blob);
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const message =
      e?.response?.data?.message ??
      (status === 413
        ? 'Recording is too large (max 10 MB).'
        : status === 502
          ? 'Voice transcription service is temporarily unavailable.'
          : e?.message ?? 'Could not send voice message.');
    notify.error('Voice message failed', message);
  } finally {
    processingVoice.value = false;
  }
}

// ─── Audio playback (TTS for assistant + user voice notes) ─────────────────
interface MessageAudioState {
  loading: boolean;
  playing: boolean;
  url: string | null;
  audio: HTMLAudioElement | null;
  duration: number;
  currentTime: number;
}
const messageAudio = ref<Record<string, MessageAudioState>>({});

function ensureAudioState(id: string): MessageAudioState {
  if (!messageAudio.value[id]) {
    messageAudio.value[id] = {
      loading: false,
      playing: false,
      url: null,
      audio: null,
      duration: 0,
      currentTime: 0,
    };
  }
  return messageAudio.value[id];
}

function isDirectAudioUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return (
    url.startsWith('blob:') ||
    url.startsWith('http') ||
    url.startsWith('data:') ||
    url.startsWith('/')
  );
}

// Probe metadata only — keeps the bubble's duration accurate before the user
// hits play, matching the chat-history view.
function preloadAudioDuration(id: string, url: string): void {
  const state = ensureAudioState(id);
  if (state.duration > 0 || state.audio) return;
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = url;
  probe.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(probe.duration)) state.duration = probe.duration;
  });
}

function stopAllAudio(): void {
  Object.values(messageAudio.value).forEach((state) => {
    if (state.audio && state.playing) {
      state.audio.pause();
      state.playing = false;
    }
  });
}

function attachAudioListeners(state: MessageAudioState): void {
  const audio = state.audio;
  if (!audio) return;
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) state.duration = audio.duration;
  });
  audio.addEventListener('timeupdate', () => {
    state.currentTime = audio.currentTime;
  });
  audio.addEventListener('ended', () => {
    state.playing = false;
    state.currentTime = 0;
  });
  audio.addEventListener('pause', () => {
    if (audio.currentTime >= audio.duration) state.playing = false;
  });
}

function formatAudioClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function toggleMessageAudio(message: ChatMessage): Promise<void> {
  if (!message.serverId) return;
  const state = ensureAudioState(message.serverId);
  if (state.playing && state.audio) {
    state.audio.pause();
    state.playing = false;
    return;
  }
  stopAllAudio();
  try {
    if (!state.url) {
      if (isDirectAudioUrl(message.audioUrl)) {
        state.url = message.audioUrl;
      } else {
        state.loading = true;
        const blob = await chatStore.loadMessageAudio(message.serverId);
        state.url = URL.createObjectURL(blob);
      }
    }
    if (!state.audio) {
      state.audio = new Audio(state.url);
      attachAudioListeners(state);
    }
    await state.audio.play();
    state.playing = true;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const fallback =
      status === 404
        ? 'Audio for this message could not be found.'
        : status === 502
          ? 'Voice synthesis is temporarily unavailable.'
          : e?.message ?? 'Could not play audio.';
    notify.error('Playback failed', e?.response?.data?.message ?? fallback);
  } finally {
    state.loading = false;
  }
}

function disposeAllAudio(): void {
  Object.values(messageAudio.value).forEach((state) => {
    if (state.audio) {
      state.audio.pause();
      state.audio.src = '';
    }
    if (state.url) URL.revokeObjectURL(state.url);
  });
  messageAudio.value = {};
}

watch(twinId, () => {
  disposeAllAudio();
  if (isRecording.value) cancelRecording();
});

function startVoiceCall(): void {
  if (!twinId.value) return;
  const href = router.resolve({
    name: 'call',
    params: { twinId: twinId.value },
  }).href;
  window.open(href, '_blank', 'noopener');
}

function setLanguage(next: ChatLang): void {
  chatStore.setLanguage(next);
  langOpen.value = false;
}

function onLangButtonBlur(e: FocusEvent): void {
  // Close the popover if focus moves outside the trigger + popover.
  const next = e.relatedTarget as Node | null;
  const root = (e.currentTarget as HTMLElement).closest('[data-lang-root]');
  if (!root || !next || !root.contains(next)) {
    langOpen.value = false;
  }
}

function onDocumentClick(e: MouseEvent): void {
  if (!langOpen.value) return;
  const root = (e.target as Element)?.closest('[data-lang-root]');
  if (!root) langOpen.value = false;
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  autoSize();
  loadTwin();
  loadLanguages();
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  disposeAllAudio();
  if (isRecording.value) cancelRecording();
  stopRecordingStream();
});

const currentLang = computed<LangPickerOption>(() => {
  const list = languageOptions.value;
  return (
    list.find((l) => l.code === lang.value) ??
    FALLBACK_LANG_OPTIONS.find((l) => l.code === lang.value) ??
    list[0] ??
    FALLBACK_LANG_OPTIONS[0]
  );
});

interface Group {
  label: string;
  items: ChatMessage[];
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return t.today;
  if (sameDay(d, yesterday)) return t.yesterday;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const groupedMessages = computed<Group[]>(() => {
  const groups: Group[] = [];
  for (const m of messages.value) {
    const label = dayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(m);
    } else {
      groups.push({ label, items: [m] });
    }
  }
  return groups;
});

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="chat-shell flex h-[100dvh] min-h-0 w-full flex-col bg-surface">
    <ChatPageSkeleton v-if="showTwinSkeleton" />

    <section v-else-if="showTwinError" class="flex h-full min-h-0 flex-col items-center justify-center bg-surface px-6">
      <EmptyState
        :icon="BubbleChatIcon"
        :title="tt('chat.twinLoadError', 'Could not load this AI Twin')"
        :description="twinError ?? tt('common.tryAgain', 'Please try again.')"
      >
        <div class="flex items-center gap-2">
          <BaseButton variant="outline" @click="goBack">
            {{ tt('common.back', 'Back') }}
          </BaseButton>
          <BaseButton variant="primary" :loading="twinLoading" @click="loadTwin">
            {{ tt('common.retry', 'Retry') }}
          </BaseButton>
        </div>
      </EmptyState>
    </section>

    <section v-else class="flex h-full min-h-0 flex-col bg-surface">
      <!-- Top bar -->
      <header
        class="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-6 py-4"
      >
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-full bg-surface-muted p-2 text-text-muted transition hover:bg-surface-subtle hover:text-text"
            :aria-label="tt('common.goBack', 'Go back')"
            @click="goBack"
          >
            <Icon :icon="ArrowLeft01Icon" :size="18" />
          </button>
          <template v-if="twinId">
            <BaseAvatar
              :src="twin?.profilePicUrl ?? ''"
              :name="twin?.name ?? 'AI Twin'"
              size="md"
              badge="online"
            />
            <div class="min-w-0">
              <p class="truncate text-title text-text">{{ twin?.name ?? 'AI Twin' }}</p>
              <p class="truncate text-meta text-text-muted">
                {{ t.subgreeting.split('.')[0] }}
              </p>
            </div>
          </template>
          <template v-else>
            <p class="text-title text-text">Chat</p>
          </template>
        </div>

        <div class="flex items-center gap-2">
          <!-- Language switcher -->
          <div class="relative" data-lang-root>
            <button
              ref="langButton"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1.5 text-body font-medium text-text transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              :aria-label="t.langLabel"
              :aria-expanded="langOpen"
              aria-haspopup="listbox"
              @click="langOpen = !langOpen"
              @blur="onLangButtonBlur"
            >
              <img
                :src="flagUrl(currentLang.flag)"
                :alt="currentLang.label"
                class="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border"
                loading="lazy"
              />
              <span class="px-1 text-meta uppercase tracking-wide text-text-muted">{{ currentLang.code }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3 transition-transform" :class="langOpen && 'rotate-180'" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <ul
              v-if="langOpen"
              role="listbox"
              class="absolute right-0 top-full z-20 mt-2 max-h-80 w-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
            >
              <li v-if="languagesLoading && languageOptions.length === 0" class="px-3 py-2 text-sm text-text-subtle">
                Loading languages…
              </li>
              <li v-for="opt in languageOptions" :key="opt.code" role="option" :aria-selected="opt.code === lang">
                <button
                  type="button"
                  :class="[
                    'flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition',
                    opt.code === lang ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50',
                  ]"
                  @click="setLanguage(opt.code)"
                >
                  <span class="flex min-w-0 items-center gap-2.5">
                    <img
                      :src="flagUrl(opt.flag)"
                      :alt="opt.label"
                      class="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                      loading="lazy"
                    />
                    <span class="truncate font-medium">{{ opt.label }}</span>
                  </span>
                  <span
                    :class="[
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                      opt.code === lang ? 'border-accent bg-accent text-white' : 'border-slate-300',
                    ]"
                    aria-hidden="true"
                  >
                    <span v-if="opt.code === lang" class="block h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <BaseButton
            v-if="twin"
            variant="outline"
            size="md"
            rounded="full"
            @click="newConversation"
          >
            <Icon :icon="BubbleChatIcon" :size="16" />
            {{ t.newChat }}
          </BaseButton>

          <button
            v-if="twin"
            type="button"
            class="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-surface-inverse px-4 text-sm font-semibold text-text-inverse transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            :aria-label="t.call.startCall"
            :title="t.call.startCall"
            @click="startVoiceCall"
          >
            <Icon :icon="CallIcon" :size="16" />
            <span>{{ t.call.startCall }}</span>
          </button>
        </div>
      </header>

      <!-- Body -->
      <div class="flex min-h-0 flex-1 flex-col">
        <!-- No twin selected -->
        <EmptyState
          v-if="!twinId"
          :icon="BubbleChatIcon"
          :title="t.pickTwinTitle"
          :description="t.pickTwinDescription"
        >
          <BaseButton variant="primary" @click="router.push({ name: 'ai-twins' })">
            {{ t.pickTwinAction }}
          </BaseButton>
        </EmptyState>

        <!-- Greeting (twin selected, no messages yet) -->
        <div
          v-else-if="messages.length === 0"
          class="flex min-h-0 flex-1 flex-col px-6 py-6"
        >
          <div class="mx-auto flex w-full max-w-3xl">
            <div class="flex gap-3">
              <BaseAvatar
                :src="twin?.profilePicUrl ?? ''"
                :name="twin?.name ?? 'AI Twin'"
                size="sm"
              />
              <div class="flex max-w-[80%] flex-col items-start">
                <div class="rounded-2xl bg-surface-muted px-5 py-3 text-body text-text shadow-card">
                  <p class="whitespace-pre-wrap leading-relaxed">
                    {{ twin?.chatGreeting?.trim() || t.greeting }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Active conversation -->
        <div
          v-else
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 scrollbar-thin"
        >
          <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
            <template v-for="group in groupedMessages" :key="group.label">
              <div class="flex items-center justify-center">
                <span
                  class="rounded-full bg-surface-muted px-3 py-1 text-meta font-medium text-text-muted"
                >
                  {{ group.label }}
                </span>
              </div>
              <div
                v-for="m in group.items"
                :key="m.id"
                :class="[
                  'flex gap-3',
                  m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                ]"
              >
                <BaseAvatar
                  v-if="m.role === 'assistant'"
                  :src="twin?.profilePicUrl ?? ''"
                  :name="twin?.name ?? 'AI Twin'"
                  size="sm"
                />
                <div
                  :class="[
                    'group flex max-w-[80%] flex-col',
                    m.role === 'user' ? 'items-end' : 'items-start',
                  ]"
                >
                  <div
                    v-if="m.role === 'user' && m.audioUrl && m.serverId"
                    class="flex min-w-[16rem] items-center gap-3 rounded-full bg-accent px-3 py-2.5 text-text-inverse shadow-card"
                  >
                    <button
                      type="button"
                      class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-50"
                      :aria-label="messageAudio[m.serverId]?.playing ? 'Pause voice note' : 'Play voice note'"
                      :disabled="messageAudio[m.serverId]?.loading"
                      @click="toggleMessageAudio(m)"
                    >
                      <span
                        v-if="messageAudio[m.serverId]?.loading"
                        class="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                        aria-hidden="true"
                      />
                      <Icon
                        v-else-if="messageAudio[m.serverId]?.playing"
                        :icon="PauseIcon"
                        :size="18"
                      />
                      <Icon v-else :icon="PlayIcon" :size="18" />
                    </button>
                    <span class="flex h-9 flex-1 items-center gap-[3px]" aria-hidden="true">
                      <span
                        v-for="(h, i) in VOICE_WAVE_HEIGHTS"
                        :key="i"
                        class="w-[3px] rounded-full bg-white/85"
                        :style="{ height: `${h}%` }"
                      />
                    </span>
                    <span class="shrink-0 text-sm font-bold tabular-nums text-white">
                      {{ formatAudioClock(messageAudio[m.serverId]?.duration ?? 0) }}
                    </span>
                  </div>
                  <div
                    v-else
                    :class="[
                      'rounded-2xl px-5 py-3 text-body shadow-card',
                      m.role === 'user'
                        ? 'bg-accent text-text-inverse'
                        : 'bg-surface-muted text-text',
                    ]"
                  >
                    <span v-if="m.streaming && !m.text" class="inline-flex items-center gap-1">
                      <span class="dot" />
                      <span class="dot" style="animation-delay: 0.15s" />
                      <span class="dot" style="animation-delay: 0.3s" />
                    </span>
                    <ChatMessageBody v-else :text="m.text" :lang="m.lang" :role="m.role" />
                  </div>
                  <div
                    :class="[
                      'mt-1 flex items-center gap-1 text-meta text-text-subtle',
                      m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                    ]"
                  >
                    <span>{{ formatTime(m.createdAt) }}</span>
                    <template v-if="m.role === 'assistant' && !m.streaming">
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        class="rounded p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                        :aria-label="t.copy"
                        :title="t.copy"
                        @click="copyMessage(m)"
                      >
                        <Icon :icon="Copy01Icon" :size="14" />
                      </button>
                      <template v-if="m.serverId">
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded p-1 text-text-subtle transition hover:bg-surface-muted hover:text-text disabled:opacity-50"
                          :aria-label="messageAudio[m.serverId]?.playing ? 'Pause audio' : 'Listen to message'"
                          :disabled="messageAudio[m.serverId]?.loading"
                          @click="toggleMessageAudio(m)"
                        >
                          <span
                            v-if="messageAudio[m.serverId]?.loading"
                            class="block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                            aria-hidden="true"
                          />
                          <Icon
                            v-else-if="messageAudio[m.serverId]?.playing"
                            :icon="PauseIcon"
                            :size="13"
                          />
                          <Icon v-else :icon="VolumeHighIcon" :size="13" />
                          <span>{{ messageAudio[m.serverId]?.playing ? 'Playing' : 'Listen' }}</span>
                        </button>
                      </template>
                    </template>
                  </div>
                </div>
              </div>
            </template>

            <div
              v-if="processingVoice"
              class="flex items-start justify-end gap-3"
              role="status"
              aria-live="polite"
              aria-label="Sending voice and waiting for a reply"
            >
              <div class="flex flex-col items-end gap-1">
                <div class="rounded-2xl bg-accent px-5 py-3 text-text-inverse shadow-card">
                  <span class="inline-flex items-center gap-1">
                    <span class="dot" />
                    <span class="dot" style="animation-delay: 0.15s" />
                    <span class="dot" style="animation-delay: 0.3s" />
                  </span>
                </div>
                <span class="text-meta text-text-subtle">Sending your voice note…</span>
              </div>
            </div>

            <div ref="messagesEnd" />
          </div>
        </div>
      </div>

      <!-- Composer -->
      <footer
        v-if="twinId"
        class="border-t border-border-subtle bg-surface px-6 py-4"
      >
        <div class="mx-auto w-full max-w-3xl">
          <div
            v-if="!isRecording"
            class="flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-card transition focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20"
          >
            <textarea
              ref="composer"
              v-model="draft"
              rows="1"
              :placeholder="t.placeholder"
              :disabled="sending"
              class="composer-input flex-1 resize-none bg-transparent px-2 py-2 text-body leading-6 text-text outline-none placeholder:text-text-subtle disabled:cursor-not-allowed"
              @keydown="onComposerKeydown"
              @input="autoSize"
            />
            <button
              type="button"
              class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="t.micAria"
              :title="t.micAria"
              :disabled="sending"
              @click="startRecording"
            >
              <Icon :icon="Mic01Icon" :size="22" />
            </button>
            <button
              type="button"
              class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="t.sendAria"
              :title="t.sendAria"
              :disabled="!draft.trim() || sending"
              @click="send()"
            >
              <Icon :icon="SentIcon" :size="20" />
            </button>
          </div>

          <div
            v-else
            class="recorder-bar flex items-center gap-3 rounded-3xl border border-border bg-surface px-3 py-2 shadow-card"
            role="status"
            aria-live="polite"
          >
            <span class="recorder-led" aria-hidden="true">
              <span class="recorder-led__core" />
              <span class="recorder-led__halo" />
            </span>

            <span class="shrink-0 text-body font-semibold tabular-nums text-text">
              {{ formatRecordingClock(recordingSeconds) }}
            </span>

            <span class="recorder-wave flex h-7 flex-1 items-center justify-center gap-[3px]" aria-hidden="true">
              <span
                v-for="i in 48"
                :key="i"
                class="recorder-wave__bar"
                :style="{ animationDelay: `${(i % 8) * 140}ms` }"
              />
            </span>

            <button
              type="button"
              class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-caption font-semibold text-text-muted transition hover:bg-surface-muted hover:text-text"
              aria-label="Cancel recording"
              @click="cancelRecording"
            >
              <Icon :icon="Cancel01Icon" :size="14" />
              Cancel
            </button>
            <button
              type="button"
              class="group inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-body font-semibold text-text-inverse shadow-md transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label="Stop and send recording"
              @click="stopRecording"
            >
              <Icon :icon="SentIcon" :size="16" />
              Send
            </button>
          </div>

          <p class="mt-2 text-center text-caption text-text-subtle">
            {{ t.disclaimer }}
          </p>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.composer-input {
  max-height: 12rem;
}
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: currentColor;
  opacity: 0.55;
  animation: pulse-dot 1.1s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 80%, 100% {
    transform: scale(0.7);
    opacity: 0.35;
  }
  40% {
    transform: scale(1);
    opacity: 0.95;
  }
}

/* ===== Voice recorder ===== */
.recorder-led {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 12px;
  height: 12px;
  margin-left: 4px;
  flex-shrink: 0;
}
.recorder-led__core {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18);
  animation: recorder-led-pulse 1.4s ease-in-out infinite;
}
.recorder-led__halo {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: rgba(239, 68, 68, 0.45);
  animation: recorder-led-halo 1.8s ease-out infinite;
}
@keyframes recorder-led-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.8); }
}
@keyframes recorder-led-halo {
  0% { transform: scale(0.8); opacity: 0.5; }
  100% { transform: scale(2.2); opacity: 0; }
}
.recorder-wave {
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
}
.recorder-wave__bar {
  flex: 0 0 auto;
  width: 3px;
  border-radius: 2px;
  background: var(--color-text-muted, #9ca3af);
  opacity: 0.55;
  animation: recorder-wave-bar 1.8s ease-in-out infinite;
  height: 22%;
}
@keyframes recorder-wave-bar {
  0%, 100% { height: 18%; opacity: 0.4; }
  25%      { height: 45%; opacity: 0.7; }
  50%      { height: 28%; opacity: 0.55; }
  75%      { height: 55%; opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .recorder-led__core,
  .recorder-led__halo,
  .recorder-wave__bar {
    animation: none;
  }
  .recorder-wave__bar {
    height: 50%;
    opacity: 0.7;
  }
}
</style>
