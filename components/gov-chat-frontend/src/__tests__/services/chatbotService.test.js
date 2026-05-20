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
  default: { getAccessToken: jest.fn().mockResolvedValue('mock-token') }
}));

const chatbotService = require('@/services/chatbotService').default;

describe('chatbotService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

      expect(mockPost).toHaveBeenCalledWith('queries', expect.objectContaining({
        query: 'test question',
        timestamp: expect.any(String)
      }));
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

      expect(mockPatch).toHaveBeenCalledWith('queries/q-1/responsetime', expect.objectContaining({
        responseTime: expect.any(Number)
      }));
    });

    it('marks query as answered after successful submission', async () => {
      mockPost.mockResolvedValue({
        data: { queryId: 'q-2', response: 'Answer' }
      });
      mockPatch.mockResolvedValue({ data: {} });

      await chatbotService.submitQuery({ query: 'test' });

      expect(mockPatch).toHaveBeenCalledWith('queries/q-2/answered', expect.objectContaining({
        responseTime: expect.any(Number)
      }));
    });

    it('throws and rejects when response starts with "Error:"', async () => {
      mockPost.mockResolvedValue({
        data: { queryId: 'q-1', response: 'Error: OPEA service unavailable' }
      });

      await expect(chatbotService.submitQuery({ query: 'test' })).rejects.toThrow(
        'Error: OPEA service unavailable'
      );
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
});
