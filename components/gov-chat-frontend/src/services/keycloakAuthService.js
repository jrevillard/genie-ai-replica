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

// ── CROSS-TAB RENEW (round 20 #80800 → round 21 #80864/#80876) ───────────────
// The in-tab `renewInFlight` promise is one per JavaScript realm — one per
// TAB — so the two-tab race the root-cause comment names needs a CROSS-tab
// mechanism: with refresh_token_max_reuse=0 the second tab's concurrent
// renew reuses a rotated token, is rejected, and after 3 such failures the
// escalation path forces the very logout this fix exists to remove.
//
// Round 21 redesign — the round-20 lease had two holes:
//  (1) NOT ATOMIC (#80864): localStorage has no compare-and-swap, and the
//      write→read-back only proved WE were the last writer AT THE MOMENT WE
//      READ — two tabs whose timers fire together could BOTH hold the lease
//      and both rotate the refresh token. The PRIMARY mechanism is now the
//      Web Locks API (`navigator.locks.request('genie-renew')`), the only
//      genuinely atomic cross-tab claim; the localStorage lease survives as
//      a FALLBACK for engines without Web Locks, hardened with a settle
//      window (write, wait out RENEW_SETTLE_MS, re-read — a simultaneous
//      claimant has already overwritten us by then, so only the LAST writer
//      can still see its own tab id).
//  (2) THE DONE-MARKER CARRIED NO TOKEN (#80876): the waiter's
//      `manager.getUser()` reads THIS tab's per-tab oidc user store
//      (sessionStorage by default — no shared `userStore` is configured), so
//      a "done" flag made the waiter adopt its OWN STALE user: an access
//      token about to 401 and a refresh token Keycloak had already
//      invalidated — the forced logout, relocated to the waiter tab. The
//      holder now PUBLISHES the minted user itself (RENEW_USER_KEY) before
//      the done marker, and waiters adopt THAT (storeUser seeds their own
//      per-tab store with the fresh tokens).
// TTL-bounded either way: a holder that dies without releasing is taken
// over after RENEW_LEASE_TTL_MS (a Web Lock held by a dead tab releases
// automatically; the lease fallback uses the TTL takeover). Storage
// failures degrade to the in-tab serialisation alone.
const RENEW_LOCK_NAME = 'genie-renew';
const RENEW_LEASE_KEY = 'genie.renew.lease';
const RENEW_DONE_KEY = 'genie.renew.done';
const RENEW_USER_KEY = 'genie.renew.user';
const RENEW_LEASE_TTL_MS = 20000;
const RENEW_WAIT_POLL_MS = 250;
const RENEW_SETTLE_MS = 80;
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

async function acquireRenewLease() {
  if (leaseHeldByOther()) return false;
  try {
    window.localStorage.setItem(RENEW_LEASE_KEY, JSON.stringify({ tab: RENEW_TAB_ID, at: Date.now() }));
    // SETTLE WINDOW (round 21, #80864): localStorage has no compare-and-swap,
    // and the round-20 immediate read-back only proved we were the last
    // writer AT THE MOMENT WE READ — two tabs whose renew timers fire
    // together could BOTH see their own tab id and both rotate the refresh
    // token. Waiting out the settle window before re-reading means a
    // simultaneous claimant has already overwritten us by the time we look;
    // only the LAST writer can still see its own tab id. (Browsers with the
    // Web Locks API never take this path — the lock is the atomic claim.)
    await new Promise((resolve) => setTimeout(resolve, RENEW_SETTLE_MS));
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

/** The holder publishes the minted user BEFORE the done marker (#80876): a
 * done flag alone carries no token, and the waiter's own per-tab oidc store
 * still holds its PRE-renew user. Same-origin localStorage is synchronous,
 * so whoever observes the marker can always read the user. */
function publishRenewedUser(user) {
  if (!user) return;
  try {
    const at = Date.now();
    window.localStorage.setItem(RENEW_USER_KEY, JSON.stringify({ at, user }));
    window.localStorage.setItem(RENEW_DONE_KEY, String(at));
  } catch {
    /* best-effort — waiters fall back to their own renew */
  }
}

/** The waiter's side of the handoff: the publication newer than OUR wait's
 * start, with a comfortably-future expires_at (the JSON round-trip drops
 * the User class, so check the raw field — oidc stores it in seconds). */
function readPublishedRenew(startedAt) {
  try {
    const raw = window.localStorage.getItem(RENEW_USER_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !(entry.at >= startedAt) || !entry.user) return null;
    const exp = entry.user.expires_at;
    if (typeof exp !== 'number' || exp * 1000 <= Date.now() + 5000) return null;
    return entry.user;
  } catch {
    return null;
  }
}

/** Adopt the holder's published user: seed THIS tab's per-tab oidc store
 * (storeUser) so its next getUser returns the fresh tokens, then serve it. */
async function adoptPublishedUser(manager, user) {
  try {
    await manager.storeUser(user);
  } catch {
    /* keep the returned user even if the store write fails */
  }
  currentUser = user;
  return user;
}

/** PRIMARY cross-tab mechanism (#80864): the Web Locks API — the only
 * genuinely atomic cross-tab claim. ifAvailable:true never queues: a busy
 * lock returns null immediately and the caller waits for the holder's
 * publication instead, retrying the lock if it frees (a dead holder's lock
 * releases automatically). Past the TTL with no publication the holder is
 * wedged — bounded degradation: renew without the lock, the same trade the
 * stale-lease takeover always made (a renew wedged >20s went nowhere). */
async function renewViaWebLock(manager, startedAt) {
  const renewOnce = async () => {
    const user = await manager.signinSilent();
    if (user) currentUser = user;
    publishRenewedUser(user);
    return user;
  };
  const held = await navigator.locks.request(RENEW_LOCK_NAME, { ifAvailable: true }, async (lock) =>
    lock ? renewOnce() : null
  );
  if (held) return held;
  while (Date.now() - startedAt < RENEW_LEASE_TTL_MS) {
    await new Promise((resolve) => setTimeout(resolve, RENEW_WAIT_POLL_MS));
    const adopted = readPublishedRenew(startedAt);
    if (adopted) return adoptPublishedUser(manager, adopted);
    const got = await navigator.locks.request(RENEW_LOCK_NAME, { ifAvailable: true }, async (lock) =>
      lock ? renewOnce() : null
    );
    if (got) return got;
  }
  return renewOnce();
}

/** FALLBACK for engines without Web Locks: the settle-window localStorage
 * lease (see acquireRenewLease) + the same publication handoff. */
async function renewViaLease(manager, startedAt) {
  let held = await acquireRenewLease();
  while (!held) {
    if (Date.now() - startedAt > RENEW_LEASE_TTL_MS + RENEW_WAIT_POLL_MS) {
      // The holder's lease is stale/dead — its renew went nowhere. Run our
      // own (acquireRenewLease takes over an expired lease).
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, RENEW_WAIT_POLL_MS));
    // After each wake: FIRST look for the holder's publication (the minted
    // tokens, not just a timestamp — #80876), and only then try to take the
    // lease — checking the lease first would grab it the moment the holder
    // releases, without ever reading what it published.
    const adopted = readPublishedRenew(startedAt);
    if (adopted) return adoptPublishedUser(manager, adopted);
    held = await acquireRenewLease();
  }
  const user = await manager.signinSilent();
  if (user) currentUser = user;
  publishRenewedUser(user);
  return user;
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
      // Web Locks where the engine has them (atomic, #80864); settle-window
      // localStorage lease otherwise. Both publish the minted user (#80876).
      if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return await renewViaWebLock(manager, startedAt);
      }
      return await renewViaLease(manager, startedAt);
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
