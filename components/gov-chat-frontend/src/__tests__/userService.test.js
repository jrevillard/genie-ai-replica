'use strict';

// A7: pins the getCurrentUserInfo repoint — GETs `me` (the sanitized doc route)
// and returns response.data directly, unwrapped.
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('../services/httpService', () => ({
  __esModule: true,
  default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }
}));

const userService = require('../services/userService').default;

describe('userService (A7 live surface)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('getCurrentUserInfo GETs `me` and returns the doc directly', async () => {
    const meDoc = { _key: 'users/123', iss_sub: 'iss#123', email: 'u@example.com', role: 'User', roles: ['user'] };
    mockGet.mockResolvedValue({ data: meDoc });

    await expect(userService.getCurrentUserInfo()).resolves.toEqual(meDoc);
    expect(mockGet).toHaveBeenCalledWith('me');
  });
});
