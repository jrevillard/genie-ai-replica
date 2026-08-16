// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// In-memory ArangoDB mock for the repository-service unit tests. Implements the
// subset of arangojs the OKF services use (collection().save/firstExample/document/
// update + db.query cursor). Collection handles are cached per name (like real
// arangojs), so a test can program a handle's method before triggering the service:
//   jest.mock('../shared-lib/db-connection-service', () => {
//     const mockDb = require('../mocks/arango-mock').createMockDb();
//     return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
//   });

function createMockDb() {
  const stores = {}; // collectionName -> { key: doc }
  const handles = {}; // collectionName -> cached handle (stable across calls)

  function handleFor(name) {
    stores[name] = stores[name] || {};
    const s = stores[name];
    if (handles[name]) return handles[name];
    const handle = {
      exists: jest.fn(async () => true),
      create: jest.fn(async () => {}),
      ensureIndex: jest.fn(async () => {}),
      save: jest.fn(async (doc) => {
        const k = doc._key || doc.repo_id || `k${++counter}`;
        s[k] = { ...doc, _key: k, _id: `${name}/${k}`, _rev: '1' };
        return { ...s[k] };
      }),
      firstExample: jest.fn(async (ex) => {
        const found = Object.values(s).find((d) => Object.keys(ex).every((k) => d[k] === ex[k]));
        return found ? { ...found } : null;
      }),
      document: jest.fn(async (k) => {
        if (!s[k]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        return { ...s[k] };
      }),
      update: jest.fn(async (k, patch) => {
        if (!s[k]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        s[k] = { ...s[k], ...patch };
        return { ...s[k] };
      }),
      drop: jest.fn(async () => {
        if (!stores[name]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        delete stores[name];
        delete handles[name];
      })
    };
    handles[name] = handle;
    return handle;
  }

  const collection = jest.fn((name) => handleFor(name));

  // Raw _api routes (gharial graph definitions etc.) — minimal passthrough.
  const route = jest.fn((_path) => ({
    get: jest.fn(async () => ({ body: {} })),
    delete: jest.fn(async () => ({ body: {} })),
    post: jest.fn(async () => ({ body: {} }))
  }));

  return {
    collection,
    route,
    query: jest.fn(async () => ({ all: async () => [] })),
    exists: jest.fn(async () => true),
    /** Clear all stored docs + reset call history + drop cached handles (call in beforeEach). */
    _reset() {
      for (const k of Object.keys(stores)) delete stores[k];
      for (const k of Object.keys(handles)) delete handles[k];
      collection.mockClear();
      route.mockClear();
      this.query.mockReset();
      this.query.mockResolvedValue({ all: async () => [] });
    },
    _stores: stores
  };
}

let counter = 0;

module.exports = { createMockDb };
