import { defineStore } from 'pinia';
import { translateMarkdown, translateTexts } from '../services/translate';

const MAX_ENTRIES = 500;
const BATCH_WINDOW_MS = 50;

interface TranslationState {
  // Reactive Map: components reading this via store actions stay up-to-date.
  // Key shape: `${source}|${target}|${text}`.
  cache: Map<string, string>;
  // version bumps every time the cache mutates, so external watchers in
  // composables (which only see the action's promise resolve) can trigger
  // re-evaluation cleanly. Pinia tracks primitive reads automatically.
  version: number;
}

interface PendingItem {
  text: string;
  resolve: (translated: string) => void;
  reject: (err: unknown) => void;
}

interface BatchQueue {
  // Each (source,target) pair gets its own queue + timer.
  items: PendingItem[];
  timer: ReturnType<typeof setTimeout> | null;
}

const queues = new Map<string, BatchQueue>(); // key: `${source}|${target}`
const inflight = new Map<string, Promise<string>>(); // key: full cache key

function cacheKey(source: string, target: string, text: string): string {
  return `${source}|${target}|${text}`;
}

function pairKey(source: string, target: string): string {
  return `${source}|${target}`;
}

export const useTranslationStore = defineStore('translation', {
  state: (): TranslationState => ({
    cache: new Map(),
    version: 0,
  }),

  actions: {
    /** Synchronous cache lookup. Returns undefined on miss. */
    peek(text: string, sourceLang: string, targetLang: string): string | undefined {
      if (sourceLang === targetLang) return text;
      // Read version so reactive consumers re-run when the cache mutates.
      void this.version;
      return this.cache.get(cacheKey(sourceLang, targetLang, text));
    },

    /** Async fetch — returns cached value if present, otherwise batches into a /translate call. */
    async getOne(text: string, sourceLang: string, targetLang: string): Promise<string> {
      if (sourceLang === targetLang || !text) return text;
      const key = cacheKey(sourceLang, targetLang, text);

      const cached = this.cache.get(key);
      if (cached !== undefined) return cached;

      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = new Promise<string>((resolve, reject) => {
        const pk = pairKey(sourceLang, targetLang);
        let queue = queues.get(pk);
        if (!queue) {
          queue = { items: [], timer: null };
          queues.set(pk, queue);
        }
        queue.items.push({ text, resolve, reject });
        if (!queue.timer) {
          queue.timer = setTimeout(() => this._flush(sourceLang, targetLang), BATCH_WINDOW_MS);
        }
      });

      inflight.set(key, promise);
      promise.finally(() => inflight.delete(key));
      return promise;
    },

    /** Markdown variant — no batching. */
    async getMarkdown(markdown: string, sourceLang: string, targetLang: string): Promise<string> {
      if (sourceLang === targetLang || !markdown) return markdown;
      const key = cacheKey(sourceLang, targetLang, markdown);

      const cached = this.cache.get(key);
      if (cached !== undefined) return cached;

      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = (async () => {
        try {
          const out = await translateMarkdown(markdown, sourceLang, targetLang);
          this._set(key, out);
          return out;
        } catch (err) {
          // Degrade to source on failure.
          inflight.delete(key);
          throw err;
        }
      })();

      inflight.set(key, promise);
      promise.finally(() => inflight.delete(key));
      return promise;
    },

    /** Seed entries directly (e.g. from a server response that already contains a translation). */
    prime(entries: Array<{ text: string; translated: string; sourceLang: string; targetLang: string }>): void {
      for (const e of entries) {
        if (e.sourceLang === e.targetLang) continue;
        this._set(cacheKey(e.sourceLang, e.targetLang, e.text), e.translated);
      }
    },

    _set(key: string, value: string): void {
      // LRU-style trim: delete oldest insertion when over the cap.
      if (this.cache.size >= MAX_ENTRIES && !this.cache.has(key)) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      // Re-insert to refresh recency.
      this.cache.delete(key);
      this.cache.set(key, value);
      this.version++;
    },

    async _flush(sourceLang: string, targetLang: string): Promise<void> {
      const pk = pairKey(sourceLang, targetLang);
      const queue = queues.get(pk);
      if (!queue || queue.items.length === 0) return;

      const items = queue.items;
      queue.items = [];
      queue.timer = null;

      // Dedup texts within this batch so we don't pay for duplicates.
      const uniqueTexts: string[] = [];
      const indexFor = new Map<string, number>();
      for (const item of items) {
        if (!indexFor.has(item.text)) {
          indexFor.set(item.text, uniqueTexts.length);
          uniqueTexts.push(item.text);
        }
      }

      try {
        const translated = await translateTexts(uniqueTexts, sourceLang, targetLang);
        for (const item of items) {
          const idx = indexFor.get(item.text)!;
          const out = translated[idx] ?? item.text;
          this._set(cacheKey(sourceLang, targetLang, item.text), out);
          item.resolve(out);
        }
      } catch (err) {
        for (const item of items) item.reject(err);
      }
    },
  },
});
