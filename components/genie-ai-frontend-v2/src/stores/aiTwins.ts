import { defineStore } from 'pinia';
import * as api from '../services/aiTwins';
import type { AiTwin, CreateAiTwinPayload, UpdateAiTwinPayload } from '../services/aiTwins';

interface AiTwinsState {
  twins: AiTwin[];
  total: number;
  offset: number;
  limit: number;
  current: AiTwin | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export const useAiTwinsStore = defineStore('aiTwins', {
  state: (): AiTwinsState => ({
    twins: [],
    total: 0,
    offset: 0,
    limit: 50,
    current: null,
    loading: false,
    saving: false,
    error: null,
  }),

  actions: {
    async fetchAll(params?: { offset?: number; limit?: number }): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const res = await api.listAiTwins({
          offset: params?.offset ?? this.offset,
          limit: params?.limit ?? this.limit,
        });
        this.twins = res.twins;
        this.total = res.total;
        this.offset = res.offset;
        this.limit = res.limit;
      } catch (err) {
        this.error = extractError(err, 'Failed to load AI Twins');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(twinId: string): Promise<AiTwin> {
      // Clear stale `current` so the view shows its loading skeleton instead
      // of the previously-opened twin while the new request is in flight.
      if (this.current?._key !== twinId) {
        this.current = null;
      }
      this.loading = true;
      this.error = null;
      try {
        const twin = await api.getAiTwin(twinId);
        this.current = twin;
        upsert(this.twins, twin);
        return twin;
      } catch (err) {
        this.error = extractError(err, 'Failed to load AI Twin');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async create(payload: CreateAiTwinPayload): Promise<AiTwin> {
      this.saving = true;
      this.error = null;
      try {
        const twin = await api.createAiTwin(payload);
        this.twins.unshift(twin);
        this.total += 1;
        return twin;
      } catch (err) {
        this.error = extractError(err, 'Failed to create AI Twin');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async update(twinId: string, payload: UpdateAiTwinPayload): Promise<AiTwin> {
      this.saving = true;
      this.error = null;
      try {
        const twin = await api.updateAiTwin(twinId, payload);
        upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = twin;
        return twin;
      } catch (err) {
        this.error = extractError(err, 'Failed to update AI Twin');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async remove(twinId: string): Promise<void> {
      this.saving = true;
      this.error = null;
      try {
        await api.deleteAiTwin(twinId);
        this.twins = this.twins.filter((t) => t._key !== twinId);
        this.total = Math.max(0, this.total - 1);
        if (this.current?._key === twinId) this.current = null;
      } catch (err) {
        this.error = extractError(err, 'Failed to delete AI Twin');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async linkKbFile(twinId: string, fileId: string): Promise<AiTwin> {
      const twin = await api.linkKbFile(twinId, fileId);
      upsert(this.twins, twin);
      if (this.current?._key === twinId) this.current = twin;
      return twin;
    },

    async uploadAvatar(twinId: string, file: File): Promise<AiTwin> {
      this.saving = true;
      this.error = null;
      try {
        const twin = await api.uploadAiTwinAvatar(twinId, file);
        upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = twin;
        return twin;
      } catch (err) {
        this.error = extractError(err, 'Failed to upload avatar');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async replaceKbFiles(twinId: string, fileIds: string[]): Promise<AiTwin> {
      const twin = await api.replaceKbFiles(twinId, fileIds);
      upsert(this.twins, twin);
      if (this.current?._key === twinId) this.current = twin;
      return twin;
    },
  },
});

function upsert(list: AiTwin[], twin: AiTwin): void {
  const idx = list.findIndex((t) => t._key === twin._key);
  if (idx >= 0) list[idx] = twin;
  else list.unshift(twin);
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
