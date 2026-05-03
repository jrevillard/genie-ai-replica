import { defineStore } from 'pinia';
import type { ChatLang } from '../lib/chatStrings';
import { createChatSession, sendChatMessage } from '../services/chatSessions';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
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

const LANG_STORAGE_KEY = 'chat.lang';
const VALID_LANGS: ChatLang[] = ['en', 'fr', 'mnk'];

function readPersistedLang(): ChatLang {
  if (typeof window === 'undefined') return 'en';
  const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
  return VALID_LANGS.includes(raw as ChatLang) ? (raw as ChatLang) : 'en';
}

function makeId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    currentTwinId: null,
    sessionId: null,
    messages: [],
    sending: false,
    lang: readPersistedLang(),
  }),

  actions: {
    setTwinContext(twinId: string | null): void {
      if (this.currentTwinId === twinId) return;
      this.currentTwinId = twinId;
      this.sessionId = null;
      this.messages = [];
    },

    setLanguage(lang: ChatLang): void {
      this.lang = lang;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LANG_STORAGE_KEY, lang);
      }
    },

    resetConversation(): void {
      this.sessionId = null;
      this.messages = [];
    },

    async ensureSession(): Promise<string | null> {
      if (this.sessionId) return this.sessionId;
      if (!this.currentTwinId) return null;
      const sessionId = await createChatSession(this.currentTwinId);
      this.sessionId = sessionId;
      return sessionId;
    },

    async sendMessage(text: string): Promise<void> {
      const trimmed = text.trim();
      if (!trimmed || this.sending) return;

      this.messages.push({
        id: makeId(),
        role: 'user',
        text: trimmed,
        createdAt: new Date(),
      });

      const placeholder: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        text: '',
        createdAt: new Date(),
        streaming: true,
      };
      this.messages.push(placeholder);
      this.sending = true;

      try {
        const sessionId = await this.ensureSession();
        if (!sessionId) throw new Error('No twin selected');
        const reply = await sendChatMessage(sessionId, {
          text: trimmed,
          context: { language: this.lang },
        });
        const target = this.messages.find((m) => m.id === placeholder.id);
        if (target) {
          target.text = reply;
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
