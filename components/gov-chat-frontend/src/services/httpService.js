import axios from 'axios';
import keycloakAuthService from './keycloakAuthService';
import notificationService from './notificationService';

/**
 * Default error messages for fallback when backend message is missing
 *
 * WHY HARDCODED STRINGS INSTEAD OF I18N?
 * ============================================
 * httpService.js is a plain ES module (not a Vue component), which means:
 * - It has NO access to Vue's i18n system (this.$t() or translate())
 * - It cannot use Vue's composition API or inject/provide
 * - It must have synchronous access to messages at module load time
 * - i18n translation keys are defined in src/i18n/locales/*.js for:
 *   1. Documentation purposes (this serves as the source of truth for message semantics)
 *   2. Potential future use in Vue-based error pages
 *   3. Consistency across all 14 supported languages
 *
 * ARCHITECTURE NOTES:
 * - The i18n system (vue-i18n) is only available within Vue component context
 * - Plain ES modules like httpService.js use hardcoded constants for runtime messages
 * - This is a deliberate architectural decision, not an oversight
 * - When backend returns a message, we use it; when missing, we use these fallbacks
 */
const DEFAULT_MESSAGES = {
  tokenExpired: 'Your session has expired. Please log in again.',
  tokenInvalid: 'Your session is invalid. Please log in again.',
  insufficientRoles: 'You lack required permissions. Contact your administrator.',
  serviceUnavailable: 'Authentication service is temporarily unavailable. Please try again later.',
  provisioningFailed: 'A system error occurred. Please try again later.',
  default: 'An error occurred'
};

/**
 * Parse standardized backend error response format
 * Extracts error code and message, never includes details field
 * @param {Object} errorResponse - Backend error response { error, message, details }
 * @returns {Object} Parsed error { code, message }
 */
function parseAuthError(errorResponse) {
  if (!errorResponse || typeof errorResponse !== 'object') {
    return {
      code: 'UNKNOWN_ERROR',
      message: DEFAULT_MESSAGES.default
    };
  }

  const code = errorResponse.error || 'UNKNOWN_ERROR';
  let message = errorResponse.message;

  // Use fallback message if backend message is missing
  if (!message) {
    switch (code) {
      case 'TOKEN_EXPIRED':
        message = DEFAULT_MESSAGES.tokenExpired;
        break;
      case 'TOKEN_INVALID':
        message = DEFAULT_MESSAGES.tokenInvalid;
        break;
      case 'INSUFFICIENT_ROLES':
        message = DEFAULT_MESSAGES.insufficientRoles;
        break;
      case 'AUTH_SERVICE_UNAVAILABLE':
        message = DEFAULT_MESSAGES.serviceUnavailable;
        break;
      case 'PROVISIONING_FAILED':
        message = DEFAULT_MESSAGES.provisioningFailed;
        break;
      default:
        message = DEFAULT_MESSAGES.default;
    }
  }

  // NEVER include details field in parsed result
  return {
    code,
    message
  };
}

/**
 * Base service for handling HTTP requests
 * Provides standardized methods for API communication
 */
class HttpService {
  /**
   * Initialize the HTTP service
   */
  constructor() {
    // Cloud-native: Read from runtime config (generated at container startup)
    // Falls back to build-time env var for backward compatibility
    this.baseUrl = window.APP_CONFIG?.apiUrl || process.env.VUE_APP_API_URL || 'http://localhost:3000/api';

    this.axios = axios;

    // Configure axios
    this.axios.defaults.headers.common['Content-Type'] = 'application/json';

    // Add request interceptor
    this.axios.interceptors.request.use(this.handleRequest.bind(this), this.handleRequestError.bind(this));

    // Add response interceptor
    this.axios.interceptors.response.use(this.handleResponse.bind(this), this.handleResponseError.bind(this));
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
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    let base = this.baseUrl;
    if (!base.endsWith('/') && cleanEndpoint) {
      base += '/';
    }
    return `${base}${cleanEndpoint}`;
  }

  /**
   * Parse standardized backend error response format
   * Exposed as instance method for testing
   * @param {Object} errorResponse - Backend error response { error, message, details }
   * @returns {Object} Parsed error { code, message }
   */
  parseAuthError(errorResponse) {
    return parseAuthError(errorResponse);
  }

  /**
   * Handle request interceptor
   * @param {Object} config - Request configuration
   * @returns {Object} Modified request configuration
   */
  handleRequest(config) {
    const token = keycloakAuthService.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
    return Promise.reject(error);
  }

  /**
   * Handle response interceptor
   * @param {Object} response - Response object
   * @returns {Object} Response object
   */
  handleResponse(response) {
    return response;
  }

  /**
   * Handle response error interceptor with token refresh and Keycloak redirect
   * @param {Error} error - Response error
   * @returns {Promise} Rejected promise with error or retried request
   */
  async handleResponseError(error) {
    if (error.response) {
      const status = error.response.status;
      const { statusText } = error.response;
      const originalRequest = error.config;

      // Handle 401 — attempt silent token refresh then retry once
      if (status === 401 && !originalRequest._retryCount) {
        originalRequest._retryCount = 1;

        // A SERVER-SIDE failure on the retry (502/504/timeout/network) is NOT a
        // dead session (David's 2026-10-11 logout: one transient failure threw
        // the user to the login page and discarded a good session). Only a 401
        // on the retried request may escalate to a redirect — and even then the
        // stored user is checked first, so a live session is never discarded.
        try {
          const refreshedUser = await keycloakAuthService.signinSilent();

          if (refreshedUser?.access_token) {
            originalRequest.headers.Authorization = `Bearer ${refreshedUser.access_token}`;
            try {
              return await this.axios(originalRequest);
            } catch (retryError) {
              const retryStatus = retryError.response ? retryError.response.status : null;
              if (retryStatus !== 401) {
                // Server-side problem: surface it verbatim. Redirecting here is
                // how a gateway blip used to look like an expired session.
                return Promise.reject(retryError);
              }
            }
          }
        } catch (refreshError) {
          console.error('[HttpService] Token refresh failed:', refreshError.message);
        }

        // The refresh yielded no usable token, or the retry came back 401 —
        // the only two cases where the session may genuinely be gone. Check
        // the STORED user before discarding it. The WHOLE escalation is
        // guarded (round 16, #80131): a storage/session failure inside
        // getUser()/login() must not replace the intended 401 rejection
        // with an unrelated error shape — the caller always gets the
        // {status, statusText, data, message} envelope below.
        try {
          const user = await keycloakAuthService.getUser();
          if (!user || user.expired) {
            if (typeof window !== 'undefined') {
              await keycloakAuthService.login();
            }
          }
        } catch (escalationError) {
          console.error('[HttpService] Session escalation failed:', escalationError.message);
        }

        return Promise.reject({
          status,
          statusText,
          data: error.response.data,
          message: error.response.data?.message || 'Unauthorized access'
        });
      }

      // Non-auth errors or already retried
      const errorData = {
        status,
        statusText,
        data: error.response.data,
        message: error.response.data?.message || 'An error occurred'
      };

      // Parse error for structured handling
      const parsedError = parseAuthError(error.response.data);

      // Emit user-facing error notification for all non-401 errors
      // (401 errors redirect to Keycloak login — the redirect IS the user feedback).
      // Callers may opt out with { silent: true } for probe-style lookups where a
      // non-success response is an expected, handled outcome (e.g. crawl-job 404,
      // the OKF bundle manifest before the worker has settled it). Silent skips
      // BOTH the toast and the console.error — the caller owns the outcome.
      if (!error.config?.silent) {
        notificationService.error(parsedError.message);

        // Log only safe information (status, statusText, message) — NOT raw data or details
        console.error('API response error:', {
          status,
          statusText,
          message: parsedError.message
        });
      }

      return Promise.reject(errorData);
    } else if (error.request) {
      console.error('Network error - no response received:', error.request);
      return Promise.reject({
        status: 0,
        message: 'Network error. Please check your connection.'
      });
    } else {
      console.error('Request setup error:', error.message);
      return Promise.reject({
        message: 'Error preparing the request: ' + error.message
      });
    }
  }

  /**
   * Make a GET request
   *
   * The SECOND argument is the QUERY: this method reads `params` from it
   * and sends the whole bag as query parameters. The THIRD argument is
   * the axios options — a `timeout` among them. A timeout placed in the
   * second argument is dropped on the floor and axios waits forever, with
   * no error to show for it.
   *
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
   * @param {boolean} appendBaseUrl - Whether to append base URL
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
    const timestamp = Date.now();
    const noCacheUrl = `${this.getUrl(url)}?_nocache=${timestamp}`;
    const noCacheData = {
      ...data,
      _timestamp: timestamp
    };
    return this.axios.put(noCacheUrl, noCacheData, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '-1',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Timestamp': timestamp
      }
    });
  }
}

export default new HttpService();
