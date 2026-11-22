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
  const graphNames = new Set(); // the named graphs the database knows

  function handleFor(name) {
    stores[name] = stores[name] || {};
    if (handles[name]) return handles[name];
    const store = () => (stores[name] = stores[name] || {});
    const handle = {
      exists: jest.fn(async () => !!stores[name] && Object.keys(stores[name]).length > 0),
      create: jest.fn(async () => {}),
      ensureIndex: jest.fn(async () => {}),
      save: jest.fn(async (doc) => {
        const s = store();
        const k = doc._key || doc.repo_id || `k${++counter}`;
        s[k] = { ...doc, _key: k, _id: `${name}/${k}`, _rev: '1' };
        return { ...s[k] };
      }),
      firstExample: jest.fn(async (ex) => {
        const s = stores[name];
        const found = s && Object.values(s).find((d) => Object.keys(ex).every((k) => d[k] === ex[k]));
        return found ? { ...found } : null;
      }),
      document: jest.fn(async (k) => {
        const s = stores[name];
        if (!s || !s[k]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        return { ...s[k] };
      }),
      update: jest.fn(async (k, patch) => {
        const s = stores[name];
        if (!s || !s[k]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        s[k] = { ...s[k], ...patch };
        return { ...s[k] };
      }),
      replace: jest.fn(async (k, doc) => {
        const s = stores[name];
        if (!s || !s[k]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        s[k] = { ...doc, _key: k, _id: `${name}/${k}`, _rev: '2' };
        return { ...s[k] };
      }),
      indexes: jest.fn(async () => []),
      rename: jest.fn(async (newName) => {
        const exists = (n) => !!(stores[n] && Object.keys(stores[n]).length > 0);
        if (!exists(name)) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        if (exists(newName)) {
          const e = new Error('duplicate name');
          e.code = 409;
          throw e;
        }
        stores[newName] = stores[name];
        delete stores[name];
        delete handles[name];
        handles[newName] = handle;
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
      }),
      remove: jest.fn(async (key) => {
        const s = stores[name];
        if (!s || !s[key]) {
          const e = new Error('not found');
          e.code = 404;
          e.errorNum = 1204;
          throw e;
        }
        delete s[key];
        return { _key: key };
      })
    };
    handles[name] = handle;
    return handle;
  }

  const collection = jest.fn((name) => handleFor(name));

  // Default query handler — shape-aware for the SPEC-#1020 conditional
  // single-statement writes, which the real code relies on returning their
  // matched-row count:
  //   settle CAS (lifecycle-service._settleIngest): reports ONE matched row
  //   so the settle proceeds (lease acquired).
  // Everything else returns no rows (the historical default) — EXCEPT the
  // collection scan, which the mock now really runs (below).
  function defaultQuery(q, bindVars) {
    const text = typeof q === 'string' ? q : q && q.query ? String(q.query) : '';
    // arangojs's OWN rule (node_modules/arangojs/database.js:1524-1526):
    // for an `aql` TEMPLATE the second argument is the OPTIONS and the bind
    // variables come from the template's own `bindVars`. Reading the second
    // argument as bind vars would let through a query the engine REFUSES
    // (an unbound `@@name`) — which is exactly how the graph-retract
    // service's orphan sweep reached production broken and stayed green
    // here (measured live, 2026-11-22).
    const vars = q && q.query ? q.bindVars : bindVars;
    if (text.includes('UPDATE r WITH') && text.includes('settle_claimed_at')) {
      return Promise.resolve({ all: async () => [{ _key: 'settle-lease' }] });
    }
    // The COLLECTION-NAME bind parameter is resolved the way the engine
    // resolves it — and refused the way the engine refuses it. A wrong key
    // used to pass every unit test here and answer HTTP 500 in production
    // (measured live, 2026-11-22: the evaluation-context list endpoint).
    const missing = missingCollectionBindParams(text, vars);
    if (missing.length) {
      return Promise.reject(new Error(`no value specified for declared bind parameter '${missing[0]}'`));
    }
    // A BARE `FOR x IN @@coll ... RETURN x` scan really scans the store, so
    // a LIST endpoint's rows are the ones it saved. `SORT ... created_at DESC`
    // really sorts. A query with a FILTER is NOT executed here — the mock
    // has no AQL engine, and pretending to filter would hand a caller rows
    // the real database would never return (the pii-service's flagged-rows
    // query is exactly that case).
    const scan = text.match(/FOR\s+\w+\s+IN\s+@@([A-Za-z_][A-Za-z0-9_]*)/i);
    if (scan && !/\bfilter\b/i.test(text)) {
      const rows = Object.values(stores[vars[`@${scan[1]}`]] || {});
      if (/created_at/i.test(text) && /\bdesc\b/i.test(text)) {
        rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      }
      return Promise.resolve({ all: async () => rows.map((r) => ({ ...r })) });
    }
    return Promise.resolve({ all: async () => [] });
  }

  // Raw _api routes (gharial graph definitions etc.) — minimal passthrough.
  const route = jest.fn((_path) => ({
    get: jest.fn(async () => ({ body: {} })),
    delete: jest.fn(async () => ({ body: {} })),
    post: jest.fn(async () => ({ body: {} }))
  }));

  return {
    collection,
    route,
    query: jest.fn(defaultQuery),
    exists: jest.fn(async () => true),
    /** Collection inventory + creation (frontmatter/head-suite ensure paths). */
    listCollections: jest.fn(async () => Object.keys(stores).map((n) => ({ name: n }))),
    createCollection: jest.fn(async (n) => {
      stores[n] = stores[n] || {};
    }),
    /**
     * The NAMED GRAPHS — the same route the teardown drops through
     * (`_api/gharial`). A graph name is not a collection: the member
     * collections are `NAME_SOURCE` / `NAME_ENTITY`, so a graph inventory
     * cannot be derived from the collection store.
     */
    listGraphs: jest.fn(async () => [...graphNames].map((n) => ({ name: n }))),
    /** Named-graph handles: existence derived from member collections. */
    graph: jest.fn((n) => {
      graphNames.add(n);
      return {
        exists: jest.fn(async () => {
          const src = stores[n + '_SOURCE'];
          const ent = stores[n + '_ENTITY'];
          return !!((src && Object.keys(src).length) || (ent && Object.keys(ent).length));
        }),
        drop: jest.fn(async () => ({}))
      };
    }),
    createGraph: jest.fn(async (n) => {
      graphNames.add(n);
      return {};
    }),
    /** Clear all stored docs + reset call history + drop cached handles (call in beforeEach). */
    _reset() {
      for (const k of Object.keys(stores)) delete stores[k];
      for (const k of Object.keys(handles)) delete handles[k];
      graphNames.clear();
      collection.mockClear();
      route.mockClear();
      this.graph.mockClear();
      this.createGraph.mockClear();
      this.query.mockReset();
      this.query.mockImplementation(defaultQuery);
    },
    _stores: stores
  };
}

let counter = 0;

/**
 * ArangoDB's COLLECTION-NAME bind-parameter rule, measured against the local
 * ArangoDB on 2026-11-22: a query placeholder `@@name` is a collection-name
 * bind parameter, and its value lives under the key `@name` — the sigil
 * STAYS in the key, which is the opposite of the value form (`@name` reads
 * the key `name`). A query whose placeholder has no value is REFUSED by the
 * engine with "no value specified for declared bind parameter '@name'".
 *
 * The rule is here, once, so the mock and the tests that pin the contract
 * cannot drift apart.
 *
 * @param {string} text - the AQL
 * @param {object} bindVars - the bind variables as the caller passed them
 * @returns {string[]} the placeholders the engine would refuse
 */
function missingCollectionBindParams(text, bindVars) {
  const vars = bindVars || {};
  const missing = [];
  for (const m of String(text || '').matchAll(/@@([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!Object.prototype.hasOwnProperty.call(vars, `@${m[1]}`)) missing.push(`@${m[1]}`);
  }
  return missing;
}

module.exports = { createMockDb, missingCollectionBindParams };
