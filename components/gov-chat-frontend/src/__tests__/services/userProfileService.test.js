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

const userProfileService = require('@/services/userProfileService').default;

describe('userProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('fetches user profile via GET /me', async () => {
      mockGet.mockResolvedValue({
        data: { _key: 'users/user-123', email: 'test@example.com', name: 'Test User' }
      });

      const result = await userProfileService.getProfile();

      expect(mockGet).toHaveBeenCalledWith('me');
      expect(result.email).toBe('test@example.com');
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(userProfileService.getProfile()).rejects.toThrow('Server error');
    });

    it('throws on 401 unauthorized', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401, data: { error: 'UNAUTHORIZED' } };
      mockGet.mockRejectedValue(error);

      await expect(userProfileService.getProfile()).rejects.toThrow('Unauthorized');
    });
  });

  describe('updateProfile', () => {
    it('updates profile via PUT /me with JSON data', async () => {
      mockPut.mockResolvedValue({
        data: { _key: 'users/user-123', name: 'Updated Name' }
      });

      const result = await userProfileService.updateProfile({ name: 'Updated Name' });

      expect(mockPut).toHaveBeenCalledWith('me', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('throws on API failure', async () => {
      mockPut.mockRejectedValue(new Error('Server error'));

      await expect(userProfileService.updateProfile({ name: 'Test' })).rejects.toThrow('Server error');
    });
  });
});
