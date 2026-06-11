'use strict';

// Mock uuid to return deterministic IDs
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1')
}));

// Mock chatHistoryService (required by chatHistoryStore import)
jest.mock('@/services/chatHistoryService', () => ({
  __esModule: true,
  default: {
    moveConversation: jest.fn(),
    getFolder: jest.fn()
  }
}));

const { createStore } = require('vuex');
const chatHistoryStore = require('@/store/chatHistoryStore').default;

// Replicate the persistence plugin from store/index.js
function createPersistencePlugin() {
  return (store) => {
    try {
      const savedChatHistory = localStorage.getItem('chatHistory');
      if (savedChatHistory) {
        const parsedData = JSON.parse(savedChatHistory);
        if (parsedData && typeof parsedData === 'object') {
          store.replaceState({
            ...store.state,
            chatHistory: parsedData
          });
        }
      }
    } catch (e) {
      console.error('Error loading chat history from localStorage:', e);
    }

    store.subscribe((mutation, state) => {
      if (mutation.type.startsWith('chatHistory/')) {
        try {
          if (mutation.type === 'chatHistory/CLEAR_FOLDERS') {
            localStorage.removeItem('chatHistory');
          } else {
            localStorage.setItem('chatHistory', JSON.stringify(state.chatHistory));
          }
        } catch (e) {
          console.error('Error saving chat history to localStorage:', e);
        }
      }
    });
  };
}

function createTestStore() {
  return createStore({
    modules: {
      chatHistory: chatHistoryStore,
      auth: {
        namespaced: false,
        state: {
          isAuthenticated: false,
          user: null,
          accessToken: null,
          error: null,
          isInitialized: false
        },
        getters: {
          currentUser: (state) => state.user
        },
        mutations: {},
        actions: {}
      }
    },
    plugins: [createPersistencePlugin()]
  });
}

describe('Store persistence plugin (AC8)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should persist chatHistory state on chatHistory mutations', () => {
    const store = createTestStore();

    store.commit('chatHistory/ADD_FOLDER', { name: 'Work' });

    const saved = JSON.parse(localStorage.getItem('chatHistory'));
    expect(saved.folders).toHaveLength(2);
    expect(saved.folders[1].name).toBe('Work');
  });

  it('should remove localStorage on CLEAR_FOLDERS', () => {
    const store = createTestStore();

    store.commit('chatHistory/ADD_FOLDER', { name: 'Work' });
    expect(localStorage.getItem('chatHistory')).not.toBeNull();

    store.commit('chatHistory/CLEAR_FOLDERS');
    expect(localStorage.getItem('chatHistory')).toBeNull();
  });

  it('should NOT trigger persistence on non-chatHistory mutations', () => {
    const store = createTestStore();

    // Pre-populate localStorage to verify it stays unchanged
    localStorage.setItem('chatHistory', JSON.stringify({ folders: [], chats: [], folderChats: {} }));
    const before = localStorage.getItem('chatHistory');

    // Commit a non-chatHistory mutation — subscriber fires but persistence is skipped
    store.commit('auth/setToken', 'dummy-token');

    expect(localStorage.getItem('chatHistory')).toBe(before);
  });

  it('should restore state from localStorage on store creation', () => {
    const savedState = {
      folders: [
        { id: 'default', name: 'All Chats', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'restored-folder', name: 'Restored', isDefault: false, createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      chats: [{ id: 'c1', title: 'Restored Chat' }],
      folderChats: { default: ['c1'], 'restored-folder': [] }
    };
    localStorage.setItem('chatHistory', JSON.stringify(savedState));

    const store = createTestStore();

    expect(store.state.chatHistory.folders).toHaveLength(2);
    expect(store.state.chatHistory.folders[1].name).toBe('Restored');
    expect(store.state.chatHistory.chats).toHaveLength(1);
  });

  it('should handle invalid localStorage data gracefully', () => {
    localStorage.setItem('chatHistory', 'not-valid-json');

    const store = createTestStore();
    expect(store.state.chatHistory.folders).toHaveLength(1);
    expect(store.state.chatHistory.folders[0].id).toBe('default');
  });

  it('should handle missing localStorage data gracefully', () => {
    expect(() => createTestStore()).not.toThrow();

    const store = createTestStore();
    expect(store.state.chatHistory.folders).toHaveLength(1);
  });
});
