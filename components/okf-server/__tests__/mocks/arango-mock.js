// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// In-memory ArangoDB mock for the repository-service unit tests. Implements the
// subset of arangojs the OKF services use (collection().save/firstExample/document/
///update + db.query cursor). Used via:
//   jest.mock('../db/arango-connection', () => require('../mocks/arango-mock').createMockDb());

let counter = 0;

function createMockDb() {
  const stores = {}; // collectionName -> { key: doc }

  const collection = jest.fn((name) => {
    stores[name] = stores[name] || {};
    const s = stores[name];
    return {
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
          throw e;
        }
        return { ...s[k] };
      }),
      update: jest.fn(async (k, patch) => {
        if (!s[k]) {
          const e = new Error('not found');
          e.code = 404;
          throw e;
        }
        s[k] = { ...s[k], ...patch };
        return { ...s[k] };
      })
    };
  });

  return {
    collection,
    query: jest.fn(async () => ({ all: async () => [] })),
    exists: jest.fn(async () => true),
    /** Clear all stored docs + reset call history (call in beforeEach). */
    _reset() {
      for (const k of Object.keys(stores)) delete stores[k];
      collection.mockClear();
      this.query.mockReset();
      this.query.mockResolvedValue({ all: async () => [] });
    },
    _stores: stores
  };
}

module.exports = { createMockDb };
