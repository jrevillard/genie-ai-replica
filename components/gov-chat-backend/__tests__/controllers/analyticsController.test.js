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

const mockAnalyticsService = {
  getDashboardAnalytics: jest.fn(),
  getUniqueUsersCount: jest.fn(),
  getSatisfactionGaugeData: jest.fn(),
  getSatisfactionHeatmapData: jest.fn(),
  getTimeSeriesData: jest.fn(),
  formatDateLabel: jest.fn().mockReturnValue('Jan 15')
};

let AnalyticsController;
let controller;

beforeEach(() => {
  jest.clearAllMocks();
  jest.isolateModules(() => {
    AnalyticsController = require('../../controllers/analyticsController');
  });
  controller = new AnalyticsController(mockAnalyticsService);
});

function mockReqRes(body = {}, query = {}, params = {}) {
  return {
    req: { body, query, params },
    res: {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    }
  };
}

describe('AnalyticsController', () => {
  describe('constructor', () => {
    it('should throw when analyticsService is invalid', () => {
      expect(() => new AnalyticsController(null)).toThrow('Invalid analyticsService');
      expect(() => new AnalyticsController({})).toThrow('Invalid analyticsService');
    });
  });

  describe('getDashboardAnalytics', () => {
    it('should return 400 when missing startDate', async () => {
      const { req, res } = mockReqRes({}, { endDate: '2026-01-31' });
      await controller.getDashboardAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when missing endDate', async () => {
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01' });
      await controller.getDashboardAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 on service error', async () => {
      mockAnalyticsService.getDashboardAnalytics.mockRejectedValue(new Error('DB fail'));
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31' });
      await controller.getDashboardAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return dashboard data successfully', async () => {
      mockAnalyticsService.getDashboardAnalytics.mockResolvedValue({ queries: { total: 10 } });
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31', locale: 'en' });
      await controller.getDashboardAnalytics(req, res);
      expect(res.json).toHaveBeenCalledWith({ queries: { total: 10 } });
      expect(mockAnalyticsService.getDashboardAnalytics).toHaveBeenCalledWith('2026-01-01', '2026-01-31', 'en');
    });
  });

  describe('getMetric', () => {
    it('should return 400 when missing startDate', async () => {
      const { req, res } = mockReqRes({}, {}, { metric: 'totalQueries' });
      await controller.getMetric(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return totalQueries metric', async () => {
      mockAnalyticsService.getDashboardAnalytics.mockResolvedValue({ queries: { total: 42 } });
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'totalQueries' }
      );
      await controller.getMetric(req, res);
      expect(res.json).toHaveBeenCalledWith({ metric: 'totalQueries', value: 42 });
    });

    it('should return uniqueUsers metric', async () => {
      mockAnalyticsService.getUniqueUsersCount.mockResolvedValue(25);
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'uniqueUsers' }
      );
      await controller.getMetric(req, res);
      expect(res.json).toHaveBeenCalledWith({ metric: 'uniqueUsers', value: 25 });
    });

    it('should return averageResponseTime metric', async () => {
      mockAnalyticsService.getDashboardAnalytics.mockResolvedValue({ queries: { avgResponseTime: 1.5 } });
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'averageResponseTime' }
      );
      await controller.getMetric(req, res);
      expect(res.json).toHaveBeenCalledWith({ metric: 'averageResponseTime', value: 1.5 });
    });

    it('should use default value when avgResponseTime is not a number', async () => {
      mockAnalyticsService.getDashboardAnalytics.mockResolvedValue({ queries: { avgResponseTime: 'unknown' } });
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'averageResponseTime' }
      );
      await controller.getMetric(req, res);
      expect(res.json).toHaveBeenCalledWith({ metric: 'averageResponseTime', value: 2.8 });
    });

    it('should return satisfactionRate metric', async () => {
      mockAnalyticsService.getSatisfactionGaugeData.mockResolvedValue({ currentValue: 92 });
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'satisfactionRate' }
      );
      await controller.getMetric(req, res);
      expect(res.json).toHaveBeenCalledWith({ metric: 'satisfactionRate', value: 92 });
    });

    it('should return 400 for unsupported metric', async () => {
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31' }, { metric: 'unknown' });
      await controller.getMetric(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return undefined value when service property is missing', async () => {
      // Service returns data without totalQueries — value stays null (undefined !== null)
      // Source only defaults on exact null, not undefined
      mockAnalyticsService.getDashboardAnalytics.mockResolvedValue({ queries: {} });
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'totalQueries' }
      );
      await controller.getMetric(req, res);
      expect(res.json).toHaveBeenCalledWith({ metric: 'totalQueries', value: undefined });
    });

    it('should return 500 on service error', async () => {
      mockAnalyticsService.getDashboardAnalytics.mockRejectedValue(new Error('fail'));
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metric: 'totalQueries' }
      );
      await controller.getMetric(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getTimeSeriesData', () => {
    it('should return 400 when missing interval', async () => {
      const { req, res } = mockReqRes(
        {},
        { startDate: '2026-01-01', endDate: '2026-01-31' },
        { metricType: 'queries' }
      );
      await controller.getTimeSeriesData(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid interval', async () => {
      const { req, res } = mockReqRes(
        {},
        { interval: 'yearly', startDate: '2026-01-01', endDate: '2026-01-31' },
        { metricType: 'queries' }
      );
      await controller.getTimeSeriesData(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return time series data', async () => {
      mockAnalyticsService.getTimeSeriesData.mockResolvedValue([{ timestamp: '2026-01-15', value: 10, userCount: 3 }]);
      const { req, res } = mockReqRes(
        {},
        { interval: 'daily', startDate: '2026-01-01', endDate: '2026-01-31' },
        { metricType: 'queries' }
      );
      await controller.getTimeSeriesData(req, res);
      expect(res.json).toHaveBeenCalledWith([
        { timestamp: '2026-01-15', dateLabel: 'Jan 15', value: 10, userCount: 3 }
      ]);
    });

    it('should return 500 on service error', async () => {
      mockAnalyticsService.getTimeSeriesData.mockRejectedValue(new Error('fail'));
      const { req, res } = mockReqRes(
        {},
        { interval: 'daily', startDate: '2026-01-01', endDate: '2026-01-31' },
        { metricType: 'queries' }
      );
      await controller.getTimeSeriesData(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getSatisfactionGauge', () => {
    it('should return 400 when missing params', async () => {
      const { req, res } = mockReqRes({}, {});
      await controller.getSatisfactionGauge(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return gauge data', async () => {
      mockAnalyticsService.getSatisfactionGaugeData.mockResolvedValue({ currentValue: 85, target: 85 });
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31', locale: 'fr' });
      await controller.getSatisfactionGauge(req, res);
      expect(res.json).toHaveBeenCalledWith({ currentValue: 85, target: 85 });
      // DW-113: verify locale is propagated from req.query to service
      expect(mockAnalyticsService.getSatisfactionGaugeData).toHaveBeenCalledWith(
        '2026-01-01',
        '2026-01-31',
        'fr'
      );
    });

    it('should return 500 on service error', async () => {
      mockAnalyticsService.getSatisfactionGaugeData.mockRejectedValue(new Error('fail'));
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31' });
      await controller.getSatisfactionGauge(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getSatisfactionHeatmap', () => {
    it('should return 400 when missing params', async () => {
      const { req, res } = mockReqRes({}, {});
      await controller.getSatisfactionHeatmap(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return heatmap data', async () => {
      mockAnalyticsService.getSatisfactionHeatmapData.mockResolvedValue([{ name: 'Cat 1', data: [] }]);
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31', locale: 'es' });
      await controller.getSatisfactionHeatmap(req, res);
      expect(res.json).toHaveBeenCalledWith([{ name: 'Cat 1', data: [] }]);
      // DW-113: verify locale is propagated from req.query to service
      expect(mockAnalyticsService.getSatisfactionHeatmapData).toHaveBeenCalledWith(
        '2026-01-01',
        '2026-01-31',
        'es'
      );
    });

    it('should return 500 on service error', async () => {
      mockAnalyticsService.getSatisfactionHeatmapData.mockRejectedValue(new Error('fail'));
      const { req, res } = mockReqRes({}, { startDate: '2026-01-01', endDate: '2026-01-31' });
      await controller.getSatisfactionHeatmap(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
