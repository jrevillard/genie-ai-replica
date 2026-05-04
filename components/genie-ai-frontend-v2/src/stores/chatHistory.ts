import { defineStore } from 'pinia';
import * as api from '../services/chatSessions';
import type {
  ChatHistoryMessage,
  ChatSessionRecord,
  ChatSessionType,
  ListChatSessionsParams,
} from '../services/chatSessions';

interface ChatHistoryState {
  sessions: ChatSessionRecord[];
  loading: boolean;
  error: string | null;

  selectedSessionId: string | null;
  currentSession: ChatSessionRecord | null;
  messages: ChatHistoryMessage[];
  loadingMessages: boolean;
  messagesError: string | null;
  messageQuery: string;
  deleting: boolean;

  typeFilter: ChatSessionType | null;
  scopeFilter: 'me' | 'all';
  phoneNumberFilter: string;
  twinIdFilter: string | null;
}

export const useChatHistoryStore = defineStore('chatHistory', {
  state: (): ChatHistoryState => ({
    sessions: [],
    loading: false,
    error: null,

    selectedSessionId: null,
    currentSession: null,
    messages: [],
    loadingMessages: false,
    messagesError: null,
    messageQuery: '',
    deleting: false,

    typeFilter: null,
    scopeFilter: 'me',
    phoneNumberFilter: '',
    twinIdFilter: null,
  }),

  getters: {
    filteredSessions: (state): ChatSessionRecord[] => {
      let rows = state.sessions.slice();
      if (state.twinIdFilter) {
        rows = rows.filter((s) => s.twinId === state.twinIdFilter);
      }
      return rows;
    },
  },

  actions: {
    async fetchSessions(params: ListChatSessionsParams = {}): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const phone = this.phoneNumberFilter.trim();
        const merged: ListChatSessionsParams = {
          limit: 50,
          offset: 0,
          ...(this.typeFilter ? { type: this.typeFilter } : {}),
          ...(this.scopeFilter ? { scope: this.scopeFilter } : {}),
          ...(phone ? { phoneNumber: phone } : {}),
          ...params,
        };
        this.sessions = await api.listChatSessions(merged);
      } catch (err) {
        this.error = extractError(err, 'Failed to load chat sessions');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async selectSession(sessionId: string): Promise<void> {
      if (this.loadingMessages && this.selectedSessionId === sessionId) return;
      const switching = this.selectedSessionId !== sessionId;
      this.selectedSessionId = sessionId;
      this.loadingMessages = true;
      this.messagesError = null;
      this.messages = [];
      if (switching) this.messageQuery = '';
      try {
        const q = this.messageQuery.trim();
        const data = await api.getChatSessionMessages(sessionId, q ? { q } : {});
        this.currentSession = data.session ?? null;
        this.messages = data.messages ?? [];
      } catch (err) {
        this.messagesError = extractError(err, 'Failed to load conversation');
        throw err;
      } finally {
        this.loadingMessages = false;
      }
    },

    async searchMessages(q: string): Promise<void> {
      this.messageQuery = q;
      if (!this.selectedSessionId) return;
      this.loadingMessages = true;
      this.messagesError = null;
      try {
        const trimmed = q.trim();
        const data = await api.getChatSessionMessages(
          this.selectedSessionId,
          trimmed ? { q: trimmed } : {}
        );
        this.currentSession = data.session ?? null;
        this.messages = data.messages ?? [];
      } catch (err) {
        this.messagesError = extractError(err, 'Failed to search messages');
        throw err;
      } finally {
        this.loadingMessages = false;
      }
    },

    async deleteSession(sessionId: string): Promise<number> {
      this.deleting = true;
      try {
        const res = await api.deleteChatSession(sessionId);
        this.sessions = this.sessions.filter((s) => s._key !== sessionId);
        if (this.selectedSessionId === sessionId) this.clearSelection();
        return res.deletedMessages;
      } finally {
        this.deleting = false;
      }
    },

    clearSelection(): void {
      this.selectedSessionId = null;
      this.currentSession = null;
      this.messages = [];
      this.messagesError = null;
      this.messageQuery = '';
    },

    setTwinFilter(twinId: string | null): void {
      this.twinIdFilter = twinId;
    },

    setTypeFilter(type: ChatSessionType | null): void {
      this.typeFilter = type;
    },

    setScopeFilter(scope: 'me' | 'all'): void {
      this.scopeFilter = scope;
    },

    setPhoneNumberFilter(phone: string): void {
      this.phoneNumberFilter = phone;
    },
  },
});

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
