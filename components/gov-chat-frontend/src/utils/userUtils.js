// src/utils/userUtils.js - Shared user utility functions

/**
 * Extract a user ID from a user object.
 * Uses the OIDC iss_sub composite key (iss#sub).
 * @param {Object} user - User object from Vuex store
 * @returns {string|undefined}
 */
export function getUserId(user) {
  if (!user) return undefined;
  return user.iss_sub;
}
