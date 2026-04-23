'use strict';

// Mock keycloakAuthService - must be hoisted before require/import
const mockGetAccessTokenFn = jest.fn();
const mockSigninSilentFn = jest.fn();
const mockLoginFn = jest.fn();

jest.mock('../services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    getAccessToken: () => mockGetAccessTokenFn(),
    signinSilent: () => mockSigninSilentFn(),
    login: () => mockLoginFn()
  }
}));

// Mock axios
const mockCapturedRequestHandlers = [];
const mockCapturedResponseHandlers = [];

jest.mock('axios', () => {
  const mockAxiosInstance = {
    defaults: { headers: { common: {} } },
    interceptors: {
      request: {
        use: jest.fn((handler) => {
          mockCapturedRequestHandlers.push(handler);
          return handler;
        })
      },
      response: {
        use: jest.fn((successHandler, errorHandler) => {
          mockCapturedResponseHandlers.push({ success: successHandler, error: errorHandler });
          return successHandler;
        })
      }
    },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn()
  };

  return {
    create: jest.fn(() => mockAxiosInstance),
    ...mockAxiosInstance
  };
});

const httpService = require('@/services/httpService').default;

describe('httpService', () => {
  let mockAxiosInstance;
  let requestHandler;
  let responseSuccessHandler;
  

  beforeEach(() => {
    jest.clearAllMocks();

    // Get the mock instance - httpService uses axios.create() internally
    const axios = require('axios');
    mockAxiosInstance = axios.create();

    // Store the handlers that were registered during module load
    requestHandler = mockCapturedRequestHandlers[0];
    responseSuccessHandler = mockCapturedResponseHandlers[0]?.success;

    // Reset mock implementations to return empty responses
    mockAxiosInstance.get.mockResolvedValue({ data: {} });
    mockAxiosInstance.post.mockResolvedValue({ data: {} });
    mockAxiosInstance.put.mockResolvedValue({ data: {} });
    mockAxiosInstance.delete.mockResolvedValue({ data: {} });
    mockAxiosInstance.patch.mockResolvedValue({ data: {} });

    // Reset accessToken mock
    mockGetAccessTokenFn.mockReset();
  });

  // ========================================================================
  // HTTP METHODS
  // ========================================================================

  describe('get', () => {
    it('should call axios.get with full URL and params', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { result: 'success' }
      });

      const result = await httpService.get('endpoint', { param1: 'value1' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(expect.stringContaining('endpoint'), {
        params: { param1: 'value1' }
      });
      expect(result.data.result).toBe('success');
    });

    it('should handle errors gracefully', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(httpService.get('endpoint')).rejects.toThrow('Network error');
    });
  });

  describe('post', () => {
    it('should call axios.post with full URL and data', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { created: true }
      });

      const result = await httpService.post('endpoint', { data: 'test' });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(expect.stringContaining('endpoint'), { data: 'test' }, {});
      expect(result.data.created).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Post failed'));

      await expect(httpService.post('endpoint', {})).rejects.toThrow('Post failed');
    });
  });

  describe('put', () => {
    it('should call axios.put with full URL and data', async () => {
      mockAxiosInstance.put.mockResolvedValue({
        data: { updated: true }
      });

      const result = await httpService.put('endpoint', { key: 'value' });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(expect.stringContaining('endpoint'), { key: 'value' }, {});
      expect(result.data.updated).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockAxiosInstance.put.mockRejectedValue(new Error('Put failed'));

      await expect(httpService.put('endpoint', {})).rejects.toThrow('Put failed');
    });
  });

  describe('delete', () => {
    it('should call axios.delete with full URL', async () => {
      mockAxiosInstance.delete.mockResolvedValue({
        data: { deleted: true }
      });

      const result = await httpService.delete('endpoint');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(expect.stringContaining('endpoint'), {});
      expect(result.data.deleted).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockAxiosInstance.delete.mockRejectedValue(new Error('Delete failed'));

      await expect(httpService.delete('endpoint')).rejects.toThrow('Delete failed');
    });
  });

  describe('patch', () => {
    it('should call axios.patch with full URL and data', async () => {
      mockAxiosInstance.patch.mockResolvedValue({
        data: { patched: true }
      });

      const result = await httpService.patch('endpoint', { field: 'value' });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(expect.stringContaining('endpoint'), { field: 'value' }, {});
      expect(result.data.patched).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockAxiosInstance.patch.mockRejectedValue(new Error('Patch failed'));

      await expect(httpService.patch('endpoint', {})).rejects.toThrow('Patch failed');
    });
  });

  // ========================================================================
  // REQUEST INTERCEPTOR
  // ========================================================================

  describe('Request Interceptor', () => {
    it('should add Bearer token from keycloakAuthService', async () => {
      mockGetAccessTokenFn.mockReturnValue('test-token-123');

      // Use captured request handler
      const config = { headers: {} };
      requestHandler(config);

      expect(mockGetAccessTokenFn).toHaveBeenCalled();
      expect(config.headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should handle missing token gracefully', async () => {
      mockGetAccessTokenFn.mockReturnValue(null);

      const config = { headers: {} };
      requestHandler(config);

      expect(config.headers.Authorization).toBeUndefined();
    });

    it('should preserve existing headers', async () => {
      mockGetAccessTokenFn.mockReturnValue('test-token');

      const config = { headers: { 'Existing-Header': 'value' } };
      requestHandler(config);

      expect(config.headers['Existing-Header']).toBe('value');
      expect(config.headers.Authorization).toBe('Bearer test-token');
    });
  });

  // ========================================================================
  // RESPONSE INTERCEPTOR
  // ========================================================================

  describe('Response Interceptor - Success', () => {
    it('should return successful response unchanged', async () => {
      const response = {
        data: { success: true }
      };

      const result = responseSuccessHandler(response);

      expect(result).toEqual(response);
    });
  });

  // Note: 401 token refresh and error handling tests are complex to test with mocks
  // due to the 'this.axios' context requirement. These behaviors are better tested
  // via integration tests with actual Keycloak/ArangoDB.

  // ========================================================================
  // URL BUILDING
  // ========================================================================

  describe('getUrl', () => {
    it('should combine base URL with endpoint', () => {
      const result = httpService.getUrl('users');

      expect(result).toContain('users');
      // Base URL should be included
      expect(result).toMatch(/^https?:\/\/.+\/users$/);
    });

    it('should handle leading slash in endpoint', () => {
      const result = httpService.getUrl('/users');

      expect(result).toContain('users');
      expect(result).toMatch(/^https?:\/\/.+\/users$/); // Should not have double slash after base
    });

    it('should handle trailing slash in endpoint', () => {
      const result = httpService.getUrl('users/');

      expect(result).toContain('users');
    });

    it('should handle nested paths', () => {
      const result = httpService.getUrl('admin/users/123');

      expect(result).toContain('admin/users/123');
    });
  });

  // ========================================================================
  // CONFIGURATION
  // ========================================================================

  describe('setBaseUrl', () => {
    it('should update the base URL', () => {
      httpService.setBaseUrl('https://api.example.com');

      const result = httpService.getUrl('test');

      expect(result).toBe('https://api.example.com/test');
    });
  });

  // ========================================================================
  // putNoCache (special method)
  // ========================================================================

  describe('putNoCache', () => {
    it('should add cache-busting headers and timestamp', async () => {
      mockAxiosInstance.put.mockResolvedValue({
        data: { success: true }
      });

      await httpService.putNoCache('users/123', { name: 'Test' });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        expect.stringContaining('?_nocache='),
        expect.objectContaining({
          name: 'Test',
          _timestamp: expect.any(Number)
        }),
        expect.objectContaining({
          headers: expect.any(Object)
        })
      );
    });

    it('should include Cache-Control headers', async () => {
      mockAxiosInstance.put.mockResolvedValue({
        data: { success: true }
      });

      await httpService.putNoCache('users/123', { name: 'Test' });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Cache-Control': 'no-cache, no-store, must-revalidate, private',
            Pragma: 'no-cache',
            Expires: '-1'
          })
        })
      );
    });
  });
});
