// src/store/index.js
import { createStore } from 'vuex'
import chatHistoryStore from './chatHistoryStore'

// Create and export the store
export default createStore({
  modules: {
    chatHistory: chatHistoryStore
  },
  
  // Plugin for localStorage persistence
  plugins: [
    store => {
      // Initialize state from localStorage if available
      try {
        const savedChatHistory = localStorage.getItem('chatHistory')
        if (savedChatHistory) {
          const parsedData = JSON.parse(savedChatHistory);
          
          // Only apply if it has the expected structure
          if (parsedData && typeof parsedData === 'object') {
            store.replaceState({
              ...store.state,
              chatHistory: parsedData
            });
          }
        }
      } catch (e) {
        console.error('Error loading chat history from localStorage:', e)
      }
      
      // Save state to localStorage when it changes
      store.subscribe((mutation, state) => {
        if (mutation.type.startsWith('chatHistory/')) {
          try {
            localStorage.setItem('chatHistory', JSON.stringify(state.chatHistory))
          } catch (e) {
            console.error('Error saving chat history to localStorage:', e)
          }
        }
      })
    }
  ]
})
