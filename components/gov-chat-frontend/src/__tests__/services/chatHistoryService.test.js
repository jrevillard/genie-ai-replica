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
            limit: 20, offset: 0, includeArchived: false, filterStarred: false, searchTerm: ''
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
        await expect(chatHistoryService.createConversation({})).rejects.toThrow(
          'Title or initial message is required'
        );
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
        await expect(chatHistoryService.deleteConversation('')).rejects.toThrow(
          'Conversation ID is required'
        );
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
          conversationId: 'conv-1', content: 'Hello', sender: 'user'
        });
        expect(result.content).toBe('Hello');
      });

      it('throws when conversationId is missing', async () => {
        await expect(chatHistoryService.addMessage({ content: 'Hello' })).rejects.toThrow(
          'Conversation ID is required'
        );
      });
    });

    describe('markMessagesAsRead', () => {
      it('marks messages as read', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        await chatHistoryService.markMessagesAsRead('conv-1', ['msg-1', 'msg-2']);

        expect(mockPost).toHaveBeenCalledWith('/chat/conversations/conv-1/messages/read', {
          messageIds: ['msg-1', 'msg-2']
        });
      });
    });

    describe('findMessagesForQuery', () => {
      it('fetches messages by query id', async () => {
        mockGet.mockResolvedValue({ data: { messages: [{ _key: 'msg-1' }] } });

        const result = await chatHistoryService.findMessagesForQuery('query-1');

        expect(mockGet).toHaveBeenCalledWith('/chat/query/query-1/messages');
        expect(result.messages).toHaveLength(1);
      });
    });

    describe('findOriginatingQuery', () => {
      it('fetches originating query for a message', async () => {
        mockGet.mockResolvedValue({ data: { queryId: 'query-1', text: 'original question' } });

        const result = await chatHistoryService.findOriginatingQuery('msg-1');

        expect(mockGet).toHaveBeenCalledWith('/chat/messages/msg-1/query');
        expect(result.queryId).toBe('query-1');
      });
    });

    describe('createConversationFromQuery', () => {
      it('creates conversation from existing query', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'conv-new', title: 'From query' } });

        const result = await chatHistoryService.createConversationFromQuery('query-1', {
          title: 'From query', responseText: 'Answer'
        });

        expect(mockPost).toHaveBeenCalledWith('/chat/query/query-1/conversation', {
          title: 'From query', responseText: 'Answer'
        });
        expect(result._key).toBe('conv-new');
      });
    });
  });

  // =========================================================================
  // Search
  // =========================================================================
  describe('Search', () => {
    describe('searchConversations', () => {
      it('searches with term and default params', async () => {
        mockGet.mockResolvedValue({ data: { results: [], total: 0 } });

        await chatHistoryService.searchConversations('passport');

        expect(mockGet).toHaveBeenCalledWith('/chat/search', {
          params: { q: 'passport', limit: 20, offset: 0, includeArchived: false }
        });
      });

      it('throws when search term is empty', async () => {
        await expect(chatHistoryService.searchConversations('')).rejects.toThrow('Search term is required');
      });
    });

    describe('getRecentConversations', () => {
      it('fetches recent conversations', async () => {
        mockGet.mockResolvedValue({ data: { conversations: [] } });

        await chatHistoryService.getRecentConversations(5);

        expect(mockGet).toHaveBeenCalledWith('/chat/recent', { params: { limit: 5 } });
      });
    });

    describe('getUserConversationStats', () => {
      it('fetches conversation stats', async () => {
        mockGet.mockResolvedValue({ data: { totalConversations: 42, totalMessages: 150 } });

        const result = await chatHistoryService.getUserConversationStats();

        expect(mockGet).toHaveBeenCalledWith('/chat/stats');
        expect(result.totalConversations).toBe(42);
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

    describe('createFolder', () => {
      it('creates folder with name', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'folder-new', name: 'Work' } });

        const result = await chatHistoryService.createFolder({ name: 'Work', color: '#ff0000' });

        expect(mockPost).toHaveBeenCalledWith('/chat/folders', { name: 'Work', color: '#ff0000' });
        expect(result._key).toBe('folder-new');
      });

      it('throws when name is missing', async () => {
        await expect(chatHistoryService.createFolder({})).rejects.toThrow('Folder name is required');
      });
    });

    describe('updateFolder', () => {
      it('updates folder fields', async () => {
        mockPatch.mockResolvedValue({ data: { _key: 'folder-1', name: 'Updated' } });

        const result = await chatHistoryService.updateFolder('folder-1', { name: 'Updated' });

        expect(mockPatch).toHaveBeenCalledWith('/chat/folders/folder-1', { name: 'Updated' });
        expect(result.name).toBe('Updated');
      });
    });

    describe('deleteFolder', () => {
      it('deletes folder without contents by default', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        await chatHistoryService.deleteFolder('folder-1');

        expect(mockDelete).toHaveBeenCalledWith('/chat/folders/folder-1', {
          params: { deleteContents: false }
        });
      });

      it('deletes folder with contents when specified', async () => {
        mockDelete.mockResolvedValue({ data: { success: true } });

        await chatHistoryService.deleteFolder('folder-1', true);

        expect(mockDelete).toHaveBeenCalledWith('/chat/folders/folder-1', {
          params: { deleteContents: true }
        });
      });
    });

    describe('getFolderPath', () => {
      it('fetches folder path breadcrumbs', async () => {
        mockGet.mockResolvedValue({ data: [{ _key: 'parent', name: 'Parent' }, { _key: 'child', name: 'Child' }] });

        const result = await chatHistoryService.getFolderPath('child');

        expect(mockGet).toHaveBeenCalledWith('/chat/folders/child/path');
        expect(result).toHaveLength(2);
      });
    });

    describe('searchFolders', () => {
      it('searches folders by term', async () => {
        mockGet.mockResolvedValue({ data: { results: [] } });

        await chatHistoryService.searchFolders('work');

        expect(mockGet).toHaveBeenCalledWith('/chat/folders/search', {
          params: { q: 'work', includeArchived: false }
        });
      });

      it('throws when search term is empty', async () => {
        await expect(chatHistoryService.searchFolders('')).rejects.toThrow('Search term is required');
      });
    });

    describe('reorderFolders', () => {
      it('reorders folders', async () => {
        const orders = [{ folderId: 'f1', order: 0 }, { folderId: 'f2', order: 1 }];
        mockPost.mockResolvedValue({ data: { success: true } });

        await chatHistoryService.reorderFolders(orders, 'parent-1');

        expect(mockPost).toHaveBeenCalledWith('/chat/folders/reorder', {
          folderOrders: orders, parentFolderId: 'parent-1'
        });
      });

      it('throws when folderOrders is empty', async () => {
        await expect(chatHistoryService.reorderFolders([])).rejects.toThrow(
          'Folder orders array is required'
        );
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
});
