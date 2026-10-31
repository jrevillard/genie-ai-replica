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
  // means concurrent callers wait for ONE refresh instead of racing.
  if (renewInFlight) return renewInFlight;
  renewInFlight = (async () => {
    const manager = getUserManager();
    try {
      const user = await manager.signinSilent();
      if (user) currentUser = user;
      return user;
    } catch (error) {
      console.error('[KeycloakAuth] Error during silent renew:', error.message);
      throw error;
    } finally {
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
