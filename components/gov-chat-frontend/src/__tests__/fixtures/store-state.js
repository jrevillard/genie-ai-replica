'use strict';

/**
 * Vuex store state factories for frontend tests.
 *
 * State shapes match the real Vuex store initial state exactly.
 * - auth module: NOT namespaced (state fields at root level)
 * - chatHistory module: namespaced (state fields under chatHistory key)
 */

const defaultAuthenticatedUser = {
  iss_sub: 'http://localhost:8080/realms/genie#user-123',
  sub: 'user-123',
  iss: 'http://localhost:8080/realms/genie',
  email: 'test@example.com',
  name: 'Test User',
  preferred_username: 'testuser',
  roles: ['user']
};

/**
 * Create authenticated Vuex state (auth + chatHistory modules).
 * Use this for tests that need a logged-in user.
 *
 * @param {object} overrides - Override any top-level state field
 * @returns {object} Full Vuex state object
 */
function createAuthenticatedState(overrides = {}) {
  return {
    // auth module (NOT namespaced — root level)
    isAuthenticated: true,
    user: { ...defaultAuthenticatedUser },
    accessToken: 'mock-access-token',
    error: null,
    isInitialized: true,

    // chatHistory module (namespaced)
    chatHistory: {
      folders: [
        {
          id: 'default',
          name: 'All Chats',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      chats: [],
      folderChats: {
        default: []
      }
    },

    ...overrides
  };
}

/**
 * Create unauthenticated Vuex state.
 * Use this for tests that need a logged-out user.
 *
 * @returns {object} Full Vuex state object
 */
function createUnauthenticatedState() {
  return {
    // auth module (NOT namespaced — root level)
    isAuthenticated: false,
    user: null,
    accessToken: null,
    error: null,
    isInitialized: true,

    // chatHistory module (namespaced)
    chatHistory: {
      folders: [
        {
          id: 'default',
          name: 'All Chats',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      chats: [],
      folderChats: {
        default: []
      }
    }
  };
}

module.exports = {
  createAuthenticatedState,
  createUnauthenticatedState,
  defaultAuthenticatedUser
};
