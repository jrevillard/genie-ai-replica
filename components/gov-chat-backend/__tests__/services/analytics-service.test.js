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

jest.mock('../../services/service-category-service', () => ({
  init: jest.fn().mockResolvedValue(undefined),
  getAllCategoriesWithServices: jest.fn().mockResolvedValue([]),
  getCategoryTranslations: jest.fn().mockResolvedValue([])
}));

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'analytics-1' }),
    update: jest.fn(),
    document: jest.fn(),
    remove: jest.fn(),
    ensureIndex: jest.fn()
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

let analyticsService;
let mockDb;
let mockAnalytics;
let mockEvents;
let mockQueries;
let mockUsers;
let mockSessions;
let mockServiceCategories;

beforeEach(() => {
  jest.clearAllMocks();

  mockAnalytics = createMockCollection();
  mockEvents = createMockCollection();
  mockQueries = createMockCollection();
  mockUsers = createMockCollection();
  mockSessions = createMockCollection();
  mockServiceCategories = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      const map = {
        analytics: mockAnalytics,
        events: mockEvents,
        queries: mockQueries,
        users: mockUsers,
        sessions: mockSessions,
        serviceCategories: mockServiceCategories
      };
      return map[name] || createMockCollection();
    }),
    query: jest.fn()
  };

  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    analyticsService = require('../../services/analytics-service');
  });
  analyticsService.initialized = false;
});

describe('AnalyticsService', () => {
  beforeEach(async () => {
    await analyticsService.init();
  });

  describe('init', () => {
    it('should initialize all collections', async () => {
      expect(mockDb.collection).toHaveBeenCalledWith('analytics');
      expect(mockDb.collection).toHaveBeenCalledWith('events');
      expect(mockDb.collection).toHaveBeenCalledWith('queries');
      expect(mockDb.collection).toHaveBeenCalledWith('users');
      expect(mockDb.collection).toHaveBeenCalledWith('sessions');
      expect(mockDb.collection).toHaveBeenCalledWith('serviceCategories');
      expect(analyticsService.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      analyticsService.initialized = true;
      await analyticsService.init();
      const { dbService: ds } = require('../../shared-lib');
      expect(ds.getConnection).toHaveBeenCalledTimes(1);
    });

    it('should throw on DB connection failure', async () => {
      const { dbService: ds } = require('../../shared-lib');
      ds.getConnection.mockRejectedValueOnce(new Error('DB down'));
      jest.isolateModules(() => {
        analyticsService = require('../../services/analytics-service');
      });
      analyticsService.initialized = false;
      await expect(analyticsService.init()).rejects.toThrow('DB down');
    });
  });

  describe('recordQuery', () => {
    it('should save analytics record for a query', async () => {
      const queryDoc = { _key: 'q1', userId: 'u1', text: 'tax', responseTime: 500, isAnswered: true };
      const result = await analyticsService.recordQuery(queryDoc);
      expect(mockAnalytics.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'query', queryId: 'q1' }));
      expect(result).toBeDefined();
    });

    it('should throw on save failure', async () => {
      mockAnalytics.save.mockRejectedValueOnce(new Error('save fail'));
      await expect(analyticsService.recordQuery({ _key: 'q1' })).rejects.toThrow('save fail');
    });
  });

  describe('recordFeedback', () => {
    it('should save analytics record for feedback', async () => {
      const result = await analyticsService.recordFeedback('q1', { rating: 5 });
      expect(mockAnalytics.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'feedback', queryId: 'q1' }));
      expect(result).toBeDefined();
    });

    it('should throw on save failure', async () => {
      mockAnalytics.save.mockRejectedValueOnce(new Error('save fail'));
      await expect(analyticsService.recordFeedback('q1', {})).rejects.toThrow('save fail');
    });
  });

  describe('trackEvent', () => {
    it('should save event record', async () => {
      const result = await analyticsService.trackEvent('u1', 'page_view', { page: '/home' });
      expect(mockEvents.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', eventType: 'page_view' }));
      expect(result).toBeDefined();
    });

    it('should use empty eventData by default', async () => {
      const result = await analyticsService.trackEvent('u1', 'login');
      expect(mockEvents.save).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
      expect(result).toBeDefined();
    });

    it('should throw on save failure', async () => {
      mockEvents.save.mockRejectedValueOnce(new Error('save fail'));
      await expect(analyticsService.trackEvent('u1', 'login')).rejects.toThrow('save fail');
    });
  });

  describe('getUniqueUsersCount', () => {
    it('should return 0 on DB error (graceful degradation)', async () => {
      mockDb.query.mockRejectedValue(new Error('DB fail'));
      const result = await analyticsService.getUniqueUsersCount();
      expect(result).toBe(0);
    });

    it('should return count from query', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([42]));
      const result = await analyticsService.getUniqueUsersCount('2026-01-01', '2026-01-31');
      expect(result).toBe(42);
    });
  });

  describe('getDashboardAnalytics', () => {
    it('should return empty data on DB error (graceful degradation)', async () => {
      mockDb.query.mockRejectedValue(new Error('DB fail'));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.total).toBe(0);
      expect(result.feedback.total).toBe(0);
    });

    it('should return empty data when test query fails', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.total).toBe(0);
    });

    it('should handle ArangoDB-style category IDs (collection/key)', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([{ test: 'Connection is working' }])).mockResolvedValueOnce(
        createMockCursor([
          {
            queries: { total: 5, unanswered: 2, answeredPercentage: 60, avgResponseTime: 200 },
            categories: [
              { categoryId: 'serviceCategories/cat-123', count: 3, value: 3 },
              { categoryId: 'serviceCategories/cat-456', count: 2, value: 2 }
            ],
            feedback: {
              total: 0,
              positive: 0,
              neutral: 0,
              negative: 0,
              positivePercentage: 0,
              negativePercentage: 0
            },
            users: { activeCount: 2 },
            topQueries: []
          }
        ])
      );
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.categories[0].categoryId).toBe('serviceCategories/cat-123');
      expect(result.categories[0].name).toBe('Category cat-123');
      expect(result.categories[1].categoryId).toBe('serviceCategories/cat-456');
      expect(result.categories[1].name).toBe('Category cat-456');
    });
  });

  describe('getTimeSeriesData', () => {
    it('should return empty array on DB error', async () => {
      mockDb.query.mockRejectedValue(new Error('DB fail'));
      const result = await analyticsService.getTimeSeriesData('queries', 'daily');
      expect(result).toEqual([]);
    });

    it('should return empty array when no data found', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getTimeSeriesData('queries', 'daily');
      expect(result).toEqual([]);
    });
  });

  describe('getSatisfactionGaugeData', () => {
    it('should return default structure on DB error (graceful degradation)', async () => {
      mockDb.query.mockRejectedValue(new Error('DB fail'));
      const result = await analyticsService.getSatisfactionGaugeData('daily');
      expect(result.currentValue).toBe(0);
      expect(result.previousValue).toBe(0);
      expect(result.changePercentage).toBe(0);
      expect(result.target).toBe(85);
      expect(result.historicalData).toEqual([]);
    });
  });

  describe('getSatisfactionHeatmapData', () => {
    it('should not throw on DB error (graceful degradation)', async () => {
      mockDb.query.mockRejectedValue(new Error('DB fail'));
      const result = await analyticsService.getSatisfactionHeatmapData('daily');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getEmptyDashboardData', () => {
    it('should return correct empty structure', () => {
      const data = analyticsService.getEmptyDashboardData();
      expect(data).toEqual({
        queries: { total: 0, unanswered: 0, answeredPercentage: 0, avgResponseTime: 0 },
        categories: [],
        feedback: { total: 0, positive: 0, neutral: 0, negative: 0, positivePercentage: 0, negativePercentage: 0 },
        users: { activeCount: 0 },
        topQueries: []
      });
    });
  });

  describe('formatDateLabel', () => {
    it('should return empty string for null timestamp', () => {
      expect(analyticsService.formatDateLabel(null, 'daily')).toBe('');
    });

    it('should return raw string for invalid timestamp', () => {
      expect(analyticsService.formatDateLabel('not-a-date', 'daily')).toBe('not-a-date');
    });

    it('should format hourly interval', () => {
      const result = analyticsService.formatDateLabel('2026-01-15T14:30:00Z', 'hourly');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should format daily interval', () => {
      const result = analyticsService.formatDateLabel('2026-01-15T14:30:00Z', 'daily');
      expect(result).toMatch(/\w+/);
      expect(result).toMatch(/\d+/);
    });

    it('should format weekly interval', () => {
      const result = analyticsService.formatDateLabel('2026-01-15T14:30:00Z', 'weekly');
      expect(result).toContain('Week');
    });

    it('should format monthly interval', () => {
      const result = analyticsService.formatDateLabel('2026-01-15T14:30:00Z', 'monthly');
      expect(result).toBeDefined();
      expect(result).toContain('2026');
    });

    it('should use default format for unknown interval', () => {
      const result = analyticsService.formatDateLabel('2026-01-15T14:30:00Z', 'yearly');
      expect(result).toBeDefined();
    });

    it('should accept Date object directly', () => {
      const result = analyticsService.formatDateLabel(new Date('2026-01-15'), 'daily');
      expect(result).toBeDefined();
    });
  });

  describe('recordQuery - error paths', () => {
    it('should handle missing _key in queryDoc', async () => {
      const invalidQueryDoc = { userId: 'u1', text: 'test' };
      mockAnalytics.save.mockRejectedValueOnce(new Error('Missing _key'));
      await expect(analyticsService.recordQuery(invalidQueryDoc)).rejects.toThrow('Missing _key');
    });

    it('should handle missing userId', async () => {
      const queryDoc = { _key: 'q1', text: 'test' };
      const result = await analyticsService.recordQuery(queryDoc);
      expect(result).toBeDefined();
    });

    it('should use defaults for missing optional fields', async () => {
      const queryDoc = { _key: 'q1', userId: 'u1', sessionId: 's1' };
      const result = await analyticsService.recordQuery(queryDoc);
      expect(mockAnalytics.save).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            responseTime: 0,
            isAnswered: false
          })
        })
      );
    });
  });

  describe('recordFeedback - error paths', () => {
    it('should handle missing queryId', async () => {
      await expect(analyticsService.recordFeedback(null, { rating: 5 })).rejects.toThrow();
    });

    it('should handle empty feedback object', async () => {
      mockAnalytics.save.mockResolvedValueOnce({ _key: 'fb-1' });
      const result = await analyticsService.recordFeedback('q1', {});
      expect(result).toBeDefined();
    });

    it('should propagate database errors', async () => {
      mockAnalytics.save.mockRejectedValueOnce(new Error('Database connection lost'));
      await expect(analyticsService.recordFeedback('q1', { rating: 5 })).rejects.toThrow('Database connection lost');
    });
  });

  describe('trackEvent - error paths', () => {
    it('should handle missing eventName', async () => {
      mockEvents.save.mockRejectedValueOnce(new Error('Event name required'));
      await expect(analyticsService.trackEvent('u1', 's1', null, {})).rejects.toThrow();
    });

    it('should handle missing userId', async () => {
      mockEvents.save.mockResolvedValueOnce({ _key: 'evt-1' });
      const result = await analyticsService.trackEvent(null, 's1', 'click', { button: 'submit' });
      expect(result).toBeDefined();
    });

    it('should handle large metadata objects', async () => {
      const largeMetadata = { data: 'x'.repeat(10000) };
      mockEvents.save.mockResolvedValueOnce({ _key: 'evt-1' });
      const result = await analyticsService.trackEvent('u1', 's1', 'large_event', largeMetadata);
      expect(result).toBeDefined();
    });
  });

  describe('getDashboardAnalytics - date range boundaries', () => {
    it('should handle start date equal to end date', async () => {
      const sameDay = '2026-01-15';
      mockDb.query.mockResolvedValueOnce(createMockCursor([{ queries: { total: 5 } }])).mockResolvedValueOnce(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics(sameDay, sameDay);
      expect(result).toBeDefined();
    });

    it('should handle invalid date format', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics('invalid-date', '2026-01-15');
      expect(result).toBeDefined();
    });

    it('should handle very long date ranges', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics('2020-01-01', '2026-12-31');
      expect(result).toBeDefined();
    });

    it('should handle date ranges with no data', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics('2026-01-01', '2026-01-31');
      expect(result.queries.total).toBe(0);
      expect(result.feedback.total).toBe(0);
      expect(result.users.activeCount).toBe(0);
    });
  });

  describe('getDashboardAnalytics - zero-data aggregation', () => {
    it('should return zero counts when no analytics data exists', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.total).toBe(0);
      expect(result.queries.answered).toBe(0);
      expect(result.queries.unanswered).toBe(0);
      expect(result.feedback.total).toBe(0);
    });

    it('should calculate percentages correctly with zero total', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([{ queries: { total: 0 } }])).mockResolvedValueOnce(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.answeredPercentage).toBe(0);
    });
  });

  describe('getDashboardAnalytics - query validation', () => {
    it('should validate query parameters', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      await analyticsService.getDashboardAnalytics(null, null, 'invalid');
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should handle missing optional parameters', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result).toBeDefined();
    });
  });

  describe('getDashboardAnalytics - error paths', () => {
    it('should handle Arango query failure for total queries', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Query timeout'));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.total).toBe(0);
    });

    it('should handle Arango query failure for categories', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([{ queries: { total: 5 } }])).mockRejectedValueOnce(new Error('Category query failed'));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.categories).toEqual([]);
    });

    it('should handle ServiceCategoryService initialization failure', async () => {
      const { ServiceCategoryService } = require('../../services/service-category-service');
      ServiceCategoryService.init.mockRejectedValueOnce(new Error('Service category init failed'));
      analyticsService.initialized = false;
      await expect(analyticsService.init()).rejects.toThrow('Service category init failed');
    });

    it('should handle connection failure', async () => {
      const { dbService: ds } = require('../../shared-lib');
      ds.getConnection.mockRejectedValueOnce(new Error('Connection failed'));
      analyticsService.initialized = false;
      await expect(analyticsService.init()).rejects.toThrow('Connection failed');
    });
  });

  describe('formatDateLabel - edge cases', () => {
    it('should handle undefined timestamp', () => {
      const result = analyticsService.formatDateLabel(undefined, 'daily');
      expect(result).toBe('');
    });

    it('should handle very old dates', () => {
      const result = analyticsService.formatDateLabel('1970-01-01T00:00:00Z', 'daily');
      expect(result).toBeDefined();
    });

    it('should handle future dates', () => {
      const futureDate = '2099-12-31T23:59:59Z';
      const result = analyticsService.formatDateLabel(futureDate, 'daily');
      expect(result).toBeDefined();
    });

    it('should handle leap year dates', () => {
      const leapDate = '2024-02-29T12:00:00Z';
      const result = analyticsService.formatDateLabel(leapDate, 'daily');
      expect(result).toBeDefined();
    });
  });

  describe('getTimeSeriesData - error paths', () => {
    it('should handle invalid interval', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getTimeSeriesData('2026-01-01', '2026-01-31', 'invalid_interval');
      expect(result).toBeDefined();
    });

    it('should handle empty result set', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getTimeSeriesData('2026-01-01', '2026-01-31', 'daily');
      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB error'));
      const result = await analyticsService.getTimeSeriesData('2026-01-01', '2026-01-31', 'daily');
      expect(result).toEqual([]);
    });
  });

  describe('getUsageStats - error paths', () => {
    it('should handle missing userId parameter', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getUsageStats(null);
      expect(result).toBeDefined();
    });

    it('should handle empty user stats', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getUsageStats('nonexistent-user');
      expect(result.totalQueries).toBe(0);
    });

    it('should handle database connection errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Connection lost'));
      const result = await analyticsService.getUsageStats('user-1');
      expect(result.totalQueries).toBe(0);
    });
  });
});
