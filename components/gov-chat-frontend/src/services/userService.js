// src/services/userService.js
import httpService from './httpService';

/**
 * Service for user data operations (post-OIDC cleanup).
 * Only GENIE-specific operations remain — identity management
 * is handled by Keycloak Account/Admin Consoles.
 */
class UserService {
  constructor() {
    this.userEndpoint = 'me';
  }

  /**
   * Reset user profile data while preserving essential account information
   * @returns {Promise} Promise with reset operation result
   */
  async resetUserData() {
    try {
      console.log('Calling reset user data endpoint');
      const response = await httpService.post(`${this.userEndpoint}/reset-data`);
      return response.data;
    } catch (error) {
      console.error('Error resetting user data:', error);
      throw error;
    }
  }

  /**
   * Delete user account (GDPR right to erasure). Permanent and irreversible.
   * @returns {Promise} Promise with deletion result
   */
  async deleteAccount() {
    try {
      const response = await httpService.post(`${this.userEndpoint}/delete`);
      return response.data;
    } catch (error) {
      console.error('Error deleting account:', error);
      throw error;
    }
  }
}

export default new UserService();
