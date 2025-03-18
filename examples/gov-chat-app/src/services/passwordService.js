// src/services/passwordService.js
import httpService from './httpService';
import crypto from 'crypto';

/**
 * Service for handling password-related operations
 * This includes reset, validation, and update flows
 */
class PasswordService {
  /**
   * Initialize the password service
   */
  constructor() {
    this.baseEndpoint = 'auth/password';
    this.tokenExpiryMinutes = 5; // Token expires in 5 minutes
  }

  /**
   * Initiate password reset process
   * @param {string} email - User's email address
   * @returns {Promise} Password reset initiation result
   */
  async initiateReset(email) {
    try {
      const response = await httpService.post(`${this.baseEndpoint}/reset-request`, { email });
      return response.data;
    } catch (error) {
      console.error('Error initiating password reset:', error);
      throw error;
    }
  }

  /**
   * Validate a password reset token
   * @param {string} token - Reset token from email
   * @returns {Promise} Token validation result
   */
  async validateResetToken(token) {
    try {
      const response = await httpService.post(`${this.baseEndpoint}/validate-token`, { token });
      return response.data;
    } catch (error) {
      console.error('Error validating reset token:', error);
      // Return standardized response for invalid/expired tokens
      return {
        valid: false,
        expired: error.status === 410, // HTTP 410 Gone indicates expired token
        message: error.message || 'Invalid or expired token'
      };
    }
  }

  /**
   * Complete password reset with new password
   * @param {string} token - Reset token from email
   * @param {string} newPassword - New password
   * @param {string} confirmPassword - Confirmation of new password
   * @returns {Promise} Password reset result
   */
  async completeReset(token, newPassword, confirmPassword) {
    try {
      // Validate passwords match
      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      // Hash the password before sending (for client-side hashing approach)
      const hashedPassword = this.hashPassword(newPassword);
      
      const response = await httpService.post(`${this.baseEndpoint}/reset-complete`, {
        token,
        newPassword: hashedPassword
      });
      
      return response.data;
    } catch (error) {
      console.error('Error completing password reset:', error);
      throw error;
    }
  }

  /**
   * Check password strength
   * @param {string} password - Password to check
   * @returns {Object} Password strength details
   */
  checkPasswordStrength(password) {
    if (!password) {
      return { score: 0, feedback: 'Password is required' };
    }

    let score = 0;
    let feedback = [];

    // Length check
    if (password.length < 8) {
      feedback.push('Password should be at least 8 characters long');
    } else {
      score += 1;
    }

    // Contains lowercase letters
    if (/[a-z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('Add lowercase letters');
    }

    // Contains uppercase letters
    if (/[A-Z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('Add uppercase letters');
    }

    // Contains numbers
    if (/\d/.test(password)) {
      score += 1;
    } else {
      feedback.push('Add numbers');
    }

    // Contains special characters
    if (/[^A-Za-z0-9]/.test(password)) {
      score += 1;
    } else {
      feedback.push('Add special characters');
    }

    // Convert score to a scale of 0-100
    const normalizedScore = (score / 5) * 100;

    // Return result
    return {
      score: normalizedScore,
      strength: this.getStrengthLabel(normalizedScore),
      feedback: feedback.join('. ')
    };
  }

  /**
   * Get password strength label based on score
   * @param {number} score - Password strength score (0-100)
   * @returns {string} Strength label
   */
  getStrengthLabel(score) {
    if (score < 20) return 'Very Weak';
    if (score < 40) return 'Weak';
    if (score < 60) return 'Medium';
    if (score < 80) return 'Strong';
    return 'Very Strong';
  }

  /**
   * Hash a password (client-side approach)
   * @param {string} password - Password to hash
   * @returns {string} Hashed password
   */
  hashPassword(password) {
    // In a real app, consider using a more secure method or handling on server
    return crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');
  }

  /**
   * Determine if a token is expired
   * @param {string} tokenTimestamp - ISO timestamp of token creation
   * @returns {boolean} True if token is expired
   */
  isTokenExpired(tokenTimestamp) {
    const tokenDate = new Date(tokenTimestamp);
    const now = new Date();
    const diffMinutes = (now - tokenDate) / (1000 * 60);
    
    return diffMinutes > this.tokenExpiryMinutes;
  }
}

export default new PasswordService();