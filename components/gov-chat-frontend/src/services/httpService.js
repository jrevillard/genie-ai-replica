// src/services/httpService.js
import axios from 'axios';

/**
 * Base service for handling HTTP requests
 * Provides standardized methods for API communication
 */
class HttpService {
  /**
   * Initialize the HTTP service
   */
  constructor() {
    this.baseUrl = process.env.VUE_APP_API_URL || 'http://localhost:3000/api';
    this.axios = axios;
    
    // Configure axios
    this.axios.defaults.headers.common['Content-Type'] = 'application/json';
    
    // Token refresh state
    this.isRefreshing = false;
    this.refreshSubscribers = [];
    
    // Add request interceptor
    this.axios.interceptors.request.use(
      this.handleRequest.bind(this),
      this.handleRequestError.bind(this)
    );
    
    // Add response interceptor
    this.axios.interceptors.response.use(
      this.handleResponse.bind(this),
      this.handleResponseError.bind(this)
    );
  }
  
  /**
   * Set the base URL for API requests
   * @param {string} url - Base URL for API endpoints
   */
  setBaseUrl(url) {
    this.baseUrl = url;
  }
  
  /**
   * Get the full URL by combining base URL with endpoint
   * @param {string} endpoint - API endpoint
   * @returns {string} Full URL
   */
  getUrl(endpoint) {
    // Remove leading slash from endpoint if present
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    
    // Ensure base URL ends with slash if endpoint is provided
    let base = this.baseUrl;
    if (!base.endsWith('/') && cleanEndpoint) {
      base += '/';
    }
    
    return `${base}${cleanEndpoint}`;
  }
  
  /**
   * Handle request interceptor
   * @param {Object} config - Request configuration
   * @returns {Object} Modified request configuration
   */
  handleRequest(config) {
    // Get auth token from localStorage
    const user = localStorage.getItem('user');
    if (user) {
      try {
        const userData = JSON.parse(user);
        if (userData.accessToken) {
          config.headers.Authorization = `Bearer ${userData.accessToken}`;
        }
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
    
    return config;
  }
  
  /**
   * Handle request error interceptor
   * @param {Error} error - Request error
   * @returns {Promise} Rejected promise with error
   */
  handleRequestError(error) {
    console.error('Request error:', error);
    
    // Handle expired tokens more gracefully
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('user');
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = '/login';
      }
    }
    
    return Promise.reject(error);
  }
  
  /**
   * Handle response interceptor
   * @param {Object} response - Response object
   * @returns {Object} Response object or modified response
   */
  handleResponse(response) {
    return response;
  }
  
  /**
   * Subscribe to token refresh
   * @param {Function} callback - Function to call after token refresh
   */
  subscribeTokenRefresh(callback) {
    this.refreshSubscribers.push(callback);
  }
  
  /**
   * Notify subscribers about token refresh completion
   * @param {string} token - New access token
   */
  onTokenRefreshed(token) {
    this.refreshSubscribers.forEach(callback => callback(token));
    this.refreshSubscribers = [];
  }
  
  /**
   * Refresh authentication token
   * @returns {Promise} Promise with refresh result
   */
  async refreshToken() {
    try {
      // Call your refresh token endpoint
      const response = await this.axios.post(`${this.baseUrl}/auth/refresh-token`);
      return response;
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw error;
    }
  }
  
  /**
   * Handle response error interceptor with token refresh
   * @param {Error} error - Response error
   * @returns {Promise} Rejected promise with error
   */
  handleResponseError(error) {
    // Handle different error scenarios
    if (error.response) {
      // Server responded with an error status
      const status = error.response.status;
      
      // Handle authentication errors with token refresh
      if (status === 401 && !error.config._retry) {
        if (this.isRefreshing) {
          // Wait for token refresh
          return new Promise((resolve) => {
            this.subscribeTokenRefresh(token => {
              error.config.headers.Authorization = `Bearer ${token}`;
              resolve(this.axios(error.config));
            });
          });
        }
        
        error.config._retry = true;
        this.isRefreshing = true;
        
        // Try to refresh the token
        return this.refreshToken()
          .then(response => {
            const newToken = response.data.accessToken;
            
            // Get current user data
            const userStr = localStorage.getItem('user');
            if (userStr) {
              try {
                const userData = JSON.parse(userStr);
                
                // Update with new token
                userData.accessToken = newToken;
                localStorage.setItem('user', JSON.stringify(userData));
                
                // Update axios headers
                this.axios.defaults.headers.common.Authorization = `Bearer ${newToken}`;
                error.config.headers.Authorization = `Bearer ${newToken}`;
                
                // Notify subscribers
                this.onTokenRefreshed(newToken);
                this.isRefreshing = false;
                
                // Retry the original request
                return this.axios(error.config);
              } catch (e) {
                console.error('Error parsing user data during token refresh:', e);
              }
            }
            
            // If we couldn't refresh, redirect to login
            this.isRefreshing = false;
            localStorage.removeItem('user');
            if (typeof window !== 'undefined' && window.location) {
              window.location.href = '/login';
            }
            
            return Promise.reject(error);
          })
          .catch(refreshError => {
            this.isRefreshing = false;
            localStorage.removeItem('user');
            
            // Redirect to login
            if (typeof window !== 'undefined' && window.location) {
              window.location.href = '/login';
            }
            
            return Promise.reject(refreshError);
          });
      }
      
      // For other 401 errors (not eligible for refresh), clear tokens and redirect
      if (status === 401) {
        localStorage.removeItem('user');
        
        // If window object is available (browser environment)
        if (typeof window !== 'undefined' && window.location) {
          // Check if we're not already on the login page to avoid redirect loops
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
        }
      }
      
      // Create a standardized error object
      const errorData = {
        status,
        statusText: error.response.statusText,
        data: error.response.data,
        message: error.response.data?.message || 'An error occurred'
      };
      
      console.error('API response error:', errorData);
      return Promise.reject(errorData);
    } else if (error.request) {
      // Request was made but no response received (network error)
      console.error('Network error - no response received:', error.request);
      return Promise.reject({
        status: 0,
        message: 'Network error. Please check your connection.'
      });
    } else {
      // Error in setting up the request
      console.error('Request setup error:', error.message);
      return Promise.reject({
        message: 'Error preparing the request: ' + error.message
      });
    }
  }
  
  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @param {Object} options - Additional axios options
   * @returns {Promise} Response promise
   */
  async get(endpoint, params = {}, options = {}) {
    try {
      const url = this.getUrl(endpoint);
      const config = {
        ...options,
        params: params.params || params
      };
      
      return await this.axios.get(url, config);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @param {Object} options - Additional axios options
   * @returns {Promise} Response promise
   */
  async post(endpoint, data = {}, options = {}, appendBaseUrl = true) {
    try {
      const url = appendBaseUrl ? this.getUrl(endpoint) : endpoint;
      return await this.axios.post(url, data, options);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  /**
   * Make a PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @param {Object} options - Additional axios options
   * @returns {Promise} Response promise
   */
  async put(endpoint, data = {}, options = {}) {
    try {
      const url = this.getUrl(endpoint);
      return await this.axios.put(url, data, options);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  /**
   * Make a DELETE request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Additional axios options
   * @returns {Promise} Response promise
   */
  async delete(endpoint, options = {}) {
    try {
      const url = this.getUrl(endpoint);
      return await this.axios.delete(url, options);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  /**
   * Make a PATCH request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @param {Object} options - Additional axios options
   * @returns {Promise} Response promise
   */
  async patch(endpoint, data = {}, options = {}) {
    try {
      const url = this.getUrl(endpoint);
      return await this.axios.patch(url, data, options);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Special PUT method that completely bypasses caching
   * @param {string} url - API endpoint
   * @param {Object} data - Data to send
   * @returns {Promise} Promise with server response
   */
  async putNoCache(url, data) {
    // Add a timestamp to both URL and data to ensure uniqueness
    const timestamp = Date.now();
    const noCacheUrl = `${this.getUrl(url)}?_nocache=${timestamp}`;

    // Add timestamp to data as well
    const noCacheData = {
      ...data,
      _timestamp: timestamp
    };

    // Make the request with cache-busting headers
    return this.axios.put(noCacheUrl, noCacheData, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '-1',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Timestamp': timestamp
      }
    });
  }
}

export default new HttpService();