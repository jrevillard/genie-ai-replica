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

// Mock window.APP_CONFIG for baseUrl resolution
global.window = { APP_CONFIG: { apiUrl: '/api' } };

const analyticsService = require('@/services/analyticsService').default;

describe('analyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService.setI18n({ locale: 'en' });
  });

  // =========================================================================
  // HTTP functions
  // =========================================================================
  describe('HTTP functions', () => {
    describe('getDashboardAnalytics', () => {
      it('fetches dashboard analytics with calculated date range', async () => {
        const rawData = {
          queries: { total: 100, avgResponseTime: 2.5 },
          feedback: { positivePercentage: 80 },
          users: { activeCount: 50 },
          categories: [{ categoryId: 'health', name: 'Health', count: 30 }],
          topQueries: []
        };
        mockGet.mockResolvedValue({ data: rawData });

        const result = await analyticsService.getDashboardAnalytics('daily', '2026-05-19');

        expect(mockGet).toHaveBeenCalledWith('analytics/dashboard', {
          params: expect.objectContaining({
            startDate: expect.any(String),
            endDate: expect.any(String),
            locale: 'en'
          })
        });
        expect(result.totalQueries).toBe(100);
        expect(result.uniqueUsers).toBe(50);
        expect(result.averageResponseTime).toBe(2.5);
        expect(result.satisfactionRate).toBe(80);
      });

      it('throws on API failure', async () => {
        mockGet.mockRejectedValue(new Error('Server error'));

        await expect(analyticsService.getDashboardAnalytics('daily', '2026-05-19')).rejects.toThrow('Server error');
      });
    });

    describe('getTimeSeriesData', () => {
      it('fetches time series data and formats items', async () => {
        mockGet.mockResolvedValue({
          data: [
            { timestamp: '2026-05-19T00:00:00.000Z', value: 145 },
            { timestamp: '2026-05-19T01:00:00.000Z', value: 132 }
          ]
        });

        const result = await analyticsService.getTimeSeriesData('queries', 'daily', '2026-05-01', '2026-05-19');

        expect(mockGet).toHaveBeenCalledWith('analytics/timeseries/queries', {
          params: { interval: 'daily', startDate: '2026-05-01', endDate: '2026-05-19', locale: 'en' }
        });
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty('dateLabel');
        expect(result[0]).toHaveProperty('value', 145);
      });

      it('returns [] on API failure', async () => {
        mockGet.mockRejectedValue(new Error('Server error'));

        const result = await analyticsService.getTimeSeriesData('queries', 'daily', '2026-05-01', '2026-05-19');

        expect(result).toEqual([]);
      });

      it('returns [] when response.data is not an array', async () => {
        mockGet.mockResolvedValue({ data: null });

        const result = await analyticsService.getTimeSeriesData('queries', 'daily', '2026-05-01', '2026-05-19');

        expect(result).toEqual([]);
      });
    });

    describe('getUniqueUsersCount', () => {
      it('fetches unique users count', async () => {
        mockGet.mockResolvedValue({ data: { value: 234 } });

        const result = await analyticsService.getUniqueUsersCount('2026-05-01', '2026-05-19');

        expect(mockGet).toHaveBeenCalledWith('analytics/metric/uniqueUsers', {
          params: { startDate: '2026-05-01', endDate: '2026-05-19', locale: 'en' }
        });
        expect(result).toBe(234);
      });

      it('returns 0 when response.data.value is not a number', async () => {
        mockGet.mockResolvedValue({ data: { value: null } });

        const result = await analyticsService.getUniqueUsersCount('2026-05-01', '2026-05-19');

        expect(result).toBe(0);
      });

      it('returns 0 on API failure', async () => {
        mockGet.mockRejectedValue(new Error('Server error'));

        const result = await analyticsService.getUniqueUsersCount('2026-05-01', '2026-05-19');

        expect(result).toBe(0);
      });
    });

    describe('getSatisfactionHeatmap', () => {
      it('fetches satisfaction heatmap data', async () => {
        const heatmapData = [{ day: 'Mon', hour: 9, value: 4.5 }];
        mockGet.mockResolvedValue({ data: heatmapData });

        const result = await analyticsService.getSatisfactionHeatmap('weekly', '2026-05-19');

        expect(mockGet).toHaveBeenCalledWith('analytics/satisfaction/heatmap', {
          params: expect.objectContaining({ locale: 'en' })
        });
        expect(result).toEqual(heatmapData);
      });

      it('returns [] on API failure', async () => {
        mockGet.mockRejectedValue(new Error('Server error'));

        const result = await analyticsService.getSatisfactionHeatmap('weekly', '2026-05-19');

        expect(result).toEqual([]);
      });

      it('returns [] when response.data is not an array', async () => {
        mockGet.mockResolvedValue({ data: null });

        const result = await analyticsService.getSatisfactionHeatmap('weekly', '2026-05-19');

        expect(result).toEqual([]);
      });
    });

    describe('getSatisfactionGauge', () => {
      it('fetches satisfaction gauge data', async () => {
        mockGet.mockResolvedValue({
          data: {
            currentValue: 82,
            previousValue: 78,
            changePercentage: 5.1,
            target: 85,
            historicalData: [{ date: '2026-05-01', value: 80 }]
          }
        });

        const result = await analyticsService.getSatisfactionGauge('monthly', '2026-05-19');

        expect(mockGet).toHaveBeenCalledWith('analytics/satisfaction/gauge', {
          params: expect.objectContaining({ locale: 'en' })
        });
        expect(result.currentValue).toBe(82);
        expect(result.target).toBe(85);
      });

      it('throws on API failure (no fallback)', async () => {
        mockGet.mockRejectedValue(new Error('Server error'));

        await expect(analyticsService.getSatisfactionGauge('monthly', '2026-05-19')).rejects.toThrow('Server error');
      });

      it('throws when response.data has no currentValue', async () => {
        mockGet.mockResolvedValue({ data: { previousValue: 0 } });

        await expect(analyticsService.getSatisfactionGauge('monthly', '2026-05-19')).rejects.toThrow(
          'Invalid gauge data response'
        );
      });
    });

    describe('getComparisonData', () => {
      it('fetches comparison data for current and previous periods', async () => {
        mockGet.mockResolvedValueOnce({ data: { value: 100 } }).mockResolvedValueOnce({ data: { value: 80 } });

        const result = await analyticsService.getComparisonData(
          'totalQueries',
          'monthly',
          '2026-05-19',
          'monthly',
          '2026-04-19'
        );

        expect(result).toEqual({ current: 100, previous: 80 });
      });

      it('returns fallback on API failure', async () => {
        mockGet.mockRejectedValue(new Error('Server error'));

        const result = await analyticsService.getComparisonData(
          'totalQueries',
          'monthly',
          '2026-05-19',
          'monthly',
          '2026-04-19'
        );

        expect(result).toEqual({ current: null, previous: null });
      });
    });

    describe('recordQuery', () => {
      it('posts analytics query record', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await analyticsService.recordQuery({ query: 'test', timestamp: '2026-05-19T00:00:00Z' });

        expect(mockPost).toHaveBeenCalledWith('/api/analytics/query', {
          query: 'test',
          timestamp: '2026-05-19T00:00:00Z'
        });
        expect(result).toEqual({ success: true });
      });

      it('throws on API failure', async () => {
        mockPost.mockRejectedValue(new Error('Server error'));

        await expect(analyticsService.recordQuery({ query: 'test' })).rejects.toThrow('Server error');
      });
    });

    describe('recordFeedback', () => {
      it('posts analytics feedback with queryId', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await analyticsService.recordFeedback('q-1', { rating: 5 });

        expect(mockPost).toHaveBeenCalledWith('/api/analytics/feedback', { queryId: 'q-1', feedback: { rating: 5 } });
        expect(result).toEqual({ success: true });
      });

      it('throws on API failure', async () => {
        mockPost.mockRejectedValue(new Error('Server error'));

        await expect(analyticsService.recordFeedback('q-1', { rating: 5 })).rejects.toThrow('Server error');
      });
    });
  });

  // =========================================================================
  // Pure helper functions
  // =========================================================================
  describe('Pure functions', () => {
    describe('transformDashboardData', () => {
      it('transforms raw API response to dashboard format', () => {
        const raw = {
          queries: { total: 1523, unanswered: 42, answeredPercentage: 97.24, avgResponseTime: 2.8 },
          categories: [{ categoryId: 'health', name: 'Health', count: 312 }],
          feedback: {
            total: 891,
            positive: 723,
            neutral: 124,
            negative: 44,
            positivePercentage: 81.1,
            negativePercentage: 4.9
          },
          users: { activeCount: 234 },
          topQueries: [{ text: 'How to apply', count: 45, avgTime: 2.3 }]
        };

        const result = analyticsService.transformDashboardData(raw);

        expect(result.totalQueries).toBe(1523);
        expect(result.uniqueUsers).toBe(234);
        expect(result.averageResponseTime).toBe(2.8);
        expect(result.satisfactionRate).toBe(81.1);
        expect(result.queryDistribution).toHaveLength(1);
        expect(result.topQueries).toHaveLength(1);
      });

      it('returns default values when data is null', () => {
        const result = analyticsService.transformDashboardData(null);

        expect(result.totalQueries).toBe(0);
        expect(result.uniqueUsers).toBe(0);
        expect(result.averageResponseTime).toBe(0);
        expect(result.satisfactionRate).toBe(0);
        expect(result.queryDistribution).toEqual([]);
        expect(result.topQueries).toEqual([]);
      });

      it('handles missing users.activeCount', () => {
        const result = analyticsService.transformDashboardData({
          queries: { total: 50, avgResponseTime: 1.5 },
          feedback: { positivePercentage: 90 },
          users: {},
          categories: [],
          topQueries: []
        });

        expect(result.uniqueUsers).toBe(0);
      });
    });

    describe('formatDateLabel', () => {
      it('returns empty string for falsy timestamp', () => {
        expect(analyticsService.formatDateLabel(null, 'daily')).toBe('');
        expect(analyticsService.formatDateLabel('', 'daily')).toBe('');
      });

      it('formats hourly', () => {
        const result = analyticsService.formatDateLabel('2026-05-19T14:30:00.000Z', 'hourly');
        expect(result).toEqual(expect.any(String));
        expect(result.length).toBeGreaterThan(0);
      });

      it('formats daily', () => {
        const result = analyticsService.formatDateLabel('2026-05-19T00:00:00.000Z', 'daily');
        expect(result).toEqual(expect.any(String));
      });

      it('formats weekly', () => {
        const result = analyticsService.formatDateLabel('2026-05-19T00:00:00.000Z', 'weekly');
        expect(result).toEqual(expect.any(String));
      });

      it('formats monthly', () => {
        const result = analyticsService.formatDateLabel('2026-05-19T00:00:00.000Z', 'monthly');
        expect(result).toEqual(expect.any(String));
      });

      it('handles Date object', () => {
        const result = analyticsService.formatDateLabel(new Date('2026-05-19T12:00:00Z'), 'daily');
        expect(result).toEqual(expect.any(String));
      });

      it('falls back to string when date is invalid', () => {
        const result = analyticsService.formatDateLabel('not-a-date', 'daily');
        expect(result).toBe('not-a-date');
      });
    });

    describe('calculatePercentChange', () => {
      it('calculates positive change percentage', () => {
        const result = analyticsService.calculatePercentChange(150, 100);
        expect(result).toBe(50);
      });

      it('calculates negative change percentage', () => {
        const result = analyticsService.calculatePercentChange(80, 100);
        expect(result).toBe(-20);
      });

      it('returns 100 when previous is 0 and current is positive', () => {
        expect(analyticsService.calculatePercentChange(50, 0)).toBe(100);
      });

      it('returns 0 when both are 0', () => {
        expect(analyticsService.calculatePercentChange(0, 0)).toBe(0);
      });
    });

    describe('getWeekNumber', () => {
      it('returns correct week number', () => {
        // January 1, 2026 is a Thursday
        const result = analyticsService.getWeekNumber(new Date('2026-01-01'));
        expect(result).toBeGreaterThan(0);
      });
    });

    describe('calculateDateRange', () => {
      it('returns date range for daily period', () => {
        const result = analyticsService.calculateDateRange('daily', '2026-05-19');
        expect(result).toHaveProperty('startDate');
        expect(result).toHaveProperty('endDate');
        expect(new Date(result.startDate).toISOString()).toEqual(expect.any(String));
        expect(new Date(result.endDate).toISOString()).toEqual(expect.any(String));
      });

      it('returns date range for weekly period', () => {
        const result = analyticsService.calculateDateRange('weekly', '2026-05-19');
        expect(result).toHaveProperty('startDate');
        expect(result).toHaveProperty('endDate');
      });

      it('returns date range for monthly period', () => {
        const result = analyticsService.calculateDateRange('monthly', '2026-05-19');
        expect(result).toHaveProperty('startDate');
        expect(result).toHaveProperty('endDate');
      });

      it('returns date range for all-time', () => {
        const result = analyticsService.calculateDateRange('all-time', '2026-05-19');
        expect(result.startDate).toContain('2020');
      });
    });

    describe('formatValue', () => {
      it('formats numbers with locale', () => {
        const result = analyticsService.formatValue(1234.5, 'number', 'en');
        expect(result).toContain('1'); // locale-dependent
      });

      it('formats time with seconds suffix', () => {
        const result = analyticsService.formatValue(2.5, 'time');
        expect(result).toBe('2.5s');
      });

      it('formats percent with % suffix', () => {
        const result = analyticsService.formatValue(81.1, 'percent');
        expect(result).toBe('81.1%');
      });

      it('formats milliseconds with ms suffix', () => {
        const result = analyticsService.formatValue(350, 'milliseconds');
        expect(result).toBe('350ms');
      });

      it('returns em dash for null value', () => {
        const result = analyticsService.formatValue(null, 'number');
        expect(result).toBe('—');
      });

      it('returns em dash for undefined value', () => {
        const result = analyticsService.formatValue(undefined, 'number');
        expect(result).toBe('—');
      });

      it('falls back to string for unknown format', () => {
        const result = analyticsService.formatValue(42, 'unknown');
        expect(result).toBe('42');
      });
    });

    describe('getTrendColor', () => {
      it('returns positive for positive change', () => {
        expect(analyticsService.getTrendColor(10)).toBe('positive');
      });

      it('returns negative for negative change', () => {
        expect(analyticsService.getTrendColor(-5)).toBe('negative');
      });

      it('returns negative for positive change when isInverse is true', () => {
        expect(analyticsService.getTrendColor(10, true)).toBe('negative');
      });

      it('returns positive for negative change when isInverse is true', () => {
        expect(analyticsService.getTrendColor(-5, true)).toBe('positive');
      });

      it('returns neutral for zero change', () => {
        expect(analyticsService.getTrendColor(0)).toBe('neutral');
      });
    });

    describe('transformTimeSeriesData', () => {
      it('transforms time series data with date labels', () => {
        const data = [
          { timestamp: '2026-05-19T00:00:00.000Z', value: 145 },
          { timestamp: '2026-05-19T01:00:00.000Z', value: 132 }
        ];

        const result = analyticsService.transformTimeSeriesData(data, 'daily');

        expect(result).toHaveLength(2);
        expect(result[0].dateLabel).toEqual(expect.any(String));
        expect(result[0].value).toBe(145);
      });

      it('filters out entries without timestamp', () => {
        const data = [{ timestamp: '2026-05-19T00:00:00.000Z', value: 145 }, { value: 0 }];

        const result = analyticsService.transformTimeSeriesData(data, 'daily');

        expect(result).toHaveLength(1);
      });

      it('returns [] for non-array input', () => {
        expect(analyticsService.transformTimeSeriesData(null, 'daily')).toEqual([]);
        expect(analyticsService.transformTimeSeriesData(undefined, 'daily')).toEqual([]);
      });
    });

    describe('getCurrentLocale', () => {
      it('returns override locale when provided', () => {
        expect(analyticsService.getCurrentLocale('fr')).toBe('fr');
      });

      it('returns i18n locale when set', () => {
        expect(analyticsService.getCurrentLocale()).toBe('en');
      });

      it('falls back to en when i18n is not set', () => {
        analyticsService.setI18n(null);
        expect(analyticsService.getCurrentLocale()).toBe('en');
      });
    });

    describe('setI18n', () => {
      it('sets i18n instance', () => {
        analyticsService.setI18n({ locale: 'fr' });
        expect(analyticsService.getCurrentLocale()).toBe('fr');
        analyticsService.setI18n({ locale: 'en' }); // restore
      });
    });
  });
});
