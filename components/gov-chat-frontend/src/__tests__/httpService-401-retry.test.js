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

// Import httpService — constructor runs and registers interceptors
const httpService = require('@/services/httpService').default;

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
