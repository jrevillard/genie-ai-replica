// src/services/userService.js
import httpService from './httpService'
import crypto from 'crypto'

/**
 * Service for user account management and authentication operations.
 * Follows the same unified pattern as the mobile app's UserService
 * (see mobile/genie_ai_mobile/lib/services/user_service.dart).
 *
 * Merged authService.js capabilities into this service (GitLab issue #396).
 * Auth methods use `auth/` prefix, user management uses `users/` prefix.
 */
class UserService {
  /**
   * Initialize the UserService
   */
  constructor() {
    this.tokenKey = 'user'
    this.authEndpoint = 'auth'
    this.userEndpoint = 'users'

    // Request resilience (from authService)
    this.pendingRequests = new Map()
    this.maxRetries = 3
    this.retryDelay = 1000

    // Proactive token refresh (from authService)
    this.refreshInterval = 15 * 60 * 1000 // 15 minutes
    this.setupTokenRefresh()
  }

  // ===== REQUEST RESILIENCE =====

  /**
   * Set up interval for proactive token refresh
   * @private
   */
  setupTokenRefresh() {
    setInterval(async () => {
      if (this.isAuthenticated()) {
        try {
          console.log('Attempting proactive token refresh')
          await this.refreshToken()
          console.log('Token refreshed proactively')
        } catch (error) {
          console.error('Proactive token refresh failed:', error)
          if (error.response?.status === 401 || error.response?.status === 403) {
            this.clearUserData()
            console.log('Cleared user data due to refresh failure')
          }
        }
      }
    }, this.refreshInterval)
  }

  /**
   * Retry a request with exponential backoff
   * Only retries on 401/403 (auth-related) errors
   * @private
   * @param {Function} fn - Function to retry
   * @param {number} attempt - Current attempt number
   * @returns {Promise} Result of the function
   */
  async retryRequest(fn, attempt = 1) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= this.maxRetries || ![401, 403].includes(error.response?.status)) {
        throw error
      }
      console.log(`Retry attempt ${attempt} for failed request: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt))
      return this.retryRequest(fn, attempt + 1)
    }
  }

  /**
   * Refresh the access token using the refresh token
   * Includes deduplication to prevent multiple simultaneous refresh attempts
   * @returns {Promise} Promise with new token data or error
   */
  async refreshToken() {
    // Prevent multiple simultaneous refresh attempts
    if (this.pendingRequests.has('refresh')) {
      console.log('Returning existing refresh request')
      return this.pendingRequests.get('refresh')
    }

    const requestPromise = (async () => {
      try {
        const userData = this.getCurrentUser()
        if (!userData?.refreshToken) {
          throw new Error('No refresh token available')
        }
        const response = await httpService.post(`${this.authEndpoint}/refresh-token`, {
          refreshToken: userData.refreshToken,
        })
        if (response.data && response.data.accessToken) {
          this.setUserData({
            ...userData,
            accessToken: response.data.accessToken,
            refreshToken: response.data.refreshToken || userData.refreshToken,
          })
        }
        return response.data
      } catch (error) {
        console.error('Refresh token error:', error)
        if (error.response?.status === 401 || error.response?.status === 403) {
          this.clearUserData()
        }
        throw error
      } finally {
        this.pendingRequests.delete('refresh')
      }
    })()

    this.pendingRequests.set('refresh', requestPromise)
    return requestPromise
  }

  // ===== AUTHENTICATION METHODS =====

  /**
   * Authenticate user with username and password
   * @param {string} loginName The username or email
   * @param {string} password The password
   * @returns {Promise} Promise with user data or error
   */
  async login(loginName, password) {
    try {
      const encPassword = this.hashPassword(password)
      const response = await this.retryRequest(() =>
        httpService.post(`${this.authEndpoint}/login`, {
          loginName,
          encPassword,
        })
      )
      if (response.data && response.data.accessToken) {
        this.setUserData(response.data)
      }
      return response.data
    } catch (error) {
      console.error('Login error:', error)
      throw error
    }
  }

  /**
   * Register a new user
   * @param {Object} userData User registration data
   * @param {string} userData.loginName Username
   * @param {string} userData.email Email address
   * @param {string} userData.password Password (will be hashed)
   * @param {string} [userData.fullName] Full name (optional)
   * @returns {Promise} Promise with registration result or error
   */
  async register(userData) {
    try {
      const payload = {
        loginName: userData.loginName,
        email: userData.email,
        encPassword: this.hashPassword(userData.password),
      }
      if (userData.fullName) {
        payload.fullName = userData.fullName
      }
      const response = await this.retryRequest(() => httpService.post(`${this.authEndpoint}/register`, payload))
      return response.data
    } catch (error) {
      console.error('Registration error:', error)
      throw error
    }
  }

  /**
   * Log out the user
   * The backend requires authentication (authMiddleware.authenticate),
   * so the explicit Authorization header is necessary as a safety net
   * beyond the httpService interceptor. retryRequest provides resilience.
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

      const response = await this.retryRequest(() =>
        httpService.post(
          `${this.authEndpoint}/logout`,
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
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
   * Includes automatic token refresh on 401 with retry.
   * @returns {Promise} Promise with current user data
   */
  async fetchCurrentUser() {
    try {
      const response = await this.retryRequest(() => httpService.get(`${this.authEndpoint}/me`))
      return response.data.user
    } catch (error) {
      if (error.response?.status === 401) {
        try {
          await this.refreshToken()
          const retryResponse = await httpService.get(`${this.authEndpoint}/me`)
          return retryResponse.data.user
        } catch (refreshError) {
          console.error('Refresh failed, logging out:', refreshError)
          this.clearUserData()
          throw refreshError
        }
      }
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
   * Hash a password using SHA-256
   * Note: This is done for demonstration. In production, HTTPS should be used
   * rather than client-side hashing, or a more secure method should be employed.
   * @param {string} password The password to hash
   * @returns {string} The hashed password
   */
  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex')
  }

  /**
   * Initiate password reset process
   * @param {string} email User's email address
   * @returns {Promise} Promise with reset request result
   */
  async initiatePasswordReset(email) {
    try {
      const response = await this.retryRequest(() => httpService.post(`${this.authEndpoint}/reset-password`, { email }))
      return response.data
    } catch (error) {
      console.error('Password reset initiation error:', error)
      throw error
    }
  }

  /**
   * Validate a password reset token
   * @param {string} token Reset token from email
   * @returns {Promise} Promise with token validation result
   */
  async validateResetToken(token) {
    try {
      const response = await this.retryRequest(() => httpService.post(`${this.authEndpoint}/validate-token`, { token }))
      return response.data
    } catch (error) {
      console.error('Token validation error:', error)
      throw error
    }
  }

  /**
   * Reset password with token
   * @param {string} token Reset token from email
   * @param {string} newPassword New password (will be hashed)
   * @returns {Promise} Promise with password reset result
   */
  async resetPassword(token, newPassword) {
    try {
      const encPassword = this.hashPassword(newPassword)
      const response = await this.retryRequest(() =>
        httpService.post(`${this.authEndpoint}/reset-password/confirm`, {
          token,
          newPassword: encPassword,
        })
      )
      return response.data
    } catch (error) {
      console.error('Password reset error:', error)
      throw error
    }
  }

  /**
   * Change password for authenticated user
   * @param {string} currentPassword Current password (will be hashed)
   * @param {string} newPassword New password (will be hashed)
   * @returns {Promise} Promise with password change result
   */
  async changePassword(currentPassword, newPassword) {
    try {
      const encCurrentPassword = this.hashPassword(currentPassword)
      const encNewPassword = this.hashPassword(newPassword)
      const response = await this.retryRequest(() =>
        httpService.post(`${this.authEndpoint}/change-password`, {
          currentPassword: encCurrentPassword,
          newPassword: encNewPassword,
        })
      )
      return response.data
    } catch (error) {
      console.error('Password change error:', error)
      throw error
    }
  }

  /**
   * Verify email with token
   * Uses GET auth/verify-email/:token (matches backend auth-routes.js line 242).
   * Includes request deduplication to prevent duplicate verification attempts.
   * @param {string} token Verification token from email
   * @returns {Promise} Promise with verification result
   */
  async verifyEmail(token) {
    if (this.pendingRequests.has(`verify_${token}`)) {
      console.log('Returning existing verification request')
      return this.pendingRequests.get(`verify_${token}`)
    }

    try {
      const requestPromise = this.retryRequest(() => httpService.get(`${this.authEndpoint}/verify-email/${token}`))
      this.pendingRequests.set(`verify_${token}`, requestPromise)
      const response = await requestPromise
      this.pendingRequests.delete(`verify_${token}`)
      return response.data
    } catch (error) {
      this.pendingRequests.delete(`verify_${token}`)
      console.error('Email verification error:', error)
      throw error
    }
  }

  /**
   * Resend verification email
   * Uses POST auth/resend-verification (matches backend auth-routes.js line 303).
   * @param {string} email User's email address
   * @returns {Promise} Promise with resend result
   */
  async resendVerificationEmail(email) {
    try {
      const response = await this.retryRequest(() =>
        httpService.post(`${this.authEndpoint}/resend-verification`, { email })
      )
      return response.data
    } catch (error) {
      console.error('Resend verification error:', error)
      throw error
    }
  }

  // ===== USER MANAGEMENT METHODS =====

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
   * Update user's email address
   * @param {string} newEmail - New email address
   * @param {string} password - Current password for verification
   * @param {string} userId - User ID for authentication
   * @returns {Promise} Operation result
   */
  async updateEmail(newEmail, password, userId) {
    try {
      console.log(`Updating email to: ${newEmail} for user: ${userId}`)
      const response = await httpService.put('users/email', {
        email: newEmail,
        password: this.hashPassword(password),
        userId: userId,
      })
      return response.data
    } catch (error) {
      console.error('Error updating email:', error)
      throw error
    }
  }

  /**
   * Deactivate user account
   * @param {string} reason - Reason for deactivation
   * @param {string} password - Password confirmation
   * @returns {Promise} Deactivation result
   */
  async deactivateAccount(reason, password) {
    try {
      const response = await httpService.post('users/deactivate', {
        reason,
        password,
      })
      return response.data
    } catch (error) {
      console.error('Error deactivating account:', error)
      throw error
    }
  }

  /**
   * Reactivate a previously deactivated account
   * @returns {Promise} Reactivation result
   */
  async reactivateAccount() {
    try {
      const response = await httpService.post('users/reactivate')
      return response.data
    } catch (error) {
      console.error('Error reactivating account:', error)
      throw error
    }
  }

  /**
   * Check if username is available
   * @param {string} username - Username to check
   * @returns {Promise<boolean>} True if username is available
   */
  async checkUsernameAvailability(username) {
    try {
      const response = await httpService.get('users/check-username', {
        params: { username },
      })
      return response.data.available
    } catch (error) {
      console.error('Error checking username availability:', error)
      return false
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
   * Check if email is available
   * @param {string} email - Email to check
   * @returns {Promise<boolean>} True if email is available
   */
  async checkEmailAvailability(email) {
    try {
      const encodedEmail = encodeURIComponent(email)
      const url = `${this.userEndpoint}/check-email?email=${encodedEmail}`
      console.log(`Checking email availability at: ${url}`)

      const response = await httpService.get(url)
      return response.data.available
    } catch (error) {
      console.error('Error checking email availability:', error)
      return false
    }
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
   * @param {string} password - Password confirmation for security
   * @param {string} reason - Optional reason for deletion
   * @returns {Promise} Deletion result
   */
  async deleteAccount(password, reason = '') {
    try {
      const response = await httpService.post('users/delete', {
        password: this.hashPassword(password),
        reason,
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
   * Update user role (admin only)
   * @param {String} userId - User ID
   * @param {Object} updateData - Data to update (role, disabled status)
   * @returns {Promise} Update result
   */
  async updateUserRole(userId, updateData) {
    try {
      console.log(`Updating role for user ${userId} to ${updateData.role}`)

      const response = await httpService.put(`${this.userEndpoint}/${userId}/role`, updateData)

      console.log(`Role update response for ${userId}:`, response)

      return response
    } catch (error) {
      console.error(`Error updating user role for ${userId}:`, error)

      if (error.response) {
        console.error('Error response status:', error.response.status)
        console.error('Error response data:', error.response.data)
      }

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

  /**
   * Resend email verification for a user (admin only)
   * @param {String} userId - User ID
   * @returns {Promise} Operation result
   */
  async resendVerificationEmailAdmin(userId) {
    try {
      console.log(`Attempting to resend verification email for user: ${userId}`)
      const response = await httpService.post(`users/admin/users/${userId}/resend-verification`)
      return response.data
    } catch (error) {
      console.error('Verification email resend error:', error.response || error)
      throw error
    }
  }
}

export default new UserService()
