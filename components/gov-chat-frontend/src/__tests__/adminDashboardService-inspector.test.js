'use strict';

const mockGetAccessTokenFn = jest.fn().mockResolvedValue('test-token');

jest.mock('../services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    getAccessToken: () => mockGetAccessTokenFn(),
    signinSilent: jest.fn(),
    login: jest.fn()
  }
}));

jest.mock('../services/notificationService', () => ({
  __esModule: true,
  default: {
    show: jest.fn()
  }
}));

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('axios', () => {
  const instance = {
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    },
    get: mockGet,
    post: mockPost,
    put: jest.fn(),
    delete: jest.fn()
  };
  return { create: jest.fn(() => instance), ...instance };
});

describe('adminDashboardService — Query Inspector methods', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      service = require('../services/adminDashboardService').default || require('../services/adminDashboardService');
    });
  });

  describe('getQueriesForInspector', () => {
    it('should call GET with query params', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: {
            queries: [{ _key: 'q1', text: 'test' }],
            pagination: { total: 1, limit: 25, pages: 1, currentPage: 1 }
          }
        }
      };
      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getQueriesForInspector({ limit: 25, searchText: 'tax' });

      expect(mockGet).toHaveBeenCalled();
      const call = mockGet.mock.calls[0];
      // httpService prepends baseURL, so the path is the full URL
      expect(call[0]).toContain('/admin/queries/inspect');
      expect(call[1]).toEqual(expect.objectContaining({ params: { limit: 25, searchText: 'tax' } }));
      expect(result).toEqual(mockResponse.data);
    });

    it('should call GET with empty params when no options provided', async () => {
      mockGet.mockResolvedValue({ data: { success: true, data: { queries: [], pagination: {} } } });

      await service.getQueriesForInspector();

      expect(mockGet).toHaveBeenCalled();
      const call = mockGet.mock.calls[0];
      expect(call[0]).toContain('/admin/queries/inspect');
      expect(call[1]).toEqual(expect.objectContaining({ params: {} }));
    });

    it('should throw on HTTP error', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      await expect(service.getQueriesForInspector()).rejects.toThrow('Network error');
    });
  });

  describe('getQueryInspectorDetails', () => {
    it('should call GET with query ID', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: { _key: 'q1', text: 'test', userName: 'John' }
        }
      };
      mockGet.mockResolvedValue(mockResponse);

      const result = await service.getQueryInspectorDetails('q1');

      expect(mockGet).toHaveBeenCalled();
      const call = mockGet.mock.calls[0];
      expect(call[0]).toContain('/admin/queries/inspect/q1');
      expect(result).toEqual(mockResponse.data);
    });

    it('should throw on HTTP error', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));

      await expect(service.getQueryInspectorDetails('bad-id')).rejects.toThrow('Not found');
    });
  });
});
