/**
 * Keycloak OIDC Authentication Service
 *
 * Wraps oidc-client-ts UserManager to provide OIDC authentication.
 * Tokens are stored in JavaScript memory only — never in localStorage, sessionStorage, or cookies.
 */

import { UserManager } from 'oidc-client-ts';
import oidcConfig from '@/config/oidcConfig';

let userManager = null;
let currentUser = null;
let accessTokenCallbacks = new Set();
let unsubscribeUserLoaded = null;
let unsubscribeSilentRenewError = null;

/**
 * Initialize the OIDC service — creates UserManager, checks for existing session,
 * and registers silent renew event listeners.
 * @returns {Promise<Object|null>} Existing user or null
 */
async function initialize() {
  userManager = new UserManager(oidcConfig);

  // Register silent renew event listeners
  unsubscribeUserLoaded = userManager.events.addUserLoaded((user) => {
    currentUser = user;
    accessTokenCallbacks.forEach((cb) => cb(user));
  });

  unsubscribeSilentRenewError = userManager.events.addSilentRenewError(() => {
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
  const manager = getUserManager();
  try {
    const user = await manager.signinSilent();
    if (user) {
      currentUser = user;
    }
    return user;
  } catch (error) {
    console.error('[KeycloakAuth] Error during silent renew:', error.message);
    throw error;
  }
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
  isAuthenticated,
  signinSilent,
  onAccessTokenUpdated,
  removeAccessTokenUpdatedCallback,
  getUserManager: getInternalUserManager
};
