'use strict';

const { getUserId } = require('@/utils/userUtils');

describe('userUtils', () => {
  describe('getUserId', () => {
    it('returns undefined for null user', () => {
      expect(getUserId(null)).toBeUndefined();
    });

    it('returns undefined for undefined user', () => {
      expect(getUserId(undefined)).toBeUndefined();
    });

    it('returns undefined for user without iss_sub', () => {
      expect(getUserId({ name: 'Test' })).toBeUndefined();
    });

    it('returns iss_sub when present', () => {
      expect(getUserId({ iss_sub: 'user-123' })).toBe('user-123');
    });
  });

  describe('user availability guard', () => {
    // Mirrors the guard used in ChatFolders.loadConversations():
    //   if (!this.currentUser || !getUserId(this.currentUser)) { return; }
    function guardPasses(currentUser) {
      return currentUser != null && getUserId(currentUser) != null;
    }

    it('blocks when currentUser is null', () => {
      expect(guardPasses(null)).toBe(false);
    });

    it('blocks when currentUser is undefined', () => {
      expect(guardPasses(undefined)).toBe(false);
    });

    it('blocks when user has no iss_sub', () => {
      expect(guardPasses({ name: 'Test' })).toBe(false);
    });

    it('allows when user has iss_sub', () => {
      expect(guardPasses({ iss_sub: 'user-123' })).toBe(true);
    });
  });
});
