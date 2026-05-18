'use strict';

require('../setup-env');

// Tracker for fs operations — referenced by mock factory (Jest allows mock-prefixed vars)
const mockFsTracker = {
  rmCalls: [],
  existsResults: true
};

// Mock fs BEFORE requiring service — constructor uses it
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockImplementation(() => mockFsTracker.existsResults),
  readdirSync: jest.fn().mockReturnValue([]),
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(Buffer.from('filecontent')),
    rm: jest.fn().mockImplementation((...args) => {
      mockFsTracker.rmCalls.push(args);
      return Promise.resolve();
    })
  }
}));

jest.mock('path', () => ({
  join: jest.fn((...parts) => parts.join('/')),
  extname: jest.fn((name) => {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.substring(dot) : '';
  })
}));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

jest.mock('../../middleware/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'NotFoundError';
    }
  }
}));

jest.mock('../../services/path-sanitizer', () => ({
  sanitizePath: jest.fn((base, name) => `${base}/${name}`)
}));

jest.mock('../../constants/jit-fields', () => ({
  JIT_PROTECTED_FIELDS: ['email', 'firstName', 'lastName', 'username']
}));

function createMockCollection() {
  return {
    save: jest.fn(),
    update: jest.fn().mockImplementation(async (_id, data, opts) => {
      if (opts && opts.returnNew) {
        return { new: { _key: _id, ...data } };
      }
      return { _key: _id, ...data };
    }),
    document: jest.fn().mockResolvedValue({
      _key: 'user-1',
      email: 'user@example.com',
      firstName: 'John',
      lastName: 'Doe',
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    remove: jest.fn(),
    replace: jest.fn().mockResolvedValue({ _key: 'user-1' })
  };
}

let userProfileService;
let mockDb;
let mockUsers;

beforeEach(() => {
  jest.clearAllMocks();
  mockFsTracker.rmCalls = [];
  mockFsTracker.existsResults = true;

  mockUsers = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      if (name === 'users') return mockUsers;
      return createMockCollection();
    }),
    query: jest.fn()
  };

  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    userProfileService = require('../../services/user-profile-service');
  });
  userProfileService.initialized = false;
});

describe('UserProfileService', () => {
  beforeEach(async () => {
    await userProfileService.init();
  });

  describe('init', () => {
    it('should initialize users collection', async () => {
      expect(mockDb.collection).toHaveBeenCalledWith('users');
      expect(userProfileService.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      userProfileService.initialized = true;
      await userProfileService.init();
      const { dbService: ds } = require('../../shared-lib');
      expect(ds.getConnection).toHaveBeenCalledTimes(1);
    });

    it('should throw on DB failure', async () => {
      const { dbService: ds } = require('../../shared-lib');
      ds.getConnection.mockRejectedValueOnce(new Error('DB down'));
      jest.isolateModules(() => {
        userProfileService = require('../../services/user-profile-service');
      });
      userProfileService.initialized = false;
      await expect(userProfileService.init()).rejects.toThrow('DB down');
    });
  });

  describe('getUserProfile', () => {
    it('should return user document', async () => {
      const result = await userProfileService.getUserProfile('user-1');
      expect(mockUsers.document).toHaveBeenCalledWith('user-1');
      expect(result._key).toBe('user-1');
    });

    it('should merge customSettings into top level', async () => {
      mockUsers.document.mockResolvedValueOnce({
        _key: 'user-1',
        email: 'user@example.com',
        customSettings: { muslimPreferences: { halalOnly: true } }
      });
      const result = await userProfileService.getUserProfile('user-1');
      expect(result.muslimPreferences).toEqual({ halalOnly: true });
    });

    it('should propagate DB errors', async () => {
      mockUsers.document.mockRejectedValueOnce(new Error('Not found'));
      await expect(userProfileService.getUserProfile('invalid')).rejects.toThrow('Not found');
    });
  });

  describe('userExists', () => {
    it('should return true when user exists', async () => {
      const result = await userProfileService.userExists('user-1');
      expect(result).toBe(true);
    });

    it('should return false on 404', async () => {
      const error = new Error('Not found');
      error.code = 404;
      mockUsers.document.mockRejectedValueOnce(error);
      const result = await userProfileService.userExists('missing');
      expect(result).toBe(false);
    });

    it('should throw on non-404 errors', async () => {
      mockUsers.document.mockRejectedValueOnce(new Error('DB down'));
      await expect(userProfileService.userExists('user-1')).rejects.toThrow('DB down');
    });
  });

  describe('updateUserProfile', () => {
    it('should parse JSON string profileData', async () => {
      mockUsers.document.mockResolvedValueOnce({ _key: 'user-1', email: 'test@test.com' });
      mockUsers.document.mockResolvedValueOnce({ _key: 'user-1', phone: '123' });
      await userProfileService.updateUserProfile('user-1', '{"phone": "123"}');
      expect(mockUsers.update).toHaveBeenCalled();
    });

    it('should default to empty object on invalid JSON', async () => {
      mockUsers.document.mockResolvedValueOnce({ _key: 'user-1', email: 'test@test.com' });
      mockUsers.document.mockResolvedValueOnce({ _key: 'user-1' });
      await userProfileService.updateUserProfile('user-1', 'not json');
      expect(mockUsers.update).toHaveBeenCalled();
    });

    it('should throw NotFoundError when user does not exist', async () => {
      const error = new Error('Not found');
      error.code = 404;
      mockUsers.document.mockRejectedValueOnce(error);
      await expect(
        userProfileService.updateUserProfile('missing', { phone: '123' })
      ).rejects.toThrow('not found');
    });
  });

  describe('protected field stripping', () => {
    it('should strip JIT_PROTECTED_FIELDS from profileData', async () => {
      mockUsers.document.mockResolvedValueOnce({ _key: 'user-1', email: 'test@test.com' });
      mockUsers.document.mockResolvedValueOnce({ _key: 'user-1' });
      await userProfileService.updateUserProfile('user-1', {
        email: 'new@test.com',
        firstName: 'New',
        phone: '123'
      });
      const updateCall = mockUsers.update.mock.calls[0];
      expect(updateCall[1].email).toBeUndefined();
      expect(updateCall[1].firstName).toBeUndefined();
      expect(updateCall[1].phone).toBe('123');
    });
  });

  describe('storeFile', () => {
    it('should write file from buffer and return URL', async () => {
      const file = { originalname: 'photo.jpg', buffer: Buffer.from('imgdata') };
      const result = await userProfileService.storeFile(file, 'user-1', 'personalIdentification-photo');
      expect(result).toContain('/Uploads/user-1/personalIdentification-photo-');
      expect(result).toMatch(/\.jpg$/);
    });

    it('should return null on error', async () => {
      const file = { originalname: 'bad.txt', buffer: null, path: null };
      const result = await userProfileService.storeFile(file, 'user-1', 'test');
      expect(result).toBeNull();
    });
  });

  describe('deleteUserFiles', () => {
    it('should remove user directory when it exists', async () => {
      await userProfileService.deleteUserFiles({ _key: 'user-1' });
      expect(mockFsTracker.rmCalls.length).toBe(1);
      expect(mockFsTracker.rmCalls[0][0]).toContain('Uploads/user-1');
      expect(mockFsTracker.rmCalls[0][1]).toEqual({ recursive: true, force: true });
    });

    it('should do nothing when directory does not exist', async () => {
      mockFsTracker.existsResults = false;
      await userProfileService.deleteUserFiles({ _key: 'user-1' });
      expect(mockFsTracker.rmCalls.length).toBe(0);
    });
  });

  describe('resetUserData', () => {
    it('should reset user data preserving createdAt', async () => {
      mockUsers.document.mockResolvedValue({
        _key: 'user-1',
        email: 'user@test.com',
        firstName: 'John',
        createdAt: '2026-01-01T00:00:00.000Z'
      });
      const result = await userProfileService.resetUserData('user-1');
      expect(result.success).toBe(true);
      expect(result.fieldsPreserved).toBeGreaterThan(0);
      expect(mockUsers.replace).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ createdAt: '2026-01-01T00:00:00.000Z' })
      );
    });

    it('should throw NotFoundError when user not found', async () => {
      mockUsers.document.mockRejectedValueOnce(new Error('Not found'));
      await expect(userProfileService.resetUserData('missing')).rejects.toThrow();
    });

    it('should fallback to update with overwrite on replace failure', async () => {
      mockUsers.document.mockResolvedValue({
        _key: 'user-1',
        createdAt: '2026-01-01T00:00:00.000Z'
      });
      mockUsers.replace.mockRejectedValueOnce(new Error('replace fail'));
      const result = await userProfileService.resetUserData('user-1');
      expect(result.success).toBe(true);
      expect(mockUsers.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ createdAt: '2026-01-01T00:00:00.000Z' }),
        expect.objectContaining({ overwrite: true })
      );
    });
  });
});
