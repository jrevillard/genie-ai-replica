'use strict';

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

const adminDashboardService = require('@/services/adminDashboardService').default;

describe('adminDashboardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSystemHealth', () => {
    it('fetches system health data', async () => {
      const healthData = { status: 'healthy', uptime: 12345, services: [] };
      mockGet.mockResolvedValue({ data: healthData });

      const result = await adminDashboardService.getSystemHealth();

      expect(mockGet).toHaveBeenCalledWith('/admin/system-health');
      expect(result).toEqual(healthData);
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.getSystemHealth()).rejects.toThrow('Server error');
    });
  });

  describe('getLogs', () => {
    it('fetches logs without options', async () => {
      const logsResponse = { data: [{ level: 'info', message: 'test' }] };
      mockGet.mockResolvedValue(logsResponse);

      const result = await adminDashboardService.getLogs();

      expect(mockGet).toHaveBeenCalledWith('admin/logs', { params: {} });
      expect(result).toEqual(logsResponse);
    });

    it('passes filter options as query params', async () => {
      const options = { limit: 10, level: 'error', service: 'backend' };
      mockGet.mockResolvedValue({ data: [] });

      await adminDashboardService.getLogs(options);

      expect(mockGet).toHaveBeenCalledWith('admin/logs', { params: options });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.getLogs()).rejects.toThrow('Server error');
    });
  });

  describe('getUserStats', () => {
    it('fetches user stats', async () => {
      const statsData = { totalUsers: 100, activeUsers: 50 };
      mockGet.mockResolvedValue({ data: statsData });

      const result = await adminDashboardService.getUserStats();

      expect(mockGet).toHaveBeenCalledWith('admin/user-stats', { params: {} });
      expect(result).toEqual(statsData);
    });

    it('passes options as query params', async () => {
      const options = { role: 'admin' };
      mockGet.mockResolvedValue({ data: {} });

      await adminDashboardService.getUserStats(options);

      expect(mockGet).toHaveBeenCalledWith('admin/user-stats', { params: options });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.getUserStats()).rejects.toThrow('Server error');
    });
  });

  describe('getSecurityMetrics', () => {
    it('fetches security metrics', async () => {
      const metrics = { failedLogins: 5, suspiciousActivity: 1 };
      mockGet.mockResolvedValue({ data: metrics });

      const result = await adminDashboardService.getSecurityMetrics();

      expect(mockGet).toHaveBeenCalledWith('admin/security-metrics');
      expect(result).toEqual(metrics);
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.getSecurityMetrics()).rejects.toThrow('Server error');
    });
  });

  describe('getSecurityDetails', () => {
    it('fetches security scan details', async () => {
      const details = { lastScan: '2026-01-01', vulnerabilities: { critical: 0, medium: 1, low: 2 } };
      mockGet.mockResolvedValue({ data: details });

      const result = await adminDashboardService.getSecurityDetails();

      expect(mockGet).toHaveBeenCalledWith('/admin/security/last-scan');
      expect(result).toEqual(details);
    });

    it('returns fallback data on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await adminDashboardService.getSecurityDetails();

      expect(result).toEqual({
        lastScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [],
        suspiciousDetails: []
      });
    });
  });

  describe('runDiagnostics', () => {
    it('runs diagnostics and returns data', async () => {
      const diagData = { status: 'passed', checks: [] };
      mockPost.mockResolvedValue({ data: diagData });

      const result = await adminDashboardService.runDiagnostics();

      expect(mockPost).toHaveBeenCalledWith('admin/diagnostics');
      expect(result).toEqual(diagData);
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.runDiagnostics()).rejects.toThrow('Server error');
    });
  });

  describe('runSecurityScan', () => {
    it('runs security scan and returns data', async () => {
      const scanData = { success: true, data: { status: 'completed' } };
      mockPost.mockResolvedValue({ data: scanData });

      const result = await adminDashboardService.runSecurityScan();

      expect(mockPost).toHaveBeenCalledWith('/admin/security-scan');
      expect(result).toEqual(scanData);
    });

    it('returns failure result on API error', async () => {
      mockPost.mockRejectedValue(new Error('Scan failed'));

      const result = await adminDashboardService.runSecurityScan();

      expect(result.success).toBe(false);
      expect(result.data.status).toBe('failed');
      expect(result.data.message).toContain('Scan failed');
    });
  });

  describe('rolloverLogs', () => {
    it('triggers log rotation', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });

      await adminDashboardService.rolloverLogs();

      expect(mockPost).toHaveBeenCalledWith('admin/logs/rollover');
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.rolloverLogs()).rejects.toThrow('Server error');
    });
  });

  describe('getLogsSummary', () => {
    it('fetches logs summary', async () => {
      const summary = { errors: [], warnings: [], date: '2026-05-26' };
      mockGet.mockResolvedValue({ data: summary });

      const result = await adminDashboardService.getLogsSummary({ date: '2026-05-26' });

      expect(mockGet).toHaveBeenCalledWith('/admin/logs/summary', { params: { date: '2026-05-26' } });
      expect(result).toEqual(summary);
    });

    it('returns fallback data on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await adminDashboardService.getLogsSummary();

      expect(result).toEqual({ data: { errors: [], warnings: [], date: expect.any(String) } });
    });
  });

  describe('searchLogs', () => {
    it('searches logs with date range conversion', async () => {
      const searchResponse = { data: [{ level: 'error', message: 'found' }] };
      mockGet.mockResolvedValue(searchResponse);

      const result = await adminDashboardService.searchLogs({ term: 'error', dateRange: 'today' });

      expect(mockGet).toHaveBeenCalledWith('admin/logs/search', {
        params: expect.objectContaining({
          term: 'error',
          dateRange: 'today',
          includeArchived: true,
          startDate: expect.any(String),
          endDate: expect.any(String)
        })
      });
      expect(result).toEqual(searchResponse);
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.searchLogs()).rejects.toThrow('Server error');
    });
  });

  describe('convertDateRangeToParams', () => {
    it('converts "today" to today dates', () => {
      const result = adminDashboardService.convertDateRangeToParams('today');
      const today = new Date().toISOString().split('T')[0];

      expect(result.startDate).toBe(today);
      expect(result.endDate).toBe(today);
    });

    it('converts "yesterday" to yesterday dates', () => {
      const result = adminDashboardService.convertDateRangeToParams('yesterday');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      expect(result.startDate).toBe(yesterday.toISOString().split('T')[0]);
      expect(result.endDate).toBe(yesterday.toISOString().split('T')[0]);
    });

    it('converts "week" to 7-day range', () => {
      const result = adminDashboardService.convertDateRangeToParams('week');
      const today = new Date().toISOString().split('T')[0];

      expect(result.endDate).toBe(today);
    });

    it('converts "month" to 30-day range', () => {
      const result = adminDashboardService.convertDateRangeToParams('month');
      const today = new Date().toISOString().split('T')[0];

      expect(result.endDate).toBe(today);
    });

    it('uses custom dates when provided', () => {
      const result = adminDashboardService.convertDateRangeToParams('custom', '2026-01-01', '2026-01-31');

      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-01-31');
    });
  });

  describe('searchUsers', () => {
    it('searches users with options', async () => {
      const usersResponse = { data: [{ id: '1', name: 'Test User' }] };
      mockGet.mockResolvedValue(usersResponse);

      const result = await adminDashboardService.searchUsers({ term: 'test', field: 'name' });

      expect(mockGet).toHaveBeenCalledWith('admin/users/search', { params: { term: 'test', field: 'name' } });
      expect(result).toEqual(usersResponse);
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(adminDashboardService.searchUsers()).rejects.toThrow('Server error');
    });
  });

  describe('formatDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date('2026-05-26T14:30:00Z');
      const result = adminDashboardService.formatDate(date);

      expect(result).toBe('2026-05-26');
    });
  });
});
