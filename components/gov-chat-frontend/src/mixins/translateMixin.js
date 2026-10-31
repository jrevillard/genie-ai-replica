/**
 * translateMixin — additive Options API mixin that exposes a `translate(key, fallback)`
 * method on any component that mixes it in.
 *
 * Why this exists
 * ---------------
 * `AdminDashboard.vue` defines `translate(key, fallback)` locally (search for
 * `translate(key, fallback = '')`) because its child components (OKF Studio
 * surface, dialogs, etc.) reference `translate` in templates and methods. Vue
 * 3's child render scope resolves identifiers against the **child's own
 * instance**, not the parent's — so a child that calls `translate(...)` will
 * throw `TypeError: e.translate is not a function` unless it (or a mixin) also
 * defines `translate` on its own instance.
 *
 * This mixin mirrors AdminDashboard's behaviour so every OKF (and future
 * dashboard child) component can `mixins: [translateMixin]` and use
 * `translate(key, fallback)` without re-defining the helper. Existing
 * AdminDashboard is left untouched (R5 / additive-first).
 *
 * Locale awareness
 * ----------------
 * The mixin reads the active locale from `this.$i18n.locale` so a `$i18n.locale`
 * watcher in the parent (AdminDashboard does this) propagates correctly via
 * `$forceUpdate()`. If `$i18n` is missing (component mounted outside an app
 * context, e.g. in a unit test), the fallback is returned silently — same
 * behaviour as AdminDashboard.
 */
export default {
  methods: {
    /**
     * Look up a translation key. Returns the fallback when the key is missing
     * OR when i18n is unavailable. Never throws.
     *
     * @param {string} key      i18n message key (e.g. 'okf.studio.title')
     * @param {string} [fallback]  Default text returned when the key is missing
     * @param {Object} [named]  Optional named params — when supplied, {x}
     *   tokens are interpolated from it (AdminDashboard.translate's t(key,
     *   locale, named) shape, which the QueryInspector pagination rides).
     *   Absent/undefined keeps the RAW output for the .replace('{x}') callers.
     * @returns {string}
     */
    translate(key, fallback = '', named) {
      if (!this.$i18n) {
        // Match AdminDashboard.translate — when i18n is unavailable we still
        // fall back to the key itself if no explicit fallback was supplied,
        // so missing strings are obvious in the UI rather than silently empty.
        let out = fallback || key;
        if (named && typeof named === 'object') out = interpolateNamed(out, named);
        return out;
      }
      try {
        // RAW message lookup — deliberately NOT $t(). vue-i18n's message
        // compiler treats {name} as a named-interpolation slot and renders
        // it EMPTY when $t is called without params; every caller of this
        // helper interpolates via .replace('{x}') afterwards, so compiled
        // output silently dropped their placeholders (live 2026-10-09: the
        // advisor scorecard rendered "positives / claimed · negatives /
        // suppressed" with every slot gone, while jest — which has no $i18n
        // and returns the fallback verbatim — stayed green). Walk the raw
        // message tree instead: active locale first, then the 'en' tree.
        const resolve = (msgs, path) =>
          path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), msgs);
        const messages = this.$i18n.messages;
        const locale = this.$i18n.locale || 'en';
        const hit = resolve(messages && messages[locale], key);
        if (typeof hit === 'string') return interpolateNamed(hit, named);
        const en = resolve(messages && messages.en, key);
        if (typeof en === 'string') return interpolateNamed(en, named);
        let out = fallback || key;
        if (named && typeof named === 'object') out = interpolateNamed(out, named);
        return out;
      } catch (e) {
        console.error(`[translateMixin] Translation error for key ${key}:`, e);
        return fallback || key;
      }
    }
  }
};

/** Replace only the {x} tokens the caller NAMED — a token with no entry is
 * left for the caller's .replace() chain (the two regimes can mix). */
function interpolateNamed(text, named) {
  if (!named || typeof named !== 'object') return text;
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (m, k) =>
    named[k] !== undefined && named[k] !== null ? String(named[k]) : m
  );
}
