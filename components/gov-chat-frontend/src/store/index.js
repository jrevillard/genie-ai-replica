// src/store/index.js
import { createStore } from 'vuex';
import chatHistoryStore from './chatHistoryStore';
import auth from './modules/auth';
import okf from './modules/okf';
import status from './modules/status';
import conversation, { rehydrateConversation, subscribeConversation } from './modules/conversation';
import { isOkfEnabled } from '../utils/okfFlag';

// Create and export the store
const store = createStore({
  modules: {
    chatHistory: chatHistoryStore,
    auth,
    status,
    conversation,
    // The OKF module registers ONLY when the flag is on (!622 review wave 1).
    // With the flag off nothing can dispatch into it, so the flag-off store is
    // byte-identical to a pre-OKF build and a future module-level side effect
    // cannot leak under a parked flag. The gated UI entry points
    // (AdminDashboard tabs, add-from-link, the crawl dialog's OKF panel) are
    // hidden by the same flag.
    ...(isOkfEnabled() ? { okf } : {})
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
