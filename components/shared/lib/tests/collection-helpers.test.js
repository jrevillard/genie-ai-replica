'use strict';

// Set env before requiring any module
process.env.SESSION_EXPIRATION_TIME = '1800000';

const { ensureCollection, clearCollectionCache } = require('../collection-helpers');

function createMockDb(existingCollections = []) {
  const collections = [...existingCollections];
  return {
    _name: 'test-db',
    listCollections: jest.fn().mockResolvedValue(
      collections.map((name) => ({ name }))
    ),
    createCollection: jest.fn().mockImplementation(async (name, opts) => {
      collections.push(name);
      return { name };
    }),
    collection: jest.fn().mockImplementation((name) => ({
      name,
      ensureIndex: jest.fn().mockResolvedValue({ id: 'idx-1' })
    }))
  };
}

describe('ensureCollection', () => {
  beforeEach(() => {
    clearCollectionCache();
    jest.clearAllMocks();
  });

  it('should create collection when it does not exist', async () => {
    const mockDb = createMockDb([]);

    const result = await ensureCollection(mockDb, 'users');

    expect(mockDb.createCollection).toHaveBeenCalledWith('users', {});
    expect(mockDb.collection).toHaveBeenCalledWith('users');
    expect(result.name).toBe('users');
  });

  it('should skip creation when collection already exists', async () => {
    const mockDb = createMockDb(['users', 'sessions']);

    await ensureCollection(mockDb, 'users');

    expect(mockDb.createCollection).not.toHaveBeenCalled();
    expect(mockDb.collection).toHaveBeenCalledWith('users');
  });

  it('should pass options to createCollection for edge collections', async () => {
    const mockDb = createMockDb([]);

    await ensureCollection(mockDb, 'userSessions', { type: 3 });

    expect(mockDb.createCollection).toHaveBeenCalledWith('userSessions', { type: 3 });
  });

  it('should cache results to avoid repeated listCollections calls', async () => {
    const mockDb = createMockDb([]);

    await ensureCollection(mockDb, 'users');
    await ensureCollection(mockDb, 'users');
    await ensureCollection(mockDb, 'users');

    expect(mockDb.listCollections).toHaveBeenCalledTimes(1);
    expect(mockDb.createCollection).toHaveBeenCalledTimes(1);
  });

  it('should cache independently per database name', async () => {
    const mockDb1 = createMockDb([]);
    mockDb1._name = 'db-1';
    const mockDb2 = createMockDb([]);
    mockDb2._name = 'db-2';

    await ensureCollection(mockDb1, 'users');
    await ensureCollection(mockDb2, 'users');

    expect(mockDb1.listCollections).toHaveBeenCalledTimes(1);
    expect(mockDb2.listCollections).toHaveBeenCalledTimes(1);
  });
});

describe('clearCollectionCache', () => {
  it('should allow subsequent calls to re-check collections', async () => {
    const mockDb = createMockDb([]);

    await ensureCollection(mockDb, 'users');
    clearCollectionCache();
    await ensureCollection(mockDb, 'users');

    expect(mockDb.listCollections).toHaveBeenCalledTimes(2);
  });
});
