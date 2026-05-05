import { defineStore } from 'pinia';
import type { ChatLang } from '../lib/chatStrings';
import {
  createChatSession,
  createPublicChatSession,
  fetchMessageAudio,
  fetchPublicMessageAudio,
  sendChatMessage,
  sendPublicChatMessage,
  sendPublicVoiceMessage,
  sendVoiceMessage,
  type SendVoiceMessageOptions,
} from '../services/chatSessions';
import { readSession } from '../services/http';
import { i18n, setLocale, type LocaleCode } from '../i18n';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  serverId?: string;
  role: ChatRole;
  text: string;
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
}

function makeId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}

const VALID_CHAT_LANGS: ChatLang[] = ['en', 'fr', 'mnk'];

function currentLang(): ChatLang {
  const code = i18n.global.locale.value;
  return VALID_CHAT_LANGS.includes(code as ChatLang) ? (code as ChatLang) : 'en';
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    currentTwinId: null,
    sessionId: null,
    messages: [],
    sending: false,
  }),

  getters: {
    // Always reflects the global UI locale — there is no separate chat-only
    // language any more. Existing callers (`storeToRefs(chat).lang`) keep
    // working because Pinia exposes getters as refs.
    lang: (): ChatLang => currentLang(),
  },

  actions: {
    setTwinContext(twinId: string | null): void {
      if (this.currentTwinId === twinId) return;
      this.currentTwinId = twinId;
      this.sessionId = null;
      this.messages = [];
    },

    async setLanguage(lang: ChatLang): Promise<void> {
      // Delegate to the i18n module so localStorage + <html lang> + the active
      // i18n locale all stay in lockstep.
      await setLocale(lang as LocaleCode);
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
        const send = readSession() ? sendChatMessage : sendPublicChatMessage;
        const reply = await send(sessionId, {
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
          audioUrl: res.userMessage.audioUrl ?? null,
          createdAt: now,
        });
        this.messages.push({
          id: makeId(),
          serverId: res.assistantMessage.id,
          role: 'assistant',
          text: res.assistantMessage.text,
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
