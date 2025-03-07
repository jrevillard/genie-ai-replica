// src/store/chatHistoryStore.js
import { v4 as uuidv4 } from 'uuid'

export default {
  namespaced: true,
  
  state: () => ({
    folders: [
      {
        id: 'default',
        name: 'All Chats',
        isDefault: true,
        createdAt: new Date().toISOString()
      }
    ],
    chats: [], // Will hold all chats
    folderChats: {
      default: [] // Will hold chat IDs in this folder
    }
  }),
  
  getters: {
    getAllFolders: (state) => {
      return state.folders;
    },
    
    getChatsByFolderId: (state) => (folderId) => {
      const chatIds = state.folderChats[folderId] || [];
      return chatIds.map(chatId => {
        return state.chats.find(chat => chat.id === chatId);
      }).filter(chat => chat !== undefined); // Filter out any undefined values
    },
    
    getFolderById: (state) => (folderId) => {
      return state.folders.find(folder => folder.id === folderId);
    },
    
    getChatById: (state) => (chatId) => {
      return state.chats.find(chat => chat.id === chatId);
    }
  },
  
  mutations: {
    // Folder mutations
    ADD_FOLDER(state, folderData) {
      const newFolder = {
        id: uuidv4(),
        name: folderData.name,
        isDefault: false,
        createdAt: new Date().toISOString()
      };
      
      state.folders.push(newFolder);
      state.folderChats[newFolder.id] = [];
      
      return newFolder.id;
    },
    
    UPDATE_FOLDER(state, { folderId, name }) {
      const folderIndex = state.folders.findIndex(f => f.id === folderId);
      if (folderIndex !== -1 && !state.folders[folderIndex].isDefault) {
        // In Vue 3, we don't need Vue.set
        state.folders[folderIndex] = { 
          ...state.folders[folderIndex], 
          name 
        };
      }
    },
    
    REMOVE_FOLDER(state, folderId) {
      const folderIndex = state.folders.findIndex(f => f.id === folderId);
      
      // Do not remove the default folder
      if (folderIndex !== -1 && !state.folders[folderIndex].isDefault) {
        // Get chats in this folder
        const chatIds = state.folderChats[folderId] || [];
        
        // Move chats to default folder if they're not already there
        chatIds.forEach(chatId => {
          if (!state.folderChats.default.includes(chatId)) {
            state.folderChats.default.push(chatId);
          }
        });
        
        // Delete folder and its reference in folderChats
        state.folders.splice(folderIndex, 1);
        delete state.folderChats[folderId];
      }
    },
    
    // Chat mutations
    ADD_CHAT(state, chatData) {
      const newChat = {
        id: uuidv4(),
        title: chatData.title || 'Untitled Chat',
        preview: chatData.preview || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: chatData.messageCount || 0
      };
      
      state.chats.push(newChat);
      
      // Add chat to specified folder, default to 'default' folder
      const folderId = chatData.folderId || 'default';
      if (!state.folderChats[folderId]) {
        state.folderChats[folderId] = [];
      }
      state.folderChats[folderId].push(newChat.id);
      
      // Always add to default folder if not already there
      if (folderId !== 'default' && !state.folderChats.default.includes(newChat.id)) {
        state.folderChats.default.push(newChat.id);
      }
      
      return newChat.id;
    },
    
    UPDATE_CHAT(state, { chatId, title, preview }) {
      const chatIndex = state.chats.findIndex(c => c.id === chatId);
      if (chatIndex !== -1) {
        state.chats[chatIndex] = { 
          ...state.chats[chatIndex], 
          title: title || state.chats[chatIndex].title,
          preview: preview || state.chats[chatIndex].preview,
          updatedAt: new Date().toISOString()
        };
      }
    },
    
    REMOVE_CHAT(state, chatId) {
      const chatIndex = state.chats.findIndex(c => c.id === chatId);
      if (chatIndex !== -1) {
        // Remove chat from all folders
        Object.keys(state.folderChats).forEach(folderId => {
          const index = state.folderChats[folderId].indexOf(chatId);
          if (index !== -1) {
            state.folderChats[folderId].splice(index, 1);
          }
        });
        
        // Remove chat from main chats array
        state.chats.splice(chatIndex, 1);
      }
    },
    
    // Folder-chat relationship mutations
    ADD_CHAT_TO_FOLDER(state, { chatId, folderId }) {
      if (!state.folderChats[folderId]) {
        state.folderChats[folderId] = [];
      }
      
      if (!state.folderChats[folderId].includes(chatId)) {
        state.folderChats[folderId].push(chatId);
      }
    },
    
    REMOVE_CHAT_FROM_FOLDER(state, { chatId, folderId }) {
      if (state.folderChats[folderId]) {
        const index = state.folderChats[folderId].indexOf(chatId);
        if (index !== -1) {
          state.folderChats[folderId].splice(index, 1);
        }
      }
    },
    
    MOVE_CHAT(state, { chatId, fromFolderId, toFolderId }) {
      if (fromFolderId === toFolderId) return;
      
      // Remove from source folder
      if (state.folderChats[fromFolderId]) {
        const index = state.folderChats[fromFolderId].indexOf(chatId);
        if (index !== -1) {
          state.folderChats[fromFolderId].splice(index, 1);
        }
      }
      
      // Add to destination folder
      if (!state.folderChats[toFolderId]) {
        state.folderChats[toFolderId] = [];
      }
      
      if (!state.folderChats[toFolderId].includes(chatId)) {
        state.folderChats[toFolderId].push(chatId);
      }
    }
  },
  
  actions: {
    // Folder actions
    createFolder({ commit }, name) {
      return commit('ADD_FOLDER', { name });
    },
    
    updateFolder({ commit }, { folderId, name }) {
      commit('UPDATE_FOLDER', { folderId, name });
    },
    
    deleteFolder({ commit }, folderId) {
      commit('REMOVE_FOLDER', folderId);
    },
    
    // Chat actions
    createChat({ commit }, chatData) {
      return commit('ADD_CHAT', chatData);
    },
    
    updateChat({ commit }, chatData) {
      commit('UPDATE_CHAT', chatData);
    },
    
    deleteChat({ commit }, chatId) {
      commit('REMOVE_CHAT', chatId);
    },
    
    // Folder-chat relationship actions
    addChatToFolder({ commit }, { chatId, folderId }) {
      commit('ADD_CHAT_TO_FOLDER', { chatId, folderId });
    },
    
    removeChatFromFolder({ commit }, { chatId, folderId }) {
      commit('REMOVE_CHAT_FROM_FOLDER', { chatId, folderId });
    },
    
    moveChat({ commit }, { chatId, fromFolderId, toFolderId }) {
      commit('MOVE_CHAT', { chatId, fromFolderId, toFolderId });
    }
  }
}
