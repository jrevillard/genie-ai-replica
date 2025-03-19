// src/services/authService.js

import httpService from './httpService';
import crypto from 'crypto';

/**
 * Service to handle authentication with the backend
 */
class AuthService {
  /**
   * Initialize the AuthService
   */
  constructor() {
    this.tokenKey = 'user';
    this.authEndpoint = 'auth';
  }

  /**
   * Authenticate user with username and password
   * @param {string} loginName The username or email
   * @param {string} password The password
   * @returns {Promise} Promise with user data or error
   */
  async login(loginName, password) {
    try {
      // Hash the password client-side before sending
      const encPassword = this.hashPassword(password);
      
      const response = await httpService.post(`${this.authEndpoint}/login`, {
        loginName,
        encPassword
      });
      
      if (response.data && response.data.accessToken) {
        this.setUserData(response.data);
      }
      
      return response.data;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
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
      // Create payload with hashed password
      const payload = {
        loginName: userData.loginName,
        email: userData.email,
        encPassword: this.hashPassword(userData.password)
      };
      
      // Add optional fields if provided
      if (userData.fullName) {
        payload.fullName = userData.fullName;
      }
      
      const response = await httpService.post(`${this.authEndpoint}/register`, payload);
      
      // If registration includes auto login, store token
      if (response.data && response.data.accessToken) {
        this.setUserData(response.data);
      }
      
      return response.data;
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }
  
  /**
   * Log out the user
   * @returns {Promise} Promise with logout result
   */
  async logout() {
    try {
      // Call the server to invalidate the token
      const response = await httpService.post(`${this.authEndpoint}/logout`);
      
      // Remove user data from local storage regardless of server response
      this.clearUserData();
      
      return response.data;
    } catch (error) {
      console.error('Logout error:', error);
      
      // Even if the server request fails, clear local user data
      this.clearUserData();
      
      // Re-throw the error so the UI can handle it
      throw error;
    }
  }
  
  /**
   * Get the currently authenticated user from the server
   * @returns {Promise} Promise with current user data
   */
  async fetchCurrentUser() {
    try {
      const response = await httpService.get(`${this.authEndpoint}/me`);
      return response.data.user;
    } catch (error) {
      console.error('Fetch current user error:', error);
      throw error;
    }
  }
  
  /**
   * Get the currently authenticated user from local storage
   * @returns {Object|null} The user data or null if not authenticated
   */
  getCurrentUser() {
    try {
      const userStr = localStorage.getItem(this.tokenKey);
      if (!userStr) return null;
      
      return JSON.parse(userStr);
    } catch (e) {
      console.error('Error parsing user data:', e);
      return null;
    }
  }
  
  /**
   * Check if user is authenticated
   * @returns {boolean} True if authenticated, false otherwise
   */
  isAuthenticated() {
    const user = this.getCurrentUser();
    return !!user && !!user.accessToken;
  }
  
  /**
   * Set user data in local storage
   * @param {Object} userData User data with accessToken
   * @private
   */
  setUserData(userData) {
    localStorage.setItem(this.tokenKey, JSON.stringify(userData));
  }
  
  /**
   * Clear user data from local storage
   * @private
   */
  clearUserData() {
    localStorage.removeItem(this.tokenKey);
  }
  
  /**
   * Hash a password using SHA-256
   * Note: This is done for demonstration. In production, HTTPS should be used
   * rather than client-side hashing, or a more secure method should be employed.
   * @param {string} password The password to hash
   * @returns {string} The hashed password
   */
  hashPassword(password) {
    return crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');
  }
  
  /**
   * Initiate password reset process
   * @param {string} email User's email address
   * @returns {Promise} Promise with reset request result
   */
  async initiatePasswordReset(email) {
    try {
      const response = await httpService.post(`${this.authEndpoint}/reset-password`, { email });
      return response.data;
    } catch (error) {
      console.error('Password reset initiation error:', error);
      throw error;
    }
  }

  /**
   * Validate a password reset token
   * @param {string} token Reset token from email
   * @returns {Promise} Promise with token validation result
   */
  async validateResetToken(token) {
    try {
      const response = await httpService.post(`${this.authEndpoint}/validate-token`, { token });
      return response.data;
    } catch (error) {
      console.error('Token validation error:', error);
      throw error;
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
      // Hash the new password before sending
      const encPassword = this.hashPassword(newPassword);
      
      const response = await httpService.post(`${this.authEndpoint}/reset-password/confirm`, {
        token,
        newPassword: encPassword
      });
      
      return response.data;
    } catch (error) {
      console.error('Password reset error:', error);
      throw error;
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
      // Hash both passwords before sending
      const encCurrentPassword = this.hashPassword(currentPassword);
      const encNewPassword = this.hashPassword(newPassword);
      
      const response = await httpService.post(`${this.authEndpoint}/change-password`, {
        currentPassword: encCurrentPassword,
        newPassword: encNewPassword
      });
      
      return response.data;
    } catch (error) {
      console.error('Password change error:', error);
      throw error;
    }
  }
}

export default new AuthService();