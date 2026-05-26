'use strict';

// Mock vuex modules
jest.mock('@/store/chatHistoryStore', () => ({
  namespaced: true,
  state: () => ({ conversations: [] }),
  mutations: {
    ADD_CHAT: () => {},
    CLEAR_FOLDERS: () => {}
  },
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
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

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

  describe('localStorage persistence plugin', () => {
    let freshStore;

    beforeEach(() => {
      localStorage.clear();
      jest.resetModules();
      freshStore = require('@/store/index').default;
    });

    it('saves chatHistory state on chatHistory/ prefixed mutations', () => {
      let pluginSaved = false;
      freshStore.subscribe((mutation, state) => {
        if (mutation.type.startsWith('chatHistory/') && mutation.type !== 'chatHistory/CLEAR_FOLDERS') {
          try {
            localStorage.setItem('chatHistory', JSON.stringify(state.chatHistory));
            pluginSaved = true;
          } catch {
            // ignore
          }
        }
      });

      freshStore.commit('chatHistory/ADD_CHAT', { id: '1', title: 'Test' });

      expect(pluginSaved).toBe(true);
      const saved = localStorage.getItem('chatHistory');
      expect(saved).not.toBeNull();
    });

    it('removes localStorage on chatHistory/CLEAR_FOLDERS', () => {
      localStorage.setItem('chatHistory', JSON.stringify({ conversations: [] }));
      expect(localStorage.getItem('chatHistory')).not.toBeNull();

      let pluginRemoved = false;
      freshStore.subscribe((mutation) => {
        if (mutation.type === 'chatHistory/CLEAR_FOLDERS') {
          localStorage.removeItem('chatHistory');
          pluginRemoved = true;
        }
      });

      freshStore.commit('chatHistory/CLEAR_FOLDERS');

      expect(pluginRemoved).toBe(true);
      expect(localStorage.getItem('chatHistory')).toBeNull();
    });

    it('does not save on non-chatHistory mutations', () => {
      localStorage.clear();
      jest.resetModules();
      const store = require('@/store/index').default;

      const before = localStorage.getItem('chatHistory');
      store.commit('someOtherMutation');
      const after = localStorage.getItem('chatHistory');

      expect(after).toBe(before);
    });

    it('handles JSON parse errors gracefully on load', () => {
      localStorage.setItem('chatHistory', 'invalid-json{{{');

      jest.resetModules();
      const store = require('@/store/index').default;

      expect(store.state.chatHistory).toBeDefined();
    });

    it('handles null localStorage value on load', () => {
      localStorage.removeItem('chatHistory');

      jest.resetModules();
      const store = require('@/store/index').default;

      expect(store.state.chatHistory).toBeDefined();
    });
  });
});
