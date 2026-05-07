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
}

interface ChatState {
  currentTwinId: string | null;
  sessionId: string | null;
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

function readActiveSessionForTwin(twinId: string): string | null {
  if (!twinId) return null;
  return readActiveSessionsMap()[twinId] ?? null;
}

function writeActiveSessionForTwin(twinId: string, sessionId: string): void {
  if (!twinId || !sessionId) return;
  const map = readActiveSessionsMap();
  map[twinId] = sessionId;
  writeActiveSessionsMap(map);
}

function clearActiveSessionForTwin(twinId: string | null): void {
  if (!twinId) return;
  const map = readActiveSessionsMap();
  if (twinId in map) {
    delete map[twinId];
    writeActiveSessionsMap(map);
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
      // Guest path — backend assigns the default twin and returns its id.
      const res = await createPublicChatSession();
      this.sessionId = res.sessionId;
      this.currentTwinId = res.twinId;
      writeActiveSessionForTwin(res.twinId, res.sessionId);
      return res.sessionId;
    },

    async loadSessionMessages(sessionId: string): Promise<boolean> {
      if (!sessionId) return false;
      try {
        const fetcher = readSession() ? getChatSessionMessages : getPublicChatSessionMessages;
        const data = await fetcher(sessionId, { limit: 500 });
        this.sessionId = sessionId;
        this.messages = data.messages.map((m) => ({
          id: makeId(),
          serverId: m._key,
          role: m.role === 'user' ? 'user' : 'assistant',
          text: m.content ?? '',
          lang: this.lang,
          audioUrl: m.audioUrl ?? null,
          createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
        }));
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
        const ok = await this.loadSessionMessages(stored);
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
        if (!sessionId) throw new Error('No twin selected');
        const send = readSession() ? sendChatMessage : sendPublicChatMessage;
        const res = await send(sessionId, {
          text: trimmed,
          context: { language: this.lang },
        });
        if (res.userMessageId) {
          userMessage.serverId = res.userMessageId;
        }
        let assistantId = res.assistantMessageId;
        // Some backend builds return only text for the POST response. In that
        // case, fetch recent history to recover the assistant message id so the
        // "Listen" action can always call /messages/{messageId}/audio.
        if (!assistantId) {
          try {
            const getMessages = readSession() ? getChatSessionMessages : getPublicChatSessionMessages;
            const history = await getMessages(sessionId, { limit: 20 });
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

    async sendVoice(audio: Blob, opts: SendVoiceMessageOptions = {}): Promise<void> {
      if (this.sending) return;

      // Optimistic placeholders so the welcome stage gives way to the chat
      // surface immediately on the first voice message — otherwise the user
      // taps mic, releases, and sees no feedback while the upload + transcribe
      // round-trip is in flight (the welcome state hides the messages area
      // and its "Sending voice note…" indicator).
      const userPlaceholder: ChatMessage = {
        id: makeId(),
        role: 'user',
        text: '',
        lang: this.lang,
        createdAt: new Date(),
        streaming: true,
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
        if (!sessionId) throw new Error('No twin selected');
        const send = readSession() ? sendVoiceMessage : sendPublicVoiceMessage;
        const res = await send(sessionId, audio, { language: this.lang, ...opts });

        const userTarget = this.messages.find((m) => m.id === userPlaceholder.id);
        if (userTarget) {
          userTarget.serverId = res.userMessage.id;
          userTarget.text = res.userMessage.text;
          userTarget.audioUrl = res.userMessage.audioUrl ?? null;
          userTarget.streaming = false;
        }
        const assistantTarget = this.messages.find((m) => m.id === assistantPlaceholder.id);
        if (assistantTarget) {
          assistantTarget.serverId = res.assistantMessage.id;
          assistantTarget.text = res.assistantMessage.text;
          assistantTarget.streaming = false;
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
      const fetcher = readSession() ? fetchMessageAudio : fetchPublicMessageAudio;
      return fetcher(this.sessionId, messageId);
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
