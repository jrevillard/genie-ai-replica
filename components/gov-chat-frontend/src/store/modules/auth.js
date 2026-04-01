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
  authError: (state) => state.error,
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
      commit('setError', 'Authentication initialization failed');
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
      commit('setError', 'Login redirect failed');
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
      commit('setError', 'Authentication callback failed');
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

  setError(state, message) {
    state.error = message;
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
