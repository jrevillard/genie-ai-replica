'use strict';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
});

// Import httpService first to spy on it
import httpService from '@/services/httpService';

// Mock all HTTP methods
jest.spyOn(httpService, 'get').mockImplementation(() => Promise.resolve({ data: {} }));
jest.spyOn(httpService, 'post').mockImplementation(() => Promise.resolve({ data: {} }));
jest.spyOn(httpService, 'put').mockImplementation(() => Promise.resolve({ data: {} }));
jest.spyOn(httpService, 'delete').mockImplementation(() => Promise.resolve({ data: {} }));
jest.spyOn(httpService, 'patch').mockImplementation(() => Promise.resolve({ data: {} }));

const userService = require('@/services/userService').default;

describe('userService', () => {
  beforeEach(() => {
    // Reset all spies and their mock implementations
    jest.clearAllMocks();
    localStorage.clear();

    // Reset mock implementations
    httpService.get.mockImplementation(() => Promise.resolve({ data: {} }));
    httpService.post.mockImplementation(() => Promise.resolve({ data: {} }));
    httpService.put.mockImplementation(() => Promise.resolve({ data: {} }));
    httpService.delete.mockImplementation(() => Promise.resolve({ data: {} }));
    httpService.patch.mockImplementation(() => Promise.resolve({ data: {} }));
  });

  // ========================================================================
  // CRITICAL SECURITY METHODS
  // ========================================================================

  describe('deleteAccount', () => {
    it('should call POST /users/delete endpoint with reason', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Account deleted successfully' }
      });

      const result = await userService.deleteAccount('Leaving the platform');

      expect(httpService.post).toHaveBeenCalledWith(
        'users/delete',
        { reason: 'Leaving the platform' }
      );
      expect(result.success).toBe(true);
    });

    it('should clear user data from localStorage after successful deletion', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true }
      });
      localStorage.setItem('user', JSON.stringify({ accessToken: 'test-token', email: 'test@example.com' }));

      await userService.deleteAccount('Test');

      expect(localStorage.getItem('user')).toBeNull();
    });

    it('should throw but NOT clear user data if deletion fails', async () => {
      httpService.post.mockRejectedValue(new Error('Network error'));
      localStorage.setItem('user', JSON.stringify({ accessToken: 'test-token' }));

      await expect(userService.deleteAccount('Test')).rejects.toThrow('Network error');
      // Note: User data is NOT cleared on failure for deleteAccount
      expect(localStorage.getItem('user')).not.toBeNull();
    });

    it('should handle empty reason', async () => {
      httpService.post.mockResolvedValue({ data: { success: true } });

      await userService.deleteAccount();

      expect(httpService.post).toHaveBeenCalledWith('users/delete', { reason: '' });
    });
  });

  describe('deactivateAccount', () => {
    it('should call POST /users/deactivate endpoint with reason', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Account deactivated successfully' }
      });

      const result = await userService.deactivateAccount('Taking a break');

      expect(httpService.post).toHaveBeenCalledWith(
        'users/deactivate',
        { reason: 'Taking a break' }
      );
      expect(result.success).toBe(true);
    });

    it('should throw error if deactivation fails', async () => {
      httpService.post.mockRejectedValue(new Error('Deactivation failed'));

      await expect(userService.deactivateAccount('Test')).rejects.toThrow('Deactivation failed');
    });
  });

  describe('reactivateAccount', () => {
    it('should call POST /users/reactivate endpoint', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Account reactivated successfully' }
      });

      const result = await userService.reactivateAccount();

      expect(httpService.post).toHaveBeenCalledWith('users/reactivate');
      expect(result.success).toBe(true);
    });
  });

  describe('updateUserRole', () => {
    it('should call PUT /users/:userId with role data', async () => {
      httpService.put.mockResolvedValue({
        data: { success: true, data: { _key: 'users/123', roles: ['admin'] } }
      });

      const result = await userService.updateUserRole('users/123', {
        role: 'admin',
        disabled: false
      });

      expect(httpService.put).toHaveBeenCalledWith(
        'users/users/123',
        { role: 'admin', disabled: false }
      );
      // updateUserRole returns the full response, so result.data contains the axios response data
      expect(result.data.data.roles).toContain('admin');
    });

    it('should log the role update operation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      httpService.put.mockResolvedValue({ data: { success: true } });

      await userService.updateUserRole('users/123', { role: 'admin' });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating role for user users/123')
      );
      consoleSpy.mockRestore();
    });

    it('should handle update errors gracefully', async () => {
      httpService.put.mockRejectedValue(new Error('Insufficient permissions'));

      await expect(userService.updateUserRole('users/123', { role: 'admin' }))
        .rejects.toThrow('Insufficient permissions');
    });
  });

  describe('forceUserLogout', () => {
    it('should call POST /users/admin/users/:userId/force-logout', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'User logged out' }
      });

      const result = await userService.forceUserLogout('users/123');

      expect(httpService.post).toHaveBeenCalledWith('users/admin/users/users/123/force-logout');
      expect(result.success).toBe(true);
    });

    it('should log the force logout operation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      httpService.post.mockResolvedValue({ data: { success: true } });

      await userService.forceUserLogout('users/123');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempting force logout for user users/123')
      );
      consoleSpy.mockRestore();
    });

    it('should handle force logout errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      httpService.post.mockRejectedValue(new Error('User not found'));

      await expect(userService.forceUserLogout('users/999')).rejects.toThrow('User not found');
      consoleSpy.mockRestore();
    });
  });

  describe('getAllUsers', () => {
    it('should call GET /admin/users with query options', async () => {
      const mockUsers = {
        data: {
          users: [
            { _key: 'users/1', email: 'user1@example.com' },
            { _key: 'users/2', email: 'user2@example.com' }
          ],
          total: 2
        }
      };
      httpService.get.mockResolvedValue(mockUsers);

      const result = await userService.getAllUsers({ limit: 10, offset: 0 });

      expect(httpService.get).toHaveBeenCalledWith('admin/users', {
        params: { limit: 10, offset: 0 }
      });
      expect(result.data.users).toHaveLength(2);
    });

    it('should handle empty options', async () => {
      httpService.get.mockResolvedValue({ data: { users: [], total: 0 } });

      await userService.getAllUsers();

      expect(httpService.get).toHaveBeenCalledWith('admin/users', { params: {} });
    });
  });

  describe('getUserProfile', () => {
    it('should call GET /users/:userId with admin flag', async () => {
      httpService.get.mockResolvedValue({
        data: { _key: 'users/123', email: 'test@example.com', roles: ['user'] }
      });

      const result = await userService.getUserProfile('users/123');

      expect(httpService.get).toHaveBeenCalledWith('users/users/123', {
        params: { admin: true }
      });
    });
  });

  describe('verifyUserEmail', () => {
    it('should call POST /admin/users/:userId/verify-email', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Email verified' }
      });

      const result = await userService.verifyUserEmail('users/123');

      expect(httpService.post).toHaveBeenCalledWith('admin/users/users/123/verify-email');
      // verifyUserEmail returns the full response (not just response.data)
      expect(result.data.success).toBe(true);
    });
  });

  describe('resendVerificationEmailAdmin', () => {
    it('should call POST /users/admin/users/:userId/resend-verification', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Verification email sent' }
      });

      const result = await userService.resendVerificationEmailAdmin('users/123');

      expect(httpService.post).toHaveBeenCalledWith('users/admin/users/users/123/resend-verification');
      expect(result.success).toBe(true);
    });

    it('should log the resend operation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      httpService.post.mockResolvedValue({ data: { success: true } });

      await userService.resendVerificationEmailAdmin('users/123');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempting to resend verification email for user: users/123')
      );
      consoleSpy.mockRestore();
    });
  });

  // ========================================================================
  // PROFILE MANAGEMENT METHODS
  // ========================================================================

  describe('updateAccountSettings', () => {
    it('should call PUT /users/settings with settings object', async () => {
      httpService.put.mockResolvedValue({
        data: { success: true, message: 'Settings updated' }
      });

      const settings = { theme: 'dark', language: 'fr', notifications: true };
      const result = await userService.updateAccountSettings(settings);

      expect(httpService.put).toHaveBeenCalledWith('users/settings', settings);
      expect(result.success).toBe(true);
    });
  });

  describe('updateEmail', () => {
    it('should call PUT /users/email with new email and userId', async () => {
      httpService.put.mockResolvedValue({
        data: { success: true, message: 'Email updated' }
      });

      const result = await userService.updateEmail('new@example.com', 'users/123');

      expect(httpService.put).toHaveBeenCalledWith('users/email', {
        email: 'new@example.com',
        userId: 'users/123'
      });
      expect(result.success).toBe(true);
    });

    it('should log the email update operation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      httpService.put.mockResolvedValue({ data: { success: true } });

      await userService.updateEmail('new@example.com', 'users/123');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating email to: new@example.com')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('uploadAvatar', () => {
    it('should call POST /users/avatar with FormData', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, avatarUrl: 'https://example.com/avatar.jpg' }
      });

      const mockFile = new File(['fake content'], 'avatar.jpg', { type: 'image/jpeg' });
      const result = await userService.uploadAvatar(mockFile);

      expect(httpService.post).toHaveBeenCalledWith(
        'users/avatar',
        expect.any(FormData),
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
    });
  });

  describe('deleteAvatar', () => {
    it('should call DELETE /users/avatar', async () => {
      httpService.delete.mockResolvedValue({
        data: { success: true, message: 'Avatar deleted' }
      });

      const result = await userService.deleteAvatar();

      expect(httpService.delete).toHaveBeenCalledWith('users/avatar');
      expect(result.success).toBe(true);
    });
  });

  describe('getAccountStatus', () => {
    it('should call GET /users/status', async () => {
      httpService.get.mockResolvedValue({
        data: {
          status: 'active',
          emailVerified: true,
          accountCreated: '2026-01-01T00:00:00.000Z'
        }
      });

      const result = await userService.getAccountStatus();

      expect(httpService.get).toHaveBeenCalledWith('users/status');
      expect(result.status).toBe('active');
      expect(result.emailVerified).toBe(true);
    });
  });

  describe('getActivityLog', () => {
    it('should call GET /users/activity with pagination params', async () => {
      httpService.get.mockResolvedValue({
        data: {
          activities: [
            { type: 'login', timestamp: '2026-04-01T10:00:00Z' }
          ],
          total: 1
        }
      });

      const result = await userService.getActivityLog(2, 20);

      expect(httpService.get).toHaveBeenCalledWith('users/activity', {
        params: { page: 2, limit: 20 }
      });
      expect(result.activities).toHaveLength(1);
    });

    it('should use default pagination values', async () => {
      httpService.get.mockResolvedValue({ data: { activities: [], total: 0 } });

      await userService.getActivityLog();

      expect(httpService.get).toHaveBeenCalledWith('users/activity', {
        params: { page: 1, limit: 20 }
      });
    });
  });

  // ========================================================================
  // VERIFICATION METHODS
  // ========================================================================

  describe('verifyEmail', () => {
    it('should call POST /users/verify-email with token', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Email verified successfully' }
      });

      const result = await userService.verifyEmail('verify-token-123');

      expect(httpService.post).toHaveBeenCalledWith('users/verify-email', {
        token: 'verify-token-123'
      });
      expect(result.success).toBe(true);
    });
  });

  describe('resendVerificationEmail', () => {
    it('should call POST /users/resend-verification with email', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Verification email sent' }
      });

      const result = await userService.resendVerificationEmail('test@example.com');

      expect(httpService.post).toHaveBeenCalledWith('users/resend-verification', {
        email: 'test@example.com'
      });
      expect(result.success).toBe(true);
    });
  });

  // ========================================================================
  // CLIENT-SIDE VALIDATION METHODS
  // ========================================================================

  describe('validatePasswordStrength', () => {
    it('should reject passwords shorter than 8 characters', () => {
      const result = userService.validatePasswordStrength('short');

      expect(result.isValid).toBe(false);
      expect(result.score).toBe(0);
      expect(result.feedback.warnings).toContain('Password is too short');
    });

    it('should reject passwords with only lowercase letters', () => {
      const result = userService.validatePasswordStrength('lowercase');

      expect(result.isValid).toBe(false);
      expect(result.score).toBe(1);
      expect(result.feedback.warnings).toContain('Password contains only letters');
    });

    it('should reject passwords with only numbers', () => {
      const result = userService.validatePasswordStrength('12345678');

      expect(result.isValid).toBe(false);
      expect(result.score).toBe(1);
      expect(result.feedback.warnings).toContain('Password contains only numbers');
    });

    it('should accept strong passwords', () => {
      const result = userService.validatePasswordStrength('Str0ng!Pass');

      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it('should give highest score to very strong passwords', () => {
      const result = userService.validatePasswordStrength('V3ry$tr0ng!P@ssw0rd2026');

      expect(result.isValid).toBe(true);
      expect(result.score).toBe(4);
    });

    it('should detect repeated characters', () => {
      const result = userService.validatePasswordStrength('aaaabbbb');

      expect(result.feedback.warnings).toContain('Password contains repeated characters');
    });

    it('should provide suggestions for weak passwords', () => {
      const result = userService.validatePasswordStrength('weak');

      expect(result.feedback.suggestions.length).toBeGreaterThan(0);
      expect(result.feedback.suggestions).toContain('Use at least 8 characters');
    });
  });

  describe('doPasswordsMatch', () => {
    it('should return true for matching passwords', () => {
      expect(userService.doPasswordsMatch('Password123', 'Password123')).toBe(true);
    });

    it('should return false for non-matching passwords', () => {
      expect(userService.doPasswordsMatch('Password123', 'Password456')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(userService.doPasswordsMatch('Password123', 'password123')).toBe(false);
    });
  });

  // ========================================================================
  // AUTH METHODS
  // ========================================================================

  describe('logout', () => {
    it('should call POST /auth/logout and clear user data', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Logged out successfully' }
      });
      localStorage.setItem('user', JSON.stringify({ accessToken: 'test-token' }));

      const result = await userService.logout();

      expect(httpService.post).toHaveBeenCalledWith('auth/logout', {}, {
        headers: { 'Authorization': 'Bearer test-token' }
      });
      expect(result.success).toBe(true);
      expect(localStorage.getItem('user')).toBeNull();
    });

    it('should clear user data even if logout request fails', async () => {
      httpService.post.mockRejectedValue(new Error('Network error'));
      localStorage.setItem('user', JSON.stringify({ accessToken: 'test-token' }));

      await expect(userService.logout()).rejects.toThrow('Network error');
      expect(localStorage.getItem('user')).toBeNull();
    });

    it('should handle missing access token gracefully', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true, message: 'Logged out successfully (no token)' }
      });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await userService.logout();

      expect(consoleSpy).toHaveBeenCalledWith('No access token found for logout');
      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('fetchCurrentUser', () => {
    it('should call GET /auth/me and return user', async () => {
      httpService.get.mockResolvedValue({
        data: {
          user: {
            _key: 'users/123',
            email: 'test@example.com',
            name: 'Test User'
          }
        }
      });

      const result = await userService.fetchCurrentUser();

      expect(httpService.get).toHaveBeenCalledWith('auth/me');
      expect(result.email).toBe('test@example.com');
    });

    it('should throw error if request fails', async () => {
      httpService.get.mockRejectedValue(new Error('Unauthorized'));

      await expect(userService.fetchCurrentUser()).rejects.toThrow('Unauthorized');
    });
  });

  describe('getCurrentUser', () => {
    it('should return parsed user from localStorage', () => {
      const userData = { accessToken: 'token', email: 'test@example.com' };
      localStorage.setItem('user', JSON.stringify(userData));

      const result = userService.getCurrentUser();

      expect(result).toEqual(userData);
    });

    it('should return null if no user in localStorage', () => {
      const result = userService.getCurrentUser();

      expect(result).toBeNull();
    });

    it('should return null if localStorage data is invalid JSON', () => {
      localStorage.setItem('user', 'invalid-json');

      const result = userService.getCurrentUser();

      expect(result).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when user exists with accessToken', () => {
      localStorage.setItem('user', JSON.stringify({
        accessToken: 'valid-token',
        email: 'test@example.com'
      }));

      expect(userService.isAuthenticated()).toBe(true);
    });

    it('should return false when no user in localStorage', () => {
      expect(userService.isAuthenticated()).toBe(false);
    });

    it('should return false when user exists but no accessToken', () => {
      localStorage.setItem('user', JSON.stringify({ email: 'test@example.com' }));

      expect(userService.isAuthenticated()).toBe(false);
    });
  });

  describe('getCurrentUserInfo', () => {
    it('should return cached user from localStorage if available', async () => {
      const cachedUser = { _key: 'users/123', email: 'cached@example.com' };
      localStorage.setItem('user', JSON.stringify(cachedUser));

      const result = await userService.getCurrentUserInfo();

      expect(result).toEqual(cachedUser);
    });

    it('should fetch from server if no cached user', async () => {
      httpService.get.mockResolvedValue({
        data: {
          user: { _key: 'users/123', email: 'fresh@example.com' }
        }
      });

      const result = await userService.getCurrentUserInfo();

      expect(httpService.get).toHaveBeenCalledWith('auth/me');
      expect(result.email).toBe('fresh@example.com');
    });
  });

  describe('refreshUserData', () => {
    it('should fetch from server and update localStorage', async () => {
      const freshUser = { _key: 'users/123', email: 'updated@example.com' };
      httpService.get.mockResolvedValue({
        data: { user: freshUser }
      });
      localStorage.setItem('user', JSON.stringify({ _key: 'users/123', email: 'old@example.com' }));

      const result = await userService.refreshUserData();

      expect(httpService.get).toHaveBeenCalledWith('auth/me');
      expect(result.email).toBe('updated@example.com');
      expect(JSON.parse(localStorage.getItem('user')).email).toBe('updated@example.com');
    });

    it('should not throw if refresh fails (background operation)', async () => {
      httpService.get.mockRejectedValue(new Error('Network error'));

      const result = await userService.refreshUserData();

      expect(result).toBeNull();
    });
  });

  describe('resetUserData', () => {
    it('should call POST /users/reset-data and refresh user data', async () => {
      httpService.post.mockResolvedValue({
        data: { success: true }
      });
      httpService.get.mockResolvedValue({
        data: { user: { _key: 'users/123', resetData: true } }
      });

      await userService.resetUserData();

      expect(httpService.post).toHaveBeenCalledWith('users/reset-data');
    });
  });
});
