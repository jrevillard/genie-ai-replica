// src/utils/userUtils.js - Shared user utility functions

/**
 * Extract a user ID from a user object.
 * Tries OIDC claims first (sub, iss_sub), then ArangoDB fields (_key, id).
 * @param {Object} user - User object from Vuex store or API
 * @returns {string|undefined}
 */
export function getUserId(user) {
  if (!user) return undefined
  return user.sub || user.iss_sub || user._key || user.id
}
