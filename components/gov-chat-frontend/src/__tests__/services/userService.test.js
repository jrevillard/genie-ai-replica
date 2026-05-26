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

const userService = require('@/services/userService').default;

describe('userService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('singleton pattern', () => {
    it('exports a singleton instance', () => {
      const instance1 = require('@/services/userService').default;
      const instance2 = require('@/services/userService').default;
      expect(instance1).toBe(instance2);
    });
  });

  describe('resetUserData', () => {
    it('resets user profile data', async () => {
      const resetResult = { success: true, message: 'Data reset' };
      mockPost.mockResolvedValue({ data: resetResult });

      const result = await userService.resetUserData();

      expect(mockPost).toHaveBeenCalledWith('me/reset-data');
      expect(result).toEqual(resetResult);
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(userService.resetUserData()).rejects.toThrow('Server error');
    });
  });

  describe('deleteAccount', () => {
    it('deletes user account (GDPR right to erasure)', async () => {
      const deleteResult = { success: true, message: 'Account deleted' };
      mockPost.mockResolvedValue({ data: deleteResult });

      const result = await userService.deleteAccount();

      expect(mockPost).toHaveBeenCalledWith('me/delete');
      expect(result).toEqual(deleteResult);
    });

    it('handles 401 unauthorized (expired token)', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401, data: { error: 'TOKEN_EXPIRED' } };
      mockPost.mockRejectedValue(error);

      await expect(userService.deleteAccount()).rejects.toThrow('Unauthorized');
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(userService.deleteAccount()).rejects.toThrow('Server error');
    });
  });
});
