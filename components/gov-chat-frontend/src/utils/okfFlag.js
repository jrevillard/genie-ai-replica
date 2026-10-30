/**
 * The OKF feature flag, read once per call from the runtime config
 * (`window.APP_CONFIG.okfEnabled`, written by the frontend entrypoint from
 * `VUE_APP_OKF_ENABLED`).
 *
 * Single source shared by the Vuex registration (store/index.js) and every
 * gated surface (AdminDashboard tabs, the add-from-link entry, the crawl
 * dialog's OKF panel) — the gating model must not drift between them.
 *
 * Semantics (deliberate):
 * - explicit `'0'`           → disabled. This is the deployed kill-switch,
 *     and it is fail-closed at the IMAGE: the entrypoint defaults the
 *     substitution to `'0'` (review !622 wave 1), so a deployment path that
 *     injects no variable at all (bare `docker run`, k8s manifests, another
 *     compose file) boots DARK. compose/ansible write `'0'`/`'1'` explicitly.
 * - absent key / no config   → enabled, so `npm run serve` dev builds (which
 *     have no runtime config) keep the surfaces.
 * - anything else            → enabled (`'1'` is what compose/ansible write).
 */
export function isOkfEnabled() {
  const cfg = typeof window !== 'undefined' ? window.APP_CONFIG : null;
  return !cfg || String(cfg.okfEnabled == null ? '1' : cfg.okfEnabled) !== '0';
}

export default isOkfEnabled;
