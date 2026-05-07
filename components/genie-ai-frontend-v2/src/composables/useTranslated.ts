import { computed, ref, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTranslationStore } from '../stores/translation';

interface UseTranslatedReturn {
  /** Reactive value: translated text when available, source text otherwise. */
  value: ComputedRef<string>;
  loading: ComputedRef<boolean>;
  showOriginal: ComputedRef<boolean>;
  /** True when source language differs from the active UI locale, so a
   *  translation toggle makes sense to show. Independent of cache state. */
  canTranslate: ComputedRef<boolean>;
  toggle: () => void | Promise<void>;
  /** True iff a translation exists and is currently being shown. */
  isTranslated: ComputedRef<boolean>;
}

/**
 * Reactively expose a string with an opt-in translation to the active UI
 * locale. Defaults to the ORIGINAL — no translation request is made until the
 * caller invokes `toggle()`. This avoids burning translation calls on every
 * message and lets users read AI replies in the language they actually
 * requested (the chat language). Subsequent toggles flip between original and
 * the cached translation; first toggle fetches on demand.
 *
 * Failures: on translate error, the toggle stays on "original" and `value`
 * keeps mirroring the source.
 */
export function useTranslated(
  source: MaybeRefOrGetter<string>,
  sourceLang: MaybeRefOrGetter<string> = 'en'
): UseTranslatedReturn {
  const store = useTranslationStore();
  const { locale } = useI18n();

  const showOriginalRef = ref(true);
  const loadingRef = ref(false);

  const sourceText = computed(() => toValue(source) ?? '');
  const sourceLangValue = computed(() => toValue(sourceLang) || 'en');
  const targetLang = computed(() => locale.value);

  // Pull from cache reactively. `peek` reads `version` so this re-runs on writes.
  const cached = computed<string | undefined>(() =>
    store.peek(sourceText.value, sourceLangValue.value, targetLang.value)
  );

  const canTranslate = computed<boolean>(
    () => !!sourceText.value && sourceLangValue.value !== targetLang.value
  );

  const value = computed<string>(() => {
    if (showOriginalRef.value) return sourceText.value;
    if (!canTranslate.value) return sourceText.value;
    return cached.value ?? sourceText.value;
  });

  const isTranslated = computed<boolean>(
    () =>
      !showOriginalRef.value &&
      canTranslate.value &&
      cached.value !== undefined &&
      cached.value !== sourceText.value
  );

  // Reset to "show original" when the underlying text or target locale
  // changes, so a stale toggle from a previous message doesn't bleed through.
  watch([sourceText, targetLang], () => {
    showOriginalRef.value = true;
  });

  return {
    value,
    loading: computed(() => loadingRef.value),
    showOriginal: computed(() => showOriginalRef.value),
    canTranslate,
    toggle: async () => {
      if (showOriginalRef.value && canTranslate.value && cached.value === undefined) {
        loadingRef.value = true;
        try {
          await store.getOne(sourceText.value, sourceLangValue.value, targetLang.value);
        } catch {
          loadingRef.value = false;
          return;
        } finally {
          loadingRef.value = false;
        }
      }
      showOriginalRef.value = !showOriginalRef.value;
    },
    isTranslated,
  };
}

/**
 * Batched variant for arrays. Returns a reactive array of translated strings;
 * unresolved entries fall back to source text.
 */
export function useTranslatedList(
  sources: MaybeRefOrGetter<string[]>,
  sourceLang: MaybeRefOrGetter<string> = 'en'
): { values: ComputedRef<string[]>; loading: ComputedRef<boolean> } {
  const store = useTranslationStore();
  const { locale } = useI18n();
  const loadingRef = ref(false);

  const sourceArr = computed(() => toValue(sources) ?? []);
  const sourceLangValue = computed(() => toValue(sourceLang) || 'en');
  const targetLang = computed(() => locale.value);

  const values = computed<string[]>(() => {
    const src = sourceLangValue.value;
    const tgt = targetLang.value;
    if (src === tgt) return sourceArr.value;
    return sourceArr.value.map((text) => store.peek(text, src, tgt) ?? text);
  });

  watch(
    [sourceArr, sourceLangValue, targetLang],
    async ([list, src, tgt]) => {
      if (src === tgt) return;
      const missing = list.filter(
        (text) => !!text && store.peek(text, src, tgt) === undefined
      );
      if (missing.length === 0) return;
      loadingRef.value = true;
      try {
        await Promise.all(missing.map((text) => store.getOne(text, src, tgt)));
      } catch {
        // Swallow.
      } finally {
        loadingRef.value = false;
      }
    },
    { immediate: true }
  );

  return { values, loading: computed(() => loadingRef.value) };
}
