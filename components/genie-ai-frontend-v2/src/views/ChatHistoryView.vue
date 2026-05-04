<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  CallEnd01Icon,
  CallIcon,
  Calendar03Icon,
  Cancel01Icon,
  Delete02Icon,
  Download04Icon,
  FilterHorizontalIcon,
  Mic01Icon,
  MoreVerticalIcon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
  StopCircleIcon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseDropdown from '../components/ui/BaseDropdown.vue';
import TableRowsSkeleton from '../components/ui/skeletons/TableRowsSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { notify } from '../lib/notify';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useAuthStore } from '../stores/auth';
import { useChatHistoryStore } from '../stores/chatHistory';
import { useVoiceStore } from '../stores/voice';
import type { AiTwin } from '../services/aiTwins';
import * as chatSessionsApi from '../services/chatSessions';
import type { ChatSessionRecord } from '../services/chatSessions';
import type { VoiceSession } from '../services/voice';

const dateOptions = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Last month', 'Custom Date'];
const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const leftCalendar = [28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const rightCalendar = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const detailWaveformBars = [54, 72, 88, 64, 92, 46, 76, 82, 60, 78, 70, 92, 98, 74, 50, 66, 86, 44, 72, 82, 58, 74, 88, 54, 68, 38, 82, 76, 90, 48, 72, 60, 80, 44, 76, 62, 88, 54, 74, 92, 46, 66, 84, 58, 78, 52, 90, 64];

const activeTab = ref<'Chats' | 'Calls'>('Chats');
const selectedDate = ref('Today');
const dateMenuOpen = ref(false);
const filterPanelOpen = ref(false);
const callDetailOpen = ref(false);
const deleteDialogOpen = ref(false);
const detailMode = ref<'transcript' | 'summary'>('transcript');
const chatSort = ref<'newest' | 'oldest'>('newest');

const chatSearchOpen = ref(false);
const chatSearchInput = ref('');
const chatDeleteDialogOpen = ref(false);
const chatToDeleteId = ref<string | null>(null);

const auth = useAuthStore();
const voice = useVoiceStore();
const aiTwins = useAiTwinsStore();
const chatHistory = useChatHistoryStore();

const { sessions: callSessions, current: currentSession, messages: currentMessages, loading: callsLoading, loadingDetail, error: callsError, detailError, hasMore, offset: callsOffset, limit: callsLimit } = storeToRefs(voice);
const { twins } = storeToRefs(aiTwins);
const {
  sessions: chatSessions,
  loading: chatsLoading,
  error: chatsError,
  selectedSessionId,
  messages: chatMessages,
  loadingMessages,
  messagesError,
  typeFilter,
  scopeFilter,
  phoneNumberFilter,
  twinIdFilter,
  deleting: deletingChat,
  sending: sendingChat,
} = storeToRefs(chatHistory);

const composerDraft = ref('');
const messagesScrollEl = ref<HTMLElement | null>(null);

const isRecording = ref(false);
const recordingSeconds = ref(0);
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordingStream: MediaStream | null = null;
let recordingCancelled = false;

interface MessageAudioState {
  loading: boolean;
  playing: boolean;
  url: string | null;
  audio: HTMLAudioElement | null;
  duration: number;
  currentTime: number;
}
const assistantAudio = ref<Record<string, MessageAudioState>>({});

const phoneInput = ref('');

const pageSizes = [10, 25, 50] as const;
const callerName = computed(() => auth.displayName);

const showCalendar = computed(() => selectedDate.value === 'Custom Date');

function chooseDate(option: string) {
  selectedDate.value = option;
}

const callDateFilter = ref('all');
const callSort = ref('newest');
const callLanguageFilter = ref('all');

const dateFilterOptions = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
];

const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'longest', label: 'Longest' },
  { value: 'shortest', label: 'Shortest' },
];

const chatSortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

const typeOptions = [
  { value: '', label: 'All channels' },
  { value: 'chat', label: 'Chat' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const scopeOptions = [
  { value: 'me', label: 'My sessions' },
  { value: 'all', label: 'All users' },
];

const isAdmin = computed(() => auth.role === 'admin');

const typeFilterValue = computed<string>({
  get: () => typeFilter.value ?? '',
  set: (v) => {
    chatHistory.setTypeFilter((v as 'chat' | 'whatsapp') || null);
    refreshChats();
  },
});

const scopeFilterValue = computed<string>({
  get: () => scopeFilter.value,
  set: (v) => {
    chatHistory.setScopeFilter((v as 'me' | 'all') || 'me');
    refreshChats();
  },
});

const showPhoneFilter = computed(
  () => isAdmin.value && scopeFilter.value === 'all' && typeFilter.value === 'whatsapp'
);

let phoneDebounce: ReturnType<typeof setTimeout> | null = null;
function onPhoneInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  phoneInput.value = value;
  if (phoneDebounce) clearTimeout(phoneDebounce);
  phoneDebounce = setTimeout(() => {
    chatHistory.setPhoneNumberFilter(value);
    refreshChats();
  }, 300);
}

function refreshChats(): void {
  chatHistory.fetchSessions().catch(() => {
    // chatsError renders inline
  });
}

const languageOptions = computed(() => {
  const langs = Array.from(
    new Set(callSessions.value.map((s) => s.language).filter(Boolean))
  ).sort();
  return [
    { value: 'all', label: 'All languages' },
    ...langs.map((l) => ({ value: l, label: l.toUpperCase() })),
  ];
});

const twinFilterOptions = computed(() =>
  twins.value.map((t) => ({ value: t._key, label: t.name }))
);

const twinFilterValue = computed<string>({
  get: () => twinIdFilter.value ?? '',
  set: (v) => chatHistory.setTwinFilter(v || null),
});

function twinById(twinId?: string | null): AiTwin | null {
  if (!twinId) return null;
  return twins.value.find((t) => t._key === twinId) ?? null;
}

function sessionTitle(session: ChatSessionRecord | null | undefined): string {
  if (!session) return '';
  const twin = twinById(session.twinId);
  if (twin?.name) return twin.name;
  if (session.phoneNumber) return session.phoneNumber;
  return session.type === 'whatsapp' ? 'WhatsApp session' : 'Chat session';
}

function sessionPreview(session: ChatSessionRecord): string {
  if (session.type === 'whatsapp') {
    return session.phoneNumber ? `WhatsApp · ${session.phoneNumber}` : 'WhatsApp';
  }
  const twin = twinById(session.twinId);
  return twin?.description?.trim() || 'Chat session';
}

function sessionAvatar(session: ChatSessionRecord | null | undefined): string | null {
  if (!session) return null;
  return twinById(session.twinId)?.profilePicUrl ?? null;
}

const sortedChatSessions = computed<ChatSessionRecord[]>(() => {
  const rows = chatSessions.value
    .filter((s) => !twinIdFilter.value || s.twinId === twinIdFilter.value)
    .slice();
  rows.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt).getTime() || 0;
    const tb = new Date(b.updatedAt || b.createdAt).getTime() || 0;
    return chatSort.value === 'oldest' ? ta - tb : tb - ta;
  });
  return rows;
});

const selectedChatSession = computed<ChatSessionRecord | null>(() => {
  if (!selectedSessionId.value) return null;
  return (
    sortedChatSessions.value.find((s) => s._key === selectedSessionId.value) ??
    chatSessions.value.find((s) => s._key === selectedSessionId.value) ??
    null
  );
});

const displayedSessions = computed<VoiceSession[]>(() => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const cutoffByFilter: Record<string, number> = {
    all: 0,
    today: now - day,
    last7: now - 7 * day,
    last30: now - 30 * day,
  };
  const cutoff = cutoffByFilter[callDateFilter.value] ?? 0;

  let rows = callSessions.value.slice();

  if (cutoff > 0) {
    rows = rows.filter((s) => {
      const t = new Date(s.startAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }

  if (callLanguageFilter.value !== 'all') {
    rows = rows.filter((s) => s.language === callLanguageFilter.value);
  }

  if (callSort.value === 'oldest') {
    rows.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  } else if (callSort.value === 'longest') {
    rows.sort((a, b) => b.durationSeconds - a.durationSeconds);
  } else if (callSort.value === 'shortest') {
    rows.sort((a, b) => a.durationSeconds - b.durationSeconds);
  } else {
    rows.sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt));
  }

  return rows;
});

const displayedRangeStart = computed(() =>
  displayedSessions.value.length ? callsOffset.value + 1 : 0
);
const displayedRangeEnd = computed(
  () => callsOffset.value + displayedSessions.value.length
);

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const sessionListDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function formatSessionDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d);
}

function formatSessionTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : timeFormatter.format(d);
}

function formatSessionListDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return timeFormatter.format(d);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';

  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays > 0 && diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d);
  }

  return sessionListDateFormatter.format(d);
}

function formatMessageTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : messageTimeFormatter.format(d);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function loadCalls(): void {
  voice.fetchSessions().catch(() => {
    // store.error renders into the inline error row
  });
}

async function loadChats(): Promise<void> {
  try {
    if (twins.value.length === 0) {
      await aiTwins.fetchAll().catch(() => {});
    }
    if (!twinIdFilter.value && twins.value[0]) {
      chatHistory.setTwinFilter(twins.value[0]._key);
    }
    phoneInput.value = phoneNumberFilter.value;
    await chatHistory.fetchSessions();
    const first = sortedChatSessions.value[0];
    if (first && !selectedSessionId.value) {
      chatHistory.selectSession(first._key).catch(() => {});
    }
  } catch {
    // chatsError renders inline
  }
}

async function selectChatSession(sessionId: string): Promise<void> {
  if (selectedSessionId.value === sessionId) return;
  chatSearchOpen.value = false;
  chatSearchInput.value = '';
  try {
    await chatHistory.selectSession(sessionId);
  } catch {
    // messagesError renders in the chat pane
  }
}

let messageSearchDebounce: ReturnType<typeof setTimeout> | null = null;
function onChatSearchInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  chatSearchInput.value = value;
  if (messageSearchDebounce) clearTimeout(messageSearchDebounce);
  messageSearchDebounce = setTimeout(() => {
    chatHistory.searchMessages(value).catch(() => {
      // messagesError renders in the chat pane
    });
  }, 300);
}

function toggleChatSearch(): void {
  chatSearchOpen.value = !chatSearchOpen.value;
  if (!chatSearchOpen.value && chatSearchInput.value) {
    clearChatSearch();
  }
}

function clearChatSearch(): void {
  chatSearchInput.value = '';
  if (messageSearchDebounce) clearTimeout(messageSearchDebounce);
  chatHistory.searchMessages('').catch(() => {});
}

function openChatDeleteDialog(): void {
  if (!selectedSessionId.value) return;
  chatToDeleteId.value = selectedSessionId.value;
  chatDeleteDialogOpen.value = true;
}

function cancelChatDelete(): void {
  if (deletingChat.value) return;
  chatDeleteDialogOpen.value = false;
  chatToDeleteId.value = null;
}

const composerDisabled = computed(
  () =>
    !selectedChatSession.value ||
    selectedChatSession.value.type === 'whatsapp' ||
    sendingChat.value,
);

const composerPlaceholder = computed(() => {
  if (!selectedChatSession.value) return 'Select a conversation to start typing...';
  if (selectedChatSession.value.type === 'whatsapp') return 'Replies in WhatsApp sessions are not available here.';
  return 'Type your message here...';
});

function scrollMessagesToBottom(): void {
  nextTick(() => {
    const el = messagesScrollEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function sendComposerMessage(): Promise<void> {
  const text = composerDraft.value.trim();
  if (!text || composerDisabled.value) return;
  composerDraft.value = '';
  try {
    await chatHistory.sendMessage(text);
  } catch (err) {
    composerDraft.value = text;
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    notify.error('Send failed', e?.response?.data?.message ?? e?.message ?? 'Could not deliver message.');
  }
}

function onComposerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendComposerMessage();
  }
}

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
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
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;
  }
}

async function startRecording(): Promise<void> {
  if (isRecording.value || composerDisabled.value) return;
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
  recordingTimer = setInterval(() => {
    recordingSeconds.value += 1;
    if (recordingSeconds.value >= 600) stopRecording();
  }, 1000);
}

function stopRecording(): void {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
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
  try {
    mediaRecorder.stop();
  } catch {
    stopRecordingStream();
    isRecording.value = false;
    recordingSeconds.value = 0;
  }
}

async function submitVoiceMessage(blob: Blob): Promise<void> {
  if (!selectedSessionId.value) return;
  try {
    await chatHistory.sendVoice(blob);
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
  }
}

function ensureAudioState(messageId: string): MessageAudioState {
  if (!assistantAudio.value[messageId]) {
    assistantAudio.value[messageId] = {
      loading: false,
      playing: false,
      url: null,
      audio: null,
      duration: 0,
      currentTime: 0,
    };
  }
  return assistantAudio.value[messageId];
}

function stopAllMessageAudio(): void {
  Object.values(assistantAudio.value).forEach((state) => {
    if (state.audio && state.playing) {
      state.audio.pause();
      state.playing = false;
    }
  });
}

function attachAudioListeners(state: MessageAudioState): void {
  if (!state.audio) return;
  const audio = state.audio;
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

async function toggleMessageAudio(message: { _key?: string; role: string }): Promise<void> {
  const messageId = message._key;
  if (!messageId || !selectedSessionId.value) return;
  const state = ensureAudioState(messageId);
  if (state.playing && state.audio) {
    state.audio.pause();
    state.playing = false;
    return;
  }
  stopAllMessageAudio();
  try {
    if (!state.url) {
      state.loading = true;
      const blob = await chatSessionsApi.fetchMessageAudio(selectedSessionId.value, messageId);
      state.url = URL.createObjectURL(blob);
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

watch(
  () => chatMessages.value.length,
  () => scrollMessagesToBottom(),
);

watch(selectedSessionId, () => {
  composerDraft.value = '';
  scrollMessagesToBottom();
});

async function confirmChatDelete(): Promise<void> {
  if (!chatToDeleteId.value) return;
  try {
    const deletedMessages = await chatHistory.deleteSession(chatToDeleteId.value);
    chatDeleteDialogOpen.value = false;
    chatToDeleteId.value = null;
    notify.success(
      'Conversation deleted',
      deletedMessages > 0
        ? `${deletedMessages} message${deletedMessages === 1 ? '' : 's'} removed.`
        : undefined,
    );
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const message =
      e?.response?.data?.message ??
      (status === 403
        ? "You don't have permission to delete this conversation."
        : status === 404
          ? 'This conversation no longer exists.'
          : e?.message ?? 'Failed to delete conversation');
    notify.error('Delete failed', message);
  }
}

async function openCallDetails(session: VoiceSession, mode: 'transcript' | 'summary') {
  detailMode.value = mode;
  callDetailOpen.value = true;
  try {
    await voice.openSession(session._key);
  } catch {
    // detailError renders inside the dialog
  }
}

function closeCallDetails(): void {
  callDetailOpen.value = false;
  voice.closeSession();
}

function changePageSize(event: Event): void {
  const next = Number((event.target as HTMLSelectElement).value);
  if (Number.isFinite(next) && next > 0) voice.setLimit(next);
}

watch(activeTab, (tab) => {
  if (tab === 'Calls' && callSessions.value.length === 0 && !callsLoading.value) {
    loadCalls();
  }
  if (tab === 'Chats' && chatSessions.value.length === 0 && !chatsLoading.value) {
    loadChats();
  }
}, { immediate: false });

onMounted(() => {
  loadChats();
});

function cleanupAssistantAudio(): void {
  Object.values(assistantAudio.value).forEach((state) => {
    if (state.audio) {
      state.audio.pause();
      state.audio.src = '';
    }
    if (state.url) URL.revokeObjectURL(state.url);
  });
  assistantAudio.value = {};
}

watch(selectedSessionId, () => {
  cleanupAssistantAudio();
  if (isRecording.value) cancelRecording();
});

onBeforeUnmount(() => {
  cleanupAssistantAudio();
  if (isRecording.value) cancelRecording();
  stopRecordingStream();
});
</script>

<template>
  <DashboardLayout>
    <section class="h-full min-h-0 bg-white p-4 md:p-6">
      <div class="flex h-full min-h-[760px] flex-col gap-4 lg:min-h-[640px]">
        <header class="flex flex-col gap-4">
          <h1 class="text-lg font-bold text-slate-900">Chat/Call History</h1>
          <div class="inline-flex w-fit gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="History type">
            <button
              v-for="tab in ['Chats', 'Calls']"
              :key="tab"
              type="button"
              :class="[
                'rounded-md px-3 py-2 text-xs font-semibold text-slate-400 transition',
                activeTab === tab && 'bg-white text-slate-700 shadow-sm',
              ]"
              @click="activeTab = tab as 'Chats' | 'Calls'"
            >
              {{ tab }}
            </button>
          </div>
        </header>

        <div v-if="activeTab === 'Chats'" class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:grid-cols-[minmax(250px,330px)_minmax(0,1fr)]">
          <aside class="relative z-10 flex max-h-[330px] min-h-0 flex-col overflow-hidden border-b border-slate-200 bg-white lg:max-h-none lg:border-b-0 lg:border-r">
            <div class="relative z-20 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 border-b border-slate-100 px-3 py-4">
              <BaseDropdown
                v-model="twinFilterValue"
                :options="twinFilterOptions"
                placeholder="AI Twin"
                width="w-full"
              />
              <BaseDropdown
                v-model="typeFilterValue"
                :options="typeOptions"
                placeholder="Channel"
                width="w-full"
              />
              <button
                type="button"
                :class="[
                  'grid h-10 w-10 place-items-center rounded-full border bg-white shadow-sm transition',
                  filterPanelOpen
                    ? 'border-ieee-300 bg-ieee-50 text-ieee-800'
                    : 'border-neutral-200 text-ieee-700 hover:border-neutral-300 hover:bg-neutral-50',
                ]"
                aria-label="Open filters"
                @click="filterPanelOpen = !filterPanelOpen"
              >
                <Icon :icon="FilterHorizontalIcon" :size="18" />
              </button>

              <div v-if="dateMenuOpen" class="absolute left-3 top-[58px] z-40 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                <button
                  v-for="option in dateOptions"
                  :key="option"
                  type="button"
                  :class="[
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-500',
                    selectedDate === option && 'bg-ieee-50 text-ieee-800',
                  ]"
                  @click="chooseDate(option)"
                >
                  <span
                    :class="[
                      'h-3 w-3 rounded-full border border-slate-400',
                      selectedDate === option && 'border-[3.5px] border-ieee-700',
                    ]"
                  />
                  <span>{{ option }}</span>
                </button>
              </div>

              <div
                v-if="dateMenuOpen && showCalendar"
                class="absolute left-3 top-[330px] z-50 w-[calc(100vw-4rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl sm:w-[520px] lg:left-[225px] lg:top-[58px]"
              >
                <div class="mb-3 grid grid-cols-[28px_1fr_28px] items-center gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-[28px_1fr_1fr_28px]">
                  <button type="button" class="grid h-7 place-items-center rounded-md hover:bg-slate-100" aria-label="Previous month">
                    <Icon :icon="ArrowLeft01Icon" :size="16" />
                  </button>
                  <span>December 2021</span>
                  <span class="hidden sm:block">December 2021</span>
                  <button type="button" class="grid h-7 place-items-center rounded-md hover:bg-slate-100" aria-label="Next month">
                    <Icon :icon="ArrowRight01Icon" :size="16" />
                  </button>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="grid grid-cols-7 gap-1">
                    <span v-for="day in weekDays" :key="`l-${day}`" class="grid h-7 place-items-center text-[11px] font-bold text-slate-500">{{ day }}</span>
                    <span
                      v-for="(day, index) in leftCalendar"
                      :key="`left-${index}`"
                      :class="[
                        'grid h-7 place-items-center rounded-md text-[11px] text-slate-600',
                        index < 3 && 'text-slate-300',
                        day >= 23 && day <= 31 && 'bg-ieee-50 text-ieee-800',
                        day === 23 && 'bg-ieee-700 text-white',
                      ]"
                    >
                      {{ day }}
                    </span>
                  </div>
                  <div class="grid grid-cols-7 gap-1">
                    <span v-for="day in weekDays" :key="`r-${day}`" class="grid h-7 place-items-center text-[11px] font-bold text-slate-500">{{ day }}</span>
                    <span
                      v-for="(day, index) in rightCalendar"
                      :key="`right-${index}`"
                      :class="[
                        'grid h-7 place-items-center rounded-md text-[11px] text-slate-600',
                        day >= 5 && day <= 14 && 'bg-ieee-50 text-ieee-800',
                        day === 14 && 'bg-ieee-700 text-white',
                      ]"
                    >
                      {{ day || '' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="filterPanelOpen" class="flex flex-col gap-3 border-b border-slate-100 px-3 pb-3 pt-1">
              <BaseDropdown
                v-model="chatSort"
                :options="chatSortOptions"
                placeholder="Sort By"
                width="w-full"
              />
              <BaseDropdown
                v-if="isAdmin"
                v-model="scopeFilterValue"
                :options="scopeOptions"
                placeholder="Scope"
                width="w-full"
              />
              <input
                v-if="showPhoneFilter"
                type="tel"
                inputmode="tel"
                :value="phoneInput"
                placeholder="Phone number"
                class="h-10 w-full rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-ieee-700"
                @input="onPhoneInput"
              />
              <div class="flex flex-wrap gap-2">
                <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                  <Icon :icon="Calendar03Icon" :size="15" /> {{ selectedDate }}
                </span>
                <span class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Unread only</span>
              </div>
            </div>

            <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <TableRowsSkeleton
                v-if="chatsLoading && chatSessions.length === 0"
                :rows="6"
                height="3rem"
                class="p-4"
              />

              <div v-else-if="chatsError" class="flex flex-col items-start gap-2 px-3 py-4 text-xs text-red-600">
                <span>{{ chatsError }}</span>
                <button
                  type="button"
                  class="rounded-full border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                  @click="loadChats"
                >
                  Retry
                </button>
              </div>

              <div v-else-if="sortedChatSessions.length === 0" class="grid flex-1 place-items-center px-3 py-8">
                <EmptyState
                  :icon="BubbleChatIcon"
                  :title="chatSessions.length === 0 ? 'No chats yet' : 'No matches'"
                  :description="chatSessions.length === 0
                    ? 'Conversations with your AI Twins will appear here.'
                    : 'No conversations match the current filters.'"
                />
              </div>

              <div v-else class="space-y-1 p-2">
                <button
                  v-for="item in sortedChatSessions"
                  :key="item._key"
                  type="button"
                  :class="[
                    'group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-2.5 text-left transition',
                    item._key === selectedSessionId
                      ? 'border-ieee-200 bg-ieee-50/70 shadow-sm'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50',
                  ]"
                  @click="selectChatSession(item._key)"
                >
                  <span
                    aria-hidden="true"
                    :class="[
                      'absolute left-0 top-2 bottom-2 w-1 rounded-full transition',
                      item._key === selectedSessionId ? 'bg-ieee-700' : 'bg-transparent',
                    ]"
                  />
                  <BaseAvatar :src="sessionAvatar(item)" :name="sessionTitle(item)" size="sm" />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ sessionTitle(item) }}</span>
                      <time class="shrink-0 text-[11px] text-slate-400">
                        {{ formatSessionListDate(item.updatedAt || item.createdAt) }}
                      </time>
                    </span>
                    <span class="mt-0.5 flex items-center gap-1.5">
                      <span
                        :class="[
                          'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold',
                          item.type === 'whatsapp'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-ieee-50 text-ieee-700',
                        ]"
                      >
                        <Icon :icon="BubbleChatIcon" :size="10" />
                        {{ item.type === 'whatsapp' ? 'WhatsApp' : 'Chat' }}
                      </span>
                      <span class="min-w-0 truncate text-xs text-slate-500">{{ sessionPreview(item) }}</span>
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </aside>

          <article class="flex min-h-0 min-w-0 flex-col bg-white">
            <header v-if="selectedChatSession" class="relative flex items-center justify-between gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3">
              <div class="flex items-center gap-3">
                <BaseAvatar :src="sessionAvatar(selectedChatSession)" :name="sessionTitle(selectedChatSession)" size="sm" badge="online" />
                <div>
                  <h2 class="text-sm font-bold text-slate-700">{{ sessionTitle(selectedChatSession) }}</h2>
                  <p class="mt-0.5 text-[11px] text-slate-400">
                    {{ selectedChatSession.type === 'whatsapp' ? 'WhatsApp conversation' : 'AI Twin conversation' }}
                  </p>
                </div>
              </div>
              <div class="relative flex items-center gap-1 text-slate-500">
                <button
                  type="button"
                  :class="[
                    'grid h-9 w-9 place-items-center rounded-md transition hover:bg-white hover:text-ieee-800',
                    chatSearchOpen && 'bg-ieee-50 text-ieee-800',
                  ]"
                  aria-label="Search conversation"
                  @click="toggleChatSearch"
                >
                  <Icon :icon="Search01Icon" :size="19" />
                </button>
                <button
                  type="button"
                  class="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Delete conversation"
                  title="Delete conversation"
                  :disabled="!selectedSessionId"
                  @click="openChatDeleteDialog"
                >
                  <Icon :icon="Delete02Icon" :size="19" />
                </button>
              </div>
            </header>

            <div v-if="selectedChatSession && chatSearchOpen" class="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2">
              <label class="flex flex-1 items-center gap-2 rounded-full bg-slate-100 px-4">
                <Icon :icon="Search01Icon" :size="16" class="text-slate-400" />
                <input
                  type="text"
                  :value="chatSearchInput"
                  placeholder="Search in messages..."
                  class="h-9 min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                  @input="onChatSearchInput"
                />
                <button
                  v-if="chatSearchInput"
                  type="button"
                  class="text-slate-400 transition hover:text-slate-700"
                  aria-label="Clear search"
                  @click="clearChatSearch"
                >
                  <Icon :icon="Cancel01Icon" :size="14" />
                </button>
              </label>
              <button
                type="button"
                class="text-xs font-semibold text-slate-500 hover:text-slate-700"
                @click="toggleChatSearch"
              >
                Close
              </button>
            </div>

            <div ref="messagesScrollEl" class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-7">
              <div v-if="loadingMessages" class="space-y-3">
                <TableRowsSkeleton :rows="5" height="2.5rem" />
              </div>

              <div
                v-else-if="messagesError"
                class="flex items-center justify-between gap-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
              >
                <span>{{ messagesError }}</span>
                <button
                  v-if="selectedSessionId"
                  type="button"
                  class="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                  @click="selectChatSession(selectedSessionId)"
                >
                  Retry
                </button>
              </div>

              <div v-else-if="!selectedChatSession" class="grid h-full place-items-center">
                <EmptyState
                  :icon="BubbleChatIcon"
                  title="Select a conversation"
                  description="Pick a chat on the left to read its full history."
                />
              </div>

              <div v-else-if="chatMessages.length === 0" class="grid h-full place-items-center">
                <EmptyState
                  :icon="BubbleChatIcon"
                  :title="chatSearchInput ? 'No matches' : 'No messages yet'"
                  :description="chatSearchInput
                    ? `No messages contain &quot;${chatSearchInput}&quot;.`
                    : 'This conversation does not contain any messages.'"
                />
              </div>

              <template v-else>
                <div
                  v-for="(message, index) in chatMessages"
                  :key="`${selectedChatSession?._key}-${index}`"
                  :class="['mb-5 flex items-start gap-2.5', message.role === 'user' && 'justify-end']"
                >
                  <BaseAvatar
                    v-if="message.role !== 'user'"
                    :src="sessionAvatar(selectedChatSession)"
                    :name="sessionTitle(selectedChatSession)"
                    size="xs"
                  />
                  <div :class="['flex max-w-[86%] flex-col gap-1 md:max-w-[430px]', message.role === 'user' && 'items-end']">
                    <div
                      v-if="message.role === 'user' && message.audioUrl && message._key"
                      class="flex items-center gap-3 rounded-2xl rounded-tr-md bg-ieee-700 px-3 py-2.5 text-white shadow-sm"
                    >
                      <button
                        type="button"
                        class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-50"
                        :aria-label="assistantAudio[message._key]?.playing ? 'Pause voice note' : 'Play voice note'"
                        :disabled="assistantAudio[message._key]?.loading"
                        @click="toggleMessageAudio(message)"
                      >
                        <span v-if="assistantAudio[message._key]?.loading" class="typing-dots typing-dots--sm"><span /><span /><span /></span>
                        <Icon
                          v-else-if="assistantAudio[message._key]?.playing"
                          :icon="PauseIcon"
                          :size="16"
                        />
                        <Icon v-else :icon="PlayIcon" :size="16" />
                      </button>
                      <span class="flex h-7 flex-1 items-center gap-0.5" aria-hidden="true">
                        <span
                          v-for="(bar, barIdx) in detailWaveformBars.slice(0, 32)"
                          :key="barIdx"
                          class="w-0.5 rounded-full bg-white/60"
                          :style="{ height: `${Math.max(20, bar * 0.6)}%` }"
                        />
                      </span>
                      <span class="shrink-0 text-[11px] font-semibold tabular-nums text-white/80">
                        {{ formatAudioClock(assistantAudio[message._key]?.duration ?? 0) || '0:00' }}
                      </span>
                    </div>
                    <div
                      v-else
                      :class="[
                        'rounded-2xl px-3.5 py-3 text-xs leading-relaxed whitespace-pre-wrap',
                        message.role === 'user'
                          ? 'rounded-tr-md bg-ieee-700 text-white shadow-sm'
                          : 'rounded-tl-md bg-white text-slate-600 shadow-sm',
                      ]"
                    >
                      <p>{{ message.content }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <time v-if="message.createdAt" class="text-[11px] text-slate-400">{{ formatMessageTime(message.createdAt) }}</time>
                      <button
                        v-if="message.role === 'assistant' && message._key"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-ieee-50 hover:text-ieee-800 disabled:opacity-50"
                        :aria-label="assistantAudio[message._key]?.playing ? 'Pause audio' : 'Play audio'"
                        :disabled="assistantAudio[message._key]?.loading"
                        @click="toggleMessageAudio(message)"
                      >
                        <span v-if="assistantAudio[message._key]?.loading" class="typing-dots typing-dots--sm"><span /><span /><span /></span>
                        <Icon
                          v-else-if="assistantAudio[message._key]?.playing"
                          :icon="PauseIcon"
                          :size="12"
                        />
                        <Icon v-else :icon="VolumeHighIcon" :size="12" />
                        {{ assistantAudio[message._key]?.playing ? 'Playing' : 'Listen' }}
                      </button>
                    </div>
                  </div>
                  <BaseAvatar v-if="message.role === 'user'" :name="callerName" size="xs" />
                </div>

                <div
                  v-if="sendingChat"
                  class="mb-5 flex items-start gap-2.5"
                  aria-live="polite"
                  aria-label="Assistant is typing"
                >
                  <BaseAvatar
                    :src="sessionAvatar(selectedChatSession)"
                    :name="sessionTitle(selectedChatSession)"
                    size="xs"
                  />
                  <div class="flex flex-col gap-1">
                    <div class="rounded-2xl rounded-tl-md bg-white px-3.5 py-3 shadow-sm">
                      <span class="typing-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                    <span class="text-[11px] text-slate-400">{{ sessionTitle(selectedChatSession) }} is typing…</span>
                  </div>
                </div>
              </template>
            </div>

            <footer class="flex gap-3 border-t border-slate-200 bg-white/80 px-3 py-3 md:px-4 md:pb-4">
              <template v-if="!isRecording">
                <label class="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-slate-100 px-4">
                  <input
                    v-model="composerDraft"
                    type="text"
                    :placeholder="composerPlaceholder"
                    :disabled="composerDisabled"
                    class="h-11 min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                    @keydown="onComposerKeydown"
                  />
                  <button
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-white hover:text-ieee-800 disabled:opacity-40"
                    aria-label="Record voice message"
                    :disabled="composerDisabled"
                    @click="startRecording"
                  >
                    <Icon :icon="Mic01Icon" :size="18" />
                  </button>
                </label>
                <button
                  type="button"
                  class="grid h-11 w-11 place-items-center rounded-full bg-ieee-700 text-white transition hover:bg-ieee-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send message"
                  :disabled="composerDisabled || !composerDraft.trim()"
                  @click="sendComposerMessage"
                >
                  <Icon :icon="ArrowRight01Icon" :size="21" />
                </button>
              </template>

              <div
                v-else
                class="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-red-50 px-4 py-1 ring-1 ring-red-100"
                role="status"
                aria-live="polite"
              >
                <span class="relative grid h-8 w-8 place-items-center rounded-full bg-red-500 text-white">
                  <span class="absolute h-8 w-8 animate-ping rounded-full bg-red-500/40" aria-hidden="true" />
                  <Icon :icon="Mic01Icon" :size="16" />
                </span>
                <span class="flex-1 text-xs font-semibold text-red-700">
                  Recording… <span class="ml-1 tabular-nums text-red-500">{{ formatRecordingClock(recordingSeconds) }}</span>
                </span>
                <button
                  type="button"
                  class="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-white hover:text-slate-700"
                  aria-label="Cancel recording"
                  @click="cancelRecording"
                >
                  <Icon :icon="Cancel01Icon" :size="16" />
                </button>
                <button
                  type="button"
                  class="grid h-11 w-11 place-items-center rounded-full bg-red-500 text-white transition hover:bg-red-600"
                  aria-label="Stop and send recording"
                  @click="stopRecording"
                >
                  <Icon :icon="StopCircleIcon" :size="20" />
                </button>
              </div>
            </footer>
          </article>
        </div>

        <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <BaseDropdown
              v-model="callDateFilter"
              :options="dateFilterOptions"
              placeholder="Select Date"
            />
            <BaseDropdown
              v-model="callSort"
              :options="sortOptions"
              placeholder="Sort By"
            />
            <BaseDropdown
              v-model="callLanguageFilter"
              :options="languageOptions"
              placeholder="Language"
            />
          </div>

          <div class="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div class="grid grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr_1.1fr_40px] border-b border-neutral-100 bg-neutral-50 px-5 py-3 text-xs font-semibold text-slate-500">
              <span>Language</span>
              <span>Date</span>
              <span>Start Time</span>
              <span>End Time</span>
              <span>Duration</span>
              <span>Caller Name</span>
              <span />
            </div>
            <div class="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
              <TableRowsSkeleton
                v-if="callsLoading && callSessions.length === 0"
                :rows="5"
                height="3rem"
                class="p-4"
              />

              <div
                v-else-if="callsError"
                class="flex items-center justify-between gap-4 px-5 py-6 text-sm text-red-600"
              >
                <span>{{ callsError }}</span>
                <button
                  type="button"
                  class="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                  @click="loadCalls"
                >
                  Retry
                </button>
              </div>

              <div v-else-if="displayedSessions.length === 0" class="px-5 py-12">
                <EmptyState
                  :icon="CallEnd01Icon"
                  :title="callSessions.length === 0 ? 'No calls yet' : 'No matches'"
                  :description="callSessions.length === 0
                    ? 'Voice calls you make will appear here once they finish.'
                    : 'No calls match the current filters.'"
                />
              </div>

              <div
                v-for="record in displayedSessions"
                v-else
                :key="record._key"
                class="grid grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr_1.1fr_40px] items-center px-5 py-4 text-sm text-slate-600"
              >
                <button type="button" class="flex items-center gap-3 text-left font-semibold text-slate-900" @click="openCallDetails(record, 'transcript')">
                  <span class="grid h-6 w-6 place-items-center rounded-full bg-violet-50 text-violet-500">
                    <Icon :icon="CallIcon" :size="14" />
                  </span>
                  <span class="uppercase">{{ record.language || '—' }}</span>
                </button>
                <span>{{ formatSessionDate(record.startAt) }}</span>
                <span>{{ formatSessionTime(record.startAt) }}</span>
                <span>{{ formatSessionTime(record.endAt) }}</span>
                <span>{{ formatDuration(record.durationSeconds) }}</span>
                <button type="button" class="text-left transition hover:text-ieee-800" @click="openCallDetails(record, 'summary')">
                  {{ callerName }}
                </button>
                <button type="button" class="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500" aria-label="Delete call" @click="deleteDialogOpen = true">
                  <Icon :icon="MoreVerticalIcon" :size="18" />
                </button>
              </div>
            </div>
            <footer class="flex items-center justify-end gap-6 border-t border-neutral-100 px-5 py-3 text-sm text-slate-500">
              <label class="inline-flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  :value="callsLimit"
                  class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm font-medium text-slate-700 outline-none transition hover:border-neutral-300 focus:border-ieee-700"
                  @change="changePageSize"
                >
                  <option v-for="n in pageSizes" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
              <span>{{ displayedRangeStart }}-{{ displayedRangeEnd }}</span>
              <button
                type="button"
                class="text-slate-400 transition hover:text-ieee-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Previous page"
                :disabled="callsOffset === 0 || callsLoading"
                @click="voice.prevPage()"
              >
                <Icon :icon="ArrowLeft01Icon" :size="17" />
              </button>
              <button
                type="button"
                class="text-slate-700 transition hover:text-ieee-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Next page"
                :disabled="!hasMore || callsLoading"
                @click="voice.nextPage()"
              >
                <Icon :icon="ArrowRight01Icon" :size="17" />
              </button>
            </footer>
          </div>
        </div>
      </div>

      <Teleport to="body">
        <div v-if="callDetailOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-[#7f819f] p-6">
          <section class="relative w-full max-w-2xl rounded-xl bg-white p-4 shadow-2xl">
            <button
              type="button"
              class="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
              aria-label="Close call details"
              @click="closeCallDetails"
            >
              <span class="text-2xl leading-none">&times;</span>
            </button>
            <header>
              <h2 class="text-base font-semibold text-slate-950">Call Details</h2>
              <div class="mt-4 flex items-center gap-2">
                <div class="flex h-12 flex-1 items-center gap-1" aria-hidden="true">
                  <span
                    v-for="(height, index) in detailWaveformBars"
                    :key="index"
                    :class="['w-0.5 rounded-full', index < 18 ? 'bg-ieee-700' : 'bg-slate-300']"
                    :style="{ height: `${height}%` }"
                  />
                </div>
                <span class="text-xs text-slate-400">3:50</span>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <button type="button" class="inline-flex h-7 items-center gap-2 rounded-full bg-ieee-700 px-3 text-xs font-semibold text-white">
                  <Icon :icon="PlayIcon" :size="11" />
                  Play
                </button>
                <button type="button" class="grid h-7 w-7 place-items-center rounded-full bg-ieee-700 text-white" aria-label="Download recording">
                  <Icon :icon="Download04Icon" :size="14" />
                </button>
              </div>
            </header>

            <div class="mt-4 grid grid-cols-2 border-b border-slate-200 text-sm font-semibold">
              <button
                type="button"
                :class="['border-b-2 py-2', detailMode === 'transcript' ? 'border-ieee-700 text-slate-950' : 'border-transparent text-slate-500']"
                @click="detailMode = 'transcript'"
              >
                Transcript
              </button>
              <button
                type="button"
                :class="['border-b-2 py-2', detailMode === 'summary' ? 'border-ieee-700 text-slate-950' : 'border-transparent text-slate-500']"
                @click="detailMode = 'summary'"
              >
                Summary
              </button>
            </div>

            <TableRowsSkeleton
              v-if="loadingDetail"
              :rows="4"
              height="1.5rem"
              class="py-4"
            />
            <div v-else-if="detailError" class="py-6 text-sm text-red-600">{{ detailError }}</div>
            <template v-else>
              <div v-if="detailMode === 'transcript'" class="min-h-[260px] py-4 text-sm leading-relaxed">
                <template v-if="currentMessages.length">
                  <div v-for="msg in currentMessages" :key="msg._key" class="mb-3">
                    <p class="font-bold text-ieee-700">{{ msg.isAssistant ? 'AI Twin' : 'User' }}</p>
                    <p class="mt-1 text-slate-950 whitespace-pre-wrap">{{ msg.content }}</p>
                  </div>
                </template>
                <p v-else class="text-slate-500">No transcript available for this call.</p>
              </div>
              <div v-else class="min-h-[260px] space-y-4 py-4 text-sm leading-relaxed text-slate-950">
                <p v-if="currentSession">
                  Call in <span class="font-semibold uppercase">{{ currentSession.language || '—' }}</span>,
                  duration {{ formatDuration(currentSession.durationSeconds) }} on {{ formatSessionDate(currentSession.startAt) }}.
                </p>
                <p v-else class="text-slate-500">No summary available.</p>
              </div>
            </template>
          </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="deleteDialogOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-[#7f819f] p-6">
          <section class="relative w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <button
              type="button"
              class="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
              aria-label="Close delete dialog"
              @click="deleteDialogOpen = false"
            >
              <span class="text-2xl leading-none">&times;</span>
            </button>
            <h2 class="text-lg font-bold text-slate-950">Are you sure you want to delete this call recording?</h2>
            <p class="mt-4 text-sm leading-relaxed text-red-500">
              If you decide to delete, you'll lose all data related to this call. You can't recover them once deleted.
            </p>
            <footer class="mt-6 flex justify-end gap-3">
              <button type="button" class="h-10 rounded-full bg-red-500 px-5 text-sm font-semibold text-white hover:bg-red-600" @click="deleteDialogOpen = false">
                Delete
              </button>
            </footer>
          </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div
          v-if="chatDeleteDialogOpen"
          class="fixed inset-0 z-50 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
        >
          <div
            class="absolute inset-0 bg-neutral-900/35 backdrop-blur-sm"
            @click="cancelChatDelete"
          />
          <section class="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <button
              type="button"
              class="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950 disabled:opacity-40"
              aria-label="Close delete dialog"
              :disabled="deletingChat"
              @click="cancelChatDelete"
            >
              <span class="text-2xl leading-none">&times;</span>
            </button>
            <h2 class="text-lg font-bold text-slate-950">Delete this conversation?</h2>
            <p class="mt-4 text-sm leading-relaxed text-red-500">
              The chat session and all of its messages will be permanently removed. This action cannot be undone.
            </p>
            <footer class="mt-6 flex justify-end gap-3">
              <button
                type="button"
                class="h-10 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                :disabled="deletingChat"
                @click="cancelChatDelete"
              >
                Cancel
              </button>
              <button
                type="button"
                class="h-10 rounded-full bg-red-500 px-5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
                :disabled="deletingChat"
                @click="confirmChatDelete"
              >
                {{ deletingChat ? 'Deleting...' : 'Delete' }}
              </button>
            </footer>
          </section>
        </div>
      </Teleport>
    </section>
  </DashboardLayout>
</template>

<style scoped>
.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.typing-dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: #94a3b8;
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing-dots--sm span {
  width: 4px;
  height: 4px;
}
.typing-dots span:nth-child(2) { animation-delay: 0.15s; }
.typing-dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-3px); opacity: 1; }
}
</style>
