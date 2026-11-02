// Quick-help routes (J.4 / DEC-28): real router mounted on a real express
// app (admin-approval-routes.test.js pattern), dbService faked via the
// shared-lib manual mock. Pins: GET returns the sorted button list (enabled
// filter for the chat page, ?all=1 for admin), mutations are requireAdmin
// gated (403 for non-admin — real middleware in this suite), 400 validation
// (title.en/prompt.en required, icon path prefix), 404 on unknown id, and
// the create-slug collision suffix.
const ADMIN = { _key: 'admin-1' };
const VALID = {
  order: 9,
  enabled: true,
  isJustChat: false,
  title: { en: 'Maize in Lesotho', st: 'Koro Lesotho' },
  prompt: { en: 'What about maize?', st: 'Na koro?' },
  icon: '/config/quickhelp/crop-management.svg',
};

// The real middleware requires jose (ESM-only — can't load under CJS jest;
// admin-approval-routes.test.js mocks it too). requireAdmin's claims
// contract is mirrored here; its own behavior is pinned by
// keycloak-auth-middleware.test.js.
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    requireAdmin: (req, res, next) => {
      const roles = req.claims?.realm_access?.roles || [];
      if (!roles.map((r) => String(r).toLowerCase()).includes('admin')) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      }
      next();
    }
  }
}));

// Fake quickhelpButtons collection backed by a Map. FAITHFUL to arangojs 8:
// exists() is arity-0 (collection existence — true here, mirroring the
// post-migration box); documentExists(key) is the document check. The first
// draft of this fake implemented exists(key) as document-level, which
// masked the real API misuse the review caught (create() hung forever).
function makeFakeDb(seed = []) {
  const store = new Map(seed.map((d) => [d._key, { ...d }]));
  const specs = [];
  const buttons = {
    exists: async () => true,
    documentExists: async (key) => store.has(key),
    save: async (doc, opts) => {
      if (store.has(doc._key)) throw Object.assign(new Error('conflict'), { code: 409 });
      store.set(doc._key, JSON.parse(JSON.stringify(doc)));
      return { new: doc };
    },
    update: async (key, data, opts) => {
      // arangojs PATCH merge + keepNull:false: nulls stripped, merge for the rest
      const merged = JSON.parse(JSON.stringify({ ...store.get(key), ...data }));
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (data.title) merged.title = { ...data.title }; // object attrs are replaced by the patch value
      if (data.prompt) merged.prompt = { ...data.prompt };
      for (const k of ['title', 'prompt']) {
        if (merged[k]) for (const kk of Object.keys(merged[k])) if (merged[k][kk] === null) delete merged[k][kk];
      }
      store.set(key, merged);
      return { new: merged };
    },
    remove: async (key) => {
      if (!store.has(key)) throw Object.assign(new Error('not found'), { code: 404 });
      store.delete(key);
    }
  };
  const db = {
    collection: () => buttons,
    query: async (spec) => {
      specs.push(spec.query); // arangojs AQL object carries the text in .query
      return {
        all: async () => [...store.values()], // UNSORTED — the AQL SORT must do it
        next: async () => null
      };
    }
  };
  return { db, store, specs };
}

function makeApp(fakeDb, roles = ['admin']) {
  const sharedLib = require('../mocks/shared-lib.js');
  sharedLib.dbService.getConnection.mockReset().mockResolvedValue(fakeDb.db);
  const buildRoutes = require('../routes/quickhelp-routes');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = ADMIN;
    req.claims = { realm_access: { roles } };
    next();
  });
  app.use('/api/quickhelp', buildRoutes(require('../services/quickhelp-service')));
  return app;
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } finally {
    server.close();
  }
}

describe('quickhelp-routes (J.4, DEC-28)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('GET builds the AQL with SORT b.order (the fake ignores AQL, so the clause is the pin)', async () => {
    const fake = makeFakeDb([
      { _key: 'b', order: 2, enabled: true, title: { en: 'B' }, prompt: { en: 'pb' }, icon: '/config/quickhelp/x.svg' },
      { _key: 'a', order: 1, enabled: true, title: { en: 'A' }, prompt: { en: 'pa' }, icon: '/config/quickhelp/x.svg' }
    ]);
    const res = await request(makeApp(fake), 'GET', '/api/quickhelp');
    expect(res.status).toBe(200);
    const list = await res.json();
    expect([...list.map((b) => b._key)].sort()).toEqual(['a', 'b']); // both present
    expect(fake.specs[0]).toContain('SORT b.order'); // ordering lives in the AQL
  });

  it('?all=1 maps to the admin list view and 403s for non-admin (server-side gate)', async () => {
    const adminList = jest.fn().mockResolvedValue([{ _key: 'x' }]);
    const stub = { list: adminList };
    const express = require('express');
    const buildRoutes = require('../routes/quickhelp-routes');
    const sharedLib = require('../mocks/shared-lib.js');
    sharedLib.dbService.getConnection.mockReset();

    const mk = (roles) => {
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.claims = { realm_access: { roles } };
        next();
      });
      app.use('/api/quickhelp', buildRoutes(stub));
      return app;
    };

    const ok = await request(mk(['admin']), 'GET', '/api/quickhelp?all=1');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ _key: 'x' }]);
    expect(adminList).toHaveBeenCalledWith({ all: true });

    const forbidden = await request(mk(['user']), 'GET', '/api/quickhelp?all=1');
    expect(forbidden.status).toBe(403);

    const plain = await request(mk(['user']), 'GET', '/api/quickhelp');
    expect(plain.status).toBe(200);
    expect(adminList).toHaveBeenLastCalledWith({ all: false });
  });

  it('PUT with empty st clears the stored Sesotho text (keepNull:false contract)', async () => {
    const fake = makeFakeDb([
      { _key: 'k', order: 1, enabled: true, title: { en: 'x', st: 'Koro' }, prompt: { en: 'y', st: 'Poea' }, icon: '/config/quickhelp/just-chat.svg' }
    ]);
    const res = await request(makeApp(fake), 'PUT', '/api/quickhelp/k', {
      title: { en: 'x', st: '' },
      prompt: { en: 'y' },
      icon: '/config/quickhelp/just-chat.svg',
      enabled: true,
    });
    expect(res.status).toBe(200);
    expect(fake.store.get('k').title).toEqual({ en: 'x' });
    expect(fake.store.get('k').prompt).toEqual({ en: 'y' });
  });

  it('POST 400s on a non-baked icon filename (allowlist, not prefix check)', async () => {
    const fake = makeFakeDb();
    const res = await request(makeApp(fake), 'POST', '/api/quickhelp', {
      ...VALID,
      icon: '/config/quickhelp/not-a-real-icon.svg',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/baked/);
  });

  it('POST with junk order takes the 100 default (strict typing)', async () => {
    const fake = makeFakeDb();
    const res = await request(makeApp(fake), 'POST', '/api/quickhelp', { ...VALID, order: null, enabled: 'false' });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.order).toBe(100);
    expect(created.enabled).toBe(false);
  });

  it('GET filters disabled unless ?all=1 (aql fragment pin)', async () => {
    const service = require('../services/quickhelp-service');
    const fake = makeFakeDb([
      { _key: 'on', order: 1, enabled: true, title: { en: 'A' }, prompt: { en: 'pa' }, icon: '/x' },
      { _key: 'off', order: 2, enabled: false, title: { en: 'B' }, prompt: { en: 'pb' }, icon: '/x' }
    ]);
    require('../mocks/shared-lib.js').dbService.getConnection.mockReset().mockResolvedValue(fake.db);
    await service.list({ all: false });
    await service.list({ all: true });
    expect(fake.specs[0]).toContain('FILTER b.enabled == true');
    expect(fake.specs[1]).not.toContain('FILTER b.enabled');
  });

  it('POST 403s for non-admin', async () => {
    const fake = makeFakeDb();
    const app = makeApp(fake, ['user']);
    const res = await request(app, 'POST', '/api/quickhelp', VALID);
    expect(res.status).toBe(403);
    expect(fake.store.size).toBe(0);
  });

  it('POST 400s without title.en', async () => {
    const fake = makeFakeDb();
    const res = await request(makeApp(fake), 'POST', '/api/quickhelp', { ...VALID, title: { st: 'Koro' } });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/title\.en/);
  });

  it('POST 400s with a non-quickhelp icon path', async () => {
    const fake = makeFakeDb();
    const res = await request(makeApp(fake), 'POST', '/api/quickhelp', { ...VALID, icon: 'https://evil.example/x.svg' });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/icon/);
  });

  it('POST creates with a slugified _key and suffixes on collision', async () => {
    const fake = makeFakeDb([{ _key: 'maize-in-lesotho', order: 1, enabled: true, title: { en: 'x' }, prompt: { en: 'y' }, icon: '/config/quickhelp/x.svg' }]);
    const res = await request(makeApp(fake), 'POST', '/api/quickhelp', VALID);
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created._key).toBe('maize-in-lesotho-2');
    expect(created.title).toEqual({ en: 'Maize in Lesotho', st: 'Koro Lesotho' });
  });

  it('PUT 404s on unknown id, updates on known id', async () => {
    const fake = makeFakeDb([{ _key: 'k', order: 1, enabled: true, title: { en: 'x' }, prompt: { en: 'y' }, icon: '/config/quickhelp/x.svg' }]);
    const miss = await request(makeApp(fake), 'PUT', '/api/quickhelp/nope', VALID);
    expect(miss.status).toBe(404);
    const hit = await request(makeApp(fake), 'PUT', '/api/quickhelp/k', { ...VALID, enabled: false });
    expect(hit.status).toBe(200);
    expect(fake.store.get('k').enabled).toBe(false);
  });

  it('DELETE removes and 404s on unknown id', async () => {
    const fake = makeFakeDb([{ _key: 'k', order: 1, enabled: true, title: { en: 'x' }, prompt: { en: 'y' }, icon: '/config/quickhelp/x.svg' }]);
    expect((await request(makeApp(fake), 'DELETE', '/api/quickhelp/k')).status).toBe(200);
    expect(fake.store.has('k')).toBe(false);
    expect((await request(makeApp(makeFakeDb()), 'DELETE', '/api/quickhelp/k')).status).toBe(404);
  });

  it('PUT 403s for non-admin', async () => {
    const fake = makeFakeDb([{ _key: 'k', order: 1, enabled: true, title: { en: 'x' }, prompt: { en: 'y' }, icon: '/config/quickhelp/x.svg' }]);
    const res = await request(makeApp(fake, ['manager']), 'PUT', '/api/quickhelp/k', VALID);
    expect(res.status).toBe(403);
  });
});
