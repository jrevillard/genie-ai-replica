// src/services/userService.js
import httpService from './httpService'

/**
 * Service for user account management operations
 */
class UserService {
  /**
   * Initialize the UserService
   */
  constructor() {
    this.tokenKey = 'user'
    this.userEndpoint = 'users'
    this.authEndpoint = 'auth'
  }

  // ===== AUTHENTICATION METHODS =====

  /**
   * Log out the user
   * The backend requires authentication (authMiddleware.authenticate),
   * so the explicit Authorization header is necessary as a safety net
   * beyond the httpService interceptor.
   * @returns {Promise} Promise with logout result
   */
  async logout() {
    try {
      const userData = this.getCurrentUser()
      const accessToken = userData?.accessToken

      if (!accessToken) {
        console.warn('No access token found for logout')
        this.clearUserData()
        return { success: true, message: 'Logged out successfully (no token)' }
      }

      console.log('Sending logout request with Authorization header')

      const response = await httpService.post(
        `${this.authEndpoint}/logout`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      this.clearUserData()
      return response.data
    } catch (error) {
      console.error('Logout error:', error)
      this.clearUserData()
      throw error
    }
  }

  /**
   * Get the currently authenticated user from the server
   * @returns {Promise} Promise with current user data
   */
  async fetchCurrentUser() {
    try {
      const response = await httpService.get(`${this.authEndpoint}/me`)
      return response.data.user
    } catch (error) {
      console.error('Fetch current user error:', error)
      throw error
    }
  }

  /**
   * Get the currently authenticated user from local storage
   * @returns {Object|null} The user data or null if not authenticated
   */
  getCurrentUser() {
    try {
      const userStr = localStorage.getItem(this.tokenKey)
      if (!userStr) return null

      return JSON.parse(userStr)
    } catch (e) {
      console.error('Error parsing user data:', e)
      return null
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} True if authenticated, false otherwise
   */
  isAuthenticated() {
    const user = this.getCurrentUser()
    return !!user && !!user.accessToken
  }

  /**
   * Set user data in local storage
   * @param {Object} userData User data with accessToken
   * @private
   */
  setUserData(userData) {
    localStorage.setItem(this.tokenKey, JSON.stringify(userData))
  }

  /**
   * Clear user data from local storage
   * @private
   */
  clearUserData() {
    localStorage.removeItem(this.tokenKey)
  }

  /**
   * Reset user profile data while preserving essential account information
   * @returns {Promise} Promise with reset operation result
   */
  async resetUserData() {
    try {
      console.log('Calling reset user data endpoint')
      const response = await httpService.post(`${this.userEndpoint}/reset-data`)

      if (response.data && response.data.success) {
        await this.refreshUserData()
      }

      return response.data
    } catch (error) {
      console.error('Error resetting user data:', error)
      throw error
    }
  }

  // ===== EXISTING USER METHODS =====

  /**
   * Get current user account information
   * Uses cached data when available with background refresh
   * @returns {Promise} Current user data
   */
  async getCurrentUserInfo() {
    try {
      // First try to get from localStorage for faster loading
      const cachedUser = this.getCurrentUser()
      if (cachedUser) {
        // If we have cached data, make a background refresh but don't wait for it
        this.refreshUserData()
        return cachedUser
      }

      // If no cached data, fetch from the server
      const response = await httpService.get(`${this.authEndpoint}/me`)
      return response.data.user || response.data
    } catch (error) {
      console.error('Error fetching current user info:', error)
      throw error
    }
  }

  /**
   * Refresh the data for the logged in user
   * @returns {Promise} Promise with refreshed user data
   */
  async refreshUserData() {
    try {
      const response = await httpService.get(`${this.authEndpoint}/me`)
      const userData = response.data.user || response.data

      // Update local storage with fresh data
      if (userData) {
        const currentData = this.getCurrentUser()
        this.setUserData({
          ...currentData,
          ...userData,
        })
      }

      return userData
    } catch (error) {
      console.error('Error refreshing user data:', error)
      // Don't throw, this is a background refresh
      return null
    }
  }

  /**
   * Update user account settings
   * @param {Object} settings - Account settings to update
   * @returns {Promise} Updated account settings
   */
  async updateAccountSettings(settings) {
    try {
      const response = await httpService.put('users/settings', settings)
      return response.data
    } catch (error) {
      console.error('Error updating account settings:', error)
      throw error
    }
  }

  /**
   * Verify user's email address
   * @param {string} token - Email verification token
   * @returns {Promise} Verification result
   */
  async verifyEmail(token) {
    try {
      const response = await httpService.post('users/verify-email', { token })
      return response.data
    } catch (error) {
      console.error('Error verifying email:', error)
      throw error
    }
  }

  /**
   * Resend email verification link
   * @param {string} email - User's email address
   * @returns {Promise} Operation result
   */
  async resendVerificationEmail(email) {
    try {
      const response = await httpService.post('users/resend-verification', { email })
      return response.data
    } catch (error) {
      console.error('Error resending verification email:', error)
      throw error
    }
  }

  /**
   * Update user's email address
   * @param {string} newEmail - New email address
   * @param {string} userId - User ID for authentication
   * @returns {Promise} Operation result
   */
  async updateEmail(newEmail, userId) {
    try {
      console.log(`Updating email to: ${newEmail} for user: ${userId}`)
      const response = await httpService.put('users/email', {
        email: newEmail,
        userId: userId
      })
      return response.data
    } catch (error) {
      console.error('Error updating email:', error)
      throw error
    }
  }

  /**
   * Get user account activity log
   * @param {Number} page - Page number (starting from 1)
   * @param {Number} limit - Results per page
   * @returns {Promise} User activity log with pagination
   */
  async getActivityLog(page = 1, limit = 20) {
    try {
      const response = await httpService.get('users/activity', {
        params: { page, limit }
      })
      return response.data
    } catch (error) {
      console.error('Error fetching activity log:', error)
      throw error
    }
  }

  /**
   * Get user's account status
   * @returns {Promise} Account status information
   */
  async getAccountStatus() {
    try {
      const response = await httpService.get('users/status')
      return response.data
    } catch (error) {
      console.error('Error fetching account status:', error)
      throw error
    }
  }

  /**
   * Upload a user avatar
   * @param {File} avatarFile - Avatar image file
   * @returns {Promise} Upload result with avatar URL
   */
  async uploadAvatar(avatarFile) {
    try {
      const formData = new FormData()
      formData.append('avatar', avatarFile)

      const response = await httpService.post('users/avatar', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      return response.data
    } catch (error) {
      console.error('Error uploading avatar:', error)
      throw error
    }
  }

  /**
   * Delete user's avatar
   * @returns {Promise} Operation result
   */
  async deleteAvatar() {
    try {
      const response = await httpService.delete('users/avatar')
      return response.data
    } catch (error) {
      console.error('Error deleting avatar:', error)
      throw error
    }
  }

  /**
   * Validate password strength
   * @param {string} password Password to validate
   * @returns {Object} Validation result with strength score and feedback
   */
  validatePasswordStrength(password) {
    const result = {
      isValid: false,
      score: 0,
      feedback: {
        warnings: [],
        suggestions: [],
      },
    }

    if (!password || password.length < 8) {
      result.feedback.warnings.push('Password is too short')
      result.feedback.suggestions.push('Use at least 8 characters')
      return result
    }

    let score = 0

    const hasLowercase = /[a-z]/.test(password)
    const hasUppercase = /[A-Z]/.test(password)
    const hasDigit = /\d/.test(password)
    const hasSpecial = /[^a-zA-Z0-9]/.test(password)

    if (hasLowercase) score++
    if (hasUppercase) score++
    if (hasDigit) score++
    if (hasSpecial) score++

    if (password.length >= 12) score++
    if (password.length >= 16) score++

    score = Math.min(score, 4)
    result.score = score
    result.isValid = score >= 3

    if (!hasLowercase) {
      result.feedback.suggestions.push('Add lowercase letters')
    }
    if (!hasUppercase) {
      result.feedback.suggestions.push('Add uppercase letters')
    }
    if (!hasDigit) {
      result.feedback.suggestions.push('Add numbers')
    }
    if (!hasSpecial) {
      result.feedback.suggestions.push('Add special characters')
    }
    if (password.length < 12) {
      result.feedback.suggestions.push('Make your password longer')
    }

    if (/^[a-zA-Z]+$/.test(password)) {
      result.feedback.warnings.push('Password contains only letters')
    }
    if (/^\d+$/.test(password)) {
      result.feedback.warnings.push('Password contains only numbers')
    }
    if (/(.)\1{2,}/.test(password)) {
      result.feedback.warnings.push('Password contains repeated characters')
    }

    return result
  }

  /**
   * Check if passwords match
   * @param {string} password First password
   * @param {string} confirmPassword Second password for confirmation
   * @returns {boolean} True if passwords match
   */
  doPasswordsMatch(password, confirmPassword) {
    return password === confirmPassword
  }

  /**
   * Permanently delete user account
   * @param {string} reason - Optional reason for deletion
   * @returns {Promise} Deletion result
   */
  async deleteAccount(reason = '') {
    try {
      const response = await httpService.post('users/delete', {
        reason
      })

      if (response.data && response.data.success) {
        this.clearUserData()
      }

      return response.data
    } catch (error) {
      console.error('Error deleting account:', error)
      throw error
    }
  }

  /**
   * Verify user email (admin only)
   * @param {String} userId - User ID
   * @returns {Promise} Operation result
   */
  async verifyUserEmail(userId) {
    try {
      const response = await httpService.post(`admin/users/${userId}/verify-email`)
      return response
    } catch (error) {
      console.error('Error verifying user email:', error)
      throw error
    }
  }

  /**
   * Get a list of all users (admin only)
   * @param {Object} options - Query options (limit, offset, sort)
   * @returns {Promise} List of users
   */
  async getAllUsers(options = {}) {
    try {
      const response = await httpService.get('admin/users', { params: options })
      return response
    } catch (error) {
      console.error('Error fetching users list:', error)
      throw error
    }
  }

  /**
   * Get user profile by ID (for admin use)
   * @param {String} userId - User ID
   * @returns {Promise} User profile data
   */
  async getUserProfile(userId) {
    try {
      return await httpService.get(`users/${userId}`, {
        params: { admin: true },
      })
    } catch (error) {
      console.error('Error fetching user profile:', error)
      throw error
    }
  }

  /**
   * Force user logout by invalidating their token (admin only)
   * @param {String} userId - User ID
   * @returns {Promise} Operation result
   */
  async forceUserLogout(userId) {
    try {
      console.log(
        `[USER SERVICE DEBUG] Attempting force logout for user ${userId} at endpoint: /api/users/admin/users/${userId}/force-logout`
      )
      const response = await httpService.post(`users/admin/users/${userId}/force-logout`)
      console.log(`[USER SERVICE DEBUG] Force logout successful for user ${userId}:`, response.data)
      return response.data
    } catch (error) {
      console.error(
        `[USER SERVICE DEBUG] Error forcing logout for user ${userId}:`,
        error.message,
        error.response?.data
      )
      throw error
    }
  }
}

export default new UserService()
