'use strict';

// Mock uuid to return deterministic IDs
const mockUuid = jest.fn();
jest.mock('uuid', () => ({
  v4: (...args) => mockUuid(...args)
}));

// Mock chatHistoryService — only moveChat action calls the service
const mockMoveConversation = jest.fn();
const mockGetFolder = jest.fn();
jest.mock('@/services/chatHistoryService', () => ({
  __esModule: true,
  default: {
    moveConversation: (...args) => mockMoveConversation(...args),
    getFolder: (...args) => mockGetFolder(...args)
  }
}));

const chatHistory = require('@/store/chatHistoryStore').default;

describe('Vuex chatHistory module', () => {
  let state;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUuid.mockReturnValue('test-uuid-1');
    state = chatHistory.state();
  });

  // --- AC1: Initial state ---

  describe('initial state (AC1)', () => {
    it('should contain a single default folder', () => {
      expect(state.folders).toHaveLength(1);
      expect(state.folders[0]).toMatchObject({
        id: 'default',
        name: 'All Chats',
        isDefault: true
      });
    });

    it('should have empty chats array', () => {
      expect(state.chats).toEqual([]);
    });

    it('should have folderChats with only default empty array', () => {
      expect(state.folderChats).toEqual({ default: [] });
    });

    it('should set createdAt as ISO string on default folder', () => {
      expect(state.folders[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // --- AC2: Folder mutations ---

  describe('ADD_FOLDER mutation (AC2)', () => {
    it('should create a new folder with UUID and initialize folderChats', () => {
      mockUuid.mockReturnValue('folder-uuid-1');

      chatHistory.mutations.ADD_FOLDER(state, { name: 'Work' });

      expect(state.folders).toHaveLength(2);
      expect(state.folders[1]).toMatchObject({
        id: 'folder-uuid-1',
        name: 'Work',
        isDefault: false
      });
      expect(state.folderChats['folder-uuid-1']).toEqual([]);
    });

    it('should return the new folder ID', () => {
      mockUuid.mockReturnValue('returned-id');

      const result = chatHistory.mutations.ADD_FOLDER(state, { name: 'Test' });

      expect(result).toBe('returned-id');
    });
  });

  describe('UPDATE_FOLDER mutation (AC2)', () => {
    it('should rename a non-default folder', () => {
      state.folders.push({ id: 'f1', name: 'Old', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });

      chatHistory.mutations.UPDATE_FOLDER(state, { folderId: 'f1', name: 'New' });

      expect(state.folders[1].name).toBe('New');
    });

    it('should NOT rename the default folder', () => {
      chatHistory.mutations.UPDATE_FOLDER(state, { folderId: 'default', name: 'Hacked' });

      expect(state.folders[0].name).toBe('All Chats');
    });

    it('should handle non-existent folder gracefully', () => {
      const before = JSON.parse(JSON.stringify(state.folders));

      chatHistory.mutations.UPDATE_FOLDER(state, { folderId: 'nonexistent', name: 'X' });

      expect(state.folders).toEqual(before);
    });
  });

  describe('REMOVE_FOLDER mutation (AC2)', () => {
    it('should delete a non-default folder', () => {
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = [];

      chatHistory.mutations.REMOVE_FOLDER(state, 'f1');

      expect(state.folders).toHaveLength(1);
      expect(state.folders[0].id).toBe('default');
      expect(state.folderChats.f1).toBeUndefined();
    });

    it('should migrate chats to default folder when deleting folder', () => {
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['chat-1'];
      state.folderChats.default = [];

      chatHistory.mutations.REMOVE_FOLDER(state, 'f1');

      expect(state.folderChats.default).toContain('chat-1');
    });

    it('should not add duplicates when migrating chats to default', () => {
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['chat-1'];
      state.folderChats.default = ['chat-1'];

      chatHistory.mutations.REMOVE_FOLDER(state, 'f1');

      expect(state.folderChats.default.filter((id) => id === 'chat-1')).toHaveLength(1);
    });

    it('should NOT delete the default folder', () => {
      chatHistory.mutations.REMOVE_FOLDER(state, 'default');

      expect(state.folders).toHaveLength(1);
      expect(state.folders[0].id).toBe('default');
    });
  });

  describe('setFolders mutation (AC2)', () => {
    it('should replace the entire folders array', () => {
      const newFolders = [
        { id: 'default', name: 'All Chats', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'f1', name: 'Custom', isDefault: false, createdAt: '2026-02-01T00:00:00.000Z' }
      ];

      chatHistory.mutations.setFolders(state, newFolders);

      expect(state.folders).toEqual(newFolders);
    });
  });

  describe('CLEAR_FOLDERS mutation (AC2)', () => {
    it('should reset to initial state with single default folder', () => {
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['chat-1'];
      state.chats.push({ id: 'chat-1', title: 'Test' });

      chatHistory.mutations.CLEAR_FOLDERS(state);

      expect(state.folders).toHaveLength(1);
      expect(state.folders[0]).toMatchObject({ id: 'default', name: 'All Chats', isDefault: true });
      expect(state.folderChats).toEqual({ default: [] });
    });
  });

  // --- AC3: Chat mutations ---

  describe('ADD_CHAT mutation (AC3)', () => {
    it('should create a chat and add to default folder', () => {
      chatHistory.mutations.ADD_CHAT(state, { id: 'c1', title: 'Hello', preview: 'Hi' });

      expect(state.chats).toHaveLength(1);
      expect(state.chats[0]).toMatchObject({
        id: 'c1',
        title: 'Hello',
        preview: 'Hi',
        messageCount: 0
      });
      expect(state.folderChats.default).toContain('c1');
    });

    it('should add to specified folder and default folder', () => {
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = [];

      chatHistory.mutations.ADD_CHAT(state, { id: 'c1', title: 'Work Chat', folderId: 'f1' });

      expect(state.folderChats.f1).toContain('c1');
      expect(state.folderChats.default).toContain('c1');
    });

    it('should default to default folder when folderId not provided', () => {
      chatHistory.mutations.ADD_CHAT(state, { id: 'c1', title: 'No folder' });

      expect(state.folderChats.default).toContain('c1');
    });

    it('should generate UUID if id not provided', () => {
      mockUuid.mockReturnValue('generated-id');

      chatHistory.mutations.ADD_CHAT(state, { title: 'Auto ID' });

      expect(state.chats[0].id).toBe('generated-id');
    });

    it('should not add duplicate to default when already in default folder', () => {
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = [];

      // folderId === 'default' — should add only once
      chatHistory.mutations.ADD_CHAT(state, { id: 'c1', title: 'Test', folderId: 'default' });

      expect(state.folderChats.default.filter((id) => id === 'c1')).toHaveLength(1);
    });
  });

  describe('UPDATE_CHAT mutation (AC3)', () => {
    it('should update title and preview and set updatedAt', () => {
      state.chats.push({ id: 'c1', title: 'Old', preview: 'Old preview', updatedAt: '2026-01-01T00:00:00.000Z' });

      chatHistory.mutations.UPDATE_CHAT(state, { chatId: 'c1', title: 'New', preview: 'New preview' });

      expect(state.chats[0].title).toBe('New');
      expect(state.chats[0].preview).toBe('New preview');
      expect(state.chats[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should preserve existing title when not provided', () => {
      state.chats.push({ id: 'c1', title: 'Keep', preview: 'Old', updatedAt: '2026-01-01T00:00:00.000Z' });

      chatHistory.mutations.UPDATE_CHAT(state, { chatId: 'c1', preview: 'New preview' });

      expect(state.chats[0].title).toBe('Keep');
    });

    it('should handle non-existent chat gracefully', () => {
      const before = [...state.chats];

      chatHistory.mutations.UPDATE_CHAT(state, { chatId: 'missing', title: 'X' });

      expect(state.chats).toEqual(before);
    });
  });

  describe('REMOVE_CHAT mutation (AC3)', () => {
    it('should remove chat from all folderChats and chats array', () => {
      state.chats.push({ id: 'c1', title: 'Test' });
      state.folderChats.default = ['c1'];
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['c1'];

      chatHistory.mutations.REMOVE_CHAT(state, 'c1');

      expect(state.chats).toHaveLength(0);
      expect(state.folderChats.default).not.toContain('c1');
      expect(state.folderChats.f1).not.toContain('c1');
    });

    it('should handle non-existent chat gracefully', () => {
      chatHistory.mutations.REMOVE_CHAT(state, 'missing');

      expect(state.chats).toHaveLength(0);
    });
  });

  describe('MOVE_CHAT mutation (AC3)', () => {
    it('should move chat between folders and keep in default', () => {
      state.chats.push({ id: 'c1', title: 'Test' });
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folders.push({ id: 'f2', name: 'Personal', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['c1'];
      state.folderChats.f2 = [];
      state.folderChats.default = ['c1'];

      chatHistory.mutations.MOVE_CHAT(state, { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' });

      expect(state.folderChats.f1).not.toContain('c1');
      expect(state.folderChats.f2).toContain('c1');
      expect(state.folderChats.default).toContain('c1');
    });

    it('should be a no-op when fromFolderId equals toFolderId', () => {
      state.chats.push({ id: 'c1', title: 'Test' });
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['c1'];

      chatHistory.mutations.MOVE_CHAT(state, { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f1' });

      expect(state.folderChats.f1).toEqual(['c1']);
    });

    it('should ensure chat is in default folder after move', () => {
      state.chats.push({ id: 'c1', title: 'Test' });
      state.folders.push({ id: 'f1', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folders.push({ id: 'f2', name: 'Personal', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z' });
      state.folderChats.f1 = ['c1'];
      state.folderChats.f2 = [];
      state.folderChats.default = [];

      chatHistory.mutations.MOVE_CHAT(state, { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' });

      expect(state.folderChats.default).toContain('c1');
    });
  });

  // --- AC4: Folder-chat association mutations ---

  describe('ADD_CHAT_TO_FOLDER mutation (AC4)', () => {
    it('should add chat ID to folder', () => {
      chatHistory.mutations.ADD_CHAT_TO_FOLDER(state, { chatId: 'c1', folderId: 'default' });

      expect(state.folderChats.default).toContain('c1');
    });

    it('should NOT add duplicates', () => {
      state.folderChats.default = ['c1'];

      chatHistory.mutations.ADD_CHAT_TO_FOLDER(state, { chatId: 'c1', folderId: 'default' });

      expect(state.folderChats.default.filter((id) => id === 'c1')).toHaveLength(1);
    });

    it('should create folderChats entry for new folder', () => {
      chatHistory.mutations.ADD_CHAT_TO_FOLDER(state, { chatId: 'c1', folderId: 'new-folder' });

      expect(state.folderChats['new-folder']).toContain('c1');
    });
  });

  describe('REMOVE_CHAT_FROM_FOLDER mutation (AC4)', () => {
    it('should remove chat ID from folder', () => {
      state.folderChats.default = ['c1', 'c2'];

      chatHistory.mutations.REMOVE_CHAT_FROM_FOLDER(state, { chatId: 'c1', folderId: 'default' });

      expect(state.folderChats.default).not.toContain('c1');
      expect(state.folderChats.default).toContain('c2');
    });

    it('should handle non-existent folder gracefully', () => {
      expect(() => {
        chatHistory.mutations.REMOVE_CHAT_FROM_FOLDER(state, { chatId: 'c1', folderId: 'nonexistent' });
      }).not.toThrow();
    });
  });

  describe('SET_FOLDER_CHATS mutation (AC4)', () => {
    it('should replace folder chat IDs', () => {
      state.folderChats.default = ['c1', 'c2'];

      chatHistory.mutations.SET_FOLDER_CHATS(state, { folderId: 'default', chats: ['c3', 'c4'] });

      expect(state.folderChats.default).toEqual(['c3', 'c4']);
    });

    it('should create entry for new folder', () => {
      chatHistory.mutations.SET_FOLDER_CHATS(state, { folderId: 'f1', chats: ['c1'] });

      expect(state.folderChats.f1).toEqual(['c1']);
    });
  });

  // --- AC5: Getters ---

  describe('getters (AC5)', () => {
    describe('getAllFolders', () => {
      it('should return all folders', () => {
        expect(chatHistory.getters.getAllFolders(state)).toBe(state.folders);
      });
    });

    describe('getFolderById', () => {
      it('should return a specific folder', () => {
        const result = chatHistory.getters.getFolderById(state)('default');

        expect(result).toMatchObject({ id: 'default', name: 'All Chats' });
      });

      it('should return undefined for non-existent folder', () => {
        const result = chatHistory.getters.getFolderById(state)('nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('getChatById', () => {
      it('should return a specific chat', () => {
        state.chats.push({ id: 'c1', title: 'Test Chat' });

        const result = chatHistory.getters.getChatById(state)('c1');

        expect(result).toMatchObject({ id: 'c1', title: 'Test Chat' });
      });

      it('should return undefined for non-existent chat', () => {
        const result = chatHistory.getters.getChatById(state)('missing');

        expect(result).toBeUndefined();
      });
    });

    describe('getChatsByFolderId', () => {
      it('should resolve chat IDs to full objects', () => {
        state.chats.push({ id: 'c1', title: 'Chat 1' });
        state.chats.push({ id: 'c2', title: 'Chat 2' });
        state.folderChats.default = ['c1', 'c2'];

        const result = chatHistory.getters.getChatsByFolderId(state)('default');

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ id: 'c1' });
        expect(result[1]).toMatchObject({ id: 'c2' });
      });

      it('should filter out undefined entries (orphaned references)', () => {
        state.chats.push({ id: 'c1', title: 'Chat 1' });
        state.folderChats.default = ['c1', 'orphaned'];

        const result = chatHistory.getters.getChatsByFolderId(state)('default');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('c1');
      });

      it('should return empty array for non-existent folder', () => {
        const result = chatHistory.getters.getChatsByFolderId(state)('nonexistent');

        expect(result).toEqual([]);
      });
    });
  });

  // --- AC6: Actions ---

  describe('synchronous actions (AC6)', () => {
    let commit;

    beforeEach(() => {
      commit = jest.fn();
    });

    it('setFolders should commit setFolders mutation', () => {
      const folders = [{ id: 'f1' }];
      chatHistory.actions.setFolders({ commit }, folders);
      expect(commit).toHaveBeenCalledWith('setFolders', folders);
    });

    it('createFolder should commit ADD_FOLDER mutation', () => {
      chatHistory.actions.createFolder({ commit }, 'Work');
      expect(commit).toHaveBeenCalledWith('ADD_FOLDER', { name: 'Work' });
    });

    it('updateFolder should commit UPDATE_FOLDER mutation', () => {
      chatHistory.actions.updateFolder({ commit }, { folderId: 'f1', name: 'New' });
      expect(commit).toHaveBeenCalledWith('UPDATE_FOLDER', { folderId: 'f1', name: 'New' });
    });

    it('deleteFolder should commit REMOVE_FOLDER mutation', () => {
      chatHistory.actions.deleteFolder({ commit }, 'f1');
      expect(commit).toHaveBeenCalledWith('REMOVE_FOLDER', 'f1');
    });

    it('createChat should commit ADD_CHAT mutation', () => {
      const data = { id: 'c1', title: 'Test' };
      chatHistory.actions.createChat({ commit }, data);
      expect(commit).toHaveBeenCalledWith('ADD_CHAT', data);
    });

    it('updateChat should commit UPDATE_CHAT mutation', () => {
      const data = { chatId: 'c1', title: 'Updated' };
      chatHistory.actions.updateChat({ commit }, data);
      expect(commit).toHaveBeenCalledWith('UPDATE_CHAT', data);
    });

    it('deleteChat should commit REMOVE_CHAT mutation', () => {
      chatHistory.actions.deleteChat({ commit }, 'c1');
      expect(commit).toHaveBeenCalledWith('REMOVE_CHAT', 'c1');
    });

    it('addChatToFolder should commit ADD_CHAT_TO_FOLDER mutation', () => {
      chatHistory.actions.addChatToFolder({ commit }, { chatId: 'c1', folderId: 'f1' });
      expect(commit).toHaveBeenCalledWith('ADD_CHAT_TO_FOLDER', { chatId: 'c1', folderId: 'f1' });
    });

    it('setFolderChats should commit SET_FOLDER_CHATS mutation', () => {
      chatHistory.actions.setFolderChats({ commit }, { folderId: 'f1', chats: ['c1'] });
      expect(commit).toHaveBeenCalledWith('SET_FOLDER_CHATS', { folderId: 'f1', chats: ['c1'] });
    });

    it('clearFolders should commit CLEAR_FOLDERS mutation', async () => {
      await chatHistory.actions.clearFolders({ commit });
      expect(commit).toHaveBeenCalledWith('CLEAR_FOLDERS');
    });
  });

  describe('moveChat action (AC6)', () => {
    let commit;
    let rootGetters;

    beforeEach(() => {
      commit = jest.fn();
      rootGetters = { 'auth/currentUser': { sub: 'user-123' } };
    });

    it('should call service and commit mutations on success', async () => {
      mockMoveConversation.mockResolvedValue({});
      mockGetFolder.mockResolvedValue({ conversations: [{ _key: 'c1' }, { _key: 'c2' }] });

      await chatHistory.actions.moveChat(
        { commit, rootGetters },
        { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' }
      );

      expect(mockMoveConversation).toHaveBeenCalledWith('c1', 'f1', 'f2');
      expect(mockGetFolder).toHaveBeenCalledWith('f2');
      expect(commit).toHaveBeenCalledWith('SET_FOLDER_CHATS', { folderId: 'f2', chats: ['c1', 'c2'] });
      expect(commit).toHaveBeenCalledWith('MOVE_CHAT', { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' });
    });

    it('should throw when currentUser is null', async () => {
      rootGetters = { 'auth/currentUser': null };

      await expect(
        chatHistory.actions.moveChat({ commit, rootGetters }, { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' })
      ).rejects.toThrow('User is missing');
    });

    it('should propagate service errors', async () => {
      mockMoveConversation.mockRejectedValue(new Error('Network error'));

      await expect(
        chatHistory.actions.moveChat({ commit, rootGetters }, { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' })
      ).rejects.toThrow('Network error');
    });
  });

  describe('removeChatFromFolder action (AC6)', () => {
    let commit;

    beforeEach(() => {
      commit = jest.fn();
    });

    it('should commit REMOVE_CHAT_FROM_FOLDER and ensure chat in default', async () => {
      state.folderChats.default = [];

      await chatHistory.actions.removeChatFromFolder({ commit, state }, { chatId: 'c1', folderId: 'f1' });

      expect(commit).toHaveBeenCalledWith('REMOVE_CHAT_FROM_FOLDER', { chatId: 'c1', folderId: 'f1' });
      expect(commit).toHaveBeenCalledWith('ADD_CHAT_TO_FOLDER', { chatId: 'c1', folderId: 'default' });
    });

    it('should NOT add to default when already present', async () => {
      state.folderChats.default = ['c1'];

      await chatHistory.actions.removeChatFromFolder({ commit, state }, { chatId: 'c1', folderId: 'f1' });

      expect(commit).toHaveBeenCalledWith('REMOVE_CHAT_FROM_FOLDER', { chatId: 'c1', folderId: 'f1' });
      expect(commit).not.toHaveBeenCalledWith('ADD_CHAT_TO_FOLDER', expect.anything());
    });
  });
});
