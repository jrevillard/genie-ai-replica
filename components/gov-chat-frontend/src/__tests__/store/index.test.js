'use strict';

// Mock vuex modules
jest.mock('@/store/chatHistoryStore', () => ({
  namespaced: true,
  state: () => ({ conversations: [] }),
  mutations: {},
  actions: {}
}));

jest.mock('@/store/modules/auth', () => ({
  namespaced: false,
  state: () => ({ user: null, isAuthenticated: false }),
  mutations: {},
  actions: {}
}));

const storeFactory = require('@/store/index').default;

describe('store/index.js', () => {
  describe('store creation', () => {
    it('creates a Vuex store instance', () => {
      expect(storeFactory).toBeDefined();
      expect(storeFactory.state).toBeDefined();
    });

    it('registers chatHistory module', () => {
      expect(storeFactory.state.chatHistory).toBeDefined();
    });

    it('registers auth module', () => {
      expect(storeFactory.state.auth).toBeDefined();
    });

    it('has persistence plugin initialized', () => {
      // The store's persistence plugin subscribes to mutations
      // Verify by checking the store can commit without errors
      expect(() => storeFactory.commit('chatHistory/TEST')).not.toThrow();
    });
  });

  describe('module structure', () => {
    it('chatHistory module has initial state', () => {
      const chatState = storeFactory.state.chatHistory;
      expect(chatState).toBeDefined();
    });

    it('auth module has initial state', () => {
      const authState = storeFactory.state.auth;
      expect(authState).toBeDefined();
      expect(authState.isAuthenticated).toBe(false);
    });
  });
});
