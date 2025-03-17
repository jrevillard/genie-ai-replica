// src/services/authService.js

import axios from 'axios';
import crypto from 'crypto';

// Base API URL - update with your actual API endpoint
const API_URL = process.env.VUE_APP_API_URL || 'http://localhost:3000/api';

/**
 * Service to handle authentication with the backend
 */
class AuthService {
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
      
      const response = await axios.post(`${API_URL}/auth/login`, {
        loginName: username,
        encPassword: hashedPassword
      });
      
      if (response.data.accessToken) {
        localStorage.setItem('user', JSON.stringify(response.data));
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
      
      const response = await axios.post(`${API_URL}/auth/register`, {
        loginName: username,
        email: email,
        encPassword: hashedPassword
      });
      
      // If registration includes auto login, store token
      if (response.data.accessToken) {
        localStorage.setItem('user', JSON.stringify(response.data));
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
    localStorage.removeItem('user');
  }
  
  /**
   * Get the currently authenticated user
   * @returns {Object|null} The user data or null if not authenticated
   */
  getCurrentUser() {
    const userStr = localStorage.getItem('user');
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
      // In a real app, this would redirect to OAuth flow
      // For demo purposes, we're just simulating the process
      const response = await axios.get(`${API_URL}/auth/${provider}`);
      
      if (response.data.accessToken) {
        localStorage.setItem('user', JSON.stringify(response.data));
      }
      
      return response.data;
    } catch (error) {
      console.error(`${provider} login error:`, error);
      throw error;
    }
  }
}

export default new AuthService();