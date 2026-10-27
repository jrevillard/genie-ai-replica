// src/store/index.js
import { createStore } from 'vuex';
import chatHistoryStore from './chatHistoryStore';
import auth from './modules/auth';
import status from './modules/status';
import conversation, { rehydrateConversation, subscribeConversation } from './modules/conversation';

// Create and export the store
const store = createStore({
  modules: {
    chatHistory: chatHistoryStore,
    auth,
    status,
    conversation
  },

  plugins: [
    (store) => {
      // Initialize state from localStorage if available
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

      // Save state to localStorage when it changes
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
    }
  ]
});

// The open conversation rehydrates before anything renders and persists
// (debounced) as it changes.
rehydrateConversation(store.state.conversation);
subscribeConversation(store);

export default store;
