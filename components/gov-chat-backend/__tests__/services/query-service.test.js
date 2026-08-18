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
jest.mock('../../shared-lib/validation-utils', () => require('../mocks/shared-lib'), { virtual: true });

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
      mockDb.query.mockRejectedValueOnce(new Error('edge error')).mockResolvedValueOnce(createMockCursor([]));
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
      await expect(queryService.updateQueryResponseTime('query-1', -1)).rejects.toThrow('Invalid response time');
    });

    it('should throw on non-number responseTime', async () => {
      await expect(queryService.updateQueryResponseTime('query-1', 'fast')).rejects.toThrow('Invalid response time');
    });
  });

  describe('searchQueries', () => {
    it('should return paginated results with no filters', async () => {
      const mockResults = [{ _key: 'q1', text: 'query 1' }];
      mockDb.query.mockResolvedValueOnce(createMockCursor(mockResults)).mockResolvedValueOnce(createMockCursor([1]));
      const result = await queryService.searchQueries({}, 10, 0);
      expect(result.queries).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter by userId', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({ userId: 'user-1' });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should filter by text, categoryId, and isAnswered', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({
        text: 'tax',
        categoryId: 'cat-1',
        isAnswered: true
      });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should calculate pagination correctly', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([25]));
      const result = await queryService.searchQueries({}, 10, 0);
      expect(result.pagination.pages).toBe(3);
      expect(result.pagination.currentPage).toBe(1);
    });

    // DW-134: totalCount=0 → pages=0, currentPage=1, empty results
    it('should handle totalCount=0 with pages=0', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      const result = await queryService.searchQueries({}, 10, 0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.pages).toBe(0);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.queries).toEqual([]);
    });

    // DW-134: totalCount=limit → pages=1 (exact boundary)
    it('should handle totalCount equal to limit with pages=1', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([10]));
      const result = await queryService.searchQueries({}, 10, 0);
      expect(result.pagination.total).toBe(10);
      expect(result.pagination.pages).toBe(1);
      expect(result.pagination.currentPage).toBe(1);
    });

    // DW-134: offset beyond totalCount → empty results
    it('should return empty results when offset exceeds totalCount', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([5]));
      const result = await queryService.searchQueries({}, 10, 100);
      expect(result.queries).toEqual([]);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.currentPage).toBe(11); // floor(100/10) + 1
    });

    // DW-134: limit=1 → pages=totalCount
    it('should return pages=totalCount when limit=1', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([7]));
      const result = await queryService.searchQueries({}, 1, 0);
      expect(result.pagination.total).toBe(7);
      expect(result.pagination.pages).toBe(7);
      expect(result.pagination.limit).toBe(1);
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
      mockDb.query.mockResolvedValueOnce(createMockCursor([{ _key: 'edge-1', _from: 'queries/query-1' }]));
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

    it('should throw when query does not exist', async () => {
      const notFoundError = new Error('document not found');
      notFoundError.code = 404;
      mockQueriesCollection.update.mockRejectedValueOnce(notFoundError);
      await expect(queryService.setQueryCategory('nonexistent', 'cat-1')).rejects.toThrow('document not found');
      expect(mockQueryCategoriesCollection.save).not.toHaveBeenCalled();
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

    it('should parse chatqna metadata JSON event', () => {
      const meta = {
        type: 'metadata',
        source_documents: [{ document_id: 'f1', score: 0.95 }],
        confidence_score: 0.9,
        is_grounded: true
      };
      const result = queryService.parseChatQnASSELine(JSON.stringify(meta));
      expect(result.type).toBe('metadata');
      expect(result.is_grounded).toBe(true);
      expect(result.confidence_score).toBe(0.9);
      expect(result.source_documents).toHaveLength(1);
      // Retrieval/self confidence default to null when chatqna omits them
      // (feature off or pre-feature queries).
      expect(result.retrieval_confidence_score).toBeNull();
      expect(result.self_confidence).toBeNull();
    });

    it('should pass through retrieval_confidence_score and self_confidence', () => {
      const meta = {
        type: 'metadata',
        source_documents: [],
        // Citizen-facing value (LLM self-grade when feature on, fallback retrieval).
        confidence_score: 0.82,
        retrieval_confidence_score: 0.91,
        self_confidence: 0.82,
        is_grounded: true
      };
      const result = queryService.parseChatQnASSELine(JSON.stringify(meta));
      expect(result.confidence_score).toBe(0.82);
      expect(result.retrieval_confidence_score).toBe(0.91);
      expect(result.self_confidence).toBe(0.82);
    });

    it('should preserve explicit null self_confidence (sentinel missing)', () => {
      const meta = {
        type: 'metadata',
        source_documents: [],
        confidence_score: 0.5,
        retrieval_confidence_score: 0.5,
        self_confidence: null,
        is_grounded: true
      };
      const result = queryService.parseChatQnASSELine(JSON.stringify(meta));
      // hasOwnProperty guard: explicit null must round-trip as null, not be dropped.
      expect(result.self_confidence).toBeNull();
      expect(result.retrieval_confidence_score).toBe(0.5);
    });

    it('should treat non-metadata JSON object as error', () => {
      // A JSON object without type:metadata must not be mistaken for metadata.
      const result = queryService.parseChatQnASSELine(JSON.stringify({ type: 'chunk', content: 'x' }));
      expect(result.type).toBe('error');
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

    it('should preserve null categoryLabel (no "General" default) when categoryLabel is null', async () => {
      const data = createMockQueryData({ context: { categoryLabel: null, serviceLabels: ['Tomato'] } });
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.opeaPayload.context.categoryLabel).toBeNull();
      expect(result.opeaPayload.context.serviceLabels).toEqual(['Tomato']);
    });

    it('should default missing context to null categoryLabel (not "General")', async () => {
      const data = createMockQueryData({ context: undefined });
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.opeaPayload.context.categoryLabel).toBeNull();
    });

    it('should pass through a valid categoryLabel unchanged', async () => {
      const data = createMockQueryData({ context: { categoryLabel: 'Crops', serviceLabels: [] } });
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.opeaPayload.context.categoryLabel).toBe('Crops');
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

  describe('saveQueryWithCriteria', () => {
    it('should save query with criteria and metadata', async () => {
      const queryData = {
        userId: 'user-1',
        text: 'test query',
        categoryId: 'cat-1',
        serviceId: 'svc-1',
        criteria: 'tax payment',
        tags: ['urgent', 'financial'],
        name: 'Tax Query',
        description: 'Important tax question'
      };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'saved-1' });
      const result = await queryService.saveQueryWithCriteria(queryData);
      expect(mockQueriesCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          text: 'test query',
          categoryId: 'cat-1',
          serviceId: 'svc-1',
          metadata: {
            criteria: 'tax payment',
            tags: ['urgent', 'financial'],
            isSaved: true,
            name: 'Tax Query',
            description: 'Important tax question'
          }
        })
      );
      expect(result._key).toBe('saved-1');
    });

    it('should throw when userId is missing', async () => {
      const queryData = { text: 'test' };
      await expect(queryService.saveQueryWithCriteria(queryData)).rejects.toThrow('Missing required query data');
    });

    it('should throw when text is missing', async () => {
      const queryData = { userId: 'user-1' };
      await expect(queryService.saveQueryWithCriteria(queryData)).rejects.toThrow('Missing required query data');
    });

    it('should use default values for optional fields', async () => {
      const queryData = {
        userId: 'user-1',
        text: 'test query'
      };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'saved-2' });
      await queryService.saveQueryWithCriteria(queryData);
      expect(mockQueriesCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            criteria: '',
            tags: [],
            isSaved: true,
            name: expect.stringContaining('Query'),
            description: ''
          }
        })
      );
    });

    it('should handle non-array tags by defaulting to empty array', async () => {
      const queryData = {
        userId: 'user-1',
        text: 'test query',
        tags: 'invalid-tag'
      };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'saved-3' });
      await queryService.saveQueryWithCriteria(queryData);
      expect(mockQueriesCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            tags: []
          })
        })
      );
    });
  });

  describe('getSavedQueries', () => {
    it('should return saved queries with pagination', async () => {
      const mockQueries = [
        { _key: 'q1', text: 'query 1', metadata: { isSaved: true } },
        { _key: 'q2', text: 'query 2', metadata: { isSaved: true } }
      ];
      mockDb.query.mockResolvedValueOnce(createMockCursor(mockQueries)).mockResolvedValueOnce(createMockCursor([2]));
      const result = await queryService.getSavedQueries('user-1', 10, 0);
      expect(result.queries).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter by userId and isSaved flag', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.getSavedQueries('user-1');
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should handle pagination correctly', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([25]));
      const result = await queryService.getSavedQueries('user-1', 10, 10);
      expect(result.pagination.pages).toBe(3);
      expect(result.pagination.currentPage).toBe(2);
    });

    it('should propagate DB errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB error'));
      await expect(queryService.getSavedQueries('user-1')).rejects.toThrow('DB error');
    });
  });

  describe('getQueryRecommendations', () => {
    it('should return recommendations based on user history', async () => {
      const recentQueries = [
        { _key: 'q1', text: 'query 1', categoryId: 'cat-1', serviceId: 'svc-1' },
        { _key: 'q2', text: 'query 2', categoryId: 'cat-2', serviceId: 'svc-2' }
      ];
      const recommendations = ['rec1', 'rec2', 'rec3'];
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(recentQueries))
        .mockResolvedValueOnce(createMockCursor(recommendations));
      const result = await queryService.getQueryRecommendations('user-1', 5);
      expect(result).toEqual(recommendations);
    });

    it('should fall back to popular queries when no recent queries exist', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const popularQueries = [
        { text: 'popular 1', count: 10 },
        { text: 'popular 2', count: 8 }
      ];
      mockDb.query.mockResolvedValueOnce(createMockCursor(popularQueries));
      const result = await queryService.getQueryRecommendations('user-1', 5);
      expect(result).toEqual(['popular 1', 'popular 2']);
    });

    it('should fall back to popular queries on error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB error'));
      const popularQueries = [{ text: 'popular 1', count: 10 }];
      mockDb.query.mockResolvedValueOnce(createMockCursor(popularQueries));
      const result = await queryService.getQueryRecommendations('user-1', 5);
      expect(result).toEqual(['popular 1']);
    });

    it('should combine popular queries when insufficient recommendations', async () => {
      const recentQueries = [{ _key: 'q1', text: 'query 1', categoryId: 'cat-1' }];
      const recommendations = ['rec1'];
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(recentQueries))
        .mockResolvedValueOnce(createMockCursor(recommendations));
      const popularQueries = [
        { text: 'popular 1', count: 10 },
        { text: 'popular 2', count: 8 }
      ];
      mockDb.query.mockResolvedValueOnce(createMockCursor(popularQueries));
      const result = await queryService.getQueryRecommendations('user-1', 5);
      expect(result.length).toBe(3);
      expect(result).toContain('rec1');
      expect(result).toContain('popular 1');
      expect(result).toContain('popular 2');
    });
  });

  describe('getPopularQueries', () => {
    it('should return popular queries grouped by text', async () => {
      const popularQueries = [
        { text: 'tax payment', count: 15 },
        { text: 'national id', count: 12 },
        { text: 'business license', count: 8 }
      ];
      mockDb.query.mockResolvedValueOnce(createMockCursor(popularQueries));
      const result = await queryService.getPopularQueries(5);
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('tax payment');
      expect(result[0].count).toBe(15);
    });

    it('should return empty array on error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB error'));
      const result = await queryService.getPopularQueries(5);
      expect(result).toEqual([]);
    });

    it('should respect the limit parameter', async () => {
      const popularQueries = [
        { text: 'query 1', count: 10 },
        { text: 'query 2', count: 8 }
      ];
      mockDb.query.mockResolvedValueOnce(createMockCursor(popularQueries));
      const result = await queryService.getPopularQueries(2);
      expect(result).toHaveLength(2);
    });
  });

  describe('createConversationFromQuery', () => {
    beforeEach(() => {
      queryService.chatHistoryService = {
        createConversationFromQuery: jest.fn().mockResolvedValue({
          conversation: { _key: 'conv-1' }
        })
      };
    });

    it('should create conversation from query', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'query-1',
        text: 'test query',
        userId: 'user-1'
      });
      const result = await queryService.createConversationFromQuery('query-1', {
        title: 'Custom Title',
        responseText: 'Response',
        tags: ['tag1']
      });
      expect(queryService.chatHistoryService.createConversationFromQuery).toHaveBeenCalledWith('query-1', 'user-1', {
        title: 'Custom Title',
        responseText: 'Response',
        tags: ['tag1']
      });
      expect(result.conversation._key).toBe('conv-1');
    });

    it('should use query text as default title', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'query-1',
        text: 'test query',
        userId: 'user-1'
      });
      await queryService.createConversationFromQuery('query-1');
      expect(queryService.chatHistoryService.createConversationFromQuery).toHaveBeenCalledWith(
        'query-1',
        'user-1',
        expect.objectContaining({
          title: 'test query',
          tags: []
        })
      );
    });

    it('should throw when chatHistoryService is not set', async () => {
      queryService.chatHistoryService = null;
      await expect(queryService.createConversationFromQuery('query-1')).rejects.toThrow(
        'Chat history service is not set'
      );
    });

    it('should throw NotFoundError when query does not exist', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce(null);
      await expect(queryService.createConversationFromQuery('invalid')).rejects.toThrow('Query not found');
    });
  });

  describe('getConversationsForQuery', () => {
    beforeEach(() => {
      queryService.chatHistoryService = {
        findMessagesForQuery: jest.fn().mockResolvedValue([
          {
            conversation: { _key: 'conv-1', title: 'Conversation 1' },
            message: { _key: 'msg-1', content: 'Message 1' }
          },
          {
            conversation: { _key: 'conv-1', title: 'Conversation 1' },
            message: { _key: 'msg-2', content: 'Message 2' }
          },
          {
            conversation: { _key: 'conv-2', title: 'Conversation 2' },
            message: { _key: 'msg-3', content: 'Message 3' }
          }
        ])
      };
    });

    it('should return conversations grouped with messages', async () => {
      const result = await queryService.getConversationsForQuery('query-1', 'user-1');
      expect(result).toHaveLength(2);
      expect(result[0].conversation._key).toBe('conv-1');
      expect(result[0].messages).toHaveLength(2);
      expect(result[1].conversation._key).toBe('conv-2');
      expect(result[1].messages).toHaveLength(1);
      expect(queryService.chatHistoryService.findMessagesForQuery).toHaveBeenCalledWith('query-1', 'user-1');
    });

    it('should return empty array when query not found', async () => {
      queryService.chatHistoryService.findMessagesForQuery.mockResolvedValue(null);
      const result = await queryService.getConversationsForQuery('missing', 'user-1');
      expect(result).toEqual([]);
    });

    it('should throw Access denied when caller does not own the query', async () => {
      queryService.chatHistoryService.findMessagesForQuery.mockResolvedValue({ forbidden: true });
      await expect(queryService.getConversationsForQuery('query-1', 'other-user')).rejects.toThrow('Access denied');
    });

    it('should throw when chatHistoryService is not set', async () => {
      queryService.chatHistoryService = null;
      await expect(queryService.getConversationsForQuery('query-1')).rejects.toThrow('Chat history service is not set');
    });

    it('should handle empty results', async () => {
      queryService.chatHistoryService.findMessagesForQuery.mockResolvedValueOnce([]);
      const result = await queryService.getConversationsForQuery('query-1', 'user-1');
      expect(result).toEqual([]);
    });

    it('should handle items without messages', async () => {
      queryService.chatHistoryService.findMessagesForQuery.mockResolvedValueOnce([
        {
          conversation: { _key: 'conv-1', title: 'Conversation 1' },
          message: null
        }
      ]);
      const result = await queryService.getConversationsForQuery('query-1', 'user-1');
      expect(result[0].messages).toHaveLength(0);
    });
  });

  describe('markQueryAsAnswered', () => {
    it('should mark query as answered with response time', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        _key: 'query-1',
        isAnswered: true,
        responseTime: 500
      });
      const result = await queryService.markQueryAsAnswered('query-1', 500);
      expect(mockQueriesCollection.update).toHaveBeenCalledWith(
        'query-1',
        expect.objectContaining({
          isAnswered: true,
          responseTime: 500,
          updatedAt: expect.any(String)
        })
      );
      expect(result.isAnswered).toBe(true);
      expect(result.responseTime).toBe(500);
    });

    it('should throw on invalid query ID', async () => {
      await expect(queryService.markQueryAsAnswered('', 100)).rejects.toThrow('Invalid query ID provided');
      await expect(queryService.markQueryAsAnswered('undefined', 100)).rejects.toThrow('Invalid query ID provided');
    });

    it('should throw NotFoundError when query does not exist', async () => {
      const error = new Error('document not found');
      error.name = 'ArangoError';
      error.errorNum = 1202;
      mockQueriesCollection.update.mockRejectedValueOnce(error);
      await expect(queryService.markQueryAsAnswered('invalid', 100)).rejects.toThrow('Query not found');
    });

    it('should propagate other errors', async () => {
      mockQueriesCollection.update.mockRejectedValueOnce(new Error('DB error'));
      await expect(queryService.markQueryAsAnswered('query-1', 100)).rejects.toThrow('DB error');
    });
  });

  describe('linkQueryToMessage', () => {
    beforeEach(() => {
      queryService.chatHistoryService = {
        linkQueryToConversation: jest.fn().mockResolvedValue({
          _key: 'link-1',
          queryId: 'query-1',
          conversationId: 'conv-1'
        })
      };
    });

    it('should link query to message', async () => {
      mockDb.query.mockResolvedValueOnce(
        createMockCursor([
          {
            _key: 'msg-1',
            conversationId: 'conv-1'
          }
        ])
      );
      const result = await queryService.linkQueryToMessage('query-1', 'msg-1', {
        responseType: 'primary',
        confidenceScore: 0.95
      });
      expect(queryService.chatHistoryService.linkQueryToConversation).toHaveBeenCalledWith(
        'query-1',
        'conv-1',
        'msg-1',
        {
          responseType: 'primary',
          confidenceScore: 0.95
        }
      );
      expect(result._key).toBe('link-1');
    });

    it('should use default options when not provided', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([{ _key: 'msg-1', conversationId: 'conv-1' }]));
      await queryService.linkQueryToMessage('query-1', 'msg-1');
      expect(queryService.chatHistoryService.linkQueryToConversation).toHaveBeenCalledWith(
        'query-1',
        'conv-1',
        'msg-1',
        {
          responseType: 'primary',
          confidenceScore: 1.0
        }
      );
    });

    it('should throw when chatHistoryService is not set', async () => {
      queryService.chatHistoryService = null;
      await expect(queryService.linkQueryToMessage('query-1', 'msg-1')).rejects.toThrow(
        'Chat history service is not set'
      );
    });

    it('should throw NotFoundError when message does not exist', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      await expect(queryService.linkQueryToMessage('query-1', 'invalid')).rejects.toThrow('Message not found');
    });
  });

  describe('searchQueries - additional filters', () => {
    it('should filter by serviceId', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({ serviceId: 'svc-1' });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple filters combined', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({
        userId: 'user-1',
        categoryId: 'cat-1',
        serviceId: 'svc-1',
        isAnswered: false
      });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should handle empty filter object', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({});
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should validate pagination parameters', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      await queryService.searchQueries({}, -1, 0);
      expect(mockDb.query).toHaveBeenCalled();
    });
  });

  describe('searchQueries - error paths', () => {
    it('should handle database connection errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Connection lost'));
      await expect(queryService.searchQueries({})).rejects.toThrow('Connection lost');
    });

    it('should handle malformed filter values', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([0]));
      const result = await queryService.searchQueries({ isAnswered: 'not-a-boolean' });
      expect(result).toBeDefined();
    });
  });

  describe('getSimilarQueries - error paths', () => {
    it('should handle empty query text', async () => {
      const result = await queryService.getSimilarQueries('');
      expect(result).toEqual([]);
    });

    it('should handle very short query text', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await queryService.getSimilarQueries('a');
      expect(result).toEqual([]);
    });

    it('should handle special characters in query', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await queryService.getSimilarQueries('tax @#$% rate');
      expect(result).toEqual([]);
    });

    it('should handle null query text', async () => {
      const result = await queryService.getSimilarQueries(null);
      expect(result).toEqual([]);
    });
  });

  describe('createQuery - additional validation', () => {
    it('should handle missing messages array', async () => {
      const data = {
        userId: 'u1',
        sessionId: 's1',
        context: { categoryLabel: 'General', serviceLabels: [] }
      };
      await expect(queryService.createQuery(data)).rejects.toThrow('Missing required query data');
    });

    it('should handle empty messages array', async () => {
      const data = {
        userId: 'u1',
        sessionId: 's1',
        messages: [],
        context: { categoryLabel: 'General', serviceLabels: [] }
      };
      await expect(queryService.createQuery(data)).rejects.toThrow('Missing required query data');
    });
  });

  describe('initStreamQuery - additional validation', () => {
    it('should handle empty messages array', async () => {
      const data = { userId: 'u1', sessionId: 's1', messages: [] };
      await expect(queryService.initStreamQuery(data, {})).rejects.toThrow('Missing required query data');
    });

    it('should handle missing context', async () => {
      const data = { userId: 'u1', sessionId: 's1', messages: [{ role: 'user', content: 'test' }] };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result).toBeDefined();
    });

    it('should handle categoryId resolution failure', async () => {
      const data = createMockQueryData();
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([])) // No category found
        .mockResolvedValueOnce(createMockCursor([])); // No service found
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });
  });

  describe('finalizeStreamQuery - error paths', () => {
    it('should handle database update errors', async () => {
      mockQueriesCollection.update.mockRejectedValueOnce(new Error('Update failed'));
      await expect(queryService.finalizeStreamQuery('q1', 'text', 100, {})).rejects.toThrow('Update failed');
    });

    it('should handle negative responseTime', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({ new: { _key: 'q1' } });
      await queryService.finalizeStreamQuery('q1', 'text', -100, {});
      expect(mockQueriesCollection.update).toHaveBeenCalled();
    });

    it('should handle empty metadata', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({ new: { _key: 'q1' } });
      await queryService.finalizeStreamQuery('q1', 'text', 100, null);
      expect(mockQueriesCollection.update).toHaveBeenCalled();
    });
  });

  describe('setQueryCategory - edge cases', () => {
    it('should handle removing category (null categoryId)', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: null }
      });
      const result = await queryService.setQueryCategory('query-1', null);
      expect(result.categoryId).toBeNull();
    });

    it('should handle invalid categoryId format', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: 'invalid-format' }
      });
      const result = await queryService.setQueryCategory('query-1', 'invalid-format');
      expect(result.categoryId).toBe('invalid-format');
    });

    it('should handle concurrent edge updates', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', categoryId: 'cat-1' }
      });
      mockDb.query.mockRejectedValueOnce(new Error('Concurrent update')).mockResolvedValueOnce(createMockCursor([]));
      const result = await queryService.setQueryCategory('query-1', 'cat-1');
      expect(result.categoryId).toBe('cat-1');
    });
  });

  describe('deleteQuery - edge cases', () => {
    it('should handle query with no edges', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await queryService.deleteQuery('query-1');
      expect(result).toBeDefined();
    });

    it('should handle multiple edges', async () => {
      const edges = [
        { _key: 'edge-1', _from: 'queries/query-1' },
        { _key: 'edge-2', _from: 'queries/query-1' }
      ];
      mockDb.query.mockResolvedValueOnce(createMockCursor(edges));
      const result = await queryService.deleteQuery('query-1');
      expect(result).toBeDefined();
    });

    it('should handle database errors during deletion', async () => {
      mockQueriesCollection.remove.mockRejectedValueOnce(new Error('Delete failed'));
      await expect(queryService.deleteQuery('query-1')).rejects.toThrow('Delete failed');
    });
  });

  describe('addFeedback - edge cases', () => {
    it('should handle feedback with minimal data', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', userFeedback: { rating: 1 } }
      });
      const result = await queryService.addFeedback('query-1', { rating: 1 });
      expect(result.userFeedback.rating).toBe(1);
    });

    it('should handle maximum rating', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', userFeedback: { rating: 5 } }
      });
      const result = await queryService.addFeedback('query-1', { rating: 5, comment: 'Perfect!' });
      expect(result.userFeedback.rating).toBe(5);
    });

    it('should handle rating out of range', async () => {
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', userFeedback: { rating: 10 } }
      });
      const result = await queryService.addFeedback('query-1', { rating: 10 });
      expect(result.userFeedback.rating).toBe(10);
    });

    it('should handle update errors', async () => {
      mockQueriesCollection.update.mockRejectedValueOnce(new Error('Update failed'));
      await expect(queryService.addFeedback('query-1', { rating: 5 })).rejects.toThrow('Update failed');
    });

    it('should skip analytics when analyticsService is not set', async () => {
      queryService.setAnalyticsService(null);
      mockQueriesCollection.update.mockResolvedValueOnce({
        new: { _key: 'query-1', userFeedback: { rating: 3 } }
      });
      const result = await queryService.addFeedback('query-1', { rating: 3 });
      expect(result.userFeedback.rating).toBe(3);
      queryService.setAnalyticsService(mockAnalyticsService);
    });
  });

  describe('initStreamQuery - context branches', () => {
    it('should use text field when messages array is empty', async () => {
      const data = { userId: 'u1', sessionId: 's1', text: 'hello from text' };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });

    it('should default serviceLabels to empty array when not an array', async () => {
      const data = {
        userId: 'u1',
        sessionId: 's1',
        messages: [{ role: 'user', content: 'test' }],
        context: { categoryLabel: 'General', serviceLabels: 'not-an-array' }
      };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });

    it('should default categoryLabel to General when missing', async () => {
      const data = {
        userId: 'u1',
        sessionId: 's1',
        messages: [{ role: 'user', content: 'test' }],
        context: { serviceLabels: [] }
      };
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });

    it('should handle category resolution error gracefully', async () => {
      const data = createMockQueryData();
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      mockDb.query
        .mockRejectedValueOnce(new Error('Category lookup failed'))
        .mockResolvedValueOnce(createMockCursor([]));
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });

    it('should handle service resolution error gracefully', async () => {
      const data = createMockQueryData();
      mockQueriesCollection.save.mockResolvedValueOnce({ _key: 'stream-1' });
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockRejectedValueOnce(new Error('Service lookup failed'));
      const result = await queryService.initStreamQuery(data, {});
      expect(result.queryId).toBe('stream-1');
    });
  });

  describe('getSimilarQueries - success path', () => {
    it('should return similar queries with DB results', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ _key: 'q1', text: 'tax rate', similarity: 0.95 }]));
      const result = await queryService.getSimilarQueries('tax payment');
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('tax rate');
    });

    it('should return empty array when query text has only stop words', async () => {
      const result = await queryService.getSimilarQueries('the a an is are');
      expect(result).toEqual([]);
    });
  });
});
