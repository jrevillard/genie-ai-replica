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
     * @returns {string}
     */
    translate(key, fallback = '') {
      if (!this.$i18n) {
        // Match AdminDashboard.translate — when i18n is unavailable we still
        // fall back to the key itself if no explicit fallback was supplied,
        // so missing strings are obvious in the UI rather than silently empty.
        return fallback || key;
      }
      try {
        // Force the current locale so reactive locale changes propagate
        // even when the component caches its rendered output.
        const translation = this.$i18n.t(key, { locale: this.$i18n.locale });
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error(`[translateMixin] Translation error for key ${key}:`, e);
        return fallback || key;
      }
    }
  }
};
