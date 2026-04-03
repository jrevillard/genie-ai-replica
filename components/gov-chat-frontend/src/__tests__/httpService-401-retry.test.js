'use strict';

const mockSigninSilent = jest.fn();
const mockLogin = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    signinSilent: mockSigninSilent,
    login: mockLogin,
    getAccessToken: mockGetAccessToken,
    getUser: jest.fn(),
    isAuthenticated: jest.fn()
  }
}));

const mockAxiosInstance = jest.fn().mockResolvedValue({ data: { success: true } });
mockAxiosInstance.defaults = { headers: { common: {} } };
mockAxiosInstance.interceptors = {
  request: { use: jest.fn() },
  response: { use: jest.fn() }
};
mockAxiosInstance.get = jest.fn();
mockAxiosInstance.post = jest.fn();
mockAxiosInstance.put = jest.fn();
mockAxiosInstance.delete = jest.fn();
mockAxiosInstance.patch = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: mockAxiosInstance
}));

// Mock notificationService
jest.mock('@/services/notificationService', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    show: jest.fn()
  }
}));

// Import httpService — constructor runs and registers interceptors
const httpService = require('@/services/httpService').default;

// Import mocked notificationService for assertions
const notificationService = require('@/services/notificationService').default;

function createErrorResponse(status, data = {}) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = {
    status,
    statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
    data
  };
  return error;
}

// Call handleResponseError directly to avoid axios interceptor chain complexity
function callResponseErrorHandler(status, data = {}) {
  const error = createErrorResponse(status, data);
  error.config = { headers: {} };
  return httpService.handleResponseError(error);
}

describe('httpService 401 retry with signinSilent', () => {
  beforeEach(() => {
    mockSigninSilent.mockReset();
    mockLogin.mockReset();
    mockGetAccessToken.mockReset();
    mockAxiosInstance.mockReset();
  });

  it('should call signinSilent on 401 response', async () => {
    mockSigninSilent.mockResolvedValue({ access_token: 'new-token' });

    try {
      await callResponseErrorHandler(401);
    } catch (e) {
      // Expected — retry calls mockAxiosInstance which rejects
    }

    expect(mockSigninSilent).toHaveBeenCalledTimes(1);
  });

  it('should retry request with new token after successful signinSilent', async () => {
    mockSigninSilent.mockResolvedValue({ access_token: 'refreshed-token' });
    // Mock the retry call (axios instance invoked with originalRequest config)
    mockAxiosInstance.mockResolvedValue({ data: { success: true } });

    const result = await callResponseErrorHandler(401);

    expect(result.data).toEqual({ success: true });
    expect(mockSigninSilent).toHaveBeenCalledTimes(1);
    // Verify the retry was made with Bearer token from signinSilent
    expect(mockAxiosInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer refreshed-token'
        })
      })
    );
  });

  it('should redirect to Keycloak login when signinSilent returns null', async () => {
    mockSigninSilent.mockResolvedValue(null);
    mockLogin.mockResolvedValue(undefined);

    try {
      await callResponseErrorHandler(401);
    } catch (e) {
      // Expected
    }

    expect(mockSigninSilent).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalled();
  });

  it('should redirect to Keycloak login when signinSilent throws', async () => {
    mockSigninSilent.mockRejectedValue(new Error('Refresh token expired'));
    mockLogin.mockResolvedValue(undefined);

    try {
      await callResponseErrorHandler(401);
    } catch (e) {
      // Expected
    }

    expect(mockSigninSilent).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalled();
  });

  it('should NOT call signinSilent on 403 response', async () => {
    try {
      await callResponseErrorHandler(403, { error: 'INSUFFICIENT_ROLES' });
    } catch (e) {
      // Expected
    }

    expect(mockSigninSilent).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should not retry more than once', async () => {
    mockSigninSilent.mockResolvedValue({ access_token: 'new-token' });
    mockAxiosInstance.mockResolvedValue({ data: { success: true } });

    // Create error with _retryCount already set
    const error = createErrorResponse(401);
    error.config = { headers: {}, _retryCount: 1 };

    try {
      await httpService.handleResponseError(error);
    } catch (e) {
      // Expected — should not retry
    }

    expect(mockSigninSilent).not.toHaveBeenCalled();
  });

  it('should not affect non-401 errors', async () => {
    try {
      await callResponseErrorHandler(500, { error: 'Server error' });
    } catch (e) {
      // Expected
    }

    expect(mockSigninSilent).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
  });
});

describe('httpService error parsing and notifications', () => {
  // Mock notificationService
  const mockNotificationError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset notification mock before each test
    mockNotificationError.mockReset();
  });

  describe('parseAuthError helper', () => {
    it('should parse TOKEN_INVALID error code correctly', () => {
      const errorResponse = {
        error: 'TOKEN_INVALID',
        message: 'Invalid token signature',
        details: {}
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).toEqual({
        code: 'TOKEN_INVALID',
        message: 'Invalid token signature'
      });
    });

    it('should parse TOKEN_EXPIRED error code correctly', () => {
      const errorResponse = {
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired',
        details: {}
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).toEqual({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });
    });

    it('should parse FORBIDDEN error code correctly', () => {
      const errorResponse = {
        error: 'FORBIDDEN',
        message: 'Access denied',
        details: {}
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).toEqual({
        code: 'FORBIDDEN',
        message: 'Access denied'
      });
    });

    it('should parse INSUFFICIENT_ROLES error code correctly', () => {
      const errorResponse = {
        error: 'INSUFFICIENT_ROLES',
        message: 'You lack required permissions',
        details: {}
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).toEqual({
        code: 'INSUFFICIENT_ROLES',
        message: 'You lack required permissions'
      });
    });

    it('should parse AUTH_SERVICE_UNAVAILABLE error code correctly', () => {
      const errorResponse = {
        error: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service temporarily unavailable',
        details: {}
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).toEqual({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service temporarily unavailable'
      });
    });

    it('should parse PROVISIONING_FAILED error code correctly', () => {
      const errorResponse = {
        error: 'PROVISIONING_FAILED',
        message: 'User provisioning failed',
        details: {}
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).toEqual({
        code: 'PROVISIONING_FAILED',
        message: 'User provisioning failed'
      });
    });

    it('should handle malformed response gracefully with default error', () => {
      const malformedResponse = {
        foo: 'bar'
      };

      const result = httpService.parseAuthError(malformedResponse);

      expect(result).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'An error occurred'
      });
    });

    it('should handle null response gracefully', () => {
      const result = httpService.parseAuthError(null);

      expect(result).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'An error occurred'
      });
    });

    it('should handle missing error field gracefully', () => {
      const response = {
        message: 'Some error'
      };

      const result = httpService.parseAuthError(response);

      expect(result).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'Some error'
      });
    });

    it('should handle missing message field gracefully', () => {
      const response = {
        error: 'TOKEN_INVALID'
      };

      const result = httpService.parseAuthError(response);

      expect(result).toEqual({
        code: 'TOKEN_INVALID',
        message: 'Your session is invalid. Please log in again.'
      });
    });

    it('should NEVER include details field in parsed result', () => {
      const errorResponse = {
        error: 'TOKEN_INVALID',
        message: 'Invalid token',
        details: { sensitive: 'data' }
      };

      const result = httpService.parseAuthError(errorResponse);

      expect(result).not.toHaveProperty('details');
      expect(result.details).toBeUndefined();
    });
  });

  describe('error notifications in handleResponseError', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Clear notificationService mock before each test
      notificationService.error.mockClear();
    });

    describe('401 errors — NO notifications (redirect handles UX)', () => {
      it('should NOT emit notification for TOKEN_EXPIRED after refresh fails', async () => {
        mockSigninSilent.mockRejectedValue(new Error('Token expired'));
        mockLogin.mockResolvedValue(undefined);

        try {
          await callResponseErrorHandler(401, { error: 'TOKEN_EXPIRED', message: 'Token has expired' });
        } catch (e) {
          // Expected
        }

        expect(mockSigninSilent).toHaveBeenCalled();
        expect(mockLogin).toHaveBeenCalled();
        expect(notificationService.error).not.toHaveBeenCalled();
      });

      it('should NOT emit notification for TOKEN_INVALID after refresh fails', async () => {
        mockSigninSilent.mockRejectedValue(new Error('Invalid token'));
        mockLogin.mockResolvedValue(undefined);

        try {
          await callResponseErrorHandler(401, { error: 'TOKEN_INVALID', message: 'Invalid token' });
        } catch (e) {
          // Expected
        }

        expect(mockSigninSilent).toHaveBeenCalled();
        expect(mockLogin).toHaveBeenCalled();
        expect(notificationService.error).not.toHaveBeenCalled();
      });
    });

    describe('403 errors — authorization notifications', () => {
      it('should emit distinct authorization error for FORBIDDEN', async () => {
        try {
          await callResponseErrorHandler(403, { error: 'FORBIDDEN', message: 'Access denied' });
        } catch (e) {
          // Expected
        }

        expect(mockSigninSilent).not.toHaveBeenCalled();
        expect(mockLogin).not.toHaveBeenCalled();
        expect(notificationService.error).toHaveBeenCalledWith(
          expect.stringContaining('Access denied')
        );
      });

      it('should emit authorization error for INSUFFICIENT_ROLES', async () => {
        try {
          await callResponseErrorHandler(403, { error: 'INSUFFICIENT_ROLES', message: 'Insufficient permissions' });
        } catch (e) {
          // Expected
        }

        expect(mockSigninSilent).not.toHaveBeenCalled();
        expect(mockLogin).not.toHaveBeenCalled();
        expect(notificationService.error).toHaveBeenCalledWith(
          expect.stringContaining('Insufficient permissions')
        );
      });

      it('should use backend message when available for 403', async () => {
        try {
          await callResponseErrorHandler(403, { error: 'FORBIDDEN', message: 'Custom backend error message' });
        } catch (e) {
          // Expected
        }

        expect(notificationService.error).toHaveBeenCalledWith('Custom backend error message');
      });
    });

    describe('503 errors — service unavailable notifications', () => {
      it('should emit service unavailable notification for AUTH_SERVICE_UNAVAILABLE', async () => {
        try {
          await callResponseErrorHandler(503, { error: 'AUTH_SERVICE_UNAVAILABLE', message: 'Auth service unavailable' });
        } catch (e) {
          // Expected
        }

        expect(notificationService.error).toHaveBeenCalledWith(
          expect.stringContaining('Auth service unavailable')
        );
      });

      it('should handle generic 503 without error code', async () => {
        try {
          await callResponseErrorHandler(503, { message: 'Service temporarily unavailable' });
        } catch (e) {
          // Expected
        }

        expect(notificationService.error).toHaveBeenCalled();
      });
    });

    describe('500 errors — system error notifications', () => {
      it('should emit system error notification for PROVISIONING_FAILED', async () => {
        try {
          await callResponseErrorHandler(500, { error: 'PROVISIONING_FAILED', message: 'System error occurred' });
        } catch (e) {
          // Expected
        }

        expect(notificationService.error).toHaveBeenCalledWith(
          expect.stringContaining('System error occurred')
        );
      });

      it('should NOT expose provisioning details in notification', async () => {
        try {
          await callResponseErrorHandler(500, {
            error: 'PROVISIONING_FAILED',
            message: 'System error',
            details: { arangoError: 'Connection failed' }
          });
        } catch (e) {
          // Expected
        }

        const notificationCalls = notificationService.error.mock.calls;
        notificationCalls.forEach(call => {
          const message = call[0];
          expect(message).not.toContain('arangoError');
          expect(message).not.toContain('Connection failed');
        });
      });
    });

    describe('unrecognized error codes — generic notifications', () => {
      it('should emit generic error notification for unrecognized error codes', async () => {
        try {
          await callResponseErrorHandler(500, { error: 'UNKNOWN_CODE', message: 'Unknown error' });
        } catch (e) {
          // Expected
        }

        expect(notificationService.error).toHaveBeenCalledWith('Unknown error');
      });

      it('should emit generic notification when backend message is missing', async () => {
        try {
          await callResponseErrorHandler(500, { error: 'SOME_ERROR' });
        } catch (e) {
          // Expected
        }

        expect(notificationService.error).toHaveBeenCalledWith(
          expect.stringMatching(/error|occurred/i)
        );
      });
    });

    describe('details field — never exposed to notifications', () => {
      it('should NEVER pass details field to notification messages', async () => {
        try {
          await callResponseErrorHandler(403, {
            error: 'FORBIDDEN',
            message: 'Access denied',
            details: { internalTrace: 'stack trace here' }
          });
        } catch (e) {
          // Expected
        }

        const notificationCalls = notificationService.error.mock.calls;
        notificationCalls.forEach(call => {
          const message = call[0];
          expect(message).not.toContain('internalTrace');
          expect(message).not.toContain('stack trace here');
        });
      });
    });
  });
});

describe('Backend error codes completeness', () => {
  /**
   * Verify recognizedErrorCodes array contains all backend error codes
   *
   * Backend error codes (from architecture specification):
   * - TOKEN_INVALID (401)
   * - TOKEN_EXPIRED (401)
   * - FORBIDDEN (403)
   * - INSUFFICIENT_ROLES (403) - future use (currently backend returns FORBIDDEN)
   * - AUTH_SERVICE_UNAVAILABLE (503)
   * - PROVISIONING_FAILED (500)
   * - INTERNAL_ERROR (500 generic) - covered by UNKNOWN_ERROR fallback
   */
  it('recognizedErrorCodes array contains all backend error codes from architecture spec', () => {
    // Read the actual recognizedErrorCodes array from implementation
    const fs = require('fs');
    const httpServicePath = './src/services/httpService.js';
    const httpServiceContent = fs.readFileSync(httpServicePath, 'utf8');

    // Extract the recognizedErrorCodes array using regex
    const match = httpServiceContent.match(/recognizedErrorCodes\s*=\s*\[([^\]]+)\]/);
    expect(match).toBeTruthy();

    const codesInArray = match[1].split(',').map(s => s.trim().replace(/['"]/g, ''));

    // All required error codes from Story 1-8
    const requiredCodes = [
      'TOKEN_INVALID',
      'TOKEN_EXPIRED',
      'FORBIDDEN',
      'INSUFFICIENT_ROLES',
      'AUTH_SERVICE_UNAVAILABLE',
      'PROVISIONING_FAILED'
    ];

    // Verify all required codes are present
    requiredCodes.forEach(code => {
      expect(codesInArray).toContain(code);
    });

    // Verify array has at least the required codes (may have more)
    expect(codesInArray.length).toBeGreaterThanOrEqual(requiredCodes.length);
  });
});
