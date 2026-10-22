import { defineStore } from 'pinia';
import { DEFAULT_CHAT_LANG, type ChatLang } from '../lib/chatStrings';
import {
  createChatSession,
  createPublicChatSession,
  fetchMessageAudio,
  getChatSessionMessages,
  getPublicChatSessionMessages,
  fetchPublicMessageAudio,
  sendChatMessage,
  sendPublicChatMessage,
  sendPublicVoiceMessage,
  sendVoiceMessage,
  type SendVoiceMessageOptions,
  type SourceDocument,
} from '../services/chatSessions';
import { readSession } from '../services/http';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  serverId?: string;
  role: ChatRole;
  text: string;
  /** ISO-639-1 language tag for the message body. Drives dynamic translation. */
  lang?: string;
  audioUrl?: string | null;
  createdAt: Date;
  streaming?: boolean;
  errored?: boolean;
  /** KB documents that provided context for this assistant reply. */
  sourceDocuments?: SourceDocument[];
  /** Overall RAG confidence score (0–1) for this reply. */
  confidenceScore?: number;
}

interface ChatState {
  currentTwinId: string | null;
  sessionId: string | null;
  // Guests only: the id the backend requires with every request for the session.
  guestId: string | null;
  messages: ChatMessage[];
  sending: boolean;
  // True while a stored session is being fetched after a reload — lets the
  // view suppress the empty/welcome state during the brief restore window.
  restoring: boolean;
  lang: ChatLang;
}

const CHAT_LANG_STORAGE_KEY = 'chat.lang.v2';
// Map of twinId -> active sessionId. Lets a reloaded chat page resume the
// same conversation rather than starting a new session — only "New chat"
// (resetConversation) drops the entry.
const ACTIVE_SESSIONS_STORAGE_KEY = 'chat.activeSessions.v1';
// Guests: twinId -> { sessionId, guestId } in sessionStorage instead, so a
// guest chat lasts only as long as the tab: a new tab or window starts fresh,
// while a reload, a duplicated tab or a browser session restore keep it.
const GUEST_SESSIONS_STORAGE_KEY = 'chat.guestSessions.v1';

interface StoredSession {
  sessionId: string;
  guestId: string | null;
}

function readPersistedChatLang(): ChatLang {
  if (typeof window === 'undefined') return DEFAULT_CHAT_LANG;
  const stored = window.localStorage.getItem(CHAT_LANG_STORAGE_KEY);
  if (stored && /^[a-z]{2,8}(-[A-Za-z0-9]+)?$/.test(stored)) {
    return stored as ChatLang;
  }
  return DEFAULT_CHAT_LANG;
}

function readActiveSessionsMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && k && typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeActiveSessionsMap(map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_SESSIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota or disabled storage — non-fatal; resume just won't work.
  }
}

function readGuestSessionsMap(): Record<string, StoredSession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(GUEST_SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, StoredSession> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = v as { sessionId?: unknown; guestId?: unknown } | null;
      const { sessionId, guestId } = entry ?? {};
      if (k && typeof sessionId === 'string' && sessionId && typeof guestId === 'string' && guestId) {
        out[k] = { sessionId, guestId };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeGuestSessionsMap(map: Record<string, StoredSession>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(GUEST_SESSIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota or disabled storage — non-fatal; resume just won't work.
  }
}

function readActiveSessionForTwin(twinId: string): StoredSession | null {
  if (!twinId) return null;
  if (!readSession()) return readGuestSessionsMap()[twinId] ?? null;
  const sessionId = readActiveSessionsMap()[twinId];
  return sessionId ? { sessionId, guestId: null } : null;
}

function writeActiveSessionForTwin(twinId: string, sessionId: string): void {
  if (!twinId || !sessionId) return;
  const map = readActiveSessionsMap();
  map[twinId] = sessionId;
  writeActiveSessionsMap(map);
}

function writeGuestSessionForTwin(twinId: string, sessionId: string, guestId: string): void {
  if (!twinId || !sessionId || !guestId) return;
  const map = readGuestSessionsMap();
  map[twinId] = { sessionId, guestId };
  writeGuestSessionsMap(map);
}

// Clears both maps: right after a sign-out the entry to drop is a signed-in one.
function clearActiveSessionForTwin(twinId: string | null): void {
  if (!twinId) return;
  const map = readActiveSessionsMap();
  if (twinId in map) {
    delete map[twinId];
    writeActiveSessionsMap(map);
  }
  const guestMap = readGuestSessionsMap();
  if (twinId in guestMap) {
    delete guestMap[twinId];
    writeGuestSessionsMap(guestMap);
  }
}

function makeId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}

function latestAssistantMessageId(messages: { _key?: string; role: string }[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg._key) return msg._key;
  }
  return undefined;
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    currentTwinId: null,
    sessionId: null,
    guestId: null,
    messages: [],
    sending: false,
    restoring: false,
    lang: readPersistedChatLang(),
  }),

  actions: {
    setTwinContext(twinId: string | null): void {
      if (this.currentTwinId === twinId) return;
      this.currentTwinId = twinId;
      this.sessionId = null;
      this.guestId = null;
      this.messages = [];
    },

    setLanguage(lang: ChatLang): void {
      if (!lang) return;
      this.lang = lang;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(CHAT_LANG_STORAGE_KEY, lang);
      }
    },

    resetConversation(): void {
      // Drop the persisted resume entry so the next reload starts fresh too.
      clearActiveSessionForTwin(this.currentTwinId);
      this.sessionId = null;
      this.guestId = null;
      this.messages = [];
    },

    async ensureSession(): Promise<string | null> {
      if (this.sessionId) return this.sessionId;
      if (readSession()) {
        if (!this.currentTwinId) return null;
        const sessionId = await createChatSession(this.currentTwinId);
        this.sessionId = sessionId;
        writeActiveSessionForTwin(this.currentTwinId, sessionId);
        return sessionId;
      }
      // Guest path — the twin from the link, or the default twin when there is
      // none; the backend returns the id it used.
      const res = await createPublicChatSession(this.currentTwinId ?? undefined);
      this.sessionId = res.sessionId;
      this.guestId = res.guestId;
      this.currentTwinId = res.twinId;
      writeGuestSessionForTwin(res.twinId, res.sessionId, res.guestId);
      return res.sessionId;
    },

    async loadSessionMessages(sessionId: string, guestId: string | null = null): Promise<boolean> {
      if (!sessionId) return false;
      const signedIn = Boolean(readSession());
      if (!signedIn && !guestId) return false;
      try {
        const data = signedIn
          ? await getChatSessionMessages(sessionId, { limit: 500 })
          : await getPublicChatSessionMessages(sessionId, guestId, { limit: 500 });
        this.sessionId = sessionId;
        this.guestId = signedIn ? null : guestId;
        this.messages = data.messages.map((m) => {
          const docs = m.metadata?.source_documents;
          const conf = m.metadata?.confidence_score;
          const base = {
            id: makeId(),
            serverId: m._key,
            role: m.role === 'user' ? 'user' : 'assistant',
            text: m.content ?? '',
            lang: m.language ?? this.lang,
            audioUrl: m.audioUrl ?? null,
            createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
          };
          if (Array.isArray(docs) && docs.length > 0) {
            return { ...base, sourceDocuments: docs, confidenceScore: conf };
          }
          if (typeof conf === 'number' && Number.isFinite(conf)) {
            return { ...base, confidenceScore: conf };
          }
          return base;
        });
        return true;
      } catch {
        // Session likely missing/expired or auth mismatch — caller decides
        // whether to drop the persisted entry.
        return false;
      }
    },

    async restoreSessionForTwin(twinId: string): Promise<void> {
      if (!twinId) return;
      // Already loaded for this twin — don't refetch (would clobber in-flight sends).
      if (this.sessionId && this.currentTwinId === twinId) return;
      const stored = readActiveSessionForTwin(twinId);
      if (!stored) return;
      this.restoring = true;
      try {
        const ok = await this.loadSessionMessages(stored.sessionId, stored.guestId);
        if (!ok) clearActiveSessionForTwin(twinId);
      } finally {
        this.restoring = false;
      }
    },

    async sendMessage(text: string): Promise<void> {
      const trimmed = text.trim();
      if (!trimmed || this.sending) return;

      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        text: trimmed,
        lang: this.lang,
        createdAt: new Date(),
      };
      this.messages.push(userMessage);

      const placeholder: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        text: '',
        lang: this.lang,
        createdAt: new Date(),
        streaming: true,
      };
      this.messages.push(placeholder);
      this.sending = true;

      try {
        const sessionId = await this.ensureSession();
        if (!sessionId) throw new Error('No topic module selected');
        const payload = { text: trimmed, context: { language: this.lang } };
        const res = readSession()
          ? await sendChatMessage(sessionId, payload)
          : await sendPublicChatMessage(sessionId, this.guestId, payload);
        if (res.userMessageId) {
          userMessage.serverId = res.userMessageId;
        }
        let assistantId = res.assistantMessageId;
        // Some backend builds return only text for the POST response. In that
        // case, fetch recent history to recover the assistant message id so the
        // "Listen" action can always call /messages/{messageId}/audio.
        if (!assistantId) {
          try {
            const history = readSession()
              ? await getChatSessionMessages(sessionId, { limit: 20 })
              : await getPublicChatSessionMessages(sessionId, this.guestId, { limit: 20 });
            assistantId = latestAssistantMessageId(history.messages);
          } catch {
            // Best effort only; message still renders even if id lookup fails.
          }
        }
        const target = this.messages.find((m) => m.id === placeholder.id);
        if (target) {
          target.text = res.response ?? '';
          target.serverId = assistantId;
          target.streaming = false;
          const docs = res.metadata?.source_documents;
          if (Array.isArray(docs) && docs.length > 0) {
            target.sourceDocuments = docs;
            target.confidenceScore = res.metadata?.confidence_score;
          }
        }
      } catch (err) {
        const target = this.messages.find((m) => m.id === placeholder.id);
        if (target) {
          target.text = extractError(err, 'Failed to get a response. Please try again.');
          target.streaming = false;
          target.errored = true;
        }
      } finally {
        this.sending = false;
      }
    },

    async sendVoice(
      audio: Blob,
      opts: SendVoiceMessageOptions & { localAudioUrl?: string | null } = {},
    ): Promise<void> {
      if (this.sending) return;

      const { localAudioUrl, ...apiOpts } = opts;

      // Optimistic placeholders so the welcome stage gives way to the chat
      // surface immediately on the first voice message — otherwise the user
      // taps mic, releases, and sees no feedback while the upload + transcribe
      // round-trip is in flight (the welcome state hides the messages area
      // and its "Sending voice note…" indicator). Seed the user placeholder
      // with the local blob URL so the voice-note bubble (and its duration)
      // render instantly, before the server round-trip completes.
      const userPlaceholder: ChatMessage = {
        id: makeId(),
        role: 'user',
        text: '',
        lang: this.lang,
        createdAt: new Date(),
        streaming: true,
        audioUrl: localAudioUrl ?? null,
      };
      const assistantPlaceholder: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        text: '',
        lang: this.lang,
        createdAt: new Date(),
        streaming: true,
      };
      this.messages.push(userPlaceholder);
      this.messages.push(assistantPlaceholder);
      this.sending = true;

      try {
        const sessionId = await this.ensureSession();
        if (!sessionId) throw new Error('No topic module selected');
        const voiceOpts = { language: this.lang, ...apiOpts };
        const res = readSession()
          ? await sendVoiceMessage(sessionId, audio, voiceOpts)
          : await sendPublicVoiceMessage(sessionId, this.guestId, audio, voiceOpts);

        const userTarget = this.messages.find((m) => m.id === userPlaceholder.id);
        if (userTarget) {
          userTarget.serverId = res.userMessage.id;
          userTarget.text = res.userMessage.text;
          // Keep the local blob URL when present — overwriting it with the
          // server URL would force the bubble to re-probe the duration and
          // cause a visible "0:00" flicker. The server URL is only needed
          // when restoring history on a fresh page load.
          if (!userTarget.audioUrl) {
            userTarget.audioUrl = res.userMessage.audioUrl ?? null;
          }
          userTarget.streaming = false;
        }
        const assistantTarget = this.messages.find((m) => m.id === assistantPlaceholder.id);
        if (assistantTarget) {
          assistantTarget.serverId = res.assistantMessage.id;
          assistantTarget.text = res.assistantMessage.text;
          assistantTarget.streaming = false;
          const docs = res.metadata?.source_documents;
          if (Array.isArray(docs) && docs.length > 0) {
            assistantTarget.sourceDocuments = docs;
            assistantTarget.confidenceScore = res.metadata?.confidence_score;
          } else if (
            typeof res.metadata?.confidence_score === 'number' &&
            Number.isFinite(res.metadata.confidence_score)
          ) {
            assistantTarget.confidenceScore = res.metadata.confidence_score;
          }
        }
      } catch (err) {
        const userTarget = this.messages.find((m) => m.id === userPlaceholder.id);
        if (userTarget) {
          userTarget.streaming = false;
          userTarget.errored = true;
        }
        const assistantTarget = this.messages.find((m) => m.id === assistantPlaceholder.id);
        if (assistantTarget) {
          assistantTarget.text = extractError(err, 'Failed to send voice message.');
          assistantTarget.streaming = false;
          assistantTarget.errored = true;
        }
        throw err;
      } finally {
        this.sending = false;
      }
    },

    async loadMessageAudio(messageId: string): Promise<Blob> {
      if (!this.sessionId) throw new Error('No active session');
      return readSession()
        ? fetchMessageAudio(this.sessionId, messageId)
        : fetchPublicMessageAudio(this.sessionId, this.guestId, messageId);
    },

    async regenerateLast(): Promise<void> {
      if (this.sending) return;
      let lastUserIdx = -1;
      for (let i = this.messages.length - 1; i >= 0; i -= 1) {
        if (this.messages[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return;
      const lastUser = this.messages[lastUserIdx];
      this.messages = this.messages.slice(0, lastUserIdx);
      await this.sendMessage(lastUser.text);
    },
  },
});
