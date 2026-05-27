'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

jest.mock('../../middleware/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
  ForbiddenError: class ForbiddenError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'ForbiddenError';
    }
  }
}));

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'doc-1' }),
    update: jest.fn().mockImplementation(async (_id, data, opts) => {
      if (opts && opts.returnNew) {
        return { new: { _key: _id, ...data } };
      }
      return { _key: _id, ...data };
    }),
    document: jest.fn().mockResolvedValue({
      _key: 'conv-1',
      _id: 'conversations/conv-1',
      title: 'Test Conversation'
    }),
    remove: jest.fn().mockResolvedValue({ _key: 'doc-1' }),
    ensureIndex: jest.fn()
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

let chatHistoryService;
let mockDb;
let mockConversations;
let mockMessages;
let mockUserConversations;
let mockConversationCategories;
let mockQueryMessages;
let mockConversationFiles;
let mockFolders;
let mockUserFolders;
let mockFolderConversations;
let mockAnalyticsService;

beforeEach(() => {
  jest.clearAllMocks();

  // Reset singleton
  const ChatHistoryService = require('../../services/chat-history-service');
  if (ChatHistoryService.instance) {
    delete ChatHistoryService.instance;
  }

  mockConversations = createMockCollection();
  mockMessages = createMockCollection();
  mockUserConversations = createMockCollection();
  mockConversationCategories = createMockCollection();
  mockQueryMessages = createMockCollection();
  mockConversationFiles = createMockCollection();
  mockFolders = createMockCollection();
  mockUserFolders = createMockCollection();
  mockFolderConversations = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      const map = {
        conversations: mockConversations,
        messages: mockMessages,
        userConversations: mockUserConversations,
        conversationCategories: mockConversationCategories,
        queryMessages: mockQueryMessages,
        conversationFiles: mockConversationFiles,
        folders: mockFolders,
        userFolders: mockUserFolders,
        folderConversations: mockFolderConversations
      };
      return map[name] || createMockCollection();
    }),
    query: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue({
      step: jest.fn().mockImplementation(async (fn) => fn()),
      commit: jest.fn().mockResolvedValue(undefined),
      abort: jest.fn().mockResolvedValue(undefined)
    })
  };

  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  mockAnalyticsService = {
    recordQuery: jest.fn().mockResolvedValue({}),
    trackEvent: jest.fn().mockResolvedValue({})
  };

  jest.isolateModules(() => {
    chatHistoryService = require('../../services/chat-history-service');
  });
  chatHistoryService.initialized = false;
  chatHistoryService.setAnalyticsService(mockAnalyticsService);
});

describe('ChatHistoryService', () => {
  beforeEach(async () => {
    await chatHistoryService.init();
  });

  describe('init', () => {
    it('should initialize all 9 collections', async () => {
      expect(mockDb.collection).toHaveBeenCalledWith('conversations');
      expect(mockDb.collection).toHaveBeenCalledWith('messages');
      expect(mockDb.collection).toHaveBeenCalledWith('userConversations');
      expect(mockDb.collection).toHaveBeenCalledWith('conversationCategories');
      expect(mockDb.collection).toHaveBeenCalledWith('queryMessages');
      expect(mockDb.collection).toHaveBeenCalledWith('conversationFiles');
      expect(mockDb.collection).toHaveBeenCalledWith('folders');
      expect(mockDb.collection).toHaveBeenCalledWith('userFolders');
      expect(mockDb.collection).toHaveBeenCalledWith('folderConversations');
      expect(chatHistoryService.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      chatHistoryService.initialized = true;
      await chatHistoryService.init();
      const { dbService: ds } = require('../../shared-lib');
      expect(ds.getConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('setAnalyticsService', () => {
    it('should set analytics service', () => {
      const svc = { recordQuery: jest.fn() };
      chatHistoryService.setAnalyticsService(svc);
      expect(chatHistoryService.analyticsService).toBe(svc);
    });
  });

  describe('createConversation', () => {
    it('should throw when userId is missing', async () => {
      await expect(chatHistoryService.createConversation({})).rejects.toThrow('User ID is required');
    });

    it('should create conversation and user edge', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await chatHistoryService.createConversation({
        userId: 'user-1',
        title: 'New Chat'
      });
      expect(mockConversations.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Chat' }));
      expect(result).toBeDefined();
    });

    it('should resolve category name when categoryId is provided', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor(['Taxes'])).mockResolvedValue(createMockCursor([]));
      const result = await chatHistoryService.createConversation({
        userId: 'user-1',
        categoryId: 'cat-1'
      });
      expect(result).toBeDefined();
      expect(mockDb.query).toHaveBeenCalled();
    });
  });

  describe('getConversation', () => {
    it('should return conversation by ID', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await chatHistoryService.getConversation('conv-1');
      expect(mockConversations.document).toHaveBeenCalledWith('conv-1');
      expect(result).toBeDefined();
    });
  });

  describe('getUserConversations', () => {
    it('should return paginated user conversations', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'conv-1' }]))
        .mockResolvedValueOnce(createMockCursor([1]));
      const result = await chatHistoryService.getUserConversations('user-1', { userKey: 'user-1' });
      expect(result.conversations).toBeDefined();
      expect(result.pagination).toBeDefined();
    });
  });

  describe('addMessage', () => {
    it('should add message to conversation', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ sequence: 0 }]));
      const result = await chatHistoryService.addMessage({
        conversationId: 'conv-1',
        content: 'Hello',
        sender: 'user'
      });
      expect(mockMessages.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw when conversationId is missing', async () => {
      await expect(chatHistoryService.addMessage({ content: 'Hello', sender: 'user' })).rejects.toThrow();
    });
  });

  describe('getConversationMessages', () => {
    it('should return paginated messages', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'msg-1', content: 'Hi' }]))
        .mockResolvedValueOnce(createMockCursor([1]));
      const result = await chatHistoryService.getConversationMessages('conv-1');
      expect(result.messages).toBeDefined();
      expect(result.pagination).toBeDefined();
    });
  });

  describe('markMessagesAsRead', () => {
    it('should mark messages as read', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'msg-1' }]));
      const result = await chatHistoryService.markMessagesAsRead('conv-1', ['msg-1']);
      expect(mockDb.query).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.count).toBe(1);
    });

    it('should mark all messages when no IDs provided', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'msg-1' }]))
        .mockResolvedValueOnce(createMockCursor([{ _key: 'msg-2' }]));
      const result = await chatHistoryService.markMessagesAsRead('conv-1');
      expect(result).toBeDefined();
    });
  });

  describe('updateConversation', () => {
    it('should update conversation properties', async () => {
      mockConversations.update.mockResolvedValueOnce({
        new: { _key: 'conv-1', title: 'Updated', updated: '2026-01-01T00:00:00.000Z' }
      });
      const result = await chatHistoryService.updateConversation('conv-1', { title: 'Updated' });
      expect(mockConversations.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ title: 'Updated' }),
        expect.any(Object)
      );
      expect(result.title).toBe('Updated');
    });
  });

  describe('deleteConversation', () => {
    it('should throw ForbiddenError when user lacks permission', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      await expect(chatHistoryService.deleteConversation('conv-1', 'user-2', 'user-2')).rejects.toThrow();
    });

    it('should delete conversation when user has permission', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'edge-1' }])) // permission check
        .mockResolvedValueOnce(createMockCursor([])) // message IDs
        .mockResolvedValue(createMockCursor([])); // edge/message deletions
      mockConversations.remove.mockResolvedValueOnce({ _key: 'conv-1' });
      const result = await chatHistoryService.deleteConversation('conv-1', 'user-1', 'user-1');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should abort transaction when a step fails', async () => {
      const mockTrx = {
        step: jest.fn().mockRejectedValue(new Error('step failed')),
        commit: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.beginTransaction.mockResolvedValue(mockTrx);
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'edge-1' }]))
        .mockResolvedValueOnce(createMockCursor(['messages/msg-1']))
        .mockResolvedValue(createMockCursor([]));
      await expect(chatHistoryService.deleteConversation('conv-1', 'user-1', 'user-1')).rejects.toThrow();
      expect(mockTrx.abort).toHaveBeenCalled();
      expect(mockTrx.commit).not.toHaveBeenCalled();
    });
  });

  describe('folder CRUD', () => {
    describe('createFolder', () => {
      it('should create folder and user edge', async () => {
        mockFolders.save.mockResolvedValueOnce({ _key: 'folder-1' });
        const result = await chatHistoryService.createFolder({
          userId: 'user-1',
          name: 'My Folder'
        });
        expect(mockFolders.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Folder', userId: 'user-1' }));
        expect(result).toBeDefined();
      });

      it('should throw when userId is missing', async () => {
        await expect(chatHistoryService.createFolder({ name: 'No User' })).rejects.toThrow();
      });
    });

    describe('getFolder', () => {
      it('should return folder by ID', async () => {
        mockDb.query.mockResolvedValue(createMockCursor([]));
        mockFolders.document.mockResolvedValueOnce({
          _key: 'folder-1',
          name: 'Test Folder'
        });
        const result = await chatHistoryService.getFolder('folder-1');
        expect(result).toBeDefined();
      });
    });

    describe('updateFolder', () => {
      it('should update folder properties', async () => {
        mockConversations.update.mockResolvedValueOnce({
          new: { _key: 'folder-1', name: 'Updated Folder' }
        });
        const result = await chatHistoryService.updateFolder('folder-1', { name: 'Updated Folder' });
        expect(result).toBeDefined();
      });
    });

    describe('deleteFolder', () => {
      it('should throw ForbiddenError when user lacks permission', async () => {
        mockDb.query.mockResolvedValue(createMockCursor([]));
        await expect(chatHistoryService.deleteFolder('folder-1', 'user-2', false, 'user-2')).rejects.toThrow();
      });
    });
  });

  describe('folder-conversation operations', () => {
    describe('addConversationToFolder', () => {
      it('should add conversation to folder', async () => {
        mockDb.query
          .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-1' }])) // folder permission
          .mockResolvedValueOnce(createMockCursor([{ _key: 'uc-1' }])) // conv permission
          .mockResolvedValueOnce(createMockCursor([])); // existing link check
        const result = await chatHistoryService.addConversationToFolder('folder-1', 'conv-1', 'user-1', 'user-1');
        expect(result).toBeDefined();
        expect(mockFolderConversations.save).toHaveBeenCalled();
      });
    });

    describe('removeConversationFromFolder', () => {
      it('should remove conversation from folder', async () => {
        mockDb.query
          .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-1' }])) // folder permission
          .mockResolvedValueOnce(createMockCursor([{ _key: 'fc-1' }])); // existing link
        const result = await chatHistoryService.removeConversationFromFolder('folder-1', 'conv-1', 'user-1', 'user-1');
        expect(result).toBeDefined();
        expect(mockFolderConversations.remove).toHaveBeenCalled();
      });
    });

    describe('moveConversation', () => {
      it('should move conversation between folders', async () => {
        mockDb.query
          .mockResolvedValueOnce(createMockCursor([{ _key: 'uc-1' }])) // conv permission
          .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-2' }])) // target folder permission
          .mockResolvedValueOnce(
            createMockCursor([{ _key: 'fc-1', _from: 'folders/folder-1', _to: 'conversations/conv-1' }])
          ) // existing link
          .mockResolvedValue(createMockCursor([])); // transaction queries
        const result = await chatHistoryService.moveConversation('conv-1', 'folder-1', 'folder-2', 'user-1', 'user-1');
        expect(result).toBeDefined();
      });
    });
  });

  describe('searchConversations', () => {
    it('should return matching conversations', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'conv-1', title: 'Tax Question' }]));
      const result = await chatHistoryService.searchConversations('user-1', 'tax');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('searchFolders', () => {
    it('should return matching folders', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'folder-1', name: 'Tax Docs' }]));
      const result = await chatHistoryService.searchFolders('user-1', 'tax');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getUserConversationStats', () => {
    it('should return user stats', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ count: 5 }]));
      const result = await chatHistoryService.getUserConversationStats('user-1', 'user-1');
      expect(result).toBeDefined();
    });
  });

  describe('query linking', () => {
    describe('linkQueryToConversation', () => {
      it('should link query to conversation message', async () => {
        mockMessages.document.mockResolvedValueOnce({
          _key: 'msg-1',
          _id: 'messages/msg-1',
          conversationId: 'conv-1'
        });
        mockDb.query.mockResolvedValueOnce(createMockCursor([]));
        mockDb.collection.mockImplementation((name) => {
          if (name === 'queries') return createMockCollection();
          const map = {
            conversations: mockConversations,
            messages: mockMessages,
            userConversations: mockUserConversations,
            conversationCategories: mockConversationCategories,
            queryMessages: mockQueryMessages,
            conversationFiles: mockConversationFiles,
            folders: mockFolders,
            userFolders: mockUserFolders,
            folderConversations: mockFolderConversations
          };
          return map[name] || createMockCollection();
        });
        const result = await chatHistoryService.linkQueryToConversation('query-1', 'conv-1', 'msg-1');
        expect(mockQueryMessages.save).toHaveBeenCalled();
        expect(result).toBeDefined();
      });
    });

    describe('findMessagesForQuery', () => {
      it('should return messages linked to a query', async () => {
        mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'msg-1', content: 'Hello' }]));
        const result = await chatHistoryService.findMessagesForQuery('query-1');
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('findOriginatingQuery', () => {
      it('should return null when no originating query found', async () => {
        mockDb.query.mockResolvedValue(createMockCursor([]));
        const result = await chatHistoryService.findOriginatingQuery('msg-1');
        expect(result).toBeNull();
      });
    });
  });

  describe('createConversationFromQuery', () => {
    it('should create conversation from query', async () => {
      const mockQueriesColl = createMockCollection();
      mockQueriesColl.document.mockResolvedValueOnce({
        _key: 'query-1',
        userId: 'user-1',
        text: 'Tax question',
        timestamp: '2026-01-01T00:00:00.000Z',
        categoryId: 'cat-1'
      });
      mockDb.collection.mockImplementation((name) => {
        if (name === 'queries') return mockQueriesColl;
        const map = {
          conversations: mockConversations,
          messages: mockMessages,
          userConversations: mockUserConversations,
          conversationCategories: mockConversationCategories,
          queryMessages: mockQueryMessages,
          conversationFiles: mockConversationFiles,
          folders: mockFolders,
          userFolders: mockUserFolders,
          folderConversations: mockFolderConversations
        };
        return map[name] || createMockCollection();
      });
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await chatHistoryService.createConversationFromQuery('query-1', 'user-1');
      expect(mockConversations.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw NotFoundError when query not found', async () => {
      const mockQueriesColl = createMockCollection();
      mockQueriesColl.document.mockRejectedValueOnce(new Error('Not found'));
      mockDb.collection.mockImplementation((name) => {
        if (name === 'queries') return mockQueriesColl;
        return createMockCollection();
      });
      await expect(chatHistoryService.createConversationFromQuery('missing', 'user-1')).rejects.toThrow();
    });
  });

  describe('getRecentConversations', () => {
    it('should return recent conversations for user', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'conv-1', title: 'Recent' }]));
      const result = await chatHistoryService.getRecentConversations('user-1', 5, 'user-1');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getUserFolders', () => {
    it('should return user folders', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'folder-1', name: 'Folder 1' }]));
      const result = await chatHistoryService.getUserFolders('user-1');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('updateQueryResponseTime', () => {
    it('should update response time for a query', async () => {
      const mockQueries = createMockCollection();
      mockQueries.update.mockResolvedValueOnce({
        new: { _key: 'query-1', responseTime: 2500 }
      });
      mockDb.collection.mockImplementation((name) => {
        if (name === 'queries') return mockQueries;
        const map = {
          conversations: mockConversations,
          messages: mockMessages,
          userConversations: mockUserConversations,
          conversationCategories: mockConversationCategories,
          queryMessages: mockQueryMessages,
          conversationFiles: mockConversationFiles,
          folders: mockFolders,
          userFolders: mockUserFolders,
          folderConversations: mockFolderConversations
        };
        return map[name] || createMockCollection();
      });

      const result = await chatHistoryService.updateQueryResponseTime('query-1', 2500);
      expect(result.responseTime).toBe(2500);
      expect(mockQueries.update).toHaveBeenCalledWith(
        'query-1',
        expect.objectContaining({ responseTime: 2500 }),
        { returnNew: true }
      );
    });

    it('should throw when queryId is missing', async () => {
      await expect(chatHistoryService.updateQueryResponseTime(null, 1000)).rejects.toThrow(
        'queryId and responseTime are required'
      );
    });

    it('should throw when responseTime is missing', async () => {
      await expect(chatHistoryService.updateQueryResponseTime('query-1')).rejects.toThrow(
        'queryId and responseTime are required'
      );
    });

    it('should accept zero as valid responseTime', async () => {
      const mockQueries = createMockCollection();
      mockQueries.update.mockResolvedValueOnce({ new: { _key: 'query-1', responseTime: 0 } });
      mockDb.collection.mockImplementation((name) => {
        if (name === 'queries') return mockQueries;
        return createMockCollection();
      });

      const result = await chatHistoryService.updateQueryResponseTime('query-1', 0);
      expect(result.responseTime).toBe(0);
    });
  });

  describe('getConversationOwnerId', () => {
    it('should return owner user key', async () => {
      mockDb.query.mockResolvedValue(createMockCursor(['user-1']));
      const result = await chatHistoryService.getConversationOwnerId('conv-1');
      expect(result).toBe('user-1');
    });

    it('should return null when no owner found', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await chatHistoryService.getConversationOwnerId('conv-1');
      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));
      const result = await chatHistoryService.getConversationOwnerId('conv-1');
      expect(result).toBeNull();
    });
  });

  describe('findConversationFolder', () => {
    it('should return folder containing the conversation', async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([{ _id: 'folders/folder-1', _key: 'folder-1', name: 'My Folder', parentFolderId: null }])
      );
      const result = await chatHistoryService.findConversationFolder('conv-1');
      expect(result).toBeDefined();
      expect(result._key).toBe('folder-1');
    });

    it('should return null when conversation is not in any folder', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await chatHistoryService.findConversationFolder('conv-1');
      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));
      const result = await chatHistoryService.findConversationFolder('conv-1');
      expect(result).toBeNull();
    });
  });

  describe('getFolderPath', () => {
    it('should return path for root-level folder', async () => {
      mockFolders.document.mockResolvedValueOnce({
        _key: 'folder-1',
        name: 'Root Folder',
        parentFolderId: null
      });

      const result = await chatHistoryService.getFolderPath('folder-1');
      expect(result).toHaveLength(1);
      expect(result[0]._key).toBe('folder-1');
    });

    it('should return full breadcrumb path for nested folder', async () => {
      mockFolders.document
        .mockResolvedValueOnce({ _key: 'folder-2', name: 'Child', parentFolderId: 'folder-1' })
        .mockResolvedValueOnce({ _key: 'folder-1', name: 'Root', parentFolderId: null });

      const result = await chatHistoryService.getFolderPath('folder-2');
      expect(result).toHaveLength(2);
      expect(result[0]._key).toBe('folder-1');
      expect(result[1]._key).toBe('folder-2');
    });

    it('should throw when folder not found', async () => {
      mockFolders.document.mockRejectedValue(new Error('Not found'));

      await expect(chatHistoryService.getFolderPath('missing')).rejects.toThrow('Not found');
    });
  });

  describe('reorderFolders', () => {
    it('should reorder folders with valid permissions', async () => {
      const mockTrx = {
        step: jest.fn().mockImplementation(async (fn) => fn()),
        commit: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.beginTransaction.mockResolvedValue(mockTrx);

      // Permission check + parent check for each folder
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-1' }])) // perm folder-1
        .mockResolvedValueOnce(createMockCursor([null])) // parent of folder-1 (null = root)
        .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-2' }])) // perm folder-2
        .mockResolvedValueOnce(createMockCursor([null])); // parent of folder-2 (null = root)

      const result = await chatHistoryService.reorderFolders(
        'user-1',
        [{ folderId: 'folder-1', order: 1 }, { folderId: 'folder-2', order: 2 }],
        null,
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.updatedFolders).toBe(2);
      expect(mockTrx.commit).toHaveBeenCalled();
    });

    it('should throw when folderOrders is not an array', async () => {
      await expect(
        chatHistoryService.reorderFolders('user-1', 'invalid', null, 'user-1')
      ).rejects.toThrow('Invalid folder orders array');
    });

    it('should throw when folderOrders is empty', async () => {
      await expect(
        chatHistoryService.reorderFolders('user-1', [], null, 'user-1')
      ).rejects.toThrow('Invalid folder orders array');
    });

    it('should throw ForbiddenError when user lacks permission', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])); // no permission

      await expect(
        chatHistoryService.reorderFolders('user-1', [{ folderId: 'folder-1', order: 1 }], null, 'user-1')
      ).rejects.toThrow();
    });

    it('should throw when folder does not belong to parent', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-1' }])) // has permission
        .mockResolvedValueOnce(createMockCursor(['parent-1'])); // has different parent

      await expect(
        chatHistoryService.reorderFolders('user-1', [{ folderId: 'folder-1', order: 1 }], 'parent-2', 'user-1')
      ).rejects.toThrow('does not belong to the specified parent folder');
    });

    it('should abort transaction on step failure', async () => {
      const mockTrx = {
        step: jest.fn().mockRejectedValue(new Error('Step failed')),
        commit: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.beginTransaction.mockResolvedValue(mockTrx);

      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-1' }])) // perm
        .mockResolvedValueOnce(createMockCursor([null])); // parent

      await expect(
        chatHistoryService.reorderFolders('user-1', [{ folderId: 'folder-1', order: 1 }], null, 'user-1')
      ).rejects.toThrow('Step failed');
      expect(mockTrx.abort).toHaveBeenCalled();
    });
  });

  describe('deleteFolder', () => {
    it('should delete folder with contents when user has permission', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'uf-1' }])) // permission check
        .mockResolvedValueOnce(createMockCursor([{ _key: 'fc-1', _to: 'conversations/conv-1' }])) // folder conversations
        .mockResolvedValueOnce(createMockCursor([])) // child folders
        .mockResolvedValueOnce(createMockCursor([])) // getConversationOwnerId
        .mockResolvedValue(createMockCursor([])); // deletions

      mockConversations.remove.mockResolvedValueOnce({ _key: 'conv-1' });
      mockFolders.remove.mockResolvedValueOnce({ _key: 'folder-1' });

      const result = await chatHistoryService.deleteFolder('folder-1', 'user-1', true, 'user-1');
      expect(result).toBeDefined();
      expect(result.conversationLinksDeleted).toBe(1);
      expect(result.success).toBe(true);
    });
  });
});
