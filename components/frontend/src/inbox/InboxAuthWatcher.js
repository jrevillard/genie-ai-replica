/**
 * InboxAuthWatcher — keep the patient InboxBell mounting indefinitely.
 * ======================================================================
 *
 * The existing InboxBootstrap polls for the patient JWT every 2 seconds
 * for the FIRST 30 seconds after page load, then stops and relies on:
 *   - `storage` events (only fire cross-tab, not same-tab)
 *   - an explicit `amina:auth-changed` event (no one dispatches it)
 *
 * Result: a patient who opens the page, stays on the login screen for
 * more than 30 seconds, and THEN signs in never gets the bell — because
 * neither trigger fires in that flow.
 *
 * This watcher is additive: it polls localStorage for changes to
 * AMINA_TOKEN / AMINA_PATIENT and fires `amina:auth-changed` on any
 * transition (both login AND logout). The InboxBootstrap listener
 * re-runs and mounts/unmounts the bell accordingly. Same idea for the
 * caregiver bell (CaregiverInboxBell) which listens to the same event.
 */

const POLL_MS = 1000;
const KEY_TOKEN    = "AMINA_TOKEN";
const KEY_PATIENT  = "AMINA_PATIENT";
const KEY_CG_TOKEN = "AMINA_CG_TOKEN";


function _snapshot() {
  try {
    return (
      (localStorage.getItem(KEY_TOKEN)    ? "T" : "-") +
      (localStorage.getItem(KEY_PATIENT)  ? "P" : "-") +
      (localStorage.getItem(KEY_CG_TOKEN) ? "C" : "-")
    );
  } catch {
    return "---";
  }
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaInboxAuthWatcher) return;
  window.__aminaInboxAuthWatcher = true;

  let last = _snapshot();

  // Fire once at install so any listener that missed an earlier auth
  // transition (e.g. bell torn down before the watcher existed) gets
  // a chance to rehydrate on the next render tick.
  try {
    window.dispatchEvent(new CustomEvent("amina:auth-changed",
                                          { detail: { snapshot: last, reason: "bootstrap" } }));
  } catch { /* noop */ }

  setInterval(() => {
    const cur = _snapshot();

    // Fire on any storage snapshot change (original behaviour).
    if (cur !== last) {
      last = cur;
      try {
        window.dispatchEvent(new CustomEvent("amina:auth-changed",
                                              { detail: { snapshot: cur } }));
      } catch { /* noop */ }
      return;
    }

    // DOM watchdog: if a patient JWT IS present but the patient
    // inbox root isn't mounted, force a re-evaluation. InboxBootstrap's
    // render() is idempotent — a stray event is a no-op when things
    // are healthy, but a rescue when they're not.
    try {
      if (typeof document === "undefined") return;
      if (cur.charAt(0) === "T" && cur.charAt(1) === "P") {
        const root = document.getElementById("amina-inbox-root");
        const hasChildren = root && root.childElementCount > 0;
        if (!hasChildren) {
          window.dispatchEvent(new CustomEvent("amina:auth-changed",
                                                { detail: { snapshot: cur, reason: "watchdog" } }));
        }
      }
    } catch { /* noop */ }
  }, POLL_MS);
}


install();
