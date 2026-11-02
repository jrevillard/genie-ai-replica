/**
 * The OKF feature flag, read once per call from the runtime config
 * (`window.APP_CONFIG.okfEnabled`, written by the frontend entrypoint from
 * `VUE_APP_OKF_ENABLED`).
 *
 * Single source shared by the Vuex registration (store/index.js) and every
 * gated surface (AdminDashboard tabs, the add-from-link entry, the crawl
 * dialog's OKF panel) — the gating model must not drift between them.
 *
 * Semantics (deliberate, fail-closed for anything unrecognized — round 16,
 * #80120: the previous "disabled only on exact '0'" made `OKF_ENABLED=false`,
 * `'no'`, `'off'`, `' 0'` all mean ENABLED):
 * - explicit `'1'`           → enabled. The one value compose/ansible write
 *     to turn the stack on.
 * - explicit `'0'`           → disabled (the deployed kill-switch). The
 *     entrypoint defaults the substitution to `'0'`, so a deployment path
 *     that injects no variable at all (bare `docker run`, k8s manifests,
 *     another compose file) boots DARK.
 * - ANY other value          → disabled. A typo or a near-miss ('true',
 *     'yes', 'false', 'off') must fail CLOSED — an operator writing
 *     `OKF_ENABLED=false` and getting the Studio silently ON is the worst
 *     outcome this flag exists to prevent.
 * - no runtime config at all → enabled, so `npm run serve` dev builds (which
 *     ship no runtime config) keep the surfaces. Production always HAS the
 *     config (the entrypoint writes it), so this arm is dev-only.
 */
export function isOkfEnabled() {
  const cfg = typeof window !== 'undefined' ? window.APP_CONFIG : null;
  if (!cfg) return true; // dev builds only — production always has the config
  // STRICT equality, no String() coercion: a numeric 1 from a hand-edited
  // config is a different writer than the entrypoint's '1' and must not
  // silently enable the Studio (String(1) === '1' would let it through).
  return cfg.okfEnabled === '1';
}

export default isOkfEnabled;
