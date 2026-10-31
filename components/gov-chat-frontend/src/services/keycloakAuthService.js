/**
 * Keycloak OIDC Authentication Service
 *
 * Wraps oidc-client-ts UserManager to provide OIDC authentication.
 * Tokens are stored in JavaScript memory only — never in localStorage, sessionStorage, or cookies.
 */

import { UserManager } from 'oidc-client-ts';
import { jwtDecode } from 'jwt-decode';
import oidcConfig from '@/config/oidcConfig';

let userManager = null;
let currentUser = null;
const accessTokenCallbacks = new Set();
let unsubscribeUserLoaded = null;
let unsubscribeSilentRenewError = null;
/** The ONE in-flight silent renew, shared by every caller (see signinSilent). */
let renewInFlight = null;

// ── CROSS-TAB RENEW LEASE (round 20, #80800) ─────────────────────────────────
// The in-tab `renewInFlight` promise is one per JavaScript realm — one per
// TAB — so the two-tab race the root-cause comment names stayed
// unserialised: with refresh_token_max_reuse=0 the second tab's concurrent
// renew reuses a rotated token, is rejected, and after 3 such failures the
// escalation path forces the very logout this fix exists to remove. The
// lease makes ONE tab renew while the others wait for the shared oidc user
// store to carry the fresh tokens. TTL-bounded: a holder that dies without
// releasing is taken over after RENEW_LEASE_TTL_MS; a waiter that waits
// longer than that runs its own renew (the dead holder's attempt went
// nowhere). Storage failures degrade to the in-tab serialisation alone.
const RENEW_LEASE_KEY = 'genie.renew.lease';
const RENEW_DONE_KEY = 'genie.renew.done';
const RENEW_LEASE_TTL_MS = 20000;
const RENEW_WAIT_POLL_MS = 250;
const RENEW_TAB_ID = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);

function leaseHeldByOther() {
  try {
    const raw = window.localStorage.getItem(RENEW_LEASE_KEY);
    if (!raw) return false;
    const lease = JSON.parse(raw);
    return !!(lease && lease.tab !== RENEW_TAB_ID && Date.now() - lease.at < RENEW_LEASE_TTL_MS);
  } catch {
    return false;
  }
}

function acquireRenewLease() {
  if (leaseHeldByOther()) return false;
  try {
    window.localStorage.setItem(RENEW_LEASE_KEY, JSON.stringify({ tab: RENEW_TAB_ID, at: Date.now() }));
    // Re-read: another tab may have written between our check and our set —
    // only the LAST writer keeps the lease (read-back fences the race).
    const raw = window.localStorage.getItem(RENEW_LEASE_KEY);
    const lease = raw ? JSON.parse(raw) : null;
    return !lease || lease.tab === RENEW_TAB_ID;
  } catch {
    return true; // storage unavailable → the in-tab promise is all we have
  }
}

function releaseRenewLease() {
  try {
    const raw = window.localStorage.getItem(RENEW_LEASE_KEY);
    if (!raw || (JSON.parse(raw) || {}).tab === RENEW_TAB_ID) window.localStorage.removeItem(RENEW_LEASE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Initialize the OIDC service — creates UserManager, checks for existing session,
 * and registers silent renew event listeners.
 * @returns {Promise<Object|null>} Existing user or null
 */
async function initialize() {
  userManager = new UserManager(oidcConfig);

  // Bounded-renew state (round 17, #80353; reset widened round 18, #80469)
  let consecutiveRenewFailures = 0;
  const MAX_RENEW_FAILURES = 3;

  // Register silent renew event listeners
  unsubscribeUserLoaded = userManager.events.addUserLoaded((user) => {
    currentUser = user;
    // A TIMER-driven successful renew also resets the failure counter (round
    // 18, #80469): the documented invariant is "reset on any success", but
    // only the error-handler's own retry reset it — three transient failures
    // spread across days (sleep/wake, network switch) still escalated to the
    // login check even though the last renewal succeeded.
    consecutiveRenewFailures = 0;
    accessTokenCallbacks.forEach((cb) => cb(user));
  });

  // A FAILED RENEW IS NOT A DEAD SESSION (David's 2026-10-11 logout). This used
  // to call login() unconditionally, so ONE rejected refresh in a burst threw
  // the user to the login page and discarded a perfectly good session — which
  // is exactly what happened mid-import while two tabs were racing. Retry
  // through the shared renew; only a run of consecutive failures justifies a
  // redirect.
  // BOUNDED RETRIES (round 17, #80353): the comment used to say "Retry once"
  // but nothing enforced it — a persistently failing grant re-raised
  // silentRenewError, re-entered this handler, failed again… one renew every
  // few seconds forever with no backoff. The counter below caps consecutive
  // failures (reset on any success) and escalates through the same
  // stored-user/login check as the 401 path.
  unsubscribeSilentRenewError = userManager.events.addSilentRenewError(async () => {
    try {
      const user = await signinSilent();
      if (user && !user.expired) {
        consecutiveRenewFailures = 0; // recovered — the grant works again
        return;
      }
    } catch (retryError) {
      console.warn('[KeycloakAuth] Silent renew retry failed:', retryError?.message);
    }
    consecutiveRenewFailures += 1;
    if (consecutiveRenewFailures < MAX_RENEW_FAILURES) return; // back off — let the next timer tick try
    // Still failing after the cap: check whether the session is actually
    // unusable before discarding it. A live, unexpired user is not a reason
    // to log out — but stop re-arming the loop either way.
    consecutiveRenewFailures = 0;
    try {
      const user = await getUser();
      if (user && !user.expired) return;
    } catch (escalationError) {
      console.error('[KeycloakAuth] Session check after renew failures failed:', escalationError?.message);
    }
    login();
  });

  try {
    currentUser = await userManager.getUser();
    return currentUser;
  } catch (error) {
    console.error('[KeycloakAuth] Error during initialization:', error.message);
    currentUser = null;
    return null;
  }
}

/**
 * Get the UserManager instance (creates one if not initialized)
 * @returns {UserManager}
 */
function getUserManager() {
  if (!userManager) {
    userManager = new UserManager(oidcConfig);
  }
  return userManager;
}

/**
 * Redirect to Keycloak login page
 * @param {Object} [options] - Optional signin options
 * @param {string} [options.returnUrl] - URL to return to after login
 */
async function login(options = {}) {
  const manager = getUserManager();
  const state = options.returnUrl ? { returnUrl: options.returnUrl } : undefined;
  await manager.signinRedirect({ state });
}

/**
 * Process the OIDC callback (authorization code exchange)
 * @returns {Promise<Object>} User object
 */
async function handleCallback() {
  const manager = getUserManager();
  try {
    currentUser = await manager.signinRedirectCallback();
    return currentUser;
  } catch (error) {
    console.error('[KeycloakAuth] Error during callback processing:', error.message);
    currentUser = null;
    throw error;
  }
}

/**
 * Redirect to Keycloak logout
 */
async function logout() {
  // Remove event listeners before clearing state
  if (unsubscribeUserLoaded) {
    unsubscribeUserLoaded();
    unsubscribeUserLoaded = null;
  }
  if (unsubscribeSilentRenewError) {
    unsubscribeSilentRenewError();
    unsubscribeSilentRenewError = null;
  }

  const manager = getUserManager();
  // Capture id_token before removeUser() clears stored user —
  // signoutRedirect needs it as id_token_hint so Keycloak properly ends the session.
  const user = await manager.getUser().catch(() => null);
  const idToken = user?.id_token;
  try {
    await manager.removeUser();
  } catch (error) {
    console.error('[KeycloakAuth] Error removing user:', error.message);
  }
  try {
    await manager.clearStaleState();
  } catch (error) {
    console.error('[KeycloakAuth] Error clearing stale state:', error.message);
  }
  try {
    await manager.signoutRedirect({ id_token_hint: idToken });
  } catch (error) {
    console.error('[KeycloakAuth] Error during logout redirect:', error.message);
  } finally {
    currentUser = null;
  }
}

/**
 * Get the current OIDC user profile
 * @returns {Promise<Object|null>} User profile or null
 */
async function getUser() {
  const manager = getUserManager();
  currentUser = await manager.getUser();
  return currentUser;
}

/**
 * Get the access token from the current user
 * @returns {string|null} Access token string
 */
function getAccessToken() {
  return currentUser?.access_token || null;
}

/**
 * Check if the user is currently authenticated
 * @returns {boolean} True if authenticated
 */
function isAuthenticated() {
  return currentUser != null && !currentUser.expired;
}

/**
 * Manually trigger a silent token refresh via iframe
 * @returns {Promise<Object|null>} Refreshed user or null if refresh failed
 */
async function signinSilent() {
  // SERIALISED (David's 2026-10-11 logout, root-caused from the Keycloak log):
  // two browser tabs each renew on their own timer, and the realm runs
  // refresh_token_max_reuse=0 + revoke_refresh_token=false — so every silent
  // renew ROTATES the refresh token and a rotated/reused one is rejected. Two
  // concurrent renews therefore race and kill the session they share. Measured
  // live: 280 token POSTs in 59 seconds from two tabs, 5 rejected with
  // "Session not active", then a forced logout. One shared in-flight promise
  // means concurrent callers wait for ONE refresh instead of racing — WITHIN
  // this tab; across tabs the localStorage lease above serialises it further
  // (round 20, #80800: the module-scoped promise alone left the two-tab
  // race — the measured one — unserialised).
  if (renewInFlight) return renewInFlight;
  renewInFlight = (async () => {
    const manager = getUserManager();
    // EVERY exit path — adopt, own-renew, rejection — must clear renewInFlight
    // and release the lease: an adopt-path return that skips the finally
    // would pin renewInFlight to a resolved promise forever, making every
    // later renew in this tab return the stale one (caught by the lease
    // tests).
    try {
      const startedAt = Date.now();
      let held = acquireRenewLease();
      while (!held) {
        if (Date.now() - startedAt > RENEW_LEASE_TTL_MS + RENEW_WAIT_POLL_MS) {
          // The holder's lease is stale/dead — its renew went nowhere. Run
          // our own (acquireRenewLease takes over an expired lease).
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, RENEW_WAIT_POLL_MS));
        // After each wake: FIRST look for the holder's completion (the shared
        // oidc user store already carries the fresh tokens), and only then
        // try to take the lease — checking the lease first would grab it the
        // moment the holder releases, without ever reading the done marker.
        let doneAt = 0;
        try {
          doneAt = Number(window.localStorage.getItem(RENEW_DONE_KEY) || 0);
        } catch {
          /* storage unavailable — fall through and try to acquire */
        }
        if (doneAt >= startedAt) {
          const shared = await manager.getUser();
          if (shared && !shared.expired) {
            currentUser = shared;
            return shared;
          }
        }
        held = acquireRenewLease();
      }
      const user = await manager.signinSilent();
      if (user) currentUser = user;
      try {
        window.localStorage.setItem(RENEW_DONE_KEY, String(Date.now()));
      } catch {
        /* best-effort — waiters fall back to their own renew */
      }
      return user;
    } catch (error) {
      console.error('[KeycloakAuth] Error during silent renew:', error.message);
      throw error;
    } finally {
      releaseRenewLease();
      renewInFlight = null;
    }
  })();
  return renewInFlight;
}

/**
 * Register a callback to be invoked when the access token is silently refreshed
 * @param {Function} callback - Function called with the updated User object
 */
function onAccessTokenUpdated(callback) {
  accessTokenCallbacks.add(callback);
}

/**
 * Remove a previously registered access token update callback
 * @param {Function} callback - The callback to remove
 */
function removeAccessTokenUpdatedCallback(callback) {
  accessTokenCallbacks.delete(callback);
}

/**
 * Decode claims from the current access token.
 * Uses jwt-decode (same library used internally by oidc-client-ts).
 * @returns {Object|null} Decoded JWT claims or null
 */
function getAccessTokenClaims() {
  const token = currentUser?.access_token;
  if (!token) return null;
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
}

/**
 * Get the internal UserManager (for advanced usage)
 * @returns {UserManager}
 */
function getInternalUserManager() {
  return getUserManager();
}

export default {
  initialize,
  login,
  handleCallback,
  logout,
  getUser,
  getAccessToken,
  getAccessTokenClaims,
  isAuthenticated,
  signinSilent,
  onAccessTokenUpdated,
  removeAccessTokenUpdatedCallback,
  getUserManager: getInternalUserManager
};
