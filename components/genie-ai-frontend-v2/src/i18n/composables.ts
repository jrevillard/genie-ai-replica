import { useI18n } from 'vue-i18n';

// Thin wrapper around vue-i18n's useI18n() that adds fallback semantics.
// vue-i18n returns the key path itself when a translation is missing — we
// prefer to render the supplied fallback instead so partial migrations don't
// leak `'auth.signIn.title'` into the UI.
export function useT() {
  const { t: rawT, locale } = useI18n();

  // Overloads keep call sites idiomatic: either a plain fallback string, or
  // (params, fallback) when the key uses {placeholders}.
  function t(key: string, fallback?: string): string;
  function t(key: string, params: Record<string, unknown>, fallback?: string): string;
  function t(
    key: string,
    fallbackOrParams?: string | Record<string, unknown>,
    fallbackArg?: string
  ): string {
    const hasParams = typeof fallbackOrParams === 'object' && fallbackOrParams !== null;
    const params = hasParams ? (fallbackOrParams as Record<string, unknown>) : undefined;
    const fallback = hasParams ? fallbackArg : (fallbackOrParams as string | undefined);
    const out = params ? rawT(key, params) : rawT(key);
    if (out === key && fallback !== undefined) {
      // Manually interpolate the fallback so callers can write
      // `t('foo', { count: 3 }, '{count} items')` and have it render correctly
      // when the catalog hasn't been populated yet.
      if (params) {
        return fallback.replace(/\{(\w+)\}/g, (_, name: string) => {
          const v = (params as Record<string, unknown>)[name];
          return v == null ? `{${name}}` : String(v);
        });
      }
      return fallback;
    }
    return out;
  }

  return { t, locale };
}
