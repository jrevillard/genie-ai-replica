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
   * @param {string} username The username
   * @param {string} password The password
   * @returns {Promise} Promise with user data or error
   */
  async login(username, password) {
    try {
      // In a real app, you would hash the password client-side 
      // before sending it over the network
      const hashedPassword = this.hashPassword(password);
      
      const response = await httpService.post(`${this.authEndpoint}/login`, {
        loginName: username,
        encPassword: hashedPassword
      });
      
      if (response.data.accessToken) {
        localStorage.setItem(this.tokenKey, JSON.stringify(response.data));
      }
      
      return response.data;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }
  
  /**
   * Register a new user
   * @param {string} username The username
   * @param {string} email The email
   * @param {string} password The password
   * @returns {Promise} Promise with registration result or error
   */
  async register(username, email, password) {
    try {
      // Hash password before sending to server
      const hashedPassword = this.hashPassword(password);
      
      const response = await httpService.post(`${this.authEndpoint}/register`, {
        loginName: username,
        email: email,
        encPassword: hashedPassword
      });
      
      // If registration includes auto login, store token
      if (response.data.accessToken) {
        localStorage.setItem(this.tokenKey, JSON.stringify(response.data));
      }
      
      return response.data;
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }
  
  /**
   * Log out the user
   */
  logout() {
    localStorage.removeItem(this.tokenKey);
    // Optional: Call backend to invalidate token server-side
    try {
      return httpService.post(`${this.authEndpoint}/logout`);
    } catch (error) {
      console.error('Logout error:', error);
      // Continue with client-side logout even if server request fails
    }
  }
  
  /**
   * Get the currently authenticated user
   * @returns {Object|null} The user data or null if not authenticated
   */
  getCurrentUser() {
    const userStr = localStorage.getItem(this.tokenKey);
    if (!userStr) return null;
    
    try {
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
   * Hash a password using SHA-256
   * Note: In a production app, you'd use a more secure method with proper salting
   * This is just for demonstration purposes
   * @param {string} password The password to hash
   * @returns {string} The hashed password
   */
  hashPassword(password) {
    // In a real app, you would use a proper password hashing library
    // This is a simple hash for demonstration
    return crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');
  }
  
  /**
   * Handle social login (Google, Facebook)
   * @param {string} provider The provider (google, facebook)
   * @returns {Promise} Promise with login result
   */
  async socialLogin(provider) {
    try {
      const response = await httpService.get(`${this.authEndpoint}/${provider}`);
      
      if (response.data.accessToken) {
        localStorage.setItem(this.tokenKey, JSON.stringify(response.data));
      }
      
      return response.data;
    } catch (error) {
      console.error(`${provider} login error:`, error);
      throw error;
    }
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
   * @param {string} newPassword New password
   * @returns {Promise} Promise with password reset result
   */
  async resetPassword(token, newPassword) {
    try {
      // Hash the new password before sending
      const hashedPassword = this.hashPassword(newPassword);
      
      const response = await httpService.post(`${this.authEndpoint}/reset-password/confirm`, {
        token,
        newPassword: hashedPassword
      });
      
      return response.data;
    } catch (error) {
      console.error('Password reset error:', error);
      throw error;
    }
  }

  /**
   * Change password for authenticated user
   * @param {string} currentPassword Current password
   * @param {string} newPassword New password
   * @returns {Promise} Promise with password change result
   */
  async changePassword(currentPassword, newPassword) {
    try {
      // Hash both passwords before sending
      const hashedCurrentPassword = this.hashPassword(currentPassword);
      const hashedNewPassword = this.hashPassword(newPassword);
      
      const response = await httpService.post(`${this.authEndpoint}/change-password`, {
        currentPassword: hashedCurrentPassword,
        newPassword: hashedNewPassword
      });
      
      return response.data;
    } catch (error) {
      console.error('Password change error:', error);
      throw error;
    }
  }
  
  /**
   * Refresh the authentication token
   * @returns {Promise} Promise with new token
   */
  async refreshToken() {
    try {
      const user = this.getCurrentUser();
      if (!user || !user.refreshToken) {
        throw new Error('No refresh token available');
      }
      
      const response = await httpService.post(`${this.authEndpoint}/refresh-token`, {
        refreshToken: user.refreshToken
      });
      
      if (response.data.accessToken) {
        // Update stored user data with new tokens
        const updatedUser = {
          ...user,
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken || user.refreshToken
        };
        
        localStorage.setItem(this.tokenKey, JSON.stringify(updatedUser));
      }
      
      return response.data;
    } catch (error) {
      console.error('Token refresh error:', error);
      // If token refresh fails, log out the user
      this.logout();
      throw error;
    }
  }
}

export default new AuthService();