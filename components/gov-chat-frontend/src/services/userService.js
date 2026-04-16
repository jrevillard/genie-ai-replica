// src/services/userService.js
import httpService from './httpService'

/**
 * Service for user data operations.
 * GENIE-specific user management methods.
 * Authentication (login/logout/register) is handled by Keycloak OIDC.
 */
class UserService {
  constructor() {
    this.userEndpoint = 'me'
  }

  /**
   * Reset user profile data while preserving essential account information
   * @returns {Promise} Promise with reset operation result
   */
  async resetUserData() {
    try {
      console.log('Calling reset user data endpoint')
      const response = await httpService.post(`${this.userEndpoint}/reset-data`)
      return response.data
    } catch (error) {
      console.error('Error resetting user data:', error)
      throw error
    }
  }
}

export default new UserService()
