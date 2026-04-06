/**
 * Vuex Auth Module — Keycloak OIDC integration
 *
 * Replaces the existing auth module entirely (no coexistence).
 * Consumes keycloakAuthService for all OIDC operations.
 * Tokens are stored in-memory only via the service layer.
 */

import keycloakAuthService from '@/services/keycloakAuthService';

function mapOidcUserToState(oidcUser) {
  if (!oidcUser || !oidcUser.profile) {
    return null;
  }

  const profile = oidcUser.profile;
  return {
    iss_sub: `${profile.iss}#${profile.sub}`,
    sub: profile.sub,
    iss: profile.iss,
    email: profile.email || null,
    name: profile.name || profile.preferred_username || null,
    preferred_username: profile.preferred_username || null,
    roles: profile.realm_access?.roles || []
  };
}

let silentRenewCallback = null;

function registerSilentRenewCallback(commit) {
  // Clean up any existing callback from a previous session
  if (silentRenewCallback) {
    keycloakAuthService.removeAccessTokenUpdatedCallback(silentRenewCallback);
  }

  silentRenewCallback = (refreshedUser) => {
    const updatedUser = mapOidcUserToState(refreshedUser);
    if (updatedUser) {
      commit('updateAccessToken', {
        accessToken: refreshedUser.access_token,
        user: updatedUser
      });
    }
  };
  keycloakAuthService.onAccessTokenUpdated(silentRenewCallback);
}

const state = {
  isAuthenticated: false,
  user: null,
  accessToken: null,
  error: null,
  isInitialized: false
};

const getters = {
  isAuthenticated: (state) => state.isAuthenticated,
  currentUser: (state) => state.user,
  accessToken: (state) => state.accessToken,
  authError: (state) => {
    // Backward compatibility: return message string if error is object
    if (state.error && typeof state.error === 'object') {
      return state.error.message;
    }
    return state.error;
  },
  lastAuthErrorCode: (state) => {
    // Return error code if error is object, null otherwise
    if (state.error && typeof state.error === 'object') {
      return state.error.code;
    }
    return null;
  },
  isAuthInitialized: (state) => state.isInitialized
};

const actions = {
  /**
   * Initialize OIDC service and restore session if available.
   * Registers callback for silent token renew updates.
   */
  async initialize({ commit }) {
    try {
      const user = await keycloakAuthService.initialize();

      if (user && !user.expired) {
        const stateUser = mapOidcUserToState(user);
        if (stateUser) {
          commit('setAuth', {
            isAuthenticated: true,
            user: stateUser,
            accessToken: user.access_token
          });

          // Register callback for silent token renew
          registerSilentRenewCallback(commit);
        } else {
          commit('clearAuth');
        }
      } else {
        commit('clearAuth');
      }
    } catch (error) {
      console.error('[Auth Store] Initialization error:', error.message);
      commit('setError', { code: 'INIT_ERROR', message: 'Authentication initialization failed' });
    } finally {
      commit('setInitialized');
    }
  },

  /**
   * Redirect to Keycloak login
   * @param {Object} [options] - Optional login options
   * @param {string} [options.returnUrl] - URL to return to after login
   */
  async login({ commit }, options = {}) {
    try {
      commit('clearError');
      await keycloakAuthService.login(options);
    } catch (error) {
      console.error('[Auth Store] Login error:', error.message);
      commit('setError', { code: 'LOGIN_ERROR', message: 'Login redirect failed' });
      throw error;
    }
  },

  /**
   * Process OIDC callback and set authenticated state
   */
  async handleCallback({ commit }) {
    try {
      commit('clearError');
      const user = await keycloakAuthService.handleCallback();

      if (user) {
        const stateUser = mapOidcUserToState(user);
        if (stateUser) {
          commit('setAuth', {
            isAuthenticated: true,
            user: stateUser,
            accessToken: user.access_token
          });

          registerSilentRenewCallback(commit);
        }
      }

      return user;
    } catch (error) {
      console.error('[Auth Store] Callback error:', error.message);
      commit('setError', { code: 'CALLBACK_ERROR', message: 'Authentication callback failed' });
      throw error;
    }
  },

  /**
   * Logout and clear auth state
   */
  async logout({ commit }) {
    try {
      commit('clearError');
      await keycloakAuthService.logout();
      commit('clearAuth');
    } catch (error) {
      console.error('[Auth Store] Logout error:', error.message);
      // Always clear local state even if Keycloak redirect fails
      commit('clearAuth');
    } finally {
      // Clean up legacy localStorage items not managed by OIDC
      localStorage.removeItem('user');
      localStorage.removeItem('auth_token');
      // Always clean up silent renew callback
      if (silentRenewCallback) {
        keycloakAuthService.removeAccessTokenUpdatedCallback(silentRenewCallback);
        silentRenewCallback = null;
      }
    }
  },

  /**
   * Clear the current auth error
   */
  clearError({ commit }) {
    commit('clearError');
  },

  /**
   * Handle API error responses with structured error parsing
   *
   * This action provides a standardized way for Vue components to handle API errors
   * from backend responses. Use this in components that need to react to specific
   * error codes or display user-friendly error messages.
   *
   * USAGE EXAMPLE IN VUE COMPONENT:
   * ```javascript
   * import { mapActions } from 'vuex';
   *
   * export default {
   *   methods: {
   *     ...mapActions(['handleApiError']),
   *
   *     async someApiCall() {
   *       try {
   *         const response = await api.someMethod();
   *         return response;
   *       } catch (error) {
   *         const parsedError = this.handleApiError(error.response.data);
   *
   *         // React based on error code
   *         if (parsedError.code === 'TOKEN_EXPIRED') {
   *           // Redirect to login or show specific UI
   *           this.$router.push('/login');
   *         } else if (parsedError.code === 'INSUFFICIENT_ROLES') {
   *           // Show permission denied UI
   *           this.showPermissionDeniedMessage();
   *         }
   *
   *         // Error is also stored in Vuex state (authError, lastAuthErrorCode getters)
   *         // for template access: {{ $store.getters.authError }}
   *       }
   *     }
   *   }
   * }
   * ```
   *
   * @param {Object} context - Vuex context
   * @param {Object} errorResponse - Backend error response { error, message, details }
   * @returns {Object} Parsed error { code, message }
   */
  handleApiError({ commit }, errorResponse) {
    let code = 'UNKNOWN_ERROR';
    let message = 'An error occurred';

    if (errorResponse && typeof errorResponse === 'object') {
      code = errorResponse.error || 'UNKNOWN_ERROR';
      message = errorResponse.message || 'An error occurred';
    }

    commit('setError', { code, message });

    return { code, message };
  }
};

const mutations = {
  setAuth(state, { isAuthenticated, user, accessToken }) {
    state.isAuthenticated = isAuthenticated;
    state.user = user;
    state.accessToken = accessToken;
    state.error = null;
  },

  clearAuth(state) {
    state.isAuthenticated = false;
    state.user = null;
    state.accessToken = null;
    state.error = null;
  },

  setError(state, error) {
    // Handle both string and { code, message } object formats
    if (typeof error === 'string') {
      state.error = error;
    } else if (error && typeof error === 'object') {
      state.error = {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message || 'An error occurred'
      };
    } else {
      state.error = null;
    }
  },

  clearError(state) {
    state.error = null;
  },

  setInitialized(state) {
    state.isInitialized = true;
  },

  updateAccessToken(state, { accessToken, user }) {
    state.accessToken = accessToken;
    if (user) {
      state.user = user;
    }
  }
};

export default {
  state,
  getters,
  actions,
  mutations
};
