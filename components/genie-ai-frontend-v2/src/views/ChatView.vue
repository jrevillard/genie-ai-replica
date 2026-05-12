<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import NProgress from 'nprogress';
import {
  ArrowLeft01Icon,
  BookOpen01Icon,
  BubbleChatIcon,
  CallIcon,
  Cancel01Icon,
  Copy01Icon,
  LinkSquare01Icon,
  Mic01Icon,
  PauseIcon,
  PlayIcon,
  SentIcon,
  SparklesIcon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons';

import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import ChatMessageBody from '../components/chat/ChatMessageBody.vue';
import ChatPageSkeleton from '../components/ui/skeletons/ChatPageSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import { chatStrings, flagForLang, flagUrl, type ChatLang } from '../lib/chatStrings';
import {
  getChatLanguages,
  getPublicSuggestedQuestions,
  type ChatLanguage,
  type SuggestedQuestion,
} from '../services/chatSessions';
import { playRecordStartChime, playRecordStopChime } from '../lib/chimes';
import { notify } from '../lib/notify';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useAuthStore } from '../stores/auth';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { useTranslationStore } from '../stores/translation';
import { useVoiceCatalogStore } from '../stores/voiceCatalog';
import { useT } from '../i18n/composables';

const { t: tt, locale } = useT();

const route = useRoute();
const router = useRouter();

const aiTwinsStore = useAiTwinsStore();
const authStore = useAuthStore();
const chatStore = useChatStore();
const translationStore = useTranslationStore();
const voiceCatalogStore = useVoiceCatalogStore();

// Auth gate: when an unauthenticated visitor opens the chat (e.g. via a shared
// link), prompt them to sign in or explicitly continue as a guest before
// kicking off any session/twin loads. The choice is stickied in sessionStorage
// so a reload within the same tab doesn't re-prompt.
const GUEST_ACCEPTED_KEY = 'genie.chat.guestAccepted';
const guestAccepted = ref<boolean>(
  typeof sessionStorage !== 'undefined' && sessionStorage.getItem(GUEST_ACCEPTED_KEY) === '1'
);
const showAuthGate = computed(() => !authStore.isAuthenticated && !guestAccepted.value);
const loggingIn = ref(false);

function chooseLogin(): void {
  if (loggingIn.value) return;
  loggingIn.value = true;
  // Kick the top-of-page progress bar synchronously on click so the feedback
  // appears the instant the button is pressed (the router guard would also
  // start it, but only after `router.push` resolves async).
  NProgress.start();
  router.push({ name: 'signin', query: { redirect: route.fullPath } }).catch(() => {
    // Guard rejection, duplicate nav, or signin chunk failed to load — bring
    // the UI back to a clean state so the user can retry.
    NProgress.done();
    loggingIn.value = false;
  });
}

function chooseGuest(): void {
  try {
    sessionStorage.setItem(GUEST_ACCEPTED_KEY, '1');
  } catch {
    // sessionStorage unavailable (private mode) — fall back to in-memory only.
  }
  guestAccepted.value = true;
  loadTwin();
  loadLanguages();
  loadSuggestedQuestions();
}

// Mid-session sign-out (e.g. user logs out from another tab while the chat
// page is open): the chat store's sessionId was created against the now-stale
// JWT and the next send would 401. Drop the conversation and re-show the gate
// so the user can choose between logging back in or continuing as guest.
watch(
  () => authStore.isAuthenticated,
  (isAuthed, wasAuthed) => {
    if (wasAuthed && !isAuthed) {
      chatStore.resetConversation();
      try {
        sessionStorage.removeItem(GUEST_ACCEPTED_KEY);
      } catch {
        // best-effort — falls through to in-memory clear below.
      }
      guestAccepted.value = false;
    }
  }
);

// All chat content (greeting, suggested questions) is authored in English.
// The selected ChatLang is the target.
const CHAT_SOURCE_LANG = 'en';
const {
  current: twin,
  loading: twinLoading,
  error: twinError,
  publicTwins,
} = storeToRefs(aiTwinsStore);
const { messages, sending, lang, restoring } = storeToRefs(chatStore);

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
  // Optional — only the API payload carries this. The fallback list has no
  // way to know, so it defaults to `undefined` and we treat that as "allowed"
  // to avoid blocking calls when the API is offline.
  isVoiceSupported?: boolean;
}

// The languages API (`GET /public/chat-sessions/languages`) is the sole source
// of truth — it controls which codes are exposed AND which carry voice
// support. The picker starts empty and renders only what the server actually
// serves; the offline fallback (below) is a one-entry safety net so a fetch
// failure doesn't leave the picker unusable.
const OFFLINE_LANG_FALLBACK: LangPickerOption[] = [
  { code: 'en', label: 'English', flag: flagForLang('en') },
];

const languageOptions = ref<LangPickerOption[]>([]);
const languagesLoading = ref(false);
const suggestedQuestions = ref<SuggestedQuestion[]>([]);
const suggestedQuestionsLoading = ref(false);
interface MessageTranslationState {
  isTranslated: boolean;
  showOriginal: boolean;
  loading: boolean;
  canTranslate: boolean;
}
interface ChatMessageBodyExposed {
  toggleTranslation: () => void;
}
const messageTranslationStates = ref<Record<string, MessageTranslationState>>({});
const messageBodyRefs = ref<Record<string, ChatMessageBodyExposed | null>>({});

async function loadLanguages(): Promise<void> {
  languagesLoading.value = true;
  try {
    const list: ChatLanguage[] = await getChatLanguages();
    if (list.length > 0) {
      languageOptions.value = list.map((l) => ({
        code: l.code,
        label: l.name,
        flag: flagForLang(l.code),
        isVoiceSupported: l.isVoiceSupported,
      }));
    } else {
      languageOptions.value = OFFLINE_LANG_FALLBACK;
    }
  } catch {
    // Fall back to a single-entry list so the picker stays usable if the
    // languages endpoint is briefly unreachable.
    if (languageOptions.value.length === 0) {
      languageOptions.value = OFFLINE_LANG_FALLBACK;
    }
  } finally {
    languagesLoading.value = false;
  }
}

async function loadSuggestedQuestions(): Promise<void> {
  if (!twinId.value) {
    suggestedQuestions.value = [];
    return;
  }
  suggestedQuestionsLoading.value = true;
  try {
    suggestedQuestions.value = await getPublicSuggestedQuestions(twinId.value);
  } catch {
    suggestedQuestions.value = [];
  } finally {
    suggestedQuestionsLoading.value = false;
  }
}

const rawSuggestedQuestions = computed(() => suggestedQuestions.value.slice(0, 3));

// Reactive translation of the welcome screen (greeting + suggested questions)
// into the selected chat content language. The source data is English; we
// route through the translation store so calls are batched + cached.
const greetingSource = computed<string>(() => {
  const fromTwin = twin.value?.chatGreeting?.trim();
  return fromTwin && fromTwin.length > 0 ? fromTwin : t.greeting;
});

const greetingDisplay = computed<string>(() => {
  const src = greetingSource.value;
  const target = lang.value;
  if (!src || target === CHAT_SOURCE_LANG) return src;
  return translationStore.peek(src, CHAT_SOURCE_LANG, target) ?? src;
});

const visibleSuggestedQuestions = computed(() =>
  rawSuggestedQuestions.value.map((q) => {
    const target = lang.value;
    if (target === CHAT_SOURCE_LANG) {
      return { ...q, displayContent: q.content, displayCategory: q.category };
    }
    return {
      ...q,
      displayContent: translationStore.peek(q.content, CHAT_SOURCE_LANG, target) ?? q.content,
      displayCategory: translationStore.peek(q.category, CHAT_SOURCE_LANG, target) ?? q.category,
    };
  })
);

// Synchronous "not ready" flags derived from the translation cache. Computed
// so they flip the instant `lang` changes — no async race window between the
// language switch and the fetch watcher firing, which would otherwise let a
// user click a card showing fallback English text and send the wrong language.
const greetingNotReady = computed<boolean>(() => {
  const src = greetingSource.value;
  const target = lang.value;
  if (!src || target === CHAT_SOURCE_LANG) return false;
  return translationStore.peek(src, CHAT_SOURCE_LANG, target) === undefined;
});

const suggestedNotReady = computed<boolean>(() => {
  const target = lang.value;
  if (target === CHAT_SOURCE_LANG) return false;
  return rawSuggestedQuestions.value.some(
    (q) =>
      (q.content && translationStore.peek(q.content, CHAT_SOURCE_LANG, target) === undefined) ||
      (q.category && translationStore.peek(q.category, CHAT_SOURCE_LANG, target) === undefined)
  );
});

watch(
  [greetingSource, lang],
  ([src, target]) => {
    if (!src || target === CHAT_SOURCE_LANG) return;
    if (translationStore.peek(src, CHAT_SOURCE_LANG, target) !== undefined) return;
    translationStore.getOne(src, CHAT_SOURCE_LANG, target).catch(() => {
      // Falls back to source via greetingDisplay.
    });
  },
  { immediate: true }
);

watch(
  [rawSuggestedQuestions, lang],
  ([list, target]) => {
    if (target === CHAT_SOURCE_LANG || list.length === 0) return;
    const missing: string[] = [];
    for (const q of list) {
      if (q.content && translationStore.peek(q.content, CHAT_SOURCE_LANG, target) === undefined) {
        missing.push(q.content);
      }
      if (q.category && translationStore.peek(q.category, CHAT_SOURCE_LANG, target) === undefined) {
        missing.push(q.category);
      }
    }
    if (missing.length === 0) return;
    Promise.all(
      missing.map((text) => translationStore.getOne(text, CHAT_SOURCE_LANG, target))
    ).catch(() => {
      // Cards fall back to English on failure.
    });
  },
  { immediate: true }
);

async function loadTwin(): Promise<void> {
  if (!twinId.value) {
    // Visitor arrived on `/chat` without picking a twin (typical guest flow).
    // Fetch the public twin catalog so we can render a picker instead of a
    // dead-end empty state with an admin-only CTA.
    void loadPublicTwinsForPicker();
    return;
  }
  chatStore.setTwinContext(twinId.value);
  // Resume the prior conversation for this twin if one was persisted (page
  // reload, back-nav). No-op if no stored session or it's no longer valid.
  void chatStore.restoreSessionForTwin(twinId.value);
  try {
    await aiTwinsStore.fetchOne(twinId.value);
  } catch {
    // store.error renders into the empty fallback below.
  }
}

const publicTwinsLoading = ref(false);
async function loadPublicTwinsForPicker(): Promise<void> {
  // Cache across renders: only fetch once unless the list comes back empty
  // (e.g. transient network failure on a previous attempt).
  if (publicTwinsLoading.value || publicTwins.value.length > 0) return;
  publicTwinsLoading.value = true;
  try {
    await aiTwinsStore.fetchAllPublic({ limit: 24 });
  } catch {
    // The picker renders an inline retry button against this empty list.
  } finally {
    publicTwinsLoading.value = false;
  }
}

function pickTwin(picked: { _key: string }): void {
  router.push({ name: 'chat', params: { twinId: picked._key } });
}

watch(twinId, () => {
  loadTwin();
  // Suggested questions are per-twin now, so re-fetch on twin switch.
  void loadSuggestedQuestions();
});

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
  () => scrollToBottom(),
);

// Preload duration for any user voice notes so their bubble shows the real
// length without forcing the listener to hit play first. Watching the
// audioUrl per message id (not just length) catches the post-send case where
// the optimistic placeholder gets its blob URL set in-place — that mutation
// doesn't change `messages.length`.
watch(
  () => messages.value
    .filter((m) => m.role === 'user')
    .map((m) => `${m.id}|${m.audioUrl ?? ''}`)
    .join(','),
  () => {
    for (const m of messages.value) {
      if (m.role === 'user' && isDirectAudioUrl(m.audioUrl)) {
        preloadAudioDuration(m.id, m.audioUrl);
      }
    }
  },
  { immediate: true },
);

watch(
  () => messages.value.map((m) => m.text).join('|'),
  () => scrollToBottom()
);

watch(
  () => messages.value.map((m) => m.id),
  (ids) => {
    const active = new Set(ids);
    Object.keys(messageTranslationStates.value).forEach((id) => {
      if (!active.has(id)) delete messageTranslationStates.value[id];
    });
    Object.keys(messageBodyRefs.value).forEach((id) => {
      if (!active.has(id)) delete messageBodyRefs.value[id];
    });
  }
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
    notify.success(tt('chat.copied', t.copied));
  } catch {
    notify.error(tt('chat.copyFailed', 'Copy failed'));
  }
}

// ─── Voice recording ────────────────────────────────────────────────────────
const isRecording = ref(false);
const recordingSeconds = ref(0);
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
    notify.error(
      tt('chat.voiceUnsupportedTitle', 'Recording not supported'),
      tt('chat.voiceUnsupportedBody', 'Your browser cannot record audio.'),
    );
    return;
  }
  // Stop any AI response that's currently playing — the mic chime + recording
  // shouldn't overlap a playing message.
  stopAllAudio();
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    notify.error(
      tt('chat.micUnavailableTitle', 'Microphone unavailable'),
      e?.name === 'NotAllowedError'
        ? tt('chat.micPermissionDenied', 'Permission denied. Allow microphone access and try again.')
        : e?.message ?? tt('chat.micGenericError', 'Could not access the microphone.'),
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
    notify.error(
      tt('chat.recordingFailedTitle', 'Recording failed'),
      tt('chat.recordingFailedBody', 'Could not initialize the recorder.'),
    );
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
  // Build a local blob URL so the user's voice-note bubble can render
  // instantly with its real duration, instead of waiting for the upload +
  // server response to populate `audioUrl`. disposeAllAudio revokes
  // state.url on twin change once the bubble's audio state seeds it.
  const localAudioUrl = URL.createObjectURL(blob);
  try {
    await chatStore.sendVoice(blob, { localAudioUrl });
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const message =
      e?.response?.data?.message ??
      (status === 413
        ? tt('chat.voiceTooLarge', 'Recording is too large (max 10 MB).')
        : status === 502
          ? tt('chat.voiceServiceUnavailable', 'Voice transcription service is temporarily unavailable.')
          : e?.message ?? tt('chat.voiceGenericError', 'Could not send voice message.'));
    notify.error(tt('chat.voiceFailedTitle', 'Voice message failed'), message);
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
  // Seed state.url so disposeAllAudio revokes any locally-created blob URL
  // on twin change. For non-blob URLs revokeObjectURL is a no-op.
  if (!state.url && isDirectAudioUrl(url)) state.url = url;
  if (state.duration > 0 || state.audio) return;
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = url;
  // MediaRecorder webm blobs report `duration === Infinity` until the
  // browser is forced to scan the chunks. Seeking past the end triggers
  // a `durationchange` event with the real value.
  const apply = (): boolean => {
    if (Number.isFinite(probe.duration) && probe.duration > 0) {
      state.duration = probe.duration;
      return true;
    }
    return false;
  };
  const onDurationChange = (): void => {
    if (apply()) {
      probe.removeEventListener('durationchange', onDurationChange);
      try { probe.currentTime = 0; } catch { /* ignore */ }
    }
  };
  probe.addEventListener('loadedmetadata', () => {
    if (apply()) return;
    probe.addEventListener('durationchange', onDurationChange);
    try { probe.currentTime = Number.MAX_SAFE_INTEGER; } catch { /* ignore */ }
  });
}

// Tracks the message the user has *intended* to play. Anything else racing in
// the background (an earlier blob fetch that's still in flight) checks this
// before calling `.play()` and bails if the intent has moved on. Without this,
// rapid clicks on multiple messages can each finish their async load and call
// play(), producing overlapping audio.
const currentPlaybackId = ref<string | null>(null);

// Frame-locked progress tick. The browser's `timeupdate` event fires every
// ~250ms which makes the waveform fill jump in visible chunks. By reading
// `audio.currentTime` on every animation frame (and writing it onto reactive
// state), the progress flows smoothly at display refresh rate.
let progressRafId: number | null = null;
function startSmoothProgress(): void {
  if (progressRafId !== null) return;
  const tick = (): void => {
    const id = currentPlaybackId.value;
    if (!id) {
      progressRafId = null;
      return;
    }
    const state = messageAudio.value[id];
    if (!state?.playing || !state.audio) {
      progressRafId = null;
      return;
    }
    state.currentTime = state.audio.currentTime;
    progressRafId = requestAnimationFrame(tick);
  };
  progressRafId = requestAnimationFrame(tick);
}
function stopSmoothProgress(): void {
  if (progressRafId !== null) {
    cancelAnimationFrame(progressRafId);
    progressRafId = null;
  }
}

function stopAllAudio(): void {
  currentPlaybackId.value = null;
  stopSmoothProgress();
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
  // MediaRecorder webm blobs report `duration === Infinity` until the file
  // has been fully scanned. We only apply the seek workaround on the very
  // first metadata load, before playback begins, so it doesn't disturb the
  // listener once they've hit play.
  let durationResolved = false;
  const applyDuration = (): boolean => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      state.duration = audio.duration;
      durationResolved = true;
      return true;
    }
    return false;
  };
  const onDurationChange = (): void => {
    if (applyDuration()) {
      audio.removeEventListener('durationchange', onDurationChange);
      try { audio.currentTime = 0; } catch { /* ignore */ }
    }
  };
  audio.addEventListener('loadedmetadata', () => {
    if (applyDuration()) return;
    audio.addEventListener('durationchange', onDurationChange);
    try { audio.currentTime = Number.MAX_SAFE_INTEGER; } catch { /* ignore */ }
  });
  audio.addEventListener('timeupdate', () => {
    state.currentTime = audio.currentTime;
    if (!durationResolved) applyDuration();
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

// Continuous opacity for a voice-note waveform bar based on playback
// position. Replaces the previous tri-state (played/active/unplayed)
// approach so the fill flows smoothly across bars instead of stepping. Two
// bars on each side of the playhead crossfade between PLAYED_OPACITY and
// UNPLAYED_OPACITY, which — combined with the rAF tick that updates
// currentTime every frame — makes the fill feel liquid even at small
// playhead movements. When not playing, the whole wave reads at full
// opacity so the user can see the shape at rest.
const PLAYED_OPACITY = 1;
const UNPLAYED_OPACITY = 0.32;
const FADE_BARS = 1.6; // how many bars the soft edge spans

function voiceBarOpacity(
  serverId: string | undefined,
  index: number
): number {
  if (!serverId) return PLAYED_OPACITY;
  const state = messageAudio.value[serverId];
  if (!state || !state.playing) return PLAYED_OPACITY;
  const duration = state.duration;
  const current = state.currentTime;
  if (!Number.isFinite(duration) || duration <= 0) return UNPLAYED_OPACITY;
  const total = VOICE_WAVE_HEIGHTS.length;
  const playhead = (current / duration) * total;
  const distance = index - playhead; // negative = behind playhead (played)
  if (distance <= -FADE_BARS) return PLAYED_OPACITY;
  if (distance >= 0) return UNPLAYED_OPACITY;
  // Linear crossfade in the soft edge zone.
  const t = (distance + FADE_BARS) / FADE_BARS; // 0 at fully played, 1 at playhead
  return PLAYED_OPACITY - (PLAYED_OPACITY - UNPLAYED_OPACITY) * t;
}

function audioProgress(audioKey: string | undefined): number {
  if (!audioKey) return 0;
  const state = messageAudio.value[audioKey];
  if (!state) return 0;
  const { duration, currentTime } = state;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, currentTime / duration));
}

async function toggleMessageAudio(message: ChatMessage): Promise<void> {
  // Key state on m.id so user voice notes work the moment the placeholder is
  // pushed (server response not yet in). The serverId is only needed when we
  // have to fetch the audio bytes from the server (assistant TTS, or user
  // notes loaded from history without a direct URL).
  if (!isDirectAudioUrl(message.audioUrl) && !message.serverId) return;
  const stateKey = message.id;
  const state = ensureAudioState(stateKey);
  if (state.playing && state.audio) {
    state.audio.pause();
    state.playing = false;
    if (currentPlaybackId.value === stateKey) {
      currentPlaybackId.value = null;
      stopSmoothProgress();
    }
    return;
  }
  stopAllAudio();
  currentPlaybackId.value = stateKey;
  try {
    if (!state.url) {
      if (isDirectAudioUrl(message.audioUrl)) {
        state.url = message.audioUrl;
      } else if (message.serverId) {
        state.loading = true;
        const blob = await chatStore.loadMessageAudio(message.serverId);
        if (currentPlaybackId.value !== stateKey) return;
        state.url = URL.createObjectURL(blob);
      } else {
        return;
      }
    }
    if (currentPlaybackId.value !== stateKey) return;
    if (!state.audio) {
      state.audio = new Audio(state.url);
      attachAudioListeners(state);
    }
    await state.audio.play();
    if (currentPlaybackId.value !== stateKey) {
      state.audio.pause();
      return;
    }
    state.playing = true;
    startSmoothProgress();
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const fallback =
      status === 404
        ? tt('chat.audioNotFound', 'Audio for this message could not be found.')
        : status === 502
          ? tt('chat.audioServiceUnavailable', 'Voice synthesis is temporarily unavailable.')
          : e?.message ?? tt('chat.audioGenericError', 'Could not play audio.');
    notify.error(tt('chat.playbackFailedTitle', 'Playback failed'), e?.response?.data?.message ?? fallback);
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
  // Block the call when the currently selected chat language has no voice
  // pipeline on the backend. `isVoiceSupported === false` is the only refusal
  // signal — `undefined` (language missing from the API or fallback entry) is
  // treated as allowed so a transient API outage doesn't lock users out.
  const selected = languageOptions.value.find((l) => l.code === lang.value);
  if (selected && selected.isVoiceSupported === false) {
    notify.info(
      tt('chat.voiceLangUnsupportedTitle', 'Voice calls unavailable'),
      tt(
        'chat.voiceLangUnsupportedBody',
        `Calls aren't available in ${selected.label} yet. Pick a language that supports voice to start a call.`
      )
    );
    return;
  }
  router.push({ name: 'call', params: { twinId: twinId.value } });
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
  if (!showAuthGate.value) {
    loadTwin();
    loadLanguages();
    loadSuggestedQuestions();
  }
  // Loads the TTS voice catalog so the "Listen" button is only rendered for
  // languages the backend can actually synthesise. Cached across views.
  void voiceCatalogStore.ensureLoaded();
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  disposeAllAudio();
  if (isRecording.value) cancelRecording();
  stopRecordingStream();
});

const currentLang = computed<LangPickerOption>(() => {
  const list = languageOptions.value;
  // Order of resolution:
  //   1. Exact match in the API-loaded list (the normal case).
  //   2. First entry in the API list — if the chat store's selected lang isn't
  //      something the server serves, pick whatever it does serve.
  //   3. Synthesised placeholder from `lang.value` — only hit before the API
  //      response arrives so the picker header has something to render.
  return (
    list.find((l) => l.code === lang.value) ??
    list[0] ??
    {
      code: lang.value,
      label: lang.value.toUpperCase(),
      flag: flagForLang(lang.value),
    }
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
  if (sameDay(d, today)) return tt('chat.today', t.today);
  if (sameDay(d, yesterday)) return tt('chat.yesterday', t.yesterday);
  const localeTag = locale.value === 'mnk' ? 'en-GB' : locale.value;
  return d.toLocaleDateString(localeTag, {
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
  const localeTag = locale.value === 'mnk' ? 'en-GB' : locale.value;
  return d.toLocaleTimeString(localeTag, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Single unified accent chip for all suggested-question cards.
const PROMPT_CARD_ACCENT = {
  chip: 'bg-accent-soft text-accent ring-ieee-100',
} as const;

function setMessageBodyRef(id: string, instance: unknown): void {
  if (instance && typeof (instance as ChatMessageBodyExposed).toggleTranslation === 'function') {
    messageBodyRefs.value[id] = instance as ChatMessageBodyExposed;
    return;
  }
  messageBodyRefs.value[id] = null;
}

function onMessageTranslationState(id: string, state: MessageTranslationState): void {
  messageTranslationStates.value[id] = state;
}

function toggleMessageTranslation(id: string): void {
  messageBodyRefs.value[id]?.toggleTranslation();
}

function translationToggleLabel(id: string): string {
  return messageTranslationStates.value[id]?.showOriginal
    ? tt('history.showTranslation', 'Show translation')
    : tt('history.showOriginal', 'Show original');
}
</script>

<template>
  <div class="chat-shell flex h-[100dvh] min-h-0 w-full flex-col bg-surface">
    <section
      v-if="showAuthGate"
      class="flex h-full min-h-0 flex-col items-center justify-center bg-surface px-6"
    >
      <div class="flex w-full max-w-md flex-col items-center text-center">
        <img src="/images/logo.svg" alt="IEEE" class="h-9 w-auto" />

        <h1 class="mt-10 text-[2rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
          {{ tt('chat.authGate.title', 'Welcome') }}
        </h1>
        <p class="mt-3 text-sm leading-relaxed text-slate-500 sm:text-base">
          {{
            tt(
              'chat.authGate.subtitle',
              'Sign in to keep your chat history, or continue as a guest.'
            )
          }}
        </p>

        <div class="mt-10 flex w-full flex-col gap-3 sm:flex-row">
          <BaseButton
            block
            variant="primary"
            autofocus
            :loading="loggingIn"
            :disabled="loggingIn"
            @click="chooseLogin"
          >
            {{ tt('chat.authGate.login', 'Login') }}
          </BaseButton>
          <BaseButton block variant="outline" :disabled="loggingIn" @click="chooseGuest">
            {{ tt('chat.authGate.guest', 'Continue as guest') }}
          </BaseButton>
        </div>

        <p class="mt-6 text-xs text-slate-400">
          {{ tt('chat.authGate.footnote', 'No account needed for guest chat.') }}
        </p>
      </div>
    </section>

    <ChatPageSkeleton v-else-if="showTwinSkeleton" />

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
        class="flex flex-nowrap items-center justify-between gap-2 border-b border-border-subtle bg-surface px-3 py-2 sm:gap-3 sm:px-6 sm:py-3"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <template v-if="twinId">
            <BaseAvatar
              :src="twin?.profilePicUrl ?? ''"
              :name="twin?.name ?? 'AI Twin'"
              size="sm"
              badge="online"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-title text-text">{{ twin?.name ?? 'AI Twin' }}</p>
              <p class="truncate text-meta text-text-muted">
                {{ tt('chat.subgreeting', t.subgreeting).split('.')[0] }}
              </p>
            </div>
          </template>
          <template v-else>
            <p class="text-title text-text">{{ tt('chat.headerLabel', 'Chat') }}</p>
          </template>
        </div>

        <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <!-- Language switcher -->
          <div class="relative" data-lang-root>
            <button
              ref="langButton"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-1.5 py-1 text-body font-medium text-text transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:gap-2 sm:px-2 sm:py-1.5"
              :aria-label="tt('chat.langLabel', t.langLabel)"
              :aria-expanded="langOpen"
              aria-haspopup="listbox"
              @click="langOpen = !langOpen"
              @blur="onLangButtonBlur"
            >
              <img
                :src="flagUrl(currentLang.flag)"
                :alt="currentLang.label"
                class="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-border sm:h-7 sm:w-7"
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
                {{ tt('chat.loadingLanguages', 'Loading languages…') }}
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

          <button
            v-if="twin"
            type="button"
            class="header-btn header-btn--ghost"
            :aria-label="tt('chat.newChat', t.newChat)"
            :title="tt('chat.newChat', t.newChat)"
            @click="newConversation"
          >
            <Icon :icon="BubbleChatIcon" :size="16" />
            <span class="hidden sm:inline">{{ tt('chat.newChat', t.newChat) }}</span>
          </button>

          <button
            v-if="twin"
            type="button"
            class="header-btn header-btn--call"
            :aria-label="tt('chat.startCall', t.call.startCall)"
            :title="tt('chat.startCall', t.call.startCall)"
            @click="startVoiceCall"
          >
            <span class="header-btn__call-icon" aria-hidden="true">
              <Icon :icon="CallIcon" :size="16" />
            </span>
            <span class="hidden sm:inline">{{ tt('chat.startCall', t.call.startCall) }}</span>
          </button>
        </div>
      </header>

      <!-- Body -->
      <div class="flex min-h-0 flex-1 flex-col">
        <!-- No twin selected — show a picker of public twins so guests can
             choose one and start chatting without ever hitting an admin-only
             route. -->
        <section v-if="!twinId" class="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
          <div class="mx-auto w-full max-w-3xl">
            <header class="text-center">
              <h2 class="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {{ tt('chat.pickTwinTitle', t.pickTwinTitle) }}
              </h2>
              <p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500 sm:text-base">
                {{ tt('chat.pickTwinDescription', t.pickTwinDescription) }}
              </p>
            </header>

            <!-- Loading skeleton: three grey cards while the public list lands. -->
            <div
              v-if="publicTwinsLoading && publicTwins.length === 0"
              class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div
                v-for="i in 3"
                :key="`twin-skel-${i}`"
                class="h-32 animate-pulse rounded-2xl border border-slate-100 bg-slate-50"
              />
            </div>

            <!-- Twin cards -->
            <ul
              v-else-if="publicTwins.length > 0"
              class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <li v-for="pt in publicTwins" :key="pt._key">
                <button
                  type="button"
                  class="group flex h-full w-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-ieee-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ieee-700"
                  @click="pickTwin(pt)"
                >
                  <div class="flex items-center gap-3">
                    <BaseAvatar :src="pt.profilePicUrl ?? ''" :name="pt.name" size="md" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-semibold text-slate-900">{{ pt.name }}</span>
                      <span class="block text-xs text-slate-400 group-hover:text-ieee-700">
                        {{ tt('chat.pickTwinStart', 'Start chatting →') }}
                      </span>
                    </span>
                  </div>
                  <p v-if="pt.description" class="line-clamp-3 text-xs leading-relaxed text-slate-500">
                    {{ pt.description }}
                  </p>
                </button>
              </li>
            </ul>

            <!-- Empty / error fallback -->
            <div v-else class="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <Icon :icon="BubbleChatIcon" :size="28" class="text-slate-400" />
              <p class="text-sm text-slate-500">
                {{ tt('chat.pickTwinEmpty', 'No AI Twins are available right now.') }}
              </p>
              <BaseButton variant="outline" @click="loadPublicTwinsForPicker">
                {{ tt('common.retry', 'Retry') }}
              </BaseButton>
            </div>
          </div>
        </section>

        <!-- Greeting (twin selected, no messages yet, not mid-restore) -->
        <div
          v-else-if="messages.length === 0 && !restoring"
          class="welcome-stage relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-6"
        >
          <!-- Aurora background -->
          <div class="welcome-aurora pointer-events-none absolute inset-0" aria-hidden="true">
            <div class="welcome-aurora__orb welcome-aurora__orb--a" />
            <div class="welcome-aurora__orb welcome-aurora__orb--b" />
            <div class="welcome-aurora__orb welcome-aurora__orb--c" />
            <div class="welcome-aurora__grid" />
          </div>

          <div class="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-end gap-10 py-6 sm:py-10">
            <!-- Hero -->
            <div class="welcome-hero w-full max-w-3xl text-center">
              <h2 class="welcome-title" :class="{ 'welcome-title--loading': greetingNotReady }">
                <span class="welcome-title__accent">
                  {{ greetingDisplay.split(' ')[0] }}
                </span>
                <span class="welcome-title__rest">
                  {{ greetingDisplay.split(' ').slice(1).join(' ') }}
                </span>
              </h2>

              <p class="welcome-sub mx-auto mt-3 max-w-xl">
                {{ tt('chat.subgreeting', t.subgreeting) }}
              </p>
            </div>

            <!-- Suggested prompts (anchored just above the input, width matches the composer) -->
            <div class="mx-auto w-full max-w-5xl">
              <div v-if="suggestedQuestionsLoading" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div
                  v-for="idx in 3"
                  :key="idx"
                  class="welcome-skeleton h-[88px] rounded-2xl"
                />
              </div>

              <div
                v-else-if="visibleSuggestedQuestions.length > 0"
                :class="[
                  'grid grid-cols-1 gap-3 sm:grid-cols-3',
                  suggestedNotReady && 'welcome-cards--loading',
                ]"
              >
                <button
                  v-for="(question, index) in visibleSuggestedQuestions"
                  :key="`${question.order}-${question.content}`"
                  type="button"
                  class="prompt-card group disabled:cursor-not-allowed disabled:opacity-60"
                  :style="{ animationDelay: `${index * 60}ms` }"
                  :title="question.displayContent"
                  :disabled="suggestedNotReady"
                  :aria-busy="suggestedNotReady || undefined"
                  @click="send(question.displayContent)"
                >
                  <span class="prompt-card__glow" aria-hidden="true" />
                  <span class="prompt-card__body">
                    <span :class="['prompt-card__chip ring-1', PROMPT_CARD_ACCENT.chip]">
                      {{ question.displayCategory }}
                    </span>
                    <span class="prompt-card__text">
                      {{ question.displayContent }}
                    </span>
                  </span>
                  <span class="prompt-card__arrow" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M5 12h14" />
                      <path d="m13 6 6 6-6 6" />
                    </svg>
                  </span>
                </button>
              </div>

            </div>
          </div>
        </div>

        <!-- Active conversation -->
        <div
          v-else
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 scrollbar-thin sm:px-6 sm:py-6"
        >
          <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
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
                    v-if="m.role === 'user' && m.audioUrl"
                    class="voice-note-bubble flex min-w-[16rem] items-center gap-2.5 rounded-2xl bg-accent px-3 py-2 text-text-inverse shadow-card"
                  >
                    <button
                      type="button"
                      class="voice-note-play group relative grid h-11 w-11 shrink-0 place-items-center disabled:cursor-not-allowed disabled:opacity-50"
                      :aria-label="messageAudio[m.id]?.playing ? tt('chat.aria.pauseVoiceNote', 'Pause voice note') : tt('chat.aria.playVoiceNote', 'Play voice note')"
                      :title="isRecording ? tt('chat.listenDisabledRecording', 'Stop recording first') : ''"
                      :disabled="messageAudio[m.id]?.loading || isRecording"
                      @click="toggleMessageAudio(m)"
                    >
                      <svg
                        class="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
                        viewBox="0 0 36 36"
                        aria-hidden="true"
                      >
                        <circle
                          cx="18"
                          cy="18"
                          r="16"
                          fill="none"
                          stroke="rgba(255,255,255,0.22)"
                          stroke-width="2.25"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="16"
                          fill="none"
                          stroke="white"
                          stroke-width="2.25"
                          stroke-linecap="round"
                          pathLength="100"
                          stroke-dasharray="100"
                          :stroke-dashoffset="100 - audioProgress(m.id) * 100"
                          style="transition: stroke-dashoffset 120ms linear"
                        />
                      </svg>
                      <span
                        class="voice-note-play__core grid h-9 w-9 place-items-center rounded-full bg-white text-accent shadow-sm transition group-hover:scale-105 group-active:scale-95"
                      >
                        <span
                          v-if="messageAudio[m.id]?.loading"
                          class="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                          aria-hidden="true"
                        />
                        <Icon
                          v-else-if="messageAudio[m.id]?.playing"
                          :icon="PauseIcon"
                          :size="16"
                        />
                        <Icon
                          v-else
                          :icon="PlayIcon"
                          :size="16"
                          class="translate-x-[1px]"
                        />
                      </span>
                    </button>
                    <span class="voice-note-wave flex h-8 flex-1 items-center gap-[2.5px]" aria-hidden="true">
                      <span
                        v-for="(h, i) in VOICE_WAVE_HEIGHTS"
                        :key="i"
                        class="voice-note-wave__bar w-[2.5px] rounded-full bg-white"
                        :style="{ height: `${h}%`, opacity: voiceBarOpacity(m.id, i) }"
                      />
                    </span>
                    <span class="shrink-0 pr-1 text-xs font-medium tabular-nums text-white/85">
                      {{ formatAudioClock(
                        messageAudio[m.id]?.playing
                          ? (messageAudio[m.id]?.currentTime ?? 0)
                          : (messageAudio[m.id]?.duration ?? 0)
                      ) }}
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
                    <ChatMessageBody
                      v-else
                      :ref="(instance) => setMessageBodyRef(m.id, instance)"
                      :text="m.text"
                      :lang="m.lang"
                      :role="m.role"
                      @translation-state="(state) => onMessageTranslationState(m.id, state)"
                    />
                  </div>
                  <div
                    :class="[
                      'mt-1 flex items-center gap-1 text-meta text-text-subtle',
                      m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                    ]"
                  >
                    <span>{{ formatTime(m.createdAt) }}</span>
                    <template v-if="!m.streaming">
                      <template v-if="m.role === 'assistant'">
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          class="rounded p-1 text-text-subtle transition hover:bg-surface-muted hover:text-text"
                          :aria-label="tt('chat.copy', t.copy)"
                          :title="tt('chat.copy', t.copy)"
                          @click="copyMessage(m)"
                        >
                          <Icon :icon="Copy01Icon" :size="14" />
                        </button>
                      </template>
                      <template v-if="messageTranslationStates[m.id]?.loading">
                        <span aria-hidden="true">·</span>
                        <span class="inline-flex items-center gap-1 rounded p-1 text-text-subtle">
                          <span
                            class="block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                            aria-hidden="true"
                          />
                          <span>{{ tt('common.loading', 'Loading…') }}</span>
                        </span>
                      </template>
                      <template v-else-if="messageTranslationStates[m.id]?.canTranslate">
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          class="rounded p-1 text-text-subtle underline-offset-2 transition hover:bg-surface-muted hover:text-text hover:underline"
                          :aria-label="translationToggleLabel(m.id)"
                          @click="toggleMessageTranslation(m.id)"
                        >
                          {{ translationToggleLabel(m.id) }}
                        </button>
                      </template>
                      <template v-if="m.serverId && m.role === 'assistant' && voiceCatalogStore.isTtsSupported(m.lang ?? lang)">
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded p-1 text-text-subtle transition hover:bg-surface-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                          :aria-label="messageAudio[m.id]?.playing ? tt('chat.aria.pauseMessage', 'Pause audio') : tt('chat.aria.playMessage', 'Listen to message')"
                          :title="isRecording ? tt('chat.listenDisabledRecording', 'Stop recording first') : ''"
                          :disabled="messageAudio[m.id]?.loading || isRecording"
                          @click="toggleMessageAudio(m)"
                        >
                          <span
                            v-if="messageAudio[m.id]?.loading"
                            class="inline-flex items-center gap-1"
                            aria-hidden="true"
                          >
                            <span class="dot dot--xs" />
                            <span class="dot dot--xs" style="animation-delay: 0.15s" />
                            <span class="dot dot--xs" style="animation-delay: 0.3s" />
                          </span>
                          <Icon
                            v-else-if="messageAudio[m.id]?.playing"
                            :icon="PauseIcon"
                            :size="13"
                          />
                          <Icon v-else :icon="VolumeHighIcon" :size="13" />
                          <span>{{ messageAudio[m.id]?.playing ? tt('chat.playing', 'Playing') : tt('chat.listen', 'Listen') }}</span>
                        </button>
                      </template>
                    </template>
                  </div>

                  <!-- Source documents (assistant messages with KB context only) -->
                  <div
                    v-if="
                      m.role === 'assistant' &&
                      !m.streaming &&
                      (m.sourceDocuments?.length || m.confidenceScore != null)
                    "
                    class="mt-2 flex flex-col gap-1"
                  >
                    <div class="flex items-center gap-1.5 text-meta text-text-muted">
                      <Icon :icon="BookOpen01Icon" :size="12" class="shrink-0" />
                      <span class="font-medium">Sources</span>
                      <span
                        v-if="m.confidenceScore != null"
                        class="ml-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[11px] font-semibold text-success"
                      >
                        {{ Math.round((m.confidenceScore ?? 0) * 100) }}% match
                      </span>
                    </div>
                    <div v-if="m.sourceDocuments?.length" class="flex flex-col gap-0.5">
                      <a
                        v-for="doc in m.sourceDocuments"
                        :key="doc.document_id"
                        :href="doc.url || '#'"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex max-w-[280px] items-center gap-1 truncate rounded text-meta text-accent underline-offset-2 hover:underline"
                      >
                        <Icon :icon="LinkSquare01Icon" :size="11" class="shrink-0" />
                        <span class="truncate">{{ doc.document_name || doc.document_id }}</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <div ref="messagesEnd" />
          </div>
        </div>
      </div>

      <!-- Composer -->
      <footer
        v-if="twinId"
        class="border-t border-border-subtle bg-surface px-3 py-3 sm:px-6 sm:py-4"
      >
        <div class="mx-auto w-full max-w-5xl">
          <div
            v-if="!isRecording"
            class="flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-card transition focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20"
          >
            <textarea
              ref="composer"
              v-model="draft"
              rows="1"
              :placeholder="tt('chat.placeholder', t.placeholder)"
              :disabled="sending"
              class="composer-input flex-1 resize-none bg-transparent px-2 py-2 text-body leading-6 text-text outline-none placeholder:text-text-subtle disabled:cursor-not-allowed"
              @keydown="onComposerKeydown"
              @input="autoSize"
            />
            <button
              type="button"
              class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="tt('chat.micAria', t.micAria)"
              :title="tt('chat.micAria', t.micAria)"
              :disabled="sending"
              @click="startRecording"
            >
              <Icon :icon="Mic01Icon" :size="22" />
            </button>
            <button
              type="button"
              class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="tt('chat.sendAria', t.sendAria)"
              :title="tt('chat.sendAria', t.sendAria)"
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
              :aria-label="tt('chat.cancelRecording', 'Cancel')"
              @click="cancelRecording"
            >
              <Icon :icon="Cancel01Icon" :size="14" />
              {{ tt('chat.cancelRecording', 'Cancel') }}
            </button>
            <button
              type="button"
              class="group inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-body font-semibold text-text-inverse shadow-md transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              :aria-label="tt('chat.sendRecording', 'Send')"
              @click="stopRecording"
            >
              <Icon :icon="SentIcon" :size="16" />
              {{ tt('chat.sendRecording', 'Send') }}
            </button>
          </div>

          <p class="mt-2 text-center text-caption text-text-subtle">
            {{ tt('chat.disclaimer', t.disclaimer) }}
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
.dot--xs {
  width: 4px;
  height: 4px;
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

/* ===== Voice-note playback waveform =====
   Bars stay at their natural heights; opacity is driven inline from
   `voiceBarOpacity` and tweens smoothly via the transition below. Combined
   with the rAF-driven currentTime tick, this yields a fluid playhead that
   reads as a continuous fill rather than discrete bar flips. */
.voice-note-wave__bar {
  transition: opacity 80ms linear;
  will-change: opacity;
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
  .voice-note-wave__bar {
    transition: none;
  }
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

/* ===== Header action buttons ===== */
.header-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 36px;
  padding: 0 0.625rem;
  border-radius: 9999px;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 200ms ease,
    background-color 200ms ease,
    color 200ms ease,
    border-color 200ms ease;
}
@media (min-width: 640px) {
  .header-btn {
    height: 40px;
    padding: 0 1rem;
  }
}
.header-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(0, 82, 128, 0.22);
}

.header-btn--ghost {
  color: #0f172a;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 1px 2px 0 rgba(15, 23, 42, 0.04);
}
.header-btn--ghost:hover {
  color: #00629b;
  border-color: rgba(0, 98, 155, 0.4);
  background: #f8fbff;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px -4px rgba(0, 82, 128, 0.18);
}

.header-btn--call {
  color: #ffffff;
  background: linear-gradient(135deg, #0073b9 0%, #003e62 100%);
  border: 1px solid rgba(0, 0, 0, 0);
  width: 36px;
  padding: 0;
  box-shadow:
    0 6px 14px -4px rgba(0, 82, 128, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
@media (min-width: 640px) {
  .header-btn--call {
    width: auto;
    padding: 0 1rem 0 0.5rem;
  }
}
.header-btn--call:hover {
  transform: translateY(-1px);
  box-shadow:
    0 10px 22px -6px rgba(0, 82, 128, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.header-btn__call-icon {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: transparent;
  flex-shrink: 0;
}
@media (min-width: 640px) {
  .header-btn__call-icon {
    width: 28px;
    height: 28px;
    background: rgba(255, 255, 255, 0.18);
  }
}
.header-btn__call-icon::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 9999px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  animation: header-call-pulse 2s ease-out infinite;
  pointer-events: none;
  display: none;
}
@media (min-width: 640px) {
  .header-btn__call-icon::after {
    display: block;
  }
}
@keyframes header-call-pulse {
  0% { transform: scale(1); opacity: 0.6; }
  80%, 100% { transform: scale(1.45); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .header-btn__call-icon::after { animation: none; opacity: 0; }
  .header-btn:hover { transform: none; }
}

/* ===== Welcome / empty state ===== */
.welcome-stage {
  background-color: #ffffff;
  background-image:
    radial-gradient(1200px 600px at 50% -10%, rgba(0, 82, 128, 0.08), transparent 60%),
    radial-gradient(800px 400px at 100% 100%, rgba(0, 115, 185, 0.05), transparent 65%);
  background-repeat: no-repeat;
  background-attachment: local;
}

.welcome-aurora {
  overflow: hidden;
}
.welcome-aurora__orb {
  position: absolute;
  border-radius: 9999px;
  filter: blur(70px);
  opacity: 0.55;
  will-change: transform;
}
.welcome-aurora__orb--a {
  top: -120px;
  left: 8%;
  width: 360px;
  height: 360px;
  background: radial-gradient(circle, rgba(0, 115, 185, 0.45), transparent 70%);
  animation: welcome-float 14s ease-in-out infinite;
}
.welcome-aurora__orb--b {
  top: 20%;
  right: 4%;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(0, 115, 185, 0.22), transparent 70%);
  animation: welcome-float 18s ease-in-out infinite reverse;
}
.welcome-aurora__orb--c {
  bottom: -160px;
  left: 28%;
  width: 420px;
  height: 420px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.25), transparent 70%);
  animation: welcome-float 22s ease-in-out infinite;
}
.welcome-aurora__grid {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(15, 23, 42, 0.06) 1px, transparent 1px);
  background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(ellipse at center, #000 0%, transparent 70%);
  mask-image: radial-gradient(ellipse at center, #000 0%, transparent 70%);
  opacity: 0.55;
}

@keyframes welcome-float {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(20px, -28px, 0) scale(1.05); }
}

.welcome-hero {
  animation: welcome-rise 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes welcome-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.welcome-title--loading,
.welcome-cards--loading {
  opacity: 0.55;
  transition: opacity 200ms ease;
}

.welcome-title {
  font-size: clamp(1.5rem, 3vw, 2.15rem);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.018em;
  color: #020617;
}
.welcome-title__accent {
  background: linear-gradient(120deg, #00629b 0%, #0ea5e9 50%, #00629b 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  animation: welcome-shine 6s ease-in-out infinite;
}
.welcome-title__rest {
  margin-left: 0.45rem;
}
@keyframes welcome-shine {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

.welcome-sub {
  color: #475569;
  font-size: 0.85rem;
  line-height: 1.55;
}

.welcome-skeleton {
  background:
    linear-gradient(110deg, #f1f5f9 30%, #f8fafc 50%, #f1f5f9 70%);
  background-size: 200% 100%;
  border: 1px solid rgba(15, 23, 42, 0.05);
  animation: welcome-shimmer 1.6s ease-in-out infinite;
}
@keyframes welcome-shimmer {
  to { background-position: -200% 0; }
}

/* Prompt cards */
.prompt-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-align: left;
  padding: 0.95rem 3rem 0.95rem 1rem;
  min-height: 88px;
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow:
    0 1px 2px 0 rgba(15, 23, 42, 0.04),
    0 1px 3px 0 rgba(15, 23, 42, 0.04);
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms ease,
    border-color 220ms ease,
    background-color 220ms ease;
  overflow: hidden;
  cursor: pointer;
  animation: welcome-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.prompt-card:hover {
  transform: translateY(-3px);
  border-color: rgba(0, 82, 128, 0.25);
  background: #ffffff;
  box-shadow:
    0 12px 28px -10px rgba(15, 23, 42, 0.18),
    0 4px 10px -4px rgba(0, 82, 128, 0.12);
}
.prompt-card:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3px rgba(0, 82, 128, 0.22),
    0 12px 28px -10px rgba(15, 23, 42, 0.18);
}
.prompt-card__glow {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(120deg, rgba(0, 115, 185, 0.22), rgba(0, 82, 128, 0.14));
  opacity: 0;
  transition: opacity 220ms ease;
  pointer-events: none;
  z-index: 0;
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  padding: 1px;
}
.prompt-card:hover .prompt-card__glow {
  opacity: 1;
}
.prompt-card__body {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.3rem;
}
.prompt-card__chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  padding: 3px 10px 3px 8px;
  border-radius: 9999px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prompt-card__chip::before {
  content: '';
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.85;
}
.prompt-card__text {
  font-size: 0.84rem;
  line-height: 1.4;
  color: #0f172a;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.prompt-card__arrow {
  position: absolute;
  top: 50%;
  right: 0.85rem;
  z-index: 2;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.04);
  transform: translate(-4px, -50%);
  opacity: 0;
  transition:
    transform 220ms ease,
    opacity 220ms ease,
    background-color 220ms ease,
    color 220ms ease;
}
.prompt-card:hover .prompt-card__arrow {
  transform: translate(0, -50%);
  opacity: 1;
  color: #ffffff;
  background: #005280;
}

@keyframes welcome-card-in {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-aurora__orb,
  .welcome-title__accent,
  .welcome-skeleton,
  .prompt-card {
    animation: none !important;
  }
  .prompt-card__arrow {
    opacity: 1;
    transform: translate(0, -50%);
  }
}
</style>
