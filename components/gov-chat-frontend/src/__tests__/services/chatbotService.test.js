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

// Mock keycloakAuthService — file-level import triggers module load
jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: { getAccessToken: jest.fn().mockReturnValue('mock-token') }
}));

const chatbotService = require('@/services/chatbotService').default;

describe('chatbotService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Polyfill TextEncoder and TextDecoder for Node.js test environment
    if (typeof global.TextEncoder === 'undefined') {
      global.TextEncoder = require('util').TextEncoder;
    }
    if (typeof global.TextDecoder === 'undefined') {
      global.TextDecoder = require('util').TextDecoder;
    }
  });

  // ---------------------------------------------------------------------------
  // submitQuery
  // ---------------------------------------------------------------------------
  describe('submitQuery', () => {
    it('posts to /queries with correct payload and timestamp', async () => {
      mockPost.mockResolvedValue({
        data: { queryId: 'q-1', response: 'Here is your answer' }
      });
      mockPatch.mockResolvedValue({ data: {} });

      await chatbotService.submitQuery({ query: 'test question' });

      expect(mockPost).toHaveBeenCalledWith(
        'queries',
        expect.objectContaining({
          query: 'test question',
          timestamp: expect.any(String)
        })
      );
    });

    it('returns response.data on success', async () => {
      const responseData = { queryId: 'q-1', response: 'Answer text' };
      mockPost.mockResolvedValue({ data: responseData });
      mockPatch.mockResolvedValue({ data: {} });

      const result = await chatbotService.submitQuery({ query: 'test' });

      expect(result).toEqual(responseData);
    });

    it('updates query response time after successful submission', async () => {
      mockPost.mockResolvedValue({
        data: { queryId: 'q-1', response: 'Answer' }
      });
      mockPatch.mockResolvedValue({ data: {} });

      await chatbotService.submitQuery({ query: 'test' });

      expect(mockPatch).toHaveBeenCalledWith(
        'queries/q-1/responsetime',
        expect.objectContaining({
          responseTime: expect.any(Number)
        })
      );
    });

    it('marks query as answered after successful submission', async () => {
      mockPost.mockResolvedValue({
        data: { queryId: 'q-2', response: 'Answer' }
      });
      mockPatch.mockResolvedValue({ data: {} });

      await chatbotService.submitQuery({ query: 'test' });

      expect(mockPatch).toHaveBeenCalledWith(
        'queries/q-2/answered',
        expect.objectContaining({
          responseTime: expect.any(Number)
        })
      );
    });

    it('throws and rejects when response starts with "Error:"', async () => {
      mockPost.mockResolvedValue({
        data: { queryId: 'q-1', response: 'Error: OPEA service unavailable' }
      });

      await expect(chatbotService.submitQuery({ query: 'test' })).rejects.toThrow('Error: OPEA service unavailable');
    });

    it('throws when API fails with network error', async () => {
      const networkError = new Error('Network Error');
      mockPost.mockRejectedValue(networkError);

      await expect(chatbotService.submitQuery({ query: 'test' })).rejects.toThrow('Network Error');
    });
  });

  // ---------------------------------------------------------------------------
  // updateQueryResponseTime
  // ---------------------------------------------------------------------------
  describe('updateQueryResponseTime', () => {
    it('sends PATCH to /queries/{id}/responsetime with responseTime', async () => {
      mockPatch.mockResolvedValue({ data: { success: true } });

      const result = await chatbotService.updateQueryResponseTime('q-123', 250);

      expect(mockPatch).toHaveBeenCalledWith('queries/q-123/responsetime', { responseTime: 250 });
      expect(result).toEqual({ success: true });
    });

    it('returns null on API failure', async () => {
      mockPatch.mockRejectedValue(new Error('Server error'));

      const result = await chatbotService.updateQueryResponseTime('q-123', 250);

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // markQueryAsAnswered
  // ---------------------------------------------------------------------------
  describe('markQueryAsAnswered', () => {
    it('sends PATCH to /queries/{id}/answered with responseTime', async () => {
      mockPatch.mockResolvedValue({ data: { success: true } });

      const result = await chatbotService.markQueryAsAnswered('q-456', 300);

      expect(mockPatch).toHaveBeenCalledWith('queries/q-456/answered', { responseTime: 300 });
      expect(result).toEqual({ success: true });
    });

    it('throws on API failure', async () => {
      mockPatch.mockRejectedValue(new Error('Server error'));

      await expect(chatbotService.markQueryAsAnswered('q-456', 300)).rejects.toThrow('Server error');
    });
  });

  // ---------------------------------------------------------------------------
  // submitFeedback
  // ---------------------------------------------------------------------------
  describe('submitFeedback', () => {
    it('sends POST to /queries/{id}/feedback with feedback data', async () => {
      const feedback = { rating: 5, comment: 'Great!' };
      mockPost.mockResolvedValue({ data: { success: true } });

      const result = await chatbotService.submitFeedback('q-789', feedback);

      expect(mockPost).toHaveBeenCalledWith('queries/q-789/feedback', feedback);
      expect(result).toEqual({ success: true });
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(chatbotService.submitFeedback('q-789', { rating: 1 })).rejects.toThrow('Server error');
    });
  });

  // ---------------------------------------------------------------------------
  // submitQueryStream
  // ---------------------------------------------------------------------------
  describe('submitQueryStream', () => {
    beforeEach(() => {
      // Mock window.APP_CONFIG
      global.window = {
        APP_CONFIG: { apiUrl: 'http://localhost:3000/api' }
      };
    });

    afterEach(() => {
      global.fetch.mockRestore?.();
      delete global.window;
    });

    it('creates AbortController and initiates SSE stream with native fetch', () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([]) })
          .mockResolvedValueOnce({ done: true })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const callbacks = {
        onChunk: jest.fn(),
        onMetadata: jest.fn(),
        onTranslation: jest.fn(),
        onDone: jest.fn(),
        onError: jest.fn()
      };

      const controller = chatbotService.submitQueryStream({ query: 'test' }, callbacks);

      expect(controller).toBeInstanceOf(AbortController);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/queries/stream',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer mock-token'
          }),
          signal: controller.signal
        })
      );
    });

    it('calls onChunk callback when receiving chunk data', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      let chunkCallCount = 0;
      const mockReader = {
        read: jest.fn().mockImplementation(() => {
          chunkCallCount++;
          if (chunkCallCount === 1) {
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode('data: {"type":"chunk","content":"Hello "}\n\n')
            });
          } else if (chunkCallCount === 2) {
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode('data: {"type":"chunk","content":"World"}\n\n')
            });
          } else {
            return Promise.resolve({ done: true });
          }
        })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onChunk = jest.fn();
      const onDone = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onChunk, onDone });

      // Wait a bit for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onChunk).toHaveBeenCalledWith('Hello ');
      expect(onChunk).toHaveBeenCalledWith('World');
    });

    it('calls onMetadata callback when receiving metadata', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"metadata","queryId":"q-123"}\n\n')
          })
          .mockResolvedValueOnce({ done: true })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onMetadata = jest.fn();
      const onDone = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onMetadata, onDone });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onMetadata).toHaveBeenCalledWith({ type: 'metadata', queryId: 'q-123' });
    });

    it('calls onTranslation callback when receiving translation', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"translation","content":"Translated"}\n\n')
          })
          .mockResolvedValueOnce({ done: true })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onTranslation = jest.fn();
      const onDone = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onTranslation, onDone });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onTranslation).toHaveBeenCalledWith('Translated');
    });

    it('calls onDone callback when stream completes', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"done"}\n\n')
          })
          .mockResolvedValueOnce({ done: true })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onDone = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onDone });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onDone).toHaveBeenCalledWith({ type: 'done' });
    });

    it('calls onError callback when receiving error from stream', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"error","message":"Stream failed"}\n\n')
          })
          .mockResolvedValueOnce({ done: true })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onError = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onError });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls onError callback when HTTP response is not ok', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockResponse = {
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal Server Error' })
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onError = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onError });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('handles abort signal and does not call onError', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest.fn().mockImplementation(() => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          return Promise.reject(error);
        })
      };

      const mockResponse = {
        ok: true,
        body: { getReader: () => mockReader }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const onError = jest.fn();

      chatbotService.submitQueryStream({ query: 'test' }, { onError });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onError).not.toHaveBeenCalled();
    });

    it('ignores SSE comment lines', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(': keep-alive\n\ndata: {"type":"chunk","content":"Real data"}\n\n')
          })
          .mockResolvedValueOnce({ done: true })
      };

      mockFetch.mockResolvedValue({ ok: true, body: { getReader: () => mockReader } });

      const onChunk = jest.fn();
      chatbotService.submitQueryStream({ query: 'test' }, { onChunk });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onChunk).toHaveBeenCalledWith('Real data');
      expect(onChunk).toHaveBeenCalledTimes(1);
    });

    it('ignores malformed JSON and processes valid lines', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {invalid json}\n\ndata: {"type":"chunk","content":"Valid"}\n\n')
          })
          .mockResolvedValueOnce({ done: true })
      };

      mockFetch.mockResolvedValue({ ok: true, body: { getReader: () => mockReader } });

      const onChunk = jest.fn();
      chatbotService.submitQueryStream({ query: 'test' }, { onChunk });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onChunk).toHaveBeenCalledWith('Valid');
      expect(onChunk).toHaveBeenCalledTimes(1);
    });

    it('calls onError when fetch throws non-AbortError', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      mockFetch.mockRejectedValue(new Error('Network failure'));

      const onError = jest.fn();
      chatbotService.submitQueryStream({ query: 'test' }, { onError });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('attaches abort controller signal to fetch request', () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => ({ read: jest.fn().mockResolvedValue({ done: true }) }) }
      });
      global.fetch = mockFetch;

      const controller = chatbotService.submitQueryStream({ query: 'test' }, {});

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
    });
  });

  // -----------------------------------------------------------------------
  // submitQuery — branches
  // -----------------------------------------------------------------------
  describe('submitQuery — missing queryId and error logging', () => {
    it('skips updateQueryResponseTime when queryId is absent', async () => {
      mockPost.mockResolvedValue({
        data: { response: 'Answer without queryId' }
      });

      const result = await chatbotService.submitQuery({ query: 'test' });

      expect(mockPatch).not.toHaveBeenCalled();
      expect(result.response).toBe('Answer without queryId');
    });

    it('logs error with response data on failure', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation();
      const apiError = new Error('Request failed');
      apiError.response = { data: { error: 'INVALID_INPUT' } };
      mockPost.mockRejectedValue(apiError);

      await expect(chatbotService.submitQuery({ query: 'test' })).rejects.toThrow('Request failed');

      expect(spy).toHaveBeenCalledWith(
        'Error submitting query:',
        'Request failed',
        JSON.stringify({ error: 'INVALID_INPUT' }, null, 2)
      );
      spy.mockRestore();
    });

    it('logs error without response data on network failure', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation();
      mockPost.mockRejectedValue(new Error('Network Error'));

      await expect(chatbotService.submitQuery({ query: 'test' })).rejects.toThrow('Network Error');

      expect(spy).toHaveBeenCalledWith('Error submitting query:', 'Network Error', 'No response data');
      spy.mockRestore();
    });
  });
});
