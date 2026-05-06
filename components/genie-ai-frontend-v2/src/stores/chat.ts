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
  lang: ChatLang;
}

const CHAT_LANG_STORAGE_KEY = 'chat.lang.v2';

function readPersistedChatLang(): ChatLang {
  if (typeof window === 'undefined') return DEFAULT_CHAT_LANG;
  const stored = window.localStorage.getItem(CHAT_LANG_STORAGE_KEY);
  if (stored && /^[a-z]{2,8}(-[A-Za-z0-9]+)?$/.test(stored)) {
    return stored as ChatLang;
  }
  return DEFAULT_CHAT_LANG;
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
      this.sessionId = null;
      this.messages = [];
    },

    async ensureSession(): Promise<string | null> {
      if (this.sessionId) return this.sessionId;
      if (readSession()) {
        if (!this.currentTwinId) return null;
        const sessionId = await createChatSession(this.currentTwinId);
        this.sessionId = sessionId;
        return sessionId;
      }
      // Guest path — backend assigns the default twin and returns its id.
      const res = await createPublicChatSession();
      this.sessionId = res.sessionId;
      this.currentTwinId = res.twinId;
      return res.sessionId;
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
      this.sending = true;
      try {
        const sessionId = await this.ensureSession();
        if (!sessionId) throw new Error('No twin selected');
        const send = readSession() ? sendVoiceMessage : sendPublicVoiceMessage;
        const res = await send(sessionId, audio, { language: this.lang, ...opts });
        const now = new Date();
        this.messages.push({
          id: makeId(),
          serverId: res.userMessage.id,
          role: 'user',
          text: res.userMessage.text,
          lang: this.lang,
          audioUrl: res.userMessage.audioUrl ?? null,
          createdAt: now,
        });
        this.messages.push({
          id: makeId(),
          serverId: res.assistantMessage.id,
          role: 'assistant',
          text: res.assistantMessage.text,
          lang: this.lang,
          createdAt: new Date(),
        });
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
