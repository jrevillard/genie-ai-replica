import { defineStore } from 'pinia';
import { listVoices, type Voice } from '../services/voices';

// Pinia store for the TTS voice catalog. Single source of truth for which
// chat languages have a Piper voice available — the backend seeds this
// catalog from `gov-chat-backend/services/voice-catalog-service.js`, so we
// avoid hardcoding the list on the frontend (which would silently drift if
// new voices are added/removed server-side).
//
// Usage: call `ensureLoaded()` once on view mount; read `isTtsSupported(lang)`
// reactively wherever the "Listen" button is rendered.

interface VoiceCatalogState {
  languages: Set<string>;
  loaded: boolean;
  loading: Promise<void> | null;
  error: unknown;
}

function deriveLanguages(voices: Voice[]): Set<string> {
  const out = new Set<string>();
  for (const v of voices) {
    // Only count voices that are explicitly enabled or where the flag is
    // missing entirely (older rows). A voice marked `enabled: false` means
    // the deploy disabled it and we shouldn't offer playback for it.
    if (v.enabled === false) continue;
    if (v.language) out.add(v.language.toLowerCase());
  }
  return out;
}

export const useVoiceCatalogStore = defineStore('voiceCatalog', {
  state: (): VoiceCatalogState => ({
    languages: new Set<string>(),
    loaded: false,
    loading: null,
    error: null,
  }),
  actions: {
    async ensureLoaded(): Promise<void> {
      if (this.loaded) return;
      if (this.loading) return this.loading;
      this.loading = (async () => {
        try {
          const voices = await listVoices();
          this.languages = deriveLanguages(voices);
          this.loaded = true;
          this.error = null;
        } catch (err) {
          this.error = err;
          // Stay un-loaded so a retry can fire on next call. No throw — UI
          // should fall back to "Listen disabled" rather than blowing up.
        } finally {
          this.loading = null;
        }
      })();
      return this.loading;
    },
    isTtsSupported(lang: string | null | undefined): boolean {
      if (!lang) return false;
      return this.languages.has(lang.toLowerCase());
    },
  },
});
