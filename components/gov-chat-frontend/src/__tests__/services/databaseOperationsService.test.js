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

const databaseOperationsService = require('@/services/databaseOperationsService').default;

describe('databaseOperationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('backupDatabase', () => {
    it('creates a database backup', async () => {
      const backupResult = { success: true, backupId: 'bk-123' };
      mockPost.mockResolvedValue({ data: backupResult });

      const result = await databaseOperationsService.backupDatabase();

      expect(mockPost).toHaveBeenCalledWith('/database/backup');
      expect(result).toEqual({ data: backupResult });
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Backup failed'));

      await expect(databaseOperationsService.backupDatabase()).rejects.toThrow('Backup failed');
    });
  });

  describe('optimizeDatabase', () => {
    it('optimizes the database', async () => {
      const optimizeResult = { success: true, freedSpace: '500MB' };
      mockPost.mockResolvedValue({ data: optimizeResult });

      const result = await databaseOperationsService.optimizeDatabase();

      expect(mockPost).toHaveBeenCalledWith('/database/optimize');
      expect(result).toEqual({ data: optimizeResult });
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Optimize failed'));

      await expect(databaseOperationsService.optimizeDatabase()).rejects.toThrow('Optimize failed');
    });
  });

  describe('getDatabaseStats', () => {
    it('fetches database statistics', async () => {
      const stats = { collections: 12, documents: 50000, size: '2GB' };
      mockGet.mockResolvedValue({ data: stats });

      const result = await databaseOperationsService.getDatabaseStats();

      expect(mockGet).toHaveBeenCalledWith('/admin/database/stats');
      expect(result).toEqual({ data: stats });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(databaseOperationsService.getDatabaseStats()).rejects.toThrow('Server error');
    });
  });
});
