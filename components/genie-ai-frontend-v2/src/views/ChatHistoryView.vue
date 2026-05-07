<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
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
  Copy01Icon,
  Delete02Icon,
  Tick02Icon,
  FilterHorizontalIcon,
  Mic01Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
  SentIcon,
  StopCircleIcon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseDropdown from '../components/ui/BaseDropdown.vue';
import ConfirmDialog from '../components/ui/ConfirmDialog.vue';
import FlagIcon from '../components/ui/FlagIcon.vue';
import { flagForLang } from '../lib/chatStrings';
import ChatSessionListSkeleton from '../components/ui/skeletons/ChatSessionListSkeleton.vue';
import ChatMessagesSkeleton from '../components/ui/skeletons/ChatMessagesSkeleton.vue';
import CallsTableSkeleton from '../components/ui/skeletons/CallsTableSkeleton.vue';
import CallTranscriptSkeleton from '../components/ui/skeletons/CallTranscriptSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { playRecordStartChime, playRecordStopChime } from '../lib/chimes';
import { notify } from '../lib/notify';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useAuthStore } from '../stores/auth';
import { useChatHistoryStore } from '../stores/chatHistory';
import { useVoiceStore } from '../stores/voice';
import type { AiTwin, PublicAiTwin } from '../services/aiTwins';
import * as chatSessionsApi from '../services/chatSessions';
import type { ChatSessionRecord } from '../services/chatSessions';
import type { VoiceSession } from '../services/voice';
import { useT } from '../i18n/composables';

const { t } = useT();

const dateOptions = computed(() => [
  t('history.dateOptions.today', 'Today'),
  t('history.dateOptions.yesterday', 'Yesterday'),
  t('history.dateOptions.last7', 'Last 7 days'),
  t('history.dateOptions.last30', 'Last 30 days'),
  t('history.dateOptions.lastMonth', 'Last month'),
  t('history.dateOptions.custom', 'Custom Date'),
]);
const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const leftCalendar = [28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const rightCalendar = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const detailWaveformBars = [54, 72, 88, 64, 92, 46, 76, 82, 60, 78, 70, 92, 98, 74, 50, 66, 86, 44, 72, 82, 58, 74, 88, 54, 68, 38, 82, 76, 90, 48, 72, 60, 80, 44, 76, 62, 88, 54, 74, 92, 46, 66, 84, 58, 78, 52, 90, 64];

const activeTab = ref<'Chats' | 'Calls'>('Chats');
const selectedDate = ref(t('history.dateOptions.today', 'Today'));
const dateMenuOpen = ref(false);
const filterPanelOpen = ref(false);
const callDetailOpen = ref(false);
const deleteDialogOpen = ref(false);
const callToDeleteId = ref<string | null>(null);
const deletingCall = ref(false);
const detailMode = ref<'transcript' | 'summary'>('transcript');
const chatSort = ref<'newest' | 'oldest'>('newest');

const chatSearchOpen = ref(false);
const chatSearchInput = ref('');
const chatDeleteDialogOpen = ref(false);
const chatToDeleteId = ref<string | null>(null);
const mobileShowChatDetail = ref(false);

const auth = useAuthStore();
const voice = useVoiceStore();
const aiTwins = useAiTwinsStore();
const chatHistory = useChatHistoryStore();

const {
  sessions: callSessions,
  current: currentSession,
  messages: currentMessages,
  loading: callsLoading,
  loadingDetail,
  error: callsError,
  detailError,
  hasMore,
  offset: callsOffset,
  limit: callsLimit,
  twinId: callTwinIdState,
  language: callLanguageState,
  dateRange: callDateRangeState,
  sort: callSortState,
} = storeToRefs(voice);
const { twins, publicTwins } = storeToRefs(aiTwins);
const {
  sessions: chatSessions,
  loading: chatsLoading,
  error: chatsError,
  selectedSessionId,
  messages: chatMessages,
  loadingMessages,
  searchingMessages,
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
const processingVoice = ref(false);
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

const showCalendar = computed(() => selectedDate.value === t('history.dateOptions.custom', 'Custom Date'));

function chooseDate(option: string) {
  selectedDate.value = option;
}

const callDateFilter = computed<string>({
  get: () => callDateRangeState.value,
  set: (v) => {
    voice.setDateRange((v as 'all' | 'today' | 'last7' | 'last30') || 'all').catch(() => {});
  },
});

const callSort = computed<string>({
  get: () => callSortState.value,
  set: (v) => {
    voice.setSort((v as 'newest' | 'oldest' | 'longest' | 'shortest') || 'newest').catch(() => {});
  },
});

const callLanguageFilter = computed<string>({
  get: () => callLanguageState.value ?? 'all',
  set: (v) => {
    voice.setLanguage(v && v !== 'all' ? v : null).catch(() => {});
  },
});

const callTwinFilter = computed<string>({
  get: () => callTwinIdState.value ?? '',
  set: (v) => {
    voice.setTwinId(v || null).catch(() => {});
  },
});

const dateFilterOptions = computed(() => [
  { value: 'all', label: t('history.filters.allDates', 'All dates') },
  { value: 'today', label: t('history.dateOptions.today', 'Today') },
  { value: 'last7', label: t('history.dateOptions.last7', 'Last 7 days') },
  { value: 'last30', label: t('history.dateOptions.last30', 'Last 30 days') },
]);

const sortOptions = computed(() => [
  { value: 'newest', label: t('history.filters.newest', 'Newest first') },
  { value: 'oldest', label: t('history.filters.oldest', 'Oldest first') },
  { value: 'longest', label: t('history.filters.longest', 'Longest') },
  { value: 'shortest', label: t('history.filters.shortest', 'Shortest') },
]);

const chatSortOptions = computed(() => [
  { value: 'newest', label: t('history.sortOptions.newestFirst', 'Newest first') },
  { value: 'oldest', label: t('history.filters.oldest', 'Oldest first') },
]);

// TODO i18n: missing keys for channel filter labels (All channels, Chat, WhatsApp)
const typeOptions = [
  { value: '', label: 'All channels' },
  { value: 'chat', label: 'Chat' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

// TODO i18n: missing keys for scope filter labels (My sessions, All users)
const scopeOptions = [
  { value: 'me', label: 'My sessions' },
  { value: 'all', label: 'All users' },
];

const isAdmin = computed(() => auth.isAdmin);

// Admins see the privileged `/ai-twins` list (full payload + admin-only fields).
// Non-admins fall back to the sanitized `/public/ai-twins` directory so the
// dropdown filter is populated with the twins the user can actually see.
type TwinOption = Pick<AiTwin, '_key' | 'name' | 'description' | 'profilePicUrl'>;
const availableTwins = computed<TwinOption[]>(() =>
  isAdmin.value ? (twins.value as TwinOption[]) : (publicTwins.value as TwinOption[])
);

async function fetchTwins(): Promise<void> {
  if (isAdmin.value) {
    await aiTwins.fetchAll().catch(() => {});
  } else {
    await aiTwins.fetchAllPublic().catch(() => {});
  }
}

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

const languageOptions = computed(() => [
  { value: 'all', label: t('history.filters.allLanguages', 'All languages') },
  { value: 'en', label: 'English', flag: flagForLang('en') },
  { value: 'fr', label: 'Français', flag: flagForLang('fr') },
  { value: 'es', label: 'Español', flag: flagForLang('es') },
  { value: 'sw', label: 'Kiswahili', flag: flagForLang('sw') },
]);

const twinFilterOptions = computed(() =>
  availableTwins.value.map((t) => ({ value: t._key, label: t.name }))
);

const callTwinFilterOptions = computed(() => [
  { value: '', label: t('history.filters.allTwins', 'All twins') },
  ...availableTwins.value.map((tw) => ({ value: tw._key, label: tw.name })),
]);

const twinFilterValue = computed<string>({
  get: () => twinIdFilter.value ?? '',
  set: (v) => chatHistory.setTwinFilter(v || null),
});

function twinById(twinId?: string | null): TwinOption | null {
  if (!twinId) return null;
  return availableTwins.value.find((t) => t._key === twinId) ?? null;
}

// Backend now returns the chatting user on each session. Show that user
// (avatar + name) in the row instead of the AI Twin — the twin is still
// surfaced in the right-pane subtitle and via the twin filter dropdown.
function sessionTitle(session: ChatSessionRecord | null | undefined): string {
  if (!session) return '';
  const userName = session.user?.name?.trim();
  if (userName) return userName;
  if (session.phoneNumber) return session.phoneNumber;
  const twin = twinById(session.twinId);
  if (twin?.name) return twin.name;
  return session.type === 'whatsapp' ? 'WhatsApp session' : 'Chat session';
}

function sessionPreview(session: ChatSessionRecord): string {
  const last = session.lastMessage?.content?.replace(/\s+/g, ' ').trim();
  if (last) {
    return session.lastMessage?.role === 'user' ? `You: ${last}` : last;
  }
  if (session.type === 'whatsapp') {
    return session.phoneNumber ? `WhatsApp · ${session.phoneNumber}` : 'WhatsApp';
  }
  const twin = twinById(session.twinId);
  return twin?.description?.trim() || 'Chat session';
}

function sessionAvatar(session: ChatSessionRecord | null | undefined): string | null {
  if (!session) return null;
  return session.user?.profilePicUrl ?? null;
}

// Twin-side avatar for assistant message bubbles. Falls back to the twin name
// (initials) so BaseAvatar can render a placeholder when no profile pic exists.
function twinAvatarSrc(session: ChatSessionRecord | null | undefined): string | null {
  if (!session) return null;
  return twinById(session.twinId)?.profilePicUrl ?? null;
}
function twinAvatarName(session: ChatSessionRecord | null | undefined): string {
  if (!session) return 'AI Twin';
  return twinById(session.twinId)?.name ?? 'AI Twin';
}

// Right-pane subtitle: keep the twin name visible so the admin can still see
// which AI Twin the conversation was with (the title is now the user).
function sessionSubtitle(session: ChatSessionRecord | null | undefined): string {
  if (!session) return '';
  if (session.type === 'whatsapp') return 'WhatsApp conversation';
  const twin = twinById(session.twinId);
  return twin?.name ? `Chat with ${twin.name}` : 'AI Twin conversation';
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
  // Only sessions visible under current sidebar filters (e.g. twin); never fall back to
  // unfiltered sessions or a stale session from another twin remains selected.
  return sortedChatSessions.value.find((s) => s._key === selectedSessionId.value) ?? null;
});

// Server applies twinId/language/dateRange/sort filters, so we just render the
// page returned by the API.
const displayedSessions = computed<VoiceSession[]>(() => callSessions.value);

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
const fullDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
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

/** Clock time for sent-at; adds a short date when the message is not from today. */
function formatMessageSentAt(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return messageTimeFormatter.format(d);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(d);
}

function formatFullDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fullDateTimeFormatter.format(d);
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
  if (availableTwins.value.length === 0) {
    fetchTwins();
  }
  voice.fetchSessions().catch(() => {
    // store.error renders into the inline error row
  });
}

async function loadChats(): Promise<void> {
  try {
    if (availableTwins.value.length === 0) {
      await fetchTwins();
    }
    if (!twinIdFilter.value && availableTwins.value[0]) {
      chatHistory.setTwinFilter(availableTwins.value[0]._key);
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
  mobileShowChatDetail.value = true;
  if (selectedSessionId.value === sessionId) return;
  chatSearchOpen.value = false;
  chatSearchInput.value = '';
  try {
    await chatHistory.selectSession(sessionId);
  } catch {
    // messagesError renders in the chat pane
  }
}

function backToChatList(): void {
  mobileShowChatDetail.value = false;
  chatSearchOpen.value = false;
  chatSearchInput.value = '';
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMessage(content: string): string {
  const safe = escapeHtml(content ?? '');
  const term = chatSearchInput.value.trim();
  if (!term) return safe;
  const re = new RegExp(`(${escapeRegex(term)})`, 'gi');
  const style = 'background-color:#bbf7d0;color:#166534;border-radius:3px;padding:0 2px;font-weight:600;';
  return safe.replace(re, `<mark style="${style}">$1</mark>`);
}

function openChatDeleteDialog(): void {
  if (!selectedChatSession.value || !selectedSessionId.value) return;
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
  // TODO i18n: missing keys for these composer placeholders
  if (!selectedChatSession.value) return 'Select a conversation to start typing...';
  if (selectedChatSession.value.type === 'whatsapp') return 'Replies in WhatsApp sessions are not available here.';
  return t('history.typeMessage', 'Type your message here...');
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
    notify.error(
      t('history.toasts.sendFailedTitle', 'Send failed'),
      e?.response?.data?.message ?? e?.message ?? t('history.toasts.sendFailedBody', 'Could not deliver message.'),
    );
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
    notify.error(
      t('chat.voiceUnsupportedTitle', 'Recording not supported'),
      t('chat.voiceUnsupportedBody', 'Your browser cannot record audio.'),
    );
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    notify.error(
      t('chat.micUnavailableTitle', 'Microphone unavailable'),
      e?.name === 'NotAllowedError'
        ? t('chat.micPermissionDenied', 'Permission denied. Allow microphone access and try again.')
        : e?.message ?? t('chat.micGenericError', 'Could not access the microphone.'),
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
      t('chat.recordingFailedTitle', 'Recording failed'),
      t('chat.recordingFailedBody', 'Could not initialize the recorder.'),
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
  if (!selectedSessionId.value) return;
  processingVoice.value = true;
  try {
    await chatHistory.sendVoice(blob);
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const message =
      e?.response?.data?.message ??
      (status === 413
        ? t('chat.voiceTooLarge', 'Recording is too large (max 10 MB).')
        : status === 502
          ? t('chat.voiceServiceUnavailable', 'Voice transcription service is temporarily unavailable.')
          : e?.message ?? t('chat.voiceGenericError', 'Could not send voice message.'));
    notify.error(t('chat.voiceFailedTitle', 'Voice message failed'), message);
  } finally {
    processingVoice.value = false;
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

function preloadAudioDuration(messageId: string, audioUrl: string): void {
  const state = ensureAudioState(messageId);
  if (state.duration > 0 || state.audio) return;
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.src = audioUrl;
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) state.duration = audio.duration;
  });
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

// Per-message "just copied" flag — flips a button's icon to a check for ~2s
// after a successful copy, then reverts to the copy glyph. Keyed by message
// _key so multiple copies don't fight over a shared timer. Falls back to a
// random per-render id when the message has no _key so the visual feedback
// still works even when the backend omits message ids.
const copiedFlags = reactive<Record<string, boolean>>({});
const copiedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function flagCopied(key: string): void {
  copiedFlags[key] = true;
  if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
  copiedTimers[key] = setTimeout(() => {
    copiedFlags[key] = false;
  }, 2000);
}

// Fallback for environments where the async Clipboard API is unavailable
// (insecure context, older browsers). Returns true on success.
function legacyCopyToClipboard(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function copyKey(message: { _key?: string; content?: string | null | undefined }): string {
  return message._key ?? `idx-${(message.content ?? '').slice(0, 32)}`;
}

async function copyMessage(message: { _key?: string; content: string | null | undefined }): Promise<void> {
  const text = message.content;
  if (!text) return;
  const key = copyKey(message);
  let ok = false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      ok = legacyCopyToClipboard(text);
    }
  } catch {
    ok = legacyCopyToClipboard(text);
  }
  if (ok) {
    flagCopied(key);
    notify.success(t('chat.copied', 'Copied to clipboard'));
  } else {
    notify.error(t('chat.copyFailed', 'Copy failed'));
  }
}

async function toggleMessageAudio(message: { _key?: string; role: string; audioUrl?: string | null }): Promise<void> {
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
      const direct = message.audioUrl;
      if (
        direct &&
        (direct.startsWith('blob:') ||
          direct.startsWith('http') ||
          direct.startsWith('data:') ||
          direct.startsWith('/'))
      ) {
        state.url = direct;
      } else {
        state.loading = true;
        const blob = await chatSessionsApi.fetchMessageAudio(selectedSessionId.value, messageId);
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
        ? t('chat.audioNotFound', 'Audio for this message could not be found.')
        : status === 502
          ? t('chat.audioServiceUnavailable', 'Voice synthesis is temporarily unavailable.')
          : e?.message ?? t('chat.audioGenericError', 'Could not play audio.');
    notify.error(t('chat.playbackFailedTitle', 'Playback failed'), e?.response?.data?.message ?? fallback);
  } finally {
    state.loading = false;
  }
}

watch(
  () => chatMessages.value.length,
  () => {
    scrollMessagesToBottom();
    for (const message of chatMessages.value) {
      if (message.role === 'user' && message._key && message.audioUrl) {
        preloadAudioDuration(message._key, message.audioUrl);
      }
    }
  },
  { immediate: true },
);

watch(sortedChatSessions, (sessions) => {
  const sid = selectedSessionId.value;
  if (!sid || sessions.some((s) => s._key === sid)) return;
  chatHistory.clearSelection();
});

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
      t('history.toasts.deletedTitle', 'Conversation deleted'),
      deletedMessages > 0
        ? deletedMessages === 1
          ? t('history.toasts.deletedBodyOne', '1 message removed.')
          : t('history.toasts.deletedBodyMany', { count: deletedMessages }, '{count} messages removed.')
        : undefined,
    );
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = e?.response?.status;
    const message =
      e?.response?.data?.message ??
      (status === 403
        ? t('history.toasts.deleteForbidden', "You don't have permission to delete this conversation.")
        : status === 404
          ? t('history.toasts.deleteNotFound', 'This conversation no longer exists.')
          : e?.message ?? t('history.toasts.deleteFailed', 'Failed to delete conversation'));
    notify.error(t('history.toasts.deleteFailedTitle', 'Delete failed'), message);
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

function openDeleteCallDialog(session: VoiceSession): void {
  callToDeleteId.value = session._key;
  deleteDialogOpen.value = true;
}

function cancelDeleteCall(): void {
  if (deletingCall.value) return;
  deleteDialogOpen.value = false;
  callToDeleteId.value = null;
}

async function confirmDeleteCall(): Promise<void> {
  if (!callToDeleteId.value) {
    deleteDialogOpen.value = false;
    return;
  }
  // Backend deletion is not wired yet; close cleanly so the dialog matches
  // the delete-twin / logout flow visually without orphaning state.
  deletingCall.value = true;
  try {
    deleteDialogOpen.value = false;
    callToDeleteId.value = null;
  } finally {
    deletingCall.value = false;
  }
}

const pageSizeOptions = computed(() =>
  pageSizes.map((n) => ({ value: String(n), label: String(n) }))
);

const pageSizeValue = computed<string>({
  get: () => String(callsLimit.value),
  set: (v) => {
    const next = Number(v);
    if (Number.isFinite(next) && next > 0) voice.setLimit(next);
  },
});

watch(activeTab, (tab) => {
  if (tab === 'Calls' && callSessions.value.length === 0 && !callsLoading.value) {
    loadCalls();
  }
  if (tab === 'Chats' && chatSessions.value.length === 0 && !chatsLoading.value) {
    loadChats();
  }
}, { immediate: false });

// Auto-select the first twin in the chat-filter dropdown as soon as twins
// arrive, so the chat panel never sits empty on first paint. Fires whenever
// the available list changes (admin login, language reload, etc.) and the
// user hasn't picked one yet.
watch(
  availableTwins,
  (list) => {
    if (!twinIdFilter.value && list.length > 0) {
      chatHistory.setTwinFilter(list[0]._key);
    }
  },
  { immediate: true }
);

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
          <h1 class="text-lg font-bold text-slate-900">{{ t('history.title', 'Chat/Call History') }}</h1>
          <div class="inline-flex w-fit gap-1 rounded-full border border-slate-200 bg-slate-50 p-1" role="tablist" :aria-label="t('history.aria.historyType', 'History type')">
            <button
              v-for="tab in ['Chats', 'Calls']"
              :key="tab"
              type="button"
              :class="[
                'whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium transition',
                activeTab === tab
                  ? 'bg-white text-ieee-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800',
              ]"
              @click="activeTab = tab as 'Chats' | 'Calls'"
            >
              {{ tab === 'Chats' ? t('history.tabs.chats', 'Chats') : t('history.tabs.calls', 'Calls') }}
            </button>
          </div>
        </header>

        <div v-if="activeTab === 'Chats'" class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:grid-cols-[minmax(250px,330px)_minmax(0,1fr)]">
          <aside
            :class="[
              'relative z-10 min-h-0 flex-col overflow-hidden bg-white lg:flex lg:max-h-none lg:border-b-0 lg:border-r',
              mobileShowChatDetail ? 'hidden' : 'flex',
            ]"
          >
            <div
              class="relative z-20 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 border-b border-slate-100 px-3 py-4"
            >
              <BaseDropdown
                v-model="twinFilterValue"
                :options="twinFilterOptions"
                :placeholder="t('history.aiTwin', 'AI Twin')"
                width="w-full"
              />
              <BaseDropdown
                v-model="typeFilterValue"
                :options="typeOptions"
                :placeholder="t('history.channelPlaceholder', 'Channel')"
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
                :aria-label="t('history.aria.openFilters', 'Open filters')"
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
                  <button type="button" class="grid h-7 place-items-center rounded-md hover:bg-slate-100" :aria-label="t('common.previousMonth', 'Previous month')">
                    <Icon :icon="ArrowLeft01Icon" :size="16" />
                  </button>
                  <span>December 2021</span>
                  <span class="hidden sm:block">December 2021</span>
                  <button type="button" class="grid h-7 place-items-center rounded-md hover:bg-slate-100" :aria-label="t('common.nextMonth', 'Next month')">
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
                v-if="isAdmin"
                v-model="scopeFilterValue"
                :options="scopeOptions"
                :placeholder="t('history.scopePlaceholder', 'Scope')"
                width="w-full"
              />
              <BaseDropdown
                v-model="chatSort"
                :options="chatSortOptions"
                :placeholder="t('history.sortBy', 'Sort By')"
                width="w-full"
              />
              <input
                v-if="showPhoneFilter"
                type="tel"
                inputmode="tel"
                :value="phoneInput"
                :placeholder="t('history.phonePlaceholder', 'Phone number')"
                class="h-10 w-full rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-ieee-700"
                @input="onPhoneInput"
              />
            </div>

            <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <ChatSessionListSkeleton
                v-if="chatsLoading && chatSessions.length === 0"
                :rows="6"
              />

              <div v-else-if="chatsError" class="flex flex-col items-start gap-2 px-3 py-4 text-xs text-red-600">
                <span>{{ chatsError }}</span>
                <button
                  type="button"
                  class="rounded-full border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                  @click="loadChats"
                >
                  {{ t('common.retry', 'Retry') }}
                </button>
              </div>

              <div v-else-if="sortedChatSessions.length === 0" class="grid flex-1 place-items-center px-3 py-8">
                <EmptyState
                  :icon="BubbleChatIcon"
                  :title="chatSessions.length === 0 ? t('history.noChatsTitle', 'No chats yet') : t('history.noMatchesTitle', 'No matches')"
                  :description="chatSessions.length === 0
                    ? t('history.noChatsBody', 'Conversations with your AI Twins will appear here.')
                    : t('history.noMatchesBody', 'No calls match the current filters.')"
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

          <article
            :class="[
              'min-h-0 min-w-0 flex-col bg-white lg:flex',
              mobileShowChatDetail ? 'flex' : 'hidden',
            ]"
          >
            <header v-if="selectedChatSession" class="relative flex items-center justify-between gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3">
              <div class="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-ieee-800 lg:hidden"
                  :aria-label="t('history.aria.backToList', 'Back to conversations')"
                  @click="backToChatList"
                >
                  <Icon :icon="ArrowLeft01Icon" :size="18" />
                </button>
                <BaseAvatar :src="sessionAvatar(selectedChatSession)" :name="sessionTitle(selectedChatSession)" size="sm" badge="online" />
                <div class="min-w-0">
                  <h2 class="truncate text-sm font-bold text-slate-700">{{ sessionTitle(selectedChatSession) }}</h2>
                  <p class="mt-0.5 truncate text-[11px] text-slate-400">
                    {{ sessionSubtitle(selectedChatSession) }}
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
                  :aria-label="t('history.aria.searchConversation', 'Search conversation')"
                  @click="toggleChatSearch"
                >
                  <Icon :icon="Search01Icon" :size="19" />
                </button>
                <button
                  type="button"
                  class="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  :aria-label="t('history.aria.deleteConversation', 'Delete conversation')"
                  title="Delete conversation"
                  :disabled="!selectedChatSession"
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
                  :placeholder="t('history.searchPlaceholder', 'Search in messages...')"
                  class="h-9 min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                  @input="onChatSearchInput"
                />
                <span v-if="searchingMessages" class="search-spinner" aria-hidden="true" />
                <button
                  v-if="chatSearchInput && !searchingMessages"
                  type="button"
                  class="text-slate-400 transition hover:text-slate-700"
                  :aria-label="t('twins.list.clearSearch', 'Clear search')"
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
              <ChatMessagesSkeleton v-if="loadingMessages" />

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
                  {{ t('common.retry', 'Retry') }}
                </button>
              </div>

              <div v-else-if="!selectedChatSession" class="grid h-full place-items-center">
                <EmptyState
                  :icon="BubbleChatIcon"
                  :title="t('history.pickConversationTitle', 'Select a conversation')"
                  :description="t('history.pickConversationBody', 'Pick a chat on the left to read its full history.')"
                />
              </div>

              <div v-else-if="chatMessages.length === 0" class="grid h-full place-items-center">
                <EmptyState
                  :icon="BubbleChatIcon"
                  :title="chatSearchInput ? t('history.noMatchesTitle', 'No matches') : t('history.noMessagesTitle', 'No messages yet')"
                  :description="chatSearchInput
                    ? t('history.searchNoMatchesBody', { query: chatSearchInput }, 'No messages contain &quot;{query}&quot;.')
                    : t('history.noMessagesBody', 'This conversation does not contain any messages.')"
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
                    :src="twinAvatarSrc(selectedChatSession)"
                    :name="twinAvatarName(selectedChatSession)"
                    size="xs"
                  />
                  <div :class="['flex max-w-[86%] flex-col gap-1 md:max-w-[430px]', message.role === 'user' && 'items-end']">
                    <div
                      v-if="message.role === 'user' && message.audioUrl && message._key"
                      class="flex items-center gap-3 rounded-2xl rounded-tr-md bg-ieee-700 px-3 py-2.5 text-white shadow-sm"
                      :title="message.createdAt ? formatFullDateTime(message.createdAt) : undefined"
                    >
                      <button
                        type="button"
                        class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-50"
                        :aria-label="assistantAudio[message._key]?.playing ? t('history.aria.pauseVoiceNote', 'Pause voice note') : t('history.aria.playVoiceNote', 'Play voice note')"
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
                      :title="message.createdAt ? formatFullDateTime(message.createdAt) : undefined"
                    >
                      <p v-html="highlightMessage(message.content)" />
                    </div>
                    <div
                      :class="[
                        'flex items-center gap-2',
                        message.role === 'user' && 'justify-end',
                      ]"
                    >
                      <time
                        v-if="message.createdAt"
                        class="text-[11px] tabular-nums text-slate-500"
                        :datetime="message.createdAt"
                        :title="formatFullDateTime(message.createdAt)"
                      >{{ formatMessageSentAt(message.createdAt) }}</time>
                      <button
                        v-if="message.role === 'assistant' && message.content"
                        type="button"
                        class="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-ieee-50 hover:text-ieee-800"
                        :aria-label="copiedFlags[copyKey(message)] ? t('chat.copied', 'Copied') : t('chat.copy', 'Copy')"
                        :title="copiedFlags[copyKey(message)] ? t('chat.copied', 'Copied') : t('chat.copy', 'Copy')"
                        @click="copyMessage(message)"
                      >
                        <Icon
                          :icon="copiedFlags[copyKey(message)] ? Tick02Icon : Copy01Icon"
                          :size="12"
                          :class="copiedFlags[copyKey(message)] ? 'text-green-600' : ''"
                        />
                      </button>
                      <button
                        v-if="message.role === 'assistant' && message._key"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-ieee-50 hover:text-ieee-800 disabled:opacity-50"
                        :aria-label="assistantAudio[message._key]?.playing ? t('history.aria.pauseAudio', 'Pause audio') : t('history.aria.playAudio', 'Play audio')"
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
                        {{ assistantAudio[message._key]?.playing ? t('chat.playing', 'Playing') : t('chat.listen', 'Listen') }}
                      </button>
                    </div>
                  </div>
                  <BaseAvatar v-if="message.role === 'user'" :name="callerName" size="xs" />
                </div>

                <div
                  v-if="processingVoice"
                  class="mb-5 flex items-start justify-end gap-2.5"
                  aria-live="polite"
                  :aria-label="t('history.aria.processingVoice', 'Processing voice message')"
                >
                  <div class="flex flex-col items-end gap-1">
                    <div class="rounded-2xl rounded-tr-md bg-ieee-700 px-3.5 py-3 text-white shadow-sm">
                      <span class="typing-dots typing-dots--invert" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                    <span class="text-[11px] text-slate-400">{{ t('history.processing', 'Processing your voice message…') }}</span>
                  </div>
                  <BaseAvatar :name="callerName" size="xs" />
                </div>

                <div
                  v-else-if="sendingChat"
                  class="mb-5 flex items-start gap-2.5"
                  aria-live="polite"
                  :aria-label="t('history.aria.assistantTyping', 'Assistant is typing')"
                >
                  <BaseAvatar
                    :src="twinAvatarSrc(selectedChatSession)"
                    :name="twinAvatarName(selectedChatSession)"
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
                    <span class="text-[11px] text-slate-400">
                      {{ sessionTitle(selectedChatSession) }} is typing…
                    </span>
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
                    :aria-label="t('history.aria.recordVoice', 'Record voice message')"
                    :disabled="composerDisabled"
                    @click="startRecording"
                  >
                    <Icon :icon="Mic01Icon" :size="18" />
                  </button>
                </label>
                <button
                  type="button"
                  class="grid h-11 w-11 place-items-center rounded-full bg-ieee-700 text-white transition hover:bg-ieee-800 disabled:cursor-not-allowed disabled:opacity-40"
                  :aria-label="t('history.aria.sendMessage', 'Send message')"
                  :disabled="composerDisabled || !composerDraft.trim()"
                  @click="sendComposerMessage"
                >
                  <Icon :icon="ArrowRight01Icon" :size="21" />
                </button>
              </template>

              <div
                v-else
                class="recorder-bar flex min-w-0 flex-1 items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm"
                role="status"
                aria-live="polite"
              >
                <span class="recorder-led" aria-hidden="true">
                  <span class="recorder-led__core" />
                  <span class="recorder-led__halo" />
                </span>

                <span class="shrink-0 text-xs font-semibold tabular-nums text-slate-700">
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
                  class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  :aria-label="t('history.aria.cancelRecording', 'Cancel recording')"
                  @click="cancelRecording"
                >
                  <Icon :icon="Cancel01Icon" :size="14" />
                  Cancel
                </button>
                <button
                  type="button"
                  class="inline-flex h-10 items-center gap-2 rounded-full bg-ieee-700 px-4 text-xs font-semibold text-white shadow-md transition hover:bg-ieee-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ieee-700"
                  :aria-label="t('history.aria.stopAndSend', 'Stop and send recording')"
                  @click="stopRecording"
                >
                  <Icon :icon="SentIcon" :size="16" />
                  Send
                </button>
              </div>
            </footer>
          </article>
        </div>

        <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <BaseDropdown
              v-model="callTwinFilter"
              :options="callTwinFilterOptions"
              :placeholder="t('history.aiTwin', 'AI Twin')"
            />
            <BaseDropdown
              v-model="callDateFilter"
              :options="dateFilterOptions"
              :placeholder="t('history.selectDate', 'Select Date')"
            />
            <BaseDropdown
              v-model="callSort"
              :options="sortOptions"
              :placeholder="t('history.sortBy', 'Sort By')"
            />
            <BaseDropdown
              v-model="callLanguageFilter"
              :options="languageOptions"
              :placeholder="t('history.columns.language', 'Language')"
            />
          </div>

          <div class="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div class="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_0.8fr_1.2fr_48px] gap-2 border-b border-neutral-100 bg-neutral-50/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>{{ t('history.columns.language', 'Language') }}</span>
              <span>{{ t('history.columns.date', 'Date') }}</span>
              <span>{{ t('history.columns.startTime', 'Start Time') }}</span>
              <span>{{ t('history.columns.endTime', 'End Time') }}</span>
              <span>{{ t('history.columns.duration', 'Duration') }}</span>
              <span>{{ t('history.columns.gender', 'Gender') }}</span>
              <span>{{ t('history.aiTwin', 'AI Twin') }}</span>
              <span />
            </div>
            <div class="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
              <CallsTableSkeleton
                v-if="callsLoading && callSessions.length === 0"
                :rows="6"
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
                  {{ t('common.retry', 'Retry') }}
                </button>
              </div>

              <div v-else-if="displayedSessions.length === 0" class="px-5 py-12">
                <EmptyState
                  :icon="CallEnd01Icon"
                  :title="callSessions.length === 0 ? t('history.noCallsTitle', 'No calls yet') : t('history.noMatchesTitle', 'No matches')"
                  :description="callSessions.length === 0
                    ? t('history.noCallsBody', 'Voice calls you make will appear here once they finish.')
                    : t('history.noMatchesBody', 'No calls match the current filters.')"
                />
              </div>

              <div
                v-for="record in displayedSessions"
                v-else
                :key="record._key"
                class="group grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_0.8fr_1.2fr_48px] items-center gap-2 px-5 py-3 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                <button type="button" class="flex items-center gap-3 text-left" @click="openCallDetails(record, 'transcript')">
                  <span class="grid h-9 w-9 place-items-center rounded-full bg-ieee-50 text-ieee-700 transition group-hover:bg-ieee-100">
                    <Icon :icon="CallIcon" :size="16" />
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                    <FlagIcon v-if="record.language" :code="flagForLang(record.language)" :width="18" shape="circle" />
                    {{ record.language || '—' }}
                  </span>
                </button>
                <span class="tabular-nums">{{ formatSessionDate(record.startAt) }}</span>
                <span class="tabular-nums">{{ formatSessionTime(record.startAt) }}</span>
                <span class="tabular-nums">{{ formatSessionTime(record.endAt) }}</span>
                <span class="font-semibold text-slate-700 tabular-nums">{{ formatDuration(record.durationSeconds ?? 0) }}</span>
                <span>
                  <span
                    v-if="record.gender"
                    :class="[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
                      record.gender === 'female'
                        ? 'bg-pink-50 text-pink-600'
                        : record.gender === 'male'
                          ? 'bg-sky-50 text-sky-600'
                          : 'bg-slate-100 text-slate-600',
                    ]"
                  >
                    {{ record.gender }}
                  </span>
                  <span v-else class="text-slate-400">—</span>
                </span>
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-2 text-left transition hover:text-ieee-800"
                  @click="openCallDetails(record, 'summary')"
                >
                  <BaseAvatar
                    :src="twinById(record.twinId)?.profilePicUrl ?? undefined"
                    :name="twinById(record.twinId)?.name ?? 'AI Twin'"
                    size="xs"
                  />
                  <span class="truncate font-medium text-slate-700">
                    {{ twinById(record.twinId)?.name ?? '—' }}
                  </span>
                </button>
                <button
                  type="button"
                  class="grid h-9 w-9 place-items-center justify-self-end rounded-full text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
                  :aria-label="t('history.aria.deleteCall', 'Delete call')"
                  @click="openDeleteCallDialog(record)"
                >
                  <Icon :icon="Delete02Icon" :size="16" />
                </button>
              </div>
            </div>
            <footer class="flex items-center justify-end gap-6 border-t border-neutral-100 bg-neutral-50/40 px-5 py-3 text-xs font-medium text-slate-500">
              <div class="inline-flex items-center gap-2">
                <span>{{ t('history.rowsPerPage', 'Rows per page:') }}</span>
                <BaseDropdown v-model="pageSizeValue" :options="pageSizeOptions" width="w-20" />
              </div>
              <span>{{ displayedRangeStart }}-{{ displayedRangeEnd }}</span>
              <button
                type="button"
                class="text-slate-400 transition hover:text-ieee-800 disabled:cursor-not-allowed disabled:opacity-40"
                :aria-label="t('common.previousPage', 'Previous page')"
                :disabled="callsOffset === 0 || callsLoading"
                @click="voice.prevPage()"
              >
                <Icon :icon="ArrowLeft01Icon" :size="17" />
              </button>
              <button
                type="button"
                class="text-slate-700 transition hover:text-ieee-800 disabled:cursor-not-allowed disabled:opacity-40"
                :aria-label="t('common.nextPage', 'Next page')"
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
        <div v-if="callDetailOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div class="absolute inset-0 bg-neutral-900/35 backdrop-blur-sm" @click="closeCallDetails" />
          <section class="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_24px_64px_-16px_rgba(15,23,42,0.35)]">
            <header class="flex items-start justify-between gap-4 px-6 pt-6">
              <div class="min-w-0">
                <h2 class="text-lg font-semibold text-slate-900">{{ t('history.callDetails', 'Call Details') }}</h2>
                <div v-if="currentSession" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span v-if="twinById(currentSession.twinId)?.name" class="font-semibold text-slate-700">
                    {{ twinById(currentSession.twinId)?.name }}
                  </span>
                  <span v-if="twinById(currentSession.twinId)?.name" class="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
                  <span>{{ formatSessionDate(currentSession.startAt) }}</span>
                  <span class="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
                  <span>{{ formatSessionTime(currentSession.startAt) }}</span>
                  <span class="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
                  <span>{{ formatDuration(currentSession.durationSeconds ?? 0) }}</span>
                  <span
                    v-if="currentSession.language"
                    class="ml-1 inline-flex items-center gap-1.5 rounded-full bg-violet-50 py-0.5 pl-0.5 pr-2 text-[10px] font-semibold uppercase tracking-wide text-violet-600"
                  >
                    <FlagIcon :code="flagForLang(currentSession.language)" :width="14" shape="circle" />
                    {{ currentSession.language }}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
                :aria-label="t('history.aria.closeCallDetails', 'Close call details')"
                @click="closeCallDetails"
              >
                <Icon :icon="Cancel01Icon" :size="16" />
              </button>
            </header>

            <div class="mt-5 px-6">
              <div class="inline-flex w-full gap-1 rounded-full bg-slate-100 p-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="detailMode === 'transcript'"
                  :class="[
                    'flex-1 rounded-full py-2 text-xs font-semibold transition',
                    detailMode === 'transcript' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  ]"
                  @click="detailMode = 'transcript'"
                >
                  {{ t('history.transcript', 'Transcript') }}
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="detailMode === 'summary'"
                  :class="[
                    'flex-1 rounded-full py-2 text-xs font-semibold transition',
                    detailMode === 'summary' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  ]"
                  @click="detailMode = 'summary'"
                >
                  {{ t('history.summary', 'Summary') }}
                </button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
              <CallTranscriptSkeleton v-if="loadingDetail" />
              <div v-else-if="detailError" class="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{{ detailError }}</div>
              <template v-else>
                <div v-if="detailMode === 'transcript'" class="min-h-[240px] space-y-3">
                  <template v-if="currentMessages.length">
                    <div
                      v-for="msg in currentMessages"
                      :key="msg._key"
                      :class="['flex items-start gap-2.5', msg.isAssistant ? 'justify-start' : 'flex-row-reverse']"
                    >
                      <BaseAvatar
                        v-if="msg.isAssistant"
                        :src="twinById(currentSession?.twinId)?.profilePicUrl ?? undefined"
                        :name="twinById(currentSession?.twinId)?.name ?? 'AI Twin'"
                        size="xs"
                      />
                      <BaseAvatar v-else :name="callerName" size="xs" />
                      <div class="flex max-w-[78%] flex-col gap-1" :class="msg.isAssistant ? 'items-start' : 'items-end'">
                        <span class="px-1 text-[11px] font-semibold" :class="msg.isAssistant ? 'text-ieee-700' : 'text-slate-500'">
                          {{ msg.isAssistant ? (twinById(currentSession?.twinId)?.name ?? 'AI Twin') : 'You' }}
                        </span>
                        <p
                          :class="[
                            'whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
                            msg.isAssistant
                              ? 'rounded-tl-md bg-slate-50 text-slate-800'
                              : 'rounded-tr-md bg-ieee-700 text-white',
                          ]"
                        >
                          {{ msg.content }}
                        </p>
                      </div>
                    </div>
                  </template>
                  <div v-else class="grid place-items-center py-12 text-sm text-slate-500">
                    No transcript available for this call.
                  </div>
                </div>

                <div v-else class="min-h-[240px] space-y-3 text-sm leading-relaxed">
                  <div v-if="currentSession" class="grid grid-cols-2 gap-3 sm:grid-cols-2">
                    <div class="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                      <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{{ t('history.aiTwin', 'AI Twin') }}</p>
                      <div class="mt-1 flex items-center gap-2">
                        <BaseAvatar
                          :src="twinById(currentSession.twinId)?.profilePicUrl ?? undefined"
                          :name="twinById(currentSession.twinId)?.name ?? 'AI Twin'"
                          size="xs"
                        />
                        <p class="truncate font-semibold text-slate-900">{{ twinById(currentSession.twinId)?.name ?? '—' }}</p>
                      </div>
                    </div>
                    <div class="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                      <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{{ t('history.columns.language', 'Language') }}</p>
                      <div class="mt-1 flex items-center gap-2">
                        <FlagIcon v-if="currentSession.language" :code="flagForLang(currentSession.language)" :width="18" shape="circle" />
                        <p class="font-semibold uppercase text-slate-900">{{ currentSession.language || '—' }}</p>
                      </div>
                    </div>
                    <div class="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                      <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{{ t('history.columns.duration', 'Duration') }}</p>
                      <p class="mt-1 font-semibold text-slate-900">{{ formatDuration(currentSession.durationSeconds ?? 0) }}</p>
                    </div>
                    <div class="rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                      <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{{ t('history.columns.date', 'Date') }}</p>
                      <p class="mt-1 font-semibold text-slate-900">{{ formatSessionDate(currentSession.startAt) }}</p>
                    </div>
                  </div>
                  <p v-else class="text-slate-500">No summary available.</p>
                </div>
              </template>
            </div>
          </section>
        </div>
      </Teleport>

      <ConfirmDialog
        v-model:open="deleteDialogOpen"
        :title="t('history.deleteCallTitle', 'Are you sure you want to delete this call recording?')"
        :description="t('history.deleteCallBody', `If you decide to delete, you'll lose all data related to this call. You can't recover them once deleted.`)"
        :confirm-label="t('common.delete', 'Delete')"
        :loading="deletingCall"
        @confirm="confirmDeleteCall"
        @cancel="cancelDeleteCall"
      />

      <ConfirmDialog
        v-model:open="chatDeleteDialogOpen"
        :title="t('history.deleteConvoTitle', 'Delete this conversation?')"
        :description="t('history.deleteConvoBody', 'The chat session and all of its messages will be permanently removed.')"
        :confirm-label="t('common.delete', 'Delete')"
        :loading="deletingChat"
        @confirm="confirmChatDelete"
        @cancel="cancelChatDelete"
      />
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
.typing-dots--invert span {
  background-color: rgba(255, 255, 255, 0.85);
}
.typing-dots span:nth-child(2) { animation-delay: 0.15s; }
.typing-dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-3px); opacity: 1; }
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
  background: #94a3b8;
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

.search-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  border: 2px solid #cbd5e1;
  border-top-color: #1d4ed8;
  animation: search-spinner-rotate 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes search-spinner-rotate {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .recorder-led__core,
  .recorder-led__halo,
  .recorder-wave__bar,
  .search-spinner {
    animation: none;
  }
  .recorder-wave__bar {
    height: 50%;
    opacity: 0.7;
  }
}
</style>
