'use strict';

// Closure-based references for jest.mock hoisting compatibility
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: (...args) => mockPut(...args),
  delete: (...args) => mockDelete(...args),
  patch: (...args) => mockPatch(...args)
}));

const chatHistoryService = require('@/services/chatHistoryService').default;

describe('chatHistoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Conversations
  // =========================================================================
  describe('Conversations', () => {
    describe('getUserConversations', () => {
      it('fetches conversations with default pagination params', async () => {
        mockGet.mockResolvedValue({ data: { conversations: [], pagination: { total: 0 } } });

        const result = await chatHistoryService.getUserConversations();

        expect(mockGet).toHaveBeenCalledWith('/chat/conversations', {
          params: {
            limit: 20,
            offset: 0,
            includeArchived: false,
            filterStarred: false,
            searchTerm: ''
          }
        });
        expect(result).toEqual({ conversations: [], pagination: { total: 0 } });
      });

      it('passes custom options to params', async () => {
        mockGet.mockResolvedValue({ data: { conversations: [], pagination: { total: 0 } } });

        await chatHistoryService.getUserConversations({ limit: 10, offset: 5, includeArchived: true });

        expect(mockGet).toHaveBeenCalledWith('/chat/conversations', {
          params: { limit: 10, offset: 5, includeArchived: true, filterStarred: false, searchTerm: '' }
        });
      });

      it('throws on API failure', async () => {
        mockGet.mockRejectedValue({
          response: { status: 500, data: { error: 'SERVER_ERROR' } }
        });

        await expect(chatHistoryService.getUserConversations()).rejects.toBeDefined();
      });
    });

    describe('getConversation', () => {
      it('fetches single conversation by id', async () => {
        mockGet.mockResolvedValue({ data: { _key: 'conv-1', title: 'Test' } });

        const result = await chatHistoryService.getConversation('conv-1');

        expect(mockGet).toHaveBeenCalledWith('/chat/conversations/conv-1');
        expect(result).toEqual({ _key: 'conv-1', title: 'Test' });
      });
    });

    describe('createConversation', () => {
      it('creates conversation with title', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'conv-new', title: 'New Chat' } });

        const result = await chatHistoryService.createConversation({ title: 'New Chat' });

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations', { title: 'New Chat' });
        expect(result._key).toBe('conv-new');
      });

      it('creates conversation with initialMessage', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'conv-2', title: 'Auto-generated' } });

        const result = await chatHistoryService.createConversation({ initialMessage: 'Hello' });

        expect(result._key).toBe('conv-2');
      });

      it('throws when no title or initialMessage provided', async () => {
        await expect(chatHistoryService.createConversation({})).rejects.toThrow('Title or initial message is required');
      });
    });

    describe('updateConversation', () => {
      it('updates conversation fields', async () => {
        mockPatch.mockResolvedValue({ data: { _key: 'conv-1', title: 'Updated' } });

        const result = await chatHistoryService.updateConversation('conv-1', { title: 'Updated', isStarred: true });

        expect(mockPatch).toHaveBeenCalledWith('/chat/conversations/conv-1', { title: 'Updated', isStarred: true });
        expect(result.title).toBe('Updated');
      });

      it('throws when conversationId is missing', async () => {
        await expect(chatHistoryService.updateConversation('', { title: 'Test' })).rejects.toThrow(
          'Conversation ID is required'
        );
      });
    });

    describe('deleteConversation', () => {
      it('deletes conversation by id', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.deleteConversation('conv-1');

        expect(mockDelete).toHaveBeenCalledWith('/chat/conversations/conv-1');
        expect(result).toEqual({ success: true });
      });

      it('throws when conversationId is missing', async () => {
        await expect(chatHistoryService.deleteConversation('')).rejects.toThrow('Conversation ID is required');
      });
    });
  });

  // =========================================================================
  // Messages
  // =========================================================================
  describe('Messages', () => {
    describe('getConversationMessages', () => {
      it('fetches messages with default pagination', async () => {
        mockGet.mockResolvedValue({ data: { messages: [], pagination: { total: 0 } } });

        await chatHistoryService.getConversationMessages('conv-1');

        expect(mockGet).toHaveBeenCalledWith('/chat/conversations/conv-1/messages', {
          params: { limit: 50, offset: 0, newestFirst: false }
        });
      });

      it('passes sort options', async () => {
        mockGet.mockResolvedValue({ data: { messages: [], pagination: { total: 0 } } });

        await chatHistoryService.getConversationMessages('conv-1', { newestFirst: true, limit: 10 });

        expect(mockGet).toHaveBeenCalledWith('/chat/conversations/conv-1/messages', {
          params: { limit: 10, offset: 0, newestFirst: true }
        });
      });
    });

    describe('addMessage', () => {
      it('posts message to conversation', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'msg-1', content: 'Hello', sender: 'user' } });

        const result = await chatHistoryService.addMessage({
          conversationId: 'conv-1',
          content: 'Hello',
          sender: 'user'
        });

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations/conv-1/messages', {
          conversationId: 'conv-1',
          content: 'Hello',
          sender: 'user'
        });
        expect(result.content).toBe('Hello');
      });

      it('throws when conversationId is missing', async () => {
        await expect(chatHistoryService.addMessage({ content: 'Hello' })).rejects.toThrow(
          'Conversation ID is required'
        );
      });
    });




  });

  // =========================================================================
  // Folders
  // =========================================================================
  describe('Folders', () => {
    describe('getUserFolders', () => {
      it('fetches all folders', async () => {
        mockGet.mockResolvedValue({ data: { folders: [] } });

        await chatHistoryService.getUserFolders();

        expect(mockGet).toHaveBeenCalledWith('/chat/folders', { params: {} });
      });

      it('passes includeArchived option', async () => {
        mockGet.mockResolvedValue({ data: { folders: [] } });

        await chatHistoryService.getUserFolders({ includeArchived: true });

        expect(mockGet).toHaveBeenCalledWith('/chat/folders', { params: { includeArchived: true } });
      });

      it('passes parentFolderId option', async () => {
        mockGet.mockResolvedValue({ data: { folders: [] } });

        await chatHistoryService.getUserFolders({ parentFolderId: 'folder-1' });

        expect(mockGet).toHaveBeenCalledWith('/chat/folders', { params: { parentFolderId: 'folder-1' } });
      });
    });

    describe('getFolder', () => {
      it('fetches single folder by id', async () => {
        mockGet.mockResolvedValue({ data: { _key: 'folder-1', name: 'Work' } });

        const result = await chatHistoryService.getFolder('folder-1');

        expect(mockGet).toHaveBeenCalledWith('/chat/folders/folder-1');
        expect(result.name).toBe('Work');
      });
    });



  });

  // =========================================================================
  // Folder-Conversation operations
  // =========================================================================
  describe('Folder-Conversation', () => {
    describe('addConversationToFolder', () => {
      it('adds conversation to folder', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        await chatHistoryService.addConversationToFolder('folder-1', 'conv-1');

        expect(mockPost).toHaveBeenCalledWith('/chat/folders/folder-1/conversations/conv-1');
      });
    });

    describe('getConversationFolder', () => {
      it('returns folder info when conversation is in a folder', async () => {
        mockGet.mockResolvedValue({ data: { inFolder: true, folder: { _key: 'folder-1', name: 'Work' } } });

        const result = await chatHistoryService.getConversationFolder('conv-1');

        expect(mockGet).toHaveBeenCalledWith('/chat/conversations/conv-1/folder');
        expect(result.inFolder).toBe(true);
      });

      it('returns { inFolder: false, folder: null } on 404', async () => {
        const error = new Error('Not found');
        error.response = { status: 404, data: { error: 'NOT_FOUND' } };
        mockGet.mockRejectedValue(error);

        const result = await chatHistoryService.getConversationFolder('conv-nonexistent');

        expect(result).toEqual({ inFolder: false, folder: null });
      });

      it('throws on non-404 errors', async () => {
        const error = new Error('Server error');
        error.response = { status: 500, data: { error: 'SERVER_ERROR' } };
        mockGet.mockRejectedValue(error);

        await expect(chatHistoryService.getConversationFolder('conv-1')).rejects.toThrow('Server error');
      });

      it('throws on errors without response property', async () => {
        const error = new Error('Network Error');
        mockGet.mockRejectedValue(error);

        await expect(chatHistoryService.getConversationFolder('conv-1')).rejects.toThrow('Network Error');
      });
    });

    describe('moveConversation', () => {
      it('moves conversation between folders', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.moveConversation('conv-1', 'folder-a', 'folder-b');

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations/conv-1/move', {
          sourceFolderId: 'folder-a',
          targetFolderId: 'folder-b'
        });
        expect(result).toEqual({ success: true });
      });
    });

    describe('removeConversationFromFolder', () => {
      it('removes conversation from folder', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        await chatHistoryService.removeConversationFromFolder('conv-1', 'folder-1');

        expect(mockDelete).toHaveBeenCalledWith('/chat/folders/folder-1/conversations/conv-1');
      });
    });
  });

  // =========================================================================
  // Additional Folder Management Tests
  // =========================================================================
  describe('Additional Folder Management', () => {
    describe('createFolder', () => {
      it('creates folder with name and color', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'folder-new', name: 'Work', color: '#ff0000' } });

        const result = await chatHistoryService.createFolder({
          name: 'Work',
          color: '#ff0000'
        });

        expect(mockPost).toHaveBeenCalledWith('/chat/folders', { name: 'Work', color: '#ff0000' });
        expect(result._key).toBe('folder-new');
      });

      it('creates folder with description and parentFolderId', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'folder-sub', name: 'Subfolder' } });

        const result = await chatHistoryService.createFolder({
          name: 'Subfolder',
          description: 'A subfolder',
          parentFolderId: 'parent-1'
        });

        expect(mockPost).toHaveBeenCalledWith('/chat/folders', {
          name: 'Subfolder',
          description: 'A subfolder',
          parentFolderId: 'parent-1'
        });
        expect(result._key).toBe('folder-sub');
      });

      it('throws when name is missing', async () => {
        await expect(chatHistoryService.createFolder({})).rejects.toThrow('Folder name is required');
      });
    });

    describe('updateFolder', () => {
      it('updates folder name', async () => {
        mockPatch.mockResolvedValue({ data: { _key: 'folder-1', name: 'Updated Name' } });

        const result = await chatHistoryService.updateFolder('folder-1', { name: 'Updated Name' });

        expect(mockPatch).toHaveBeenCalledWith('/chat/folders/folder-1', { name: 'Updated Name' });
        expect(result.name).toBe('Updated Name');
      });

      it('updates folder with multiple fields', async () => {
        mockPatch.mockResolvedValue({
          data: {
            _key: 'folder-1',
            name: 'Work Updated',
            color: '#00ff00',
            icon: 'briefcase'
          }
        });

        await chatHistoryService.updateFolder('folder-1', {
          name: 'Work Updated',
          color: '#00ff00',
          icon: 'briefcase'
        });

        expect(mockPatch).toHaveBeenCalledWith('/chat/folders/folder-1', {
          name: 'Work Updated',
          color: '#00ff00',
          icon: 'briefcase'
        });
      });

      it('throws on API failure', async () => {
        mockPatch.mockRejectedValue(new Error('Server error'));

        await expect(chatHistoryService.updateFolder('folder-1', { name: 'Test' })).rejects.toThrow(
          'Server error'
        );
      });
    });

    describe('deleteFolder', () => {
      it('deletes folder without contents by default', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.deleteFolder('folder-1');

        expect(mockDelete).toHaveBeenCalledWith('/chat/folders/folder-1', {
          params: { deleteContents: false }
        });
        expect(result).toEqual({ success: true });
      });

      it('deletes folder with contents when specified', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.deleteFolder('folder-1', true);

        expect(mockDelete).toHaveBeenCalledWith('/chat/folders/folder-1', {
          params: { deleteContents: true }
        });
        expect(result).toEqual({ success: true });
      });

      it('throws on API failure', async () => {
        mockDelete.mockRejectedValue(new Error('Server error'));

        await expect(chatHistoryService.deleteFolder('folder-1')).rejects.toThrow('Server error');
      });
    });

  });

  // =========================================================================
  // Additional Folder-Conversation Tests
  // =========================================================================
  describe('Additional Folder-Conversation Operations', () => {
    describe('addConversationToFolder', () => {
      it('adds conversation to folder', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.addConversationToFolder('folder-1', 'conv-1');

        expect(mockPost).toHaveBeenCalledWith('/chat/folders/folder-1/conversations/conv-1');
        expect(result).toEqual({ success: true });
      });

      it('throws on API failure', async () => {
        mockPost.mockRejectedValue(new Error('Server error'));

        await expect(
          chatHistoryService.addConversationToFolder('folder-1', 'conv-1')
        ).rejects.toThrow('Server error');
      });
    });

    describe('moveConversation', () => {
      it('moves conversation between folders', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.moveConversation('conv-1', 'folder-a', 'folder-b');

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations/conv-1/move', {
          sourceFolderId: 'folder-a',
          targetFolderId: 'folder-b'
        });
        expect(result).toEqual({ success: true });
      });

      it('moves conversation from folder to root', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.moveConversation('conv-1', 'folder-a', null);

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations/conv-1/move', {
          sourceFolderId: 'folder-a',
          targetFolderId: null
        });
        expect(result).toEqual({ success: true });
      });

      it('moves conversation from root to folder', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.moveConversation('conv-1', null, 'folder-b');

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations/conv-1/move', {
          sourceFolderId: null,
          targetFolderId: 'folder-b'
        });
        expect(result).toEqual({ success: true });
      });

      it('throws on API failure', async () => {
        mockPost.mockRejectedValue(new Error('Server error'));

        await expect(
          chatHistoryService.moveConversation('conv-1', 'folder-a', 'folder-b')
        ).rejects.toThrow('Server error');
      });
    });

    describe('removeConversationFromFolder', () => {
      it('removes conversation from folder', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        const result = await chatHistoryService.removeConversationFromFolder('conv-1', 'folder-1');

        expect(mockDelete).toHaveBeenCalledWith('/chat/folders/folder-1/conversations/conv-1');
        expect(result).toEqual({ success: true });
      });

      it('throws on API failure', async () => {
        mockDelete.mockRejectedValue(new Error('Server error'));

        await expect(
          chatHistoryService.removeConversationFromFolder('conv-1', 'folder-1')
        ).rejects.toThrow('Server error');
      });
    });
  });

  // =========================================================================
  // Additional Search and Stats Tests
  // =========================================================================
  describe('Additional Search and Stats', () => {



  });

  // -----------------------------------------------------------------------
  // getUserFolders — empty and undefined params
  // -----------------------------------------------------------------------
  describe('getUserFolders — empty and undefined params', () => {
    it('does not include params when options are empty', async () => {
      mockGet.mockResolvedValue({ data: { folders: [] } });

      await chatHistoryService.getUserFolders({});

      expect(mockGet).toHaveBeenCalledWith('/chat/folders', { params: {} });
    });

    it('handles undefined parentFolderId correctly', async () => {
      mockGet.mockResolvedValue({ data: { folders: [] } });

      await chatHistoryService.getUserFolders({ parentFolderId: undefined });

      expect(mockGet).toHaveBeenCalledWith('/chat/folders', { params: {} });
    });
  });
});
