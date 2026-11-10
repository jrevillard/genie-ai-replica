'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
    readdir: jest.fn().mockResolvedValue([]),
    unlink: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
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

const { dbService } = require('../../shared-lib');

// The backup streams documents via `for await...of` (issue #1762) — the
// mock cursor must be async-iterable.
function makeIterableCursor(docs) {
  let i = 0;
  return {
    all: jest.fn().mockResolvedValue(docs),
    next: jest.fn(async () => (i < docs.length ? docs[i++] : null)),
    [Symbol.asyncIterator]() {
      return {
        next: async () => (i < docs.length ? { value: docs[i++], done: false } : { value: undefined, done: true })
      };
    }
  };
}

function createMockCollection(name) {
  return {
    name,
    compact: jest.fn().mockResolvedValue(undefined),
    indexes: jest.fn().mockResolvedValue([])
  };
}

let service;
let mockDb;

beforeEach(() => {
  jest.clearAllMocks();

  mockDb = {
    query: jest.fn().mockResolvedValue(makeIterableCursor([])),
    listCollections: jest.fn().mockResolvedValue([]),
    collections: jest.fn().mockResolvedValue([]),
    collection: jest.fn().mockImplementation((name) => createMockCollection(name)),
    version: jest.fn().mockResolvedValue('3.12.0'),
    route: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ body: {} }) })
  };

  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    service = require('../../services/database-operations-service');
  });
  service.initialized = false;
});

describe('DatabaseOperationsService', () => {
  describe('init', () => {
    it('should initialize successfully', async () => {
      await service.init();
      expect(service.initialized).toBe(true);
      expect(dbService.getConnection).toHaveBeenCalledWith('default');
    });

    it('should skip re-initialization', async () => {
      await service.init();
      await service.init();
      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
    });

    it('should throw on database connection failure', async () => {
      dbService.getConnection.mockRejectedValue(new Error('Connection failed'));
      await expect(service.init()).rejects.toThrow('Connection failed');
    });
  });

  describe('backupDatabase', () => {
    let mockWriteStream;

    beforeEach(async () => {
      mockWriteStream = {
        write: jest.fn().mockReturnValue(true), // the real stream reports "no backpressure"
        end: jest.fn(),
        on: jest.fn().mockImplementation(function (event, cb) {
          if (event === 'finish') {
            setTimeout(cb, 0);
          }
          return this;
        })
      };

      jest.spyOn(require('fs'), 'createWriteStream').mockReturnValue(mockWriteStream);

      await service.init();
    });

    it('should return success result on successful backup', async () => {
      mockDb.listCollections.mockResolvedValue([
        { name: 'users', isSystem: false },
        { name: 'conversations', isSystem: false },
        { name: '_system', isSystem: true }
      ]);

      mockDb.query.mockImplementation(() => Promise.resolve(makeIterableCursor([{ _key: 'doc1' }])));

      const result = await service.backupDatabase();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Database backup completed');
      expect(result.collections).toBe(2);
      expect(result.backupFile).toMatch(/^huduma_backup_.*\.json$/);
    });

    it('streams documents without ever stringifying a whole collection', async () => {
      // Issue #1762: the backup stringified each collection's ENTIRE array
      // into one string — a 46,938-doc collection crossed V8's string cap
      // and 500'd after 34s of successful work. Every write must stay at
      // document size, whatever the collection holds.
      const bigDoc = { _key: 'big', blob: 'x'.repeat(400000) };
      mockDb.listCollections.mockResolvedValue([{ name: 'big_collection', isSystem: false }]);
      mockDb.query.mockImplementation(() => Promise.resolve(makeIterableCursor([bigDoc, { _key: 'small' }])));

      const result = await service.backupDatabase();
      expect(result.success).toBe(true);

      const writes = mockWriteStream.write.mock.calls.map((c) => c[0]);
      // The collection header opens the array...
      expect(writes.some((w) => w.includes('"big_collection": ['))).toBe(true);
      // ...and the big document is written AS ONE DOCUMENT, never inside a
      // whole-array string.
      expect(writes.some((w) => w.startsWith('{"_key":"big"'))).toBe(true);
      // The biggest single write is the biggest single DOCUMENT (bounded by
      // document size + a separator), never a multi-document array.
      const biggest = Math.max(...writes.map((w) => w.length));
      expect(biggest).toBeLessThan(400100);
      expect(writes.every((w) => !(w.includes('"_key":"big"') && w.includes('"_key":"small"')))).toBe(true);
    });

    it('removes the partial backup file when a mid-backup failure fires', async () => {
      // Issue #1762: the streaming backup persists incrementally — a
      // mid-backup failure must not leave bytes on disk that look complete.
      mockDb.listCollections.mockResolvedValue([
        { name: 'users', isSystem: false },
        { name: 'broken', isSystem: false }
      ]);
      mockDb.query
        .mockImplementationOnce(() => Promise.resolve(makeIterableCursor([{ _key: 'u1' }])))
        .mockRejectedValueOnce(new Error('AQL: collection not found'));

      const result = await service.backupDatabase();

      expect(result.success).toBe(false);
      expect(result.error).toBe('AQL: collection not found');
      expect(require('fs').promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/huduma_backup_.*\.json$/));
    });

    it('does not destroy a completed backup when a late step fails', async () => {
      // A failure AFTER the stream finished (stat/compress/cleanup) leaves a
      // COMPLETE backup — the cleanup guard must not unlink it.
      mockDb.listCollections.mockResolvedValue([{ name: 'users', isSystem: false }]);
      mockDb.query.mockImplementation(() => Promise.resolve(makeIterableCursor([{ _key: 'u1' }])));
      require('fs').promises.stat.mockRejectedValueOnce(new Error('stat failed'));

      const result = await service.backupDatabase();

      expect(result.success).toBe(false);
      expect(require('fs').promises.unlink).not.toHaveBeenCalled();
    });

    it('should skip system collections during backup', async () => {
      mockDb.listCollections.mockResolvedValue([
        { name: '_graphs', isSystem: true },
        { name: '_statistics', isSystem: true }
      ]);

      const result = await service.backupDatabase();
      expect(result.success).toBe(true);
      expect(result.collections).toBe(0);
    });

    it('should return failure result on backup error', async () => {
      mockDb.listCollections.mockRejectedValue(new Error('List failed'));

      const result = await service.backupDatabase();
      expect(result.success).toBe(false);
      expect(result.error).toBe('List failed');
    });
  });

  describe('optimizeDatabase', () => {
    beforeEach(async () => {
      await service.init();
    });

    it('should optimize all collections and return results', async () => {
      const mockColl1 = createMockCollection('users');
      const mockColl2 = createMockCollection('messages');

      mockDb.collections.mockResolvedValue([mockColl1, mockColl2]);

      const result = await service.optimizeDatabase();

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({
        collection: 'users',
        status: 'success',
        indexSuggestions: []
      });
      expect(mockColl1.compact).toHaveBeenCalled();
    });

    it('should handle collection optimization error gracefully', async () => {
      const mockColl = createMockCollection('bad_coll');
      mockColl.compact.mockRejectedValue(new Error('Compact failed'));

      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.optimizeDatabase();

      expect(result.success).toBe(true);
      expect(result.results[0]).toEqual({
        collection: 'bad_coll',
        status: 'error',
        error: 'Compact failed'
      });
    });

    it('should return index suggestions for hash and skiplist indexes', async () => {
      const mockColl = {
        name: 'queries',
        compact: jest.fn().mockResolvedValue(undefined),
        indexes: jest.fn().mockResolvedValue([
          { type: 'hash', fields: ['email'], selectivityEstimate: 0.1 },
          { type: 'skiplist', fields: ['a', 'b', 'c', 'd'], selectivityEstimate: 0.9 }
        ])
      };
      mockDb.collections.mockResolvedValue([mockColl]);
      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toHaveLength(2);
      expect(result.results[0].indexSuggestions[0]).toContain('Low selectivity');
      expect(result.results[0].indexSuggestions[1]).toContain('multi-field');
    });

    it('should include index suggestions for low selectivity hash indexes', async () => {
      const mockColl = createMockCollection('users');
      mockColl.indexes.mockResolvedValue([{ type: 'hash', fields: ['email'], selectivityEstimate: 0.1 }]);
      mockDb.collections.mockResolvedValue([mockColl]);
      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toHaveLength(1);
      expect(result.results[0].indexSuggestions[0]).toContain('Low selectivity');
    });

    it('should include suggestions for complex multi-field skiplist indexes', async () => {
      const mockColl = createMockCollection('queries');
      mockColl.indexes.mockResolvedValue([
        { type: 'skiplist', fields: ['a', 'b', 'c', 'd'], selectivityEstimate: 0.9 }
      ]);
      mockDb.collections.mockResolvedValue([mockColl]);
      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toHaveLength(1);
      expect(result.results[0].indexSuggestions[0]).toContain('multi-field');
    });

    it('should return failure when collections() throws', async () => {
      mockDb.collections.mockRejectedValue(new Error('No collections'));

      const result = await service.optimizeDatabase();
      expect(result.success).toBe(false);
      expect(result.error).toBe('No collections');
    });

    it('should include index suggestions for low selectivity hash indexes', async () => {
      const mockColl = createMockCollection('users');
      mockColl.indexes.mockResolvedValue([{ type: 'hash', fields: ['status'], selectivityEstimate: 0.1 }]);
      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toContain('Low selectivity for hash index on status');
    });

    it('should include suggestions for complex multi-field skiplist indexes', async () => {
      const mockColl = createMockCollection('messages');
      mockColl.indexes.mockResolvedValue([{ type: 'skiplist', fields: ['a', 'b', 'c', 'd'] }]);
      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toContain(
        'Consider breaking down complex multi-field skiplist index on a, b, c, d'
      );
    });
  });

  describe('getDatabaseStats', () => {
    beforeEach(async () => {
      await service.init();
    });

    it('should return database statistics', async () => {
      const mockColl = createMockCollection('users');
      mockColl.figures = jest.fn().mockResolvedValue({
        figures: { alive: 100, documentsSize: 4096 }
      });

      mockDb.collections.mockResolvedValue([mockColl]);
      mockDb.route.mockReturnValue({
        get: jest.fn().mockResolvedValue({ body: { system: 'stats' } })
      });

      const result = await service.getDatabaseStats();

      expect(result.success).toBe(true);
      expect(result.totalTables).toBe(1);
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]).toEqual({
        name: 'users',
        count: 100,
        size: '4 KB'
      });
      expect(result.systemStats).toEqual({ system: 'stats' });
    });

    it('should handle empty collections', async () => {
      mockDb.collections.mockResolvedValue([]);

      const result = await service.getDatabaseStats();

      expect(result.success).toBe(true);
      expect(result.totalTables).toBe(0);
      expect(result.collections).toEqual([]);
    });

    it('should return failure on stats error', async () => {
      mockDb.collections.mockRejectedValue(new Error('DB error'));

      const result = await service.getDatabaseStats();

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });

    it('should skip collections without figures', async () => {
      const mockColl = createMockCollection('orphan');
      mockColl.figures = jest.fn().mockResolvedValue(null);

      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.getDatabaseStats();
      expect(result.collections).toEqual([]);
    });
  });

  describe('_formatSize', () => {
    beforeEach(async () => {
      await service.init();
    });

    it('should format 0 bytes', () => {
      expect(service._formatSize(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(service._formatSize(512)).toBe('512 B');
    });

    it('should format kilobytes', () => {
      expect(service._formatSize(1024)).toBe('1 KB');
    });

    it('should format megabytes', () => {
      expect(service._formatSize(1048576)).toBe('1 MB');
    });

    it('should format gigabytes', () => {
      expect(service._formatSize(1073741824)).toBe('1 GB');
    });
  });
});
