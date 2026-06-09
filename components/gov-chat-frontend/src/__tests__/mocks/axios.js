'use strict';

// Closure-based references for jest.mock hoisting compatibility
const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();
const mockAxiosPut = jest.fn();
const mockAxiosDelete = jest.fn();
const mockAxiosPatch = jest.fn();

// Interceptor handler capture arrays
const capturedRequestHandlers = [];
const capturedResponseHandlers = [];

// Interceptor use methods — implementation persists across resets
const mockRequestUse = jest.fn((handler) => {
  capturedRequestHandlers.push(handler);
  return handler;
});

const mockResponseUse = jest.fn((successHandler, errorHandler) => {
  capturedResponseHandlers.push({ success: successHandler, error: errorHandler });
  return successHandler;
});

/**
 * Creates the default axios mock object for jest.mock('axios', ...).
 * Returns { create, get, post, put, delete, patch, defaults, interceptors }.
 */
function createDefaultMock() {
  const instance = {
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: mockRequestUse },
      response: { use: mockResponseUse }
    },
    get: mockAxiosGet,
    post: mockAxiosPost,
    put: mockAxiosPut,
    delete: mockAxiosDelete,
    patch: mockAxiosPatch
  };

  return {
    create: jest.fn(() => instance),
    ...instance
  };
}

/**
 * Configure a mock method to return a successful response.
 * @param {jest.Mock} method - One of the mockAxios* functions
 * @param {object} data - Response data
 */
function setSuccessResponse(method, data = {}) {
  method.mockResolvedValue({ data, status: 200 });
}

/**
 * Configure a mock method to return an error response.
 * @param {jest.Mock} method - One of the mockAxios* functions
 * @param {number} status - HTTP status code (401, 404, 500, etc.)
 * @param {object|string} data - Error response data
 */
function setErrorResponse(method, status, data = {}) {
  const errorData = typeof data === 'string' ? { message: data } : data;
  const error = new Error('Request failed with status code ' + status);
  error.response = { status, data: errorData };
  error.isAxiosError = true;
  method.mockRejectedValue(error);
}

/**
 * Reset all mock state. Call in beforeEach() for test isolation.
 */
function resetAxiosMock() {
  mockAxiosGet.mockReset();
  mockAxiosPost.mockReset();
  mockAxiosPut.mockReset();
  mockAxiosDelete.mockReset();
  mockAxiosPatch.mockReset();
  mockRequestUse.mockReset();
  mockResponseUse.mockReset();
  capturedRequestHandlers.length = 0;
  capturedResponseHandlers.length = 0;

  // Default: return empty successful responses
  mockAxiosGet.mockResolvedValue({ data: {} });
  mockAxiosPost.mockResolvedValue({ data: {} });
  mockAxiosPut.mockResolvedValue({ data: {} });
  mockAxiosDelete.mockResolvedValue({ data: {} });
  mockAxiosPatch.mockResolvedValue({ data: {} });
}

module.exports = {
  mockAxiosGet,
  mockAxiosPost,
  mockAxiosPut,
  mockAxiosDelete,
  mockAxiosPatch,
  capturedRequestHandlers,
  capturedResponseHandlers,
  createDefaultMock,
  setSuccessResponse,
  setErrorResponse,
  resetAxiosMock
};
