import { computed, ref, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTranslationStore } from '../stores/translation';

interface UseTranslatedReturn {
  /** Reactive value: translated text when available, source text otherwise. */
  value: ComputedRef<string>;
  loading: ComputedRef<boolean>;
  showOriginal: ComputedRef<boolean>;
  toggle: () => void;
  /** True iff a translation exists and is currently being shown. */
  isTranslated: ComputedRef<boolean>;
}

/**
 * Reactively translate a string from `sourceLang` to the active UI locale.
 *
 * Same-locale shortcut: when sourceLang matches the current i18n locale, no
 * network call is issued and `value` simply mirrors the source.
 *
 * Failures: on translate error, `value` falls back to the source string.
 */
export function useTranslated(
  source: MaybeRefOrGetter<string>,
  sourceLang: MaybeRefOrGetter<string> = 'en'
): UseTranslatedReturn {
  const store = useTranslationStore();
  const { locale } = useI18n();

  const showOriginalRef = ref(false);
  const loadingRef = ref(false);

  const sourceText = computed(() => toValue(source) ?? '');
  const sourceLangValue = computed(() => toValue(sourceLang) || 'en');
  const targetLang = computed(() => locale.value);

  // Pull from cache reactively. `peek` reads `version` so this re-runs on writes.
  const cached = computed<string | undefined>(() =>
    store.peek(sourceText.value, sourceLangValue.value, targetLang.value)
  );

  const value = computed<string>(() => {
    if (showOriginalRef.value) return sourceText.value;
    if (sourceLangValue.value === targetLang.value) return sourceText.value;
    return cached.value ?? sourceText.value;
  });

  const isTranslated = computed<boolean>(
    () =>
      sourceLangValue.value !== targetLang.value &&
      cached.value !== undefined &&
      cached.value !== sourceText.value
  );

  // Trigger fetch on locale or source change.
  watch(
    [sourceText, sourceLangValue, targetLang],
    async ([text, src, tgt]) => {
      if (!text || src === tgt) {
        loadingRef.value = false;
        return;
      }
      if (store.peek(text, src, tgt) !== undefined) {
        loadingRef.value = false;
        return;
      }
      loadingRef.value = true;
      try {
        await store.getOne(text, src, tgt);
      } catch {
        // Swallow; value getter falls back to source automatically.
      } finally {
        loadingRef.value = false;
      }
    },
    { immediate: true }
  );

  return {
    value,
    loading: computed(() => loadingRef.value),
    showOriginal: computed(() => showOriginalRef.value),
    toggle: () => {
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
