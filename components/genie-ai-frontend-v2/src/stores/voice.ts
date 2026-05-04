import { defineStore } from 'pinia';
import * as api from '../services/voice';
import type { VoiceMessage, VoiceSession } from '../services/voice';

interface VoiceState {
  sessions: VoiceSession[];
  offset: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;

  current: VoiceSession | null;
  messages: VoiceMessage[];
  loadingDetail: boolean;
  detailError: string | null;
}

export const useVoiceStore = defineStore('voice', {
  state: (): VoiceState => ({
    sessions: [],
    offset: 0,
    limit: 10,
    hasMore: false,
    loading: false,
    error: null,

    current: null,
    messages: [],
    loadingDetail: false,
    detailError: null,
  }),

  getters: {
    page: (state): number => Math.floor(state.offset / state.limit) + 1,
    rangeStart: (state): number => (state.sessions.length ? state.offset + 1 : 0),
    rangeEnd: (state): number => state.offset + state.sessions.length,
  },

  actions: {
    async fetchSessions(params?: { offset?: number; limit?: number }): Promise<void> {
      const offset = params?.offset ?? this.offset;
      const limit = params?.limit ?? this.limit;
      this.loading = true;
      this.error = null;
      try {
        const sessions = await api.listVoiceSessions({ offset, limit });
        this.sessions = sessions;
        this.offset = offset;
        this.limit = limit;
        // The API returns a plain array with no total. If we got a full page,
        // assume there might be more — Next stays enabled until a short page.
        this.hasMore = sessions.length === limit;
      } catch (err) {
        this.error = extractError(err, 'Failed to load voice sessions');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async nextPage(): Promise<void> {
      if (!this.hasMore || this.loading) return;
      await this.fetchSessions({ offset: this.offset + this.limit });
    },

    async prevPage(): Promise<void> {
      if (this.offset === 0 || this.loading) return;
      await this.fetchSessions({ offset: Math.max(0, this.offset - this.limit) });
    },

    async setLimit(limit: number): Promise<void> {
      // Reset to first page when page size changes — keeping offset would land
      // mid-window and confuse the range counter.
      await this.fetchSessions({ offset: 0, limit });
    },

    async openSession(sessionId: string): Promise<void> {
      this.loadingDetail = true;
      this.detailError = null;
      this.current = null;
      this.messages = [];
      try {
        const [session, messages] = await Promise.all([
          api.getVoiceSession(sessionId),
          api.getVoiceMessages(sessionId),
        ]);
        this.current = session;
        this.messages = messages;
      } catch (err) {
        this.detailError = extractError(err, 'Failed to load call details');
        throw err;
      } finally {
        this.loadingDetail = false;
      }
    },

    closeSession(): void {
      this.current = null;
      this.messages = [];
      this.detailError = null;
    },
  },
});

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
