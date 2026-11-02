// K.3 rag-tuning route pair — same harness as the K.2 llm-settings suite
// (real admin-routes router on a real express app, real pipeline-settings
// service against a tmp settings file). Pins: GET 200 effective values +
// audit envelope, PUT enum 400s naming the allowed values, range 400s
// (incl. the fetchK >= retrievalK cross-field constraint on the MERGED
// doc), bool/int type strictness, unknown nested keys, non-admin 403,
// corrupt-file 409 refusal, and the version bump + updatedBy stamp.
const fs = require('fs');
const os = require('os');
const path = require('path');

// requireAdmin stands in for the real claims check (pinned by
// keycloak-auth-middleware.test.js): passes with an admin role claim,
// 403s without — enough to pin the route-level gating contract.
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    requireAdmin: (req, res, next) => {
      const roles = req.claims?.realm_access?.roles || [];
      if (roles.map((r) => String(r).toLowerCase()).includes('admin')) return next();
      return res.status(403).json({ message: 'Forbidden - admin access required' });
    }
  }
}));

// The real proxy service throws at import without Keycloak env (admin-approval
// harness mocks it the same way); these routes never touch it.
jest.mock('../services/keycloak-proxy-service', () => ({
  assignRealmRole: jest.fn(),
  revokeUserSessions: jest.fn()
}));
jest.mock('../services/user-provisioning-service', () => ({ evictUser: jest.fn() }));

const express = require('express');
const buildAdminRoutes = require('../routes/admin-routes');

const ADMIN = { _key: 'admin-9', userId: 'admin-9' };
const VALID_BODY = {
  retriever: {
    retrievalK: 20, fetchK: 30, scoreThreshold: 0.2, lambdaMult: 0.5,
    searchStart: 'chunk', searchMode: 'vector', filterStrategy: 'OR',
    enableTraversal: true, traversalMaxDepth: 2, traversalMaxReturned: 5,
    traversalScoreThreshold: 0.7, traversalConcurrentBatches: 4,
    hybridEnabled: true, hybridRrfK: 60, hybridDenseWeight: 1.0,
    hybridLexicalWeight: 1.0, hybridBm25Candidates: 50
  },
  reranker: {
    strategy: 'slice', threshold: 0.75, topN: 3,
    noveltySigmoidA: 20.0, noveltySigmoidB: 0.25,
    contextDecayFactor: 0.0025, minValueThreshold: -1.0
  }
};

function makeApp(user = ADMIN, claims = { realm_access: { roles: ['admin'] } }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    req.claims = claims;
    next();
  });
  app.use('/api/admin', buildAdminRoutes({ getSystemHealth: async () => ({}) }, { getLogsSummary: async () => ({}) }));
  return app;
}

async function request(app, method, url, body) {
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-rag-routes-'));
  file = path.join(dir, 'rag-tuning.json');
  process.env.RAG_TUNING_CONFIG = file;
  const svc = require('../services/pipeline-settings-service');
  svc._resetCache();
});
afterEach(() => {
  delete process.env.RAG_TUNING_CONFIG;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('K.3 GET /api/admin/pipeline-settings/rag-tuning', () => {
  test('returns effective values + audit envelope; write is visible to the next GET', async () => {
    const app = makeApp();

    const missing = await request(app, 'GET', '/api/admin/pipeline-settings/rag-tuning');
    expect(missing.status).toBe(200);
    const missingBody = await missing.json();
    expect(missingBody.success).toBe(true);
    expect(missingBody.data.updatedBy).toBeNull(); // never edited
    expect(missingBody.data.retriever.retrievalK).toBe(20); // documented defaults

    const put = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', {
      retriever: { retrievalK: 5 }
    });
    expect(put.status).toBe(200);

    const got = await request(app, 'GET', '/api/admin/pipeline-settings/rag-tuning');
    const body = await got.json();
    expect(body.data.retriever.retrievalK).toBe(5);
    expect(body.data.retriever.fetchK).toBe(30); // siblings survive the merge
    expect(body.data.version).toBe(1);
    expect(body.data.updatedBy).toBe('admin-9');
    expect(body.data.updatedAt).toBeTruthy();
  });

  test('missing-file GET defaults deep-equal the committed seed values (no sixth-copy drift)', async () => {
    const app = makeApp();
    const seed = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../configs/pipeline/rag-tuning.seed.json'), 'utf8'
    ));
    const res = await request(app, 'GET', '/api/admin/pipeline-settings/rag-tuning');
    const body = await res.json();
    expect(body.data.retriever).toEqual(seed.retriever);
    expect(body.data.reranker).toEqual(seed.reranker);
  });

  test('hand-edited garbage values: data served as-is + warnings naming each field', async () => {
    fs.writeFileSync(file, JSON.stringify({
      version: 2, updatedAt: '2026-10-05T00:00:00Z', updatedBy: 'someone',
      retriever: { retrievalK: 'many', traversalConcurrentBatches: 9 },
      reranker: { strategy: 'fuzzy' }
    }));
    const app = makeApp();

    const res = await request(app, 'GET', '/api/admin/pipeline-settings/rag-tuning');
    expect(res.status).toBe(200);
    const body = await res.json();
    // as-is: the garbage is visible, not silently replaced
    expect(body.data.retriever.retrievalK).toBe('many');
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.some((w) => w.includes('retriever.retrievalK'))).toBe(true);
    expect(body.warnings.some((w) => w.includes('retriever.traversalConcurrentBatches'))).toBe(true);
    expect(body.warnings.some((w) => w.includes('reranker.strategy'))).toBe(true);
  });

  test('clean file and missing file both GET with warnings: []', async () => {
    const app = makeApp();
    expect((await (await request(app, 'GET', '/api/admin/pipeline-settings/rag-tuning')).json()).warnings).toEqual([]);

    await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);
    expect((await (await request(app, 'GET', '/api/admin/pipeline-settings/rag-tuning')).json()).warnings).toEqual([]);
  });
});

describe('K.3 PUT /api/admin/pipeline-settings/rag-tuning', () => {
  test('valid patch: file written, version bumped + stamped on every save', async () => {
    const app = makeApp();

    const first = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.version).toBe(1);
    expect(firstBody.data.updatedBy).toBe('admin-9');

    const second = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', {
      reranker: { strategy: 'adaptive' }
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.data.version).toBe(2); // generation counter
    expect(secondBody.data.reranker.strategy).toBe('adaptive');
    expect(secondBody.data.retriever.retrievalK).toBe(VALID_BODY.retriever.retrievalK); // merge keeps siblings
  });

  test('invalid enums rejected 400 naming the allowed values; file unchanged', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);
    const before = fs.readFileSync(file, 'utf8');

    for (const [patch, needle] of [
      [{ reranker: { strategy: 'fuzzy' } }, 'slice, threshold, knee_threshold, slice_threshold, adaptive'],
      [{ retriever: { searchStart: 'Chunk' } }, 'chunk, edge, node'],
      [{ retriever: { searchMode: 'dense' } }, 'vector, hybrid'],
      [{ retriever: { filterStrategy: 'or' } }, 'AND, OR'] // case matters: retriever branches on .upper() of an exact enum
    ]) {
      const res = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', patch);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain(needle);
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before); // untouched by every refusal
  });

  test('out-of-range values rejected 400 naming the field; file unchanged', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);
    const before = fs.readFileSync(file, 'utf8');

    for (const [patch, needle] of [
      [{ retriever: { retrievalK: 0 } }, 'retriever.retrievalK'],
      [{ retriever: { retrievalK: '40' } }, 'retriever.retrievalK'], // string 400s at the SCHEMA, never reaches the numeric cross-field check
      [{ retriever: { scoreThreshold: 1.5 } }, 'retriever.scoreThreshold'],
      [{ retriever: { traversalConcurrentBatches: 5 } }, 'retriever.traversalConcurrentBatches'],
      [{ retriever: { hybridDenseWeight: -0.1 } }, 'retriever.hybridDenseWeight'],
      [{ reranker: { noveltySigmoidA: 0 } }, 'reranker.noveltySigmoidA'],
      [{ reranker: { topN: 1.5 } }, 'reranker.topN'],
      [{ retriever: { retrievalK: true } }, 'retriever.retrievalK'], // bool is not an int
      [{ retriever: { enableTraversal: 'true' } }, 'retriever.enableTraversal'], // real bool, not string
      [{ retriever: { evil: 1 } }, 'retriever.evil'],
      [{ evilKey: 1 }, 'evilKey']
    ]) {
      const res = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', patch);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain(needle);
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('fetchK >= retrievalK enforced on the MERGED doc (MMR requirement)', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);

    // patch only fetchK below the on-disk retrievalK
    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', {
      retriever: { fetchK: 10 }
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('fetchK');

    // patch only retrievalK above the on-disk fetchK
    const res2 = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', {
      retriever: { retrievalK: 40 }
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).message).toContain('fetchK');

    // both sides moved together in one patch: legal
    const ok = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', {
      retriever: { retrievalK: 40, fetchK: 50 }
    });
    expect(ok.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.retriever.retrievalK).toBe(40);
    expect(onDisk.retriever.fetchK).toBe(50);
  });

  test('non-admin PUT: 403 FORBIDDEN, file untouched', async () => {
    const app = makeApp(ADMIN, { realm_access: { roles: ['user'] } });

    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);

    expect(res.status).toBe(403);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('corrupt on-disk file: write refused 409, file left as-is, no absolute path leaked', async () => {
    fs.writeFileSync(file, '{corrupt json');
    const app = makeApp();

    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toContain('rag-tuning.json');
    expect(body.message).not.toContain(dir); // container/absolute path sanitized
    expect(fs.readFileSync(file, 'utf8')).toBe('{corrupt json');
  });

  test('partial retriever patch validates only the provided subkeys', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', VALID_BODY);

    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/rag-tuning', {
      retriever: { hybridRrfK: 100 }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.retriever.hybridRrfK).toBe(100);
    // untouched subkeys kept their on-disk values (merge), not a 400
    expect(body.data.retriever.hybridDenseWeight).toBe(VALID_BODY.retriever.hybridDenseWeight);
  });
});
