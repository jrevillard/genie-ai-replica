import { defineStore } from 'pinia';
import * as api from '../services/aiTwins';
import type {
  AiTwin,
  CreateAiTwinPayload,
  PublicAiTwin,
  UpdateAiTwinPayload,
} from '../services/aiTwins';
import { useAuthStore } from './auth';

interface AiTwinsState {
  twins: AiTwin[];
  total: number;
  offset: number;
  limit: number;
  publicTwins: PublicAiTwin[];
  publicTotal: number;
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
    publicTwins: [],
    publicTotal: 0,
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

    async fetchAllPublic(params?: { offset?: number; limit?: number }): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const res = await api.listPublicAiTwins({
          offset: params?.offset ?? 0,
          limit: params?.limit ?? this.limit,
        });
        this.publicTwins = res.twins;
        this.publicTotal = res.total;
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
        // Only admins hit the privileged read; everyone else (guests + normal
        // users) gets the sanitized public payload. The backend only exposes
        // the default twin via /public/ai-twins/:id, but that's enough for a
        // read-only profile + chat surface.
        const isAdmin = useAuthStore().isAdmin;
        const twin = isAdmin
          ? await api.getAiTwin(twinId)
          : await api.getPublicAiTwin(twinId);
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

    async create(payload: CreateAiTwinPayload, signal?: AbortSignal): Promise<AiTwin> {
      this.saving = true;
      this.error = null;
      try {
        const twin = await api.createAiTwin(payload, signal);
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
        const merged = upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = merged;
        return merged;
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
      this.error = null;
      try {
        const twin = await api.linkKbFile(twinId, fileId);
        const merged = upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = merged;
        return merged;
      } catch (err) {
        this.error = extractError(err, 'Failed to link knowledge file');
        throw err;
      }
    },

    async unlinkKbFile(twinId: string, fileId: string): Promise<AiTwin> {
      this.error = null;
      try {
        const twin = await api.unlinkKbFile(twinId, fileId);
        const merged = upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = merged;
        return merged;
      } catch (err) {
        this.error = extractError(err, 'Failed to unlink knowledge file');
        throw err;
      }
    },

    async uploadAvatar(twinId: string, file: File, signal?: AbortSignal): Promise<AiTwin> {
      this.saving = true;
      this.error = null;
      try {
        const twin = await api.uploadAiTwinAvatar(twinId, file, signal);
        const merged = upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = merged;
        return merged;
      } catch (err) {
        this.error = extractError(err, 'Failed to upload avatar');
        throw err;
      } finally {
        this.saving = false;
      }
    },

    async replaceKbFiles(twinId: string, fileIds: string[]): Promise<AiTwin> {
      this.error = null;
      try {
        const twin = await api.replaceKbFiles(twinId, fileIds);
        const merged = upsert(this.twins, twin);
        if (this.current?._key === twinId) this.current = merged;
        return merged;
      } catch (err) {
        this.error = extractError(err, 'Failed to update knowledge files');
        throw err;
      }
    },

    // The instructions endpoint returns just the saved string[] (not the full
    // twin), so we splice the new array onto the twin we already have rather
    // than refetching. Keeps the store the single source of truth — without
    // this, `current.instructions` would stay stale after save and any other
    // consumer reading `twin.instructions` would see pre-save data.
    async replaceInstructions(twinId: string, instructions: string[]): Promise<string[]> {
      this.error = null;
      try {
        const saved = await api.replaceTwinInstructions(twinId, instructions);
        const update = (t: AiTwin): AiTwin => ({ ...t, instructions: [...saved] });
        if (this.current?._key === twinId) this.current = update(this.current);
        const idx = this.twins.findIndex((t) => t._key === twinId);
        if (idx >= 0) this.twins[idx] = update(this.twins[idx]);
        return saved;
      } catch (err) {
        this.error = extractError(err, 'Failed to update instructions');
        throw err;
      }
    },
  },
});

/**
 * Insert or merge a twin into the list.
 *
 * PATCH /ai-twins/:id now echoes the derived stats (numChats, numWhatsappChats,
 * numCalls) alongside the persisted fields, but the voice/avatar/kb-files
 * routes still return only the twin core. Merging onto the existing entry
 * means whichever fields the response carries get refreshed, and anything it
 * omits stays intact — so the stats UI never flashes to zero after a save.
 *
 * Returns the resulting (merged) twin so callers can keep `this.current` in
 * sync without re-running the merge.
 */
function upsert(list: AiTwin[], twin: AiTwin): AiTwin {
  const idx = list.findIndex((t) => t._key === twin._key);
  if (idx >= 0) {
    const merged = { ...list[idx], ...twin };
    list[idx] = merged;
    return merged;
  }
  list.unshift(twin);
  return twin;
}

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
