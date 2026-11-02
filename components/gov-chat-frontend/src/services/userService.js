// src/services/userService.js
// A7 sweep: the auth-era surface (~20 methods wrapping deleted routes) is
// DELETED — password reset/verification lives in Keycloak, profile saves go
// through userProfileService. Only the three live consumers remain
// (UserEditDialog admin actions + getCurrentUserInfo for Settings/UserProfile/
// ChatFolders, repointed to the A7 GET /api/me doc route).
import httpService from './httpService';

/**
 * Service for user account management operations.
 * Authentication is handled by keycloakAuthService (oidc-client-ts) — not here.
 */
class UserService {
  /**
   * Get current user account information — the sanitized whitelist doc from
   * GET /api/me, returned as-is (including the Arango `_key` consumers key on)
   * @returns {Promise} Current user data
   */
  async getCurrentUserInfo() {
    try {
      const response = await httpService.get('me');
      return response.data;
    } catch (error) {
      console.error('Error fetching current user info:', error);
      throw error;
    }
  }

  /**
   * Force user logout by invalidating their token (admin only)
   * @param {String} userId - User ID
   * @returns {Promise} Operation result
   */
  async forceUserLogout(userId) {
    try {
      const response = await httpService.post(`users/admin/users/${userId}/force-logout`);
      return response.data; // Ensure data is returned
    } catch (error) {
      console.error(`Error forcing logout for user ${userId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Resend email verification for a user (admin only)
   * @param {String} userId - User ID
   * @returns {Promise} Operation result
   */
  async resendVerificationEmailAdmin(userId) {
    try {
      const response = await httpService.post(`users/admin/users/${userId}/resend-verification`);
      return response.data;
    } catch (error) {
      console.error('Verification email resend error:', error.response || error);
      throw error;
    }
  }
}

export default new UserService();
