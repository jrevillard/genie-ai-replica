// K.2 llm-settings route pair — real admin-routes router on a real express
// app (admin-approval harness pattern) with the REAL pipeline-settings
// service (shared-lib mocked via moduleNameMapper) against a tmp settings
// file. Pins: GET 200 returns effective values + audit envelope, PUT
// validation 400s naming the field (prompt, range, unknown key), non-admin
// 403, corrupt-file 409 refusal, and the version bump + updatedBy stamp.
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
  systemPrompt: 'You are a test assistant.',
  enforceAbstention: true,
  abstentionInstructions: '',
  generation: {
    temperature: 0.01, topP: 0.95, repetitionPenalty: 1.03,
    frequencyPenalty: 0.0, presencePenalty: 0.0, maxTokens: 8192
  },
  ingest: {
    labelSelectorPrompt: 'label prompt',
    contextualRetrievalPrompt: 'contextual prompt'
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k2-llm-routes-'));
  file = path.join(dir, 'llm-settings.json');
  process.env.LLM_SETTINGS_CONFIG = file;
  const svc = require('../services/pipeline-settings-service');
  svc._resetCache();
});
afterEach(() => {
  delete process.env.LLM_SETTINGS_CONFIG;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('K.2 GET /api/admin/pipeline-settings/llm-settings', () => {
  test('returns effective values + audit envelope; write is visible to the next GET', async () => {
    const app = makeApp();

    const missing = await request(app, 'GET', '/api/admin/pipeline-settings/llm-settings');
    expect(missing.status).toBe(200);
    const missingBody = await missing.json();
    expect(missingBody.success).toBe(true);
    expect(missingBody.data.updatedBy).toBeNull(); // never edited

    const put = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', {
      ...VALID_BODY,
      systemPrompt: 'Edited prompt.'
    });
    expect(put.status).toBe(200);

    const got = await request(app, 'GET', '/api/admin/pipeline-settings/llm-settings');
    const body = await got.json();
    expect(body.data.systemPrompt).toBe('Edited prompt.');
    expect(body.data.version).toBe(1);
    expect(body.data.updatedBy).toBe('admin-9');
    expect(body.data.updatedAt).toBeTruthy();
  });

  test('K.3: garbage-typed values GET with warnings; defaults GET with warnings: [] (empty prompts are placeholders, not garbage)', async () => {
    const app = makeApp();
    // never-edited defaults: '' prompts skipped, everything else valid
    const clean = await (await request(app, 'GET', '/api/admin/pipeline-settings/llm-settings')).json();
    expect(clean.warnings).toEqual([]);

    fs.writeFileSync(file, JSON.stringify({
      systemPrompt: 5, generation: { temperature: 'hot' }
    }));
    const dirty = await (await request(app, 'GET', '/api/admin/pipeline-settings/llm-settings')).json();
    expect(dirty.data.systemPrompt).toBe(5); // served as-is
    expect(dirty.warnings.some((w) => w.includes('systemPrompt'))).toBe(true);
    expect(dirty.warnings.some((w) => w.includes('generation.temperature'))).toBe(true);
  });
});

describe('K.2 PUT /api/admin/pipeline-settings/llm-settings', () => {
  test('valid patch: file written, version bumped + stamped on every save', async () => {
    const app = makeApp();

    const first = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', VALID_BODY);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.version).toBe(1);
    expect(firstBody.data.updatedBy).toBe('admin-9');

    const second = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', {
      generation: { ...VALID_BODY.generation, temperature: 0.2 }
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.data.version).toBe(2); // generation counter
    expect(secondBody.data.generation.temperature).toBe(0.2);
    expect(secondBody.data.systemPrompt).toBe(VALID_BODY.systemPrompt); // merge keeps siblings
  });

  test('partial generation/ingest patches validate only the provided subkeys', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', VALID_BODY);

    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', {
      generation: { topP: 0.9 }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.generation.topP).toBe(0.9);
    // untouched subkeys kept their on-disk values (merge), not a 400
    expect(body.data.generation.temperature).toBe(VALID_BODY.generation.temperature);

    const ingestOnly = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', {
      ingest: { labelSelectorPrompt: 'new label prompt' }
    });
    expect(ingestOnly.status).toBe(200);
  });

  test('unknown nested keys inside generation/ingest are rejected 400 (never merged)', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', VALID_BODY);

    for (const [patch, needle] of [
      [{ generation: { evil: 1 } }, 'generation.evil'],
      [{ ingest: { evil: 'x' } }, 'ingest.evil']
    ]) {
      const res = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', patch);
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain(needle);
    }
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.generation.evil).toBeUndefined();
    expect(onDisk.ingest.evil).toBeUndefined();
  });

  test('maxTokens floor 256 — a tiny budget would disable the overflow guard', async () => {
    const app = makeApp();
    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', {
      generation: { maxTokens: 100 }
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('generation.maxTokens');
  });

  test('empty and oversize prompts rejected 400 naming the field; file unchanged', async () => {
    const app = makeApp();
    await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', VALID_BODY);
    const before = fs.readFileSync(file, 'utf8');

    for (const [patch, needle] of [
      [{ systemPrompt: '   ' }, 'systemPrompt'],
      [{ systemPrompt: 'x'.repeat(8001) }, 'systemPrompt'],
      [{ abstentionInstructions: 'y'.repeat(4001) }, 'abstentionInstructions'],
      [{ generation: { ...VALID_BODY.generation, temperature: 5 } }, 'generation.temperature'],
      [{ generation: { ...VALID_BODY.generation, maxTokens: 0.5 } }, 'generation.maxTokens'],
      [{ generation: { ...VALID_BODY.generation, topP: 'hot' } }, 'generation.topP'],
      [{ ingest: { ...VALID_BODY.ingest, labelSelectorPrompt: '' } }, 'ingest.labelSelectorPrompt'],
      [{ evilKey: 1 }, 'evilKey']
    ]) {
      const res = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', patch);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain(needle);
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before); // untouched by every refusal
  });

  test('non-admin PUT: 403 FORBIDDEN, file untouched', async () => {
    const app = makeApp(ADMIN, { realm_access: { roles: ['user'] } });

    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', VALID_BODY);

    expect(res.status).toBe(403);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('corrupt on-disk file: write refused 409, file left as-is, no absolute path leaked', async () => {
    fs.writeFileSync(file, '{corrupt json');
    const app = makeApp();

    const res = await request(app, 'PUT', '/api/admin/pipeline-settings/llm-settings', VALID_BODY);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toContain('llm-settings.json');
    expect(body.message).not.toContain(dir); // container/absolute path sanitized
    expect(fs.readFileSync(file, 'utf8')).toBe('{corrupt json');
  });
});
