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

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn()
  }))
}));

jest.mock('path', () => ({
  join: jest.fn((...parts) => parts.join('/'))
}));

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'query-1' }),
    update: jest.fn().mockImplementation(async (_id, data, opts) => {
      if (opts && opts.returnNew) {
        return { new: { _key: _id, ...data } };
      }
      return { _key: _id, ...data };
    }),
    document: jest.fn().mockResolvedValue({
      _key: 'query-1',
      _id: 'queries/query-1',
      userId: 'user-1',
      text: 'test query',
      isAnswered: false
    }),
    remove: jest.fn().mockResolvedValue({ _key: 'query-1' }),
    ensureIndex: jest.fn()
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

function createMockQueryData(overrides = {}) {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    messages: [{ role: 'user', content: 'What is the tax rate?' }],
    context: { categoryLabel: 'Taxes & Revenue', serviceLabels: ['Tax Payment'] },
    ...overrides
  };
}

let queryService;
let mockDb;
let mockQueriesCollection;
let mockServiceCategoriesCollection;
let mockServicesCollection;
let mockQueryCategoriesCollection;
let mockAnalyticsService;

beforeEach(() => {
  jest.clearAllMocks();

  mockQueriesCollection = createMockCollection();
  mockServiceCategoriesCollection = createMockCollection();
  mockServicesCollection = createMockCollection();
  mockQueryCategoriesCollection = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      if (name === 'queries') return mockQueriesCollection;
      if (name === 'serviceCategories') return mockServiceCategoriesCollection;
      if (name === 'services') return mockServicesCollection;
      if (name === 'queryCategories') return mockQueryCategoriesCollection;
      return createMockCollection();
    }),
    query: jest.fn()
  };

  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  mockAnalyticsService = {
    recordQuery: jest.fn().mockResolvedValue({}),
    recordFeedback: jest.fn().mockResolvedValue({})
  };

  jest.isolateModules(() => {
    queryService = require('../../services/query-service');
  });

  queryService.initialized = false;
  queryService.setAnalyticsService(mockAnalyticsService);
});

describe('QueryService', () => {
  beforeEach(async () => {
    await queryService.init();
  });

  describe('init', () => {
    it('should initialize collections on first call', async () => {
      expect(mockDb.collection).toHaveBeenCalledWith('queries');
      expect(mockDb.collection).toHaveBeenCalledWith('serviceCategories');
      expect(mockDb.collection).toHaveBeenCalledWith('services');
      expect(queryService.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      queryService.initialized = true;
      await queryService.init();
      const { dbService: ds } = require('../../shared-lib');
      expect(ds.getConnection).toHaveBeenCalledTimes(1);
    });

    it('should throw on DB connection failure', async () => {
      const { dbService: ds } = require('../../shared-lib');
      ds.getConnection.mockRejectedValueOnce(new Error('DB down'));
      jest.isolateModules(() => {
        queryService = require('../../services/query-service');
      });
      queryService.initialized = false;
      await expect(queryService.init()).rejects.toThrow('DB down');
    });
  });

  describe('dependency injection', () => {
    it('should set analytics service via setter', () => {
      const mockSvc = { recordQuery: jest.fn() };
      queryService.setAnalyticsService(mockSvc);
      expect(queryService.analyticsService).toBe(mockSvc);
    });

    it('should set chat history service via setter', async () => {
      const mockSvc = { getConversation: jest.fn() };
      await queryService.setChatHistoryService(mockSvc);
      expect(queryService.chatHistoryService).toBe(mockSvc);
    });
  });

  describe('getQuery', () => {
    it('should return query document by ID', async () => {
      const result = await queryService.getQuery('query-1');
      expect(mockQueriesCollection.document).toHaveBeenCalledWith('query-1');
      expect(result).toBeDefined();
      expect(result._key).toBe('query-1');
    });

    it('should propagate DB errors', async () => {
      mockQueriesCollection.document.mockRejectedValueOnce(new Error('Not found'));
      await expect(queryService.getQuery('invalid')).rejects.toThrow('Not found');
    });
  });

  describe('deleteQuery', () => {
    it('should delete query and its edges', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await queryService.deleteQuery('query-1');
      expect(result).toBeDefined();
      expect(mockQueriesCollection.remove).toHaveBeenCalledWith('query-1');
    });

    it('should continue if edge deletion fails', async () => {
      mockDb.query
        .mockRejectedValueOnce(new Error('edge error'))
        .mockResolvedValueOnce(createMockCursor([]));
      const result = await queryService.deleteQuery('query-1');
      expect(result).toBeDefined();
      expect(mockQueriesCollection.remove).toHaveBeenCalled();
    });
  });

  describe('addFeedback', () => {
    it('should add feedback to a query', async () => {
      const feedback = { rating: 5, comment: 'Great answer' };
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', userFeedback: feedback }
      });
      const result = await queryService.addFeedback('query-1', feedback);
      expect(result.userFeedback.rating).toBe(5);
      expect(result.userFeedback.comment).toBe('Great answer');
      expect(mockAnalyticsService.recordFeedback).toHaveBeenCalled();
    });

    it('should throw if rating is missing', async () => {
      await expect(queryService.addFeedback('query-1', { comment: 'no rating' })).rejects.toThrow(
        'Feedback rating is required'
      );
    });

    it('should continue if analytics update fails', async () => {
      mockAnalyticsService.recordFeedback.mockRejectedValueOnce(new Error('analytics down'));
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', userFeedback: { rating: 3 } }
      });
      const result = await queryService.addFeedback('query-1', { rating: 3 });
      expect(result).toBeDefined();
    });
  });

  describe('markAsAnswered', () => {
    it('should mark query as answered with response time', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', isAnswered: true, responseTime: 500 }
      });
      const result = await queryService.markAsAnswered('query-1', 500);
      expect(result.isAnswered).toBe(true);
      expect(result.responseTime).toBe(500);
    });

    it('should default responseTime to 0', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', isAnswered: true, responseTime: 0 }
      });
      const result = await queryService.markAsAnswered('query-1');
      expect(result.responseTime).toBe(0);
    });
  });

  describe('updateQueryResponseTime', () => {
    it('should update response time', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', responseTime: 1200 }
      });
      const result = await queryService.updateQueryResponseTime('query-1', 1200);
      expect(result.responseTime).toBe(1200);
    });

    it('should throw on negative responseTime', async () => {
      await expect(queryService.updateQueryResponseTime('query-1', -1)).rejects.toThrow(
        'Invalid response time'
      );
    });

    it('should throw on non-number responseTime', async () => {
      await expect(queryService.updateQueryResponseTime('query-1', 'fast')).rejects.toThrow(
        'Invalid response time'
      );
    });
  });

  describe('searchQueries', () => {
    it('should return paginated results with no filters', async () => {
      const mockResults = [{ _key: 'q1', text: 'query 1' }];
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(mockResults))
        .mockResolvedValueOnce(createMockCursor([1]));
      const result = await queryService.searchQueries({}, 10, 0);
      expect(result.queries).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter by userId', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({ userId: 'user-1' });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should filter by text, categoryId, and isAnswered', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({
        text: 'tax',
        categoryId: 'cat-1',
        isAnswered: true
      });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should calculate pagination correctly', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([25]));
      const result = await queryService.searchQueries({}, 10, 0);
      expect(result.pagination.pages).toBe(3);
      expect(result.pagination.currentPage).toBe(1);
    });
  });

  describe('setQueryCategory', () => {
    it('should update query category and create edge', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: 'cat-1' }
      });
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await queryService.setQueryCategory('query-1', 'cat-1');
      expect(result.categoryId).toBe('cat-1');
      expect(mockQueryCategoriesCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          _from: 'queries/query-1',
          _to: 'serviceCategories/cat-1'
        })
      );
    });

    it('should update existing edge instead of creating new one', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: 'cat-2' }
      });
      mockDb.query.mockResolvedValueOnce(
        createMockCursor([{ _key: 'edge-1', _from: 'queries/query-1' }])
      );
      const result = await queryService.setQueryCategory('query-1', 'cat-2');
      expect(result.categoryId).toBe('cat-2');
      expect(mockQueryCategoriesCollection.update).toHaveBeenCalled();
      expect(mockQueryCategoriesCollection.save).not.toHaveBeenCalled();
    });

    it('should include serviceId when provided', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: 'cat-1', serviceId: 'svc-1' }
      });
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await queryService.setQueryCategory('query-1', 'cat-1', 'svc-1');
      expect(result.serviceId).toBe('svc-1');
    });

    it('should continue if edge update fails', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: 'cat-1' }
      });
      mockDb.query.mockRejectedValueOnce(new Error('edge fail'));
      const result = await queryService.setQueryCategory('query-1', 'cat-1');
      expect(result.categoryId).toBe('cat-1');
    });
  });

  describe('parseChatQnASSELine', () => {
    it('should parse Python repr bytes line', () => {
      const result = queryService.parseChatQnASSELine("b'Hello World'");
      expect(result.type).toBe('chunk');
      expect(result.content).toBe('Hello World');
    });

    it('should parse double-quoted Python repr', () => {
      const result = queryService.parseChatQnASSELine('b"Hello World"');
      expect(result.type).toBe('chunk');
      expect(result.content).toBe('Hello World');
    });

    it('should return done for [DONE]', () => {
      const result = queryService.parseChatQnASSELine('[DONE]');
      expect(result.type).toBe('done');
    });

    it('should return error for unparseable lines', () => {
      const result = queryService.parseChatQnASSELine('some random text');
      expect(result.type).toBe('error');
      expect(result.raw).toBe('some random text');
    });

    it('should decode escape sequences', () => {
      const result = queryService.parseChatQnASSELine("b'Hello\\nWorld'");
      expect(result.type).toBe('chunk');
      expect(result.content).toBe('Hello\nWorld');
    });

    it('should decode hex escape sequences', () => {
      const result = queryService.parseChatQnASSELine("b'\\xc3\\xa9'");
      expect(result.type).toBe('chunk');
      expect(result.content).toBe('é');
    });

    it('should handle escaped backslash before hex', () => {
      const result = queryService.parseChatQnASSELine("b'\\\\xc3'");
      expect(result.type).toBe('chunk');
      expect(result.content).toBe('\\xc3');
    });
  });

  describe('getMockOpeaResponse', () => {
    it('should return response and metadata', () => {
      const queryData = createMockQueryData();
      const result = queryService.getMockOpeaResponse(queryData);
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('source_documents');
      expect(result.metadata).toHaveProperty('confidence_score');
    });

    it('should return category-specific response for Taxes & Revenue', () => {
      const queryData = createMockQueryData({
        context: { categoryLabel: 'Taxes & Revenue', serviceLabels: [] }
      });
      const result = queryService.getMockOpeaResponse(queryData);
      expect(result.response).toContain('Taxes & Revenue');
    });

    it('should return general response when category is General', () => {
      const queryData = createMockQueryData({
        context: { categoryLabel: 'General', serviceLabels: [] }
      });
      const result = queryService.getMockOpeaResponse(queryData);
      expect(result.response).toContain('general mock response');
    });

    it('should add source documents based on serviceLabels', () => {
      const queryData = createMockQueryData({
        context: { categoryLabel: 'Identity & Civil Registration', serviceLabels: ['National ID'] }
      });
      const result = queryService.getMockOpeaResponse(queryData);
      expect(result.metadata.source_documents.length).toBeGreaterThan(0);
    });

    it('should add generic document when no specific label matches', () => {
      const queryData = createMockQueryData({
        context: { categoryLabel: 'General', serviceLabels: ['Some Service'] }
      });
      const result = queryService.getMockOpeaResponse(queryData);
      expect(result.metadata.source_documents.length).toBeGreaterThan(0);
      expect(result.metadata.source_documents[0].document_id).toContain('doc_generic_');
    });
  });

  describe('createQuery', () => {
    it('should throw when userId is missing', async () => {
      const data = createMockQueryData();
      delete data.userId;
      await expect(queryService.createQuery(data)).rejects.toThrow('Missing required query data');
    });

    it('should throw when sessionId is missing', async () => {
      const data = createMockQueryData();
      delete data.sessionId;
      await expect(queryService.createQuery(data)).rejects.toThrow('Missing required query data');
    });

    it('should synthesize messages from legacy text field', async () => {
      const data = { userId: 'u1', sessionId: 's1', text: 'hello', context: null };
      process.env.CONTEXT_OPTION = 'test-mode';
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'q1' });
      mockQueriesCollection.update.mockResolvedValueOnce({ new: { _key: 'q1', isAnswered: true } });
      const result = await queryService.createQuery(data);
      expect(mockQueriesCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'hello' }]
        })
      );
      expect(result).toBeDefined();
      delete process.env.CONTEXT_OPTION;
    });

    it('should default context to General when missing', async () => {
      process.env.CONTEXT_OPTION = 'test-mode';
      const data = createMockQueryData();
      delete data.context;
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'q1' });
      mockQueriesCollection.update.mockResolvedValueOnce({ new: { _key: 'q1', isAnswered: true } });
      await queryService.createQuery(data);
      expect(mockQueriesCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { categoryLabel: 'General', serviceLabels: [] }
        })
      );
      delete process.env.CONTEXT_OPTION;
    });

    it('should use mock response in test-mode', async () => {
      process.env.CONTEXT_OPTION = 'test-mode';
      const data = createMockQueryData();
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'q1' });
      mockQueriesCollection.update.mockResolvedValueOnce({ new: { _key: 'q1', isAnswered: true } });
      const result = await queryService.createQuery(data);
      expect(result).toBeDefined();
      expect(result.queryId).toBe('q1');
      expect(result.response).toBeDefined();
      delete process.env.CONTEXT_OPTION;
    });
  });

  describe('initStreamQuery', () => {
    it('should save query and return OPEA payload', async () => {
      const data = createMockQueryData();
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
      expect(result).toHaveProperty('opeaUrl');
      expect(result).toHaveProperty('opeaPayload');
      expect(result.opeaPayload.stream).toBe(true);
    });

    it('should throw when messages and text are both missing', async () => {
      const data = { userId: 'u1', sessionId: 's1' };
      await expect(queryService.initStreamQuery(data, {})).rejects.toThrow('Missing required query data');
    });

    it('should resolve categoryId from categoryLabel', async () => {
      const data = createMockQueryData();
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(['cat-1']))
        .mockResolvedValueOnce(createMockCursor(['svc-1']));
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });
  });

  describe('finalizeStreamQuery', () => {
    it('should update query with response and mark as answered', async () => {
      await queryService.finalizeStreamQuery('q1', 'Response text', 500, { confidence_score: 0.9 });
      expect(mockQueriesCollection.update).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({
          response: 'Response text',
          responseTime: 500,
          isAnswered: true
        })
      );
    });

    it('should record analytics when analyticsService is set', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({ _key: 'q1', isAnswered: true });
      await queryService.finalizeStreamQuery('q1', 'text', 100, {});
      expect(mockAnalyticsService.recordQuery).toHaveBeenCalled();
    });

    it('should continue if analytics recording fails', async () => {
      mockAnalyticsService.recordQuery.mockRejectedValueOnce(new Error('analytics fail'));
      await queryService.finalizeStreamQuery('q1', 'text', 100, {});
      expect(mockQueriesCollection.update).toHaveBeenCalled();
    });
  });

  describe('getSimilarQueries', () => {
    it('should return empty array on DB error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB fail'));
      const result = await queryService.getSimilarQueries('tax rate');
      expect(result).toEqual([]);
    });
  });
});
