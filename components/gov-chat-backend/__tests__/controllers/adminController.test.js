'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });
jest.mock('../../shared-lib/validation-utils', () => require('../mocks/shared-lib'), { virtual: true });

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

const adminController = require('../../controllers/adminController');
const sharedLib = require('../../shared-lib');

// Mock the services
jest.mock('../../services/admin-dashboard-service', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    getSystemHealth: jest.fn().mockResolvedValue({ status: 'healthy', uptime: 3600 }),
    getDatabaseStats: jest.fn().mockResolvedValue({ collections: 10, documents: 1000 }),
    getUserStats: jest.fn().mockResolvedValue({ total: 100, active: 50 }),
    getSecurityMetrics: jest.fn().mockResolvedValue({ incidents: 0, threats: 0 }),
    runSecurityScan: jest.fn().mockResolvedValue({ scanResults: 'clean' }),
    runDiagnostics: jest.fn().mockResolvedValue({ checks: 'passed' }),
    searchUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
    getLogs: jest.fn().mockResolvedValue({ total: 100, logs: [] })
  }));
});

jest.mock('../../services/logs-service', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    getLogsSummary: jest.fn().mockResolvedValue({ total: 100, errors: 5 }),
    searchLogs: jest.fn().mockResolvedValue({ results: [], total: 0 }),
    debugYesterdayLogs: jest.fn().mockResolvedValue({ issues: [] })
  }));
});

jest.mock('../../services/database-operations-service', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    backupDatabase: jest.fn().mockResolvedValue({ success: true, message: 'Backup complete' }),
    optimizeDatabase: jest.fn().mockResolvedValue({ success: true, message: 'Optimization complete' })
  }));
});

describe('adminController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      params: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  });

  describe('getSystemHealth', () => {
    it('should return system health data successfully', async () => {
      await adminController.getSystemHealth(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'healthy',
            uptime: 3600,
            timestamp: expect.any(String)
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Service unavailable'))
      }));

      await adminController.getSystemHealth(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Failed to retrieve system health data'
        })
      );
    });
  });

  describe('getDatabaseStats', () => {
    it('should return database statistics successfully', async () => {
      await adminController.getDatabaseStats(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            collections: 10,
            documents: 1000,
            timestamp: expect.any(String)
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Database connection failed'))
      }));

      await adminController.getDatabaseStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Failed to retrieve database statistics'
        })
      );
    });
  });

  describe('backupDatabase', () => {
    it('should backup database successfully', async () => {
      await adminController.backupDatabase(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Backup complete'
        })
      );
    });

    it('should return 500 on error', async () => {
      const DatabaseOperationsService = require('../../services/database-operations-service');
      DatabaseOperationsService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Backup failed'))
      }));

      await adminController.backupDatabase(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Failed to backup database'
        })
      );
    });
  });

  describe('optimizeDatabase', () => {
    it('should optimize database successfully', async () => {
      await adminController.optimizeDatabase(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Optimization complete'
        })
      );
    });

    it('should return 500 on error', async () => {
      const DatabaseOperationsService = require('../../services/database-operations-service');
      DatabaseOperationsService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Optimization failed'))
      }));

      await adminController.optimizeDatabase(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Failed to optimize database'
        })
      );
    });
  });

  describe('getLogs', () => {
    it('should fetch logs with default limit', async () => {
      await adminController.getLogs(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Object)
        })
      );
    });

    it('should use query parameters', async () => {
      req.query = { limit: 50, level: 'error', service: 'backend' };
      await adminController.getLogs(req, res);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Logs unavailable'))
      }));

      await adminController.getLogs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getLogsSummary', () => {
    it('should return logs summary successfully', async () => {
      await adminController.getLogsSummary(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            total: 100,
            errors: 5
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const LogsService = require('../../services/logs-service');
      LogsService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Summary failed'))
      }));

      await adminController.getLogsSummary(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('searchLogs', () => {
    it('should search logs successfully', async () => {
      req.query = { term: 'error' };
      await adminController.searchLogs(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [],
          total: 0
        })
      );
    });

    it('should return 500 on error', async () => {
      const LogsService = require('../../services/logs-service');
      LogsService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Search failed'))
      }));

      await adminController.searchLogs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('debugYesterdayLogs', () => {
    it('should debug yesterday logs successfully', async () => {
      await adminController.debugYesterdayLogs(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            issues: []
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const LogsService = require('../../services/logs-service');
      LogsService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Debug failed'))
      }));

      await adminController.debugYesterdayLogs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('rolloverLogs', () => {
    it('should trigger log rollover successfully', async () => {
      await adminController.rolloverLogs(req, res);

      expect(sharedLib.triggerLogRollover).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Logs rolled over successfully',
          timestamp: expect.any(String)
        })
      );
    });

    it('should return 500 on error', async () => {
      sharedLib.triggerLogRollover.mockImplementation(() => {
        throw new Error('Rollover failed');
      });

      await adminController.rolloverLogs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Failed to rollover logs'
        })
      );
    });
  });

  describe('getUserStats', () => {
    it('should return user statistics successfully', async () => {
      await adminController.getUserStats(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            total: 100,
            active: 50
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Stats failed'))
      }));

      await adminController.getUserStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getSecurityMetrics', () => {
    it('should return security metrics successfully', async () => {
      await adminController.getSecurityMetrics(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            incidents: 0,
            threats: 0
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Metrics failed'))
      }));

      await adminController.getSecurityMetrics(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('runSecurityScan', () => {
    it('should run security scan successfully', async () => {
      await adminController.runSecurityScan(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Security scan completed',
          data: expect.objectContaining({
            scanResults: 'clean'
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Scan failed'))
      }));

      await adminController.runSecurityScan(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('runDiagnostics', () => {
    it('should run diagnostics successfully', async () => {
      await adminController.runDiagnostics(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Diagnostics completed successfully',
          data: expect.objectContaining({
            checks: 'passed',
            timestamp: expect.any(String)
          })
        })
      );
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Diagnostics failed'))
      }));

      await adminController.runDiagnostics(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('searchUsers', () => {
    it('should search users with default parameters', async () => {
      await adminController.searchUsers(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            users: [],
            total: 0
          })
        })
      );
    });

    it('should use custom query parameters', async () => {
      req.query = { term: 'john', field: 'username', limit: 10, offset: 5 };
      await adminController.searchUsers(req, res);

      expect(res.json).toHaveBeenCalled();
    });

    it('should handle invalid limit/offset gracefully', async () => {
      req.query = { limit: 'invalid', offset: 'NaN' };
      await adminController.searchUsers(req, res);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      const AdminDashboardService = require('../../services/admin-dashboard-service');
      AdminDashboardService.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Search failed'))
      }));

      await adminController.searchUsers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
