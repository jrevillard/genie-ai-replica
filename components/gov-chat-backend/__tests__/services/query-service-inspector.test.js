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
    update: jest.fn().mockResolvedValue({ _key: 'query-1' }),
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

let queryService;
let mockDb;
let mockQueriesCollection;

beforeEach(() => {
  jest.clearAllMocks();

  mockQueriesCollection = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      if (name === 'queries') return mockQueriesCollection;
      return createMockCollection();
    }),
    query: jest.fn()
  };

  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    queryService = require('../../services/query-service');
  });

  queryService.initialized = false;
});

describe('QueryService — Inspector methods', () => {
  beforeEach(async () => {
    await queryService.init();
  });

  describe('getQueriesForInspector', () => {
    const mockQueryResults = [
      {
        _key: 'q1',
        userId: 'user-1',
        timestamp: '2025-05-28T10:00:00Z',
        text: 'What is the tax rate?',
        response: 'The tax rate is 30%',
        responseTime: 500,
        context: { categoryLabel: 'Taxes', serviceLabels: ['Tax Payment'] },
        metadata: { confidence_score: 0.92, source_documents: [{ document_id: 'doc-1' }] },
        userFeedback: { rating: 5, comment: 'Great' },
        contextOption: 'single-message'
      }
    ];

    it('should return paginated queries with default options', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(mockQueryResults))
        .mockResolvedValueOnce(createMockCursor([1]));

      const result = await queryService.getQueriesForInspector();

      expect(result.success).toBe(true);
      expect(result.data.queries).toHaveLength(1);
      expect(result.data.queries[0]._key).toBe('q1');
      expect(result.data.pagination).toEqual({
        total: 1,
        limit: 50,
        offset: 0,
        pages: 1,
        currentPage: 1
      });
    });

    it('should respect custom limit and offset', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(mockQueryResults))
        .mockResolvedValueOnce(createMockCursor([25]));

      const result = await queryService.getQueriesForInspector({ limit: '10', offset: '20' });

      expect(result.data.pagination.limit).toBe(10);
      expect(result.data.pagination.offset).toBe(20);
      expect(result.data.pagination.currentPage).toBe(3);
    });

    it('should default limit to 50 when not provided', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      const result = await queryService.getQueriesForInspector();

      expect(result.data.pagination.limit).toBe(50);
    });

    it('should filter by userId', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      await queryService.getQueriesForInspector({ userId: 'user-1' });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should filter by date range', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      await queryService.getQueriesForInspector({
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should filter by confidence range', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      await queryService.getQueriesForInspector({
        minConfidence: '0.5',
        maxConfidence: '0.9'
      });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should skip empty confidence filters', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      await queryService.getQueriesForInspector({
        minConfidence: '',
        maxConfidence: undefined
      });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should filter by searchText', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      await queryService.getQueriesForInspector({ searchText: 'tax' });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should calculate pagination correctly for multiple pages', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor(mockQueryResults))
        .mockResolvedValueOnce(createMockCursor([75]));

      const result = await queryService.getQueriesForInspector({ limit: '25' });

      expect(result.data.pagination.pages).toBe(3);
      expect(result.data.pagination.total).toBe(75);
    });

    it('should handle zero results', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      const result = await queryService.getQueriesForInspector();

      expect(result.data.queries).toEqual([]);
      expect(result.data.pagination.total).toBe(0);
      expect(result.data.pagination.pages).toBe(0);
    });

    it('should handle null count from DB', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([null]));

      const result = await queryService.getQueriesForInspector();

      expect(result.data.pagination.total).toBe(0);
    });

    it('should throw and log on DB error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(queryService.getQueriesForInspector()).rejects.toThrow('DB connection lost');

      const { logger } = require('../../shared-lib');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('get_queries_for_inspector_failed'),
        expect.any(Object)
      );
    });

    it('should apply all filters combined', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([0]));

      await queryService.getQueriesForInspector({
        userId: 'user-1',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        minConfidence: '0.5',
        maxConfidence: '1.0',
        searchText: 'tax'
      });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('getQueryInspectorDetails', () => {
    it('should return full query document with userName resolved', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'q1',
        userId: 'user-1',
        text: 'What is the tax rate?',
        response: 'The tax rate is 30%',
        messages: [{ role: 'user', content: 'What is the tax rate?' }],
        context: { categoryLabel: 'Taxes' },
        metadata: { confidence_score: 0.92 }
      });

      mockDb.query.mockResolvedValueOnce(createMockCursor([{ fullName: 'John Doe', email: 'john@example.com' }]));

      const result = await queryService.getQueryInspectorDetails('q1');

      expect(result.success).toBe(true);
      expect(result.data._key).toBe('q1');
      expect(result.data.userName).toBe('John Doe');
      expect(result.data.text).toBe('What is the tax rate?');
    });

    it('should fall back to email when fullName is null', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'q2',
        userId: 'user-2',
        text: 'test'
      });

      mockDb.query.mockResolvedValueOnce(createMockCursor([{ fullName: null, email: 'jane@example.com' }]));

      const result = await queryService.getQueryInspectorDetails('q2');

      expect(result.data.userName).toBe('jane@example.com');
    });

    it('should set userName to null when user not found', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'q3',
        userId: 'user-999',
        text: 'test'
      });

      mockDb.query.mockResolvedValueOnce(createMockCursor([null]));

      const result = await queryService.getQueryInspectorDetails('q3');

      expect(result.data.userName).toBeNull();
    });

    it('should set userName to null when userId is missing', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'q4',
        text: 'anonymous query'
      });

      const result = await queryService.getQueryInspectorDetails('q4');

      expect(result.data.userName).toBeNull();
    });

    it('should handle user lookup failure gracefully', async () => {
      mockQueriesCollection.document.mockResolvedValueOnce({
        _key: 'q5',
        userId: 'user-1',
        text: 'test'
      });

      mockDb.query.mockRejectedValueOnce(new Error('users collection not found'));

      const result = await queryService.getQueryInspectorDetails('q5');

      expect(result.success).toBe(true);
      expect(result.data.userName).toBeNull();

      const { logger } = require('../../shared-lib');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('user_lookup_failed'),
        expect.any(Object)
      );
    });

    it('should throw on document not found', async () => {
      mockQueriesCollection.document.mockRejectedValueOnce(new Error('document not found'));

      await expect(queryService.getQueryInspectorDetails('nonexistent')).rejects.toThrow('document not found');

      const { logger } = require('../../shared-lib');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('get_query_inspector_details_failed'),
        expect.any(Object)
      );
    });

    it('should handle ArangoDB error code 1202', async () => {
      const error = new Error('document not found');
      error.errorNum = 1202;
      mockQueriesCollection.document.mockRejectedValueOnce(error);

      await expect(queryService.getQueryInspectorDetails('bad-id')).rejects.toThrow('document not found');
    });
  });
});
