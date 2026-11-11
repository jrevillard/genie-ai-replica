'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

// One fs.promises mock instance for every registry: jest.isolateModules (in
// beforeEach) re-invokes jest.mock factories, so a factory-literal promises
// object gives the SERVICE one set of jest.fns and the TEST another — fs
// assertions read a different instance than the code writes to (the
// out-of-scope `mock` prefix is jest's allow-list for factory references).
const mockFsPromises = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
  readdir: jest.fn().mockResolvedValue([]),
  unlink: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: mockFsPromises
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
    dbService: { getConnection: jest.fn() },
    // The real formatters — sizes come from the shared helpers now
    // (issue #1761/#1762 review: one formatSize + one figures() decode,
    // not three drifting copies).
    ...require('../../../shared/lib/format-utils')
  }),
  { virtual: true }
);

const { dbService } = require('../../shared-lib');

// The backup consumes the cursor ONLY via `for await...of` (issue #1762) —
// the mock carries exactly that surface, no dead cursor.all().
function makeIterableCursor(docs) {
  let i = 0;
  return {
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
      // A real EventEmitter: the backup now registers persistent error
      // listeners and per-write drain/error pairs (issue #1762 review).
      const { EventEmitter } = require('events');
      mockWriteStream = Object.assign(new EventEmitter(), {
        write: jest.fn().mockReturnValue(true), // the real stream reports "no backpressure"
        end: jest.fn(function () {
          setImmediate(() => this.emit('finish'));
        })
      });

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

      // The streamed envelope must be parseable JSON — the format change
      // (compact arrays, comma-prefixed collection blocks) stays honest.
      const joined = mockWriteStream.write.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(joined);
      expect(parsed._metadata.name).toBe(process.env.ARANGO_DB);
      expect(parsed.users).toEqual([{ _key: 'doc1' }]);
    });

    it('produces valid JSON for a database with zero non-system collections', async () => {
      // A trailing comma after the metadata once made an empty database's
      // backup unparseable while still reporting success.
      mockDb.listCollections.mockResolvedValue([{ name: '_system', isSystem: true }]);

      const result = await service.backupDatabase();
      expect(result.success).toBe(true);

      const joined = mockWriteStream.write.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(joined);
      expect(Object.keys(parsed)).toEqual(['_metadata']);
    });

    it('fails the backup (and cleans up) when the stream errors mid-backup', async () => {
      // Issue #1762 review: a stream error with no listener crashed the
      // process or hung the request on a never-firing drain. The backup
      // must reject, return a failure result, and remove the partial file.
      mockDb.listCollections.mockResolvedValue([
        { name: 'users', isSystem: false },
        { name: 'broken', isSystem: false }
      ]);
      mockDb.query
        .mockImplementationOnce(() => Promise.resolve(makeIterableCursor([{ _key: 'u1' }])))
        .mockImplementationOnce(() => Promise.resolve(makeIterableCursor([])));
      mockWriteStream.write.mockImplementation((chunk) => {
        if (chunk.includes('"broken"')) {
          process.nextTick(() => mockWriteStream.emit('error', new Error('ENOSPC: no space left on device')));
        }
        return true;
      });

      const result = await service.backupDatabase();

      expect(result.success).toBe(false);
      expect(require('fs').promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/huduma_backup_.*\.json$/));
    });

    it('streams documents in bounded chunks, never a whole collection', async () => {
      // Issue #1762: the backup stringified each collection's ENTIRE array
      // into one string — a 46,938-doc collection crossed V8's string cap
      // and 500'd after 34s of successful work. Chunks are capped at 256
      // docs / 1 MiB (plus one document), whatever the collection holds.
      const bigDoc = { _key: 'big', blob: 'x'.repeat(400000) };
      mockDb.listCollections.mockResolvedValue([{ name: 'big_collection', isSystem: false }]);
      mockDb.query.mockImplementation(() => Promise.resolve(makeIterableCursor([bigDoc, { _key: 'small' }])));

      const result = await service.backupDatabase();
      expect(result.success).toBe(true);

      const writes = mockWriteStream.write.mock.calls.map((c) => c[0]);
      // The collection header opens the array...
      expect(writes.some((w) => w.includes('"big_collection": ['))).toBe(true);
      // ...and no single write may exceed the chunk cap plus one document —
      // a whole-collection array (or the old whole-database stringify) is
      // orders of magnitude over this bound at corpus scale.
      const biggest = Math.max(...writes.map((w) => w.length));
      expect(biggest).toBeLessThan(1024 * 1024 + 400020);

      // The streamed envelope must be parseable JSON.
      const joined = writes.join('');
      expect(JSON.parse(joined).big_collection).toEqual([bigDoc, { _key: 'small' }]);
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

    it('keeps the uncompressed backup when compression fails', async () => {
      // _compressBackup swallows its own errors and returns the ORIGINAL
      // path — the compress branch must then keep that file, not unlink the
      // only copy of a completed backup (issue #1762 review).
      mockDb.listCollections.mockResolvedValue([{ name: 'users', isSystem: false }]);
      mockDb.query.mockImplementation(() => Promise.resolve(makeIterableCursor([{ _key: 'u1' }])));
      service.compressBackups = true;
      // The honest contract: compression failure reports null.
      const compressSpy = jest.spyOn(service, '_compressBackup').mockResolvedValue(null);

      const result = await service.backupDatabase();

      expect(result.success).toBe(true);
      expect(compressSpy).toHaveBeenCalled();
      expect(require('fs').promises.unlink).not.toHaveBeenCalled();
      compressSpy.mockRestore();
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
      // The driver's REAL shape (issue #1761): count at the TOP level,
      // sizes under figures.figures — the fabricated inner "alive" count
      // (which does not exist on ArangoDB 3.12) once pinned count=0.
      const mockColl = createMockCollection('users');
      mockColl.figures = jest.fn().mockResolvedValue({
        count: 100,
        figures: { documentsSize: 4096 }
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
        size: 4096,
        sizeFormatted: '4 KB'
      });
      expect(result.databaseSize).toBe('4 KB');
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

  // _formatSize moved to shared-lib as formatSize — its contract is pinned
  // by components/shared/lib/__tests__/format-utils.test.js.
});
