// src/store/chatHistoryStore.js
import { v4 as uuidv4 } from 'uuid';

export default {
  namespaced: true,

  state: () => ({
    folders: [
      {
        id: 'default',
        name: 'All Chats',
        isDefault: true,
        createdAt: new Date().toISOString(),
      },
    ],
    chats: [],
    folderChats: {
      default: [],
    },
  }),

  getters: {
    getAllFolders: (state) => {
      return state.folders;
    },

    getChatsByFolderId: (state) => (folderId) => {
      const chatIds = state.folderChats[folderId] || [];
      return chatIds
        .map((chatId) => {
          return state.chats.find((chat) => chat.id === chatId);
        })
        .filter((chat) => chat !== undefined);
    },

    getFolderById: (state) => (folderId) => {
      return state.folders.find((folder) => folder.id === folderId);
    },

    getChatById: (state) => (chatId) => {
      return state.chats.find((chat) => chat.id === chatId);
    },
  },

  mutations: {
    // Add setFolders mutation
    setFolders(state, folders) {
      console.log("setFolders mutation received:", folders); // Debug
      state.folders = [...folders]; // Replace state with dispatched folders
    },

    ADD_FOLDER(state, folderData) {
      const newFolder = {
        id: uuidv4(),
        name: folderData.name,
        isDefault: false,
        createdAt: new Date().toISOString(),
      };

      state.folders.push(newFolder);
      state.folderChats[newFolder.id] = [];

      return newFolder.id;
    },

    UPDATE_FOLDER(state, { folderId, name }) {
      const folderIndex = state.folders.findIndex((f) => f.id === folderId);
      if (folderIndex !== -1 && !state.folders[folderIndex].isDefault) {
        state.folders[folderIndex] = {
          ...state.folders[folderIndex],
          name,
        };
      }
    },

    REMOVE_FOLDER(state, folderId) {
      const folderIndex = state.folders.findIndex((f) => f.id === folderId);

      if (folderIndex !== -1 && !state.folders[folderIndex].isDefault) {
        const chatIds = state.folderChats[folderId] || [];

        chatIds.forEach((chatId) => {
          if (!state.folderChats.default.includes(chatId)) {
            state.folderChats.default.push(chatId);
          }
        });

        state.folders.splice(folderIndex, 1);
        delete state.folderChats[folderId];
      }
    },

    ADD_CHAT(state, chatData) {
      const newChat = {
        id: uuidv4(),
        title: chatData.title || 'Untitled Chat',
        preview: chatData.preview || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: chatData.messageCount || 0,
      };

      state.chats.push(newChat);

      const folderId = chatData.folderId || 'default';
      if (!state.folderChats[folderId]) {
        state.folderChats[folderId] = [];
      }
      state.folderChats[folderId].push(newChat.id);

      if (folderId !== 'default' && !state.folderChats.default.includes(newChat.id)) {
        state.folderChats.default.push(newChat.id);
      }

      return newChat.id;
    },

    UPDATE_CHAT(state, { chatId, title, preview }) {
      const chatIndex = state.chats.findIndex((c) => c.id === chatId);
      if (chatIndex !== -1) {
        state.chats[chatIndex] = {
          ...state.chats[chatIndex],
          title: title || state.chats[chatIndex].title,
          preview: preview || state.chats[chatIndex].preview,
          updatedAt: new Date().toISOString(),
        };
      }
    },

    REMOVE_CHAT(state, chatId) {
      const chatIndex = state.chats.findIndex((c) => c.id === chatId);
      if (chatIndex !== -1) {
        Object.keys(state.folderChats).forEach((folderId) => {
          const index = state.folderChats[folderId].indexOf(chatId);
          if (index !== -1) {
            state.folderChats[folderId].splice(index, 1);
          }
        });

        state.chats.splice(chatIndex, 1);
      }
    },

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

      if (state.folderChats[fromFolderId]) {
        const index = state.folderChats[fromFolderId].indexOf(chatId);
        if (index !== -1) {
          state.folderChats[fromFolderId].splice(index, 1);
        }
      }

      if (!state.folderChats[toFolderId]) {
        state.folderChats[toFolderId] = [];
      }

      if (!state.folderChats[toFolderId].includes(chatId)) {
        state.folderChats[toFolderId].push(chatId);
      }
    },
  },

  actions: {
    // Add setFolders action
    setFolders({ commit }, folders) {
      console.log("setFolders action dispatching:", folders); // Debug
      commit('setFolders', folders);
    },

    createFolder({ commit }, name) {
      return commit('ADD_FOLDER', { name });
    },

    updateFolder({ commit }, { folderId, name }) {
      commit('UPDATE_FOLDER', { folderId, name });
    },

    deleteFolder({ commit }, folderId) {
      commit('REMOVE_FOLDER', folderId);
    },

    createChat({ commit }, chatData) {
      return commit('ADD_CHAT', chatData);
    },

    updateChat({ commit }, chatData) {
      commit('UPDATE_CHAT', chatData);
    },

    deleteChat({ commit }, chatId) {
      commit('REMOVE_CHAT', chatId);
    },

    addChatToFolder({ commit }, { chatId, folderId }) {
      commit('ADD_CHAT_TO_FOLDER', { chatId, folderId });
    },

    removeChatFromFolder({ commit }, { chatId, folderId }) {
      commit('REMOVE_CHAT_FROM_FOLDER', { chatId, folderId });
    },

    moveChat({ commit }, { chatId, fromFolderId, toFolderId }) {
      commit('MOVE_CHAT', { chatId, fromFolderId, toFolderId });
    },
  },
};