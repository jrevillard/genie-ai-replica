// K.1 pipeline-settings-service (file-registry mechanism). Pins the spec's
// writer/reader matrix: env-var path resolution (override + repo fallback),
// partial-file defaults merge, schema-rejected write leaves the on-disk file
// untouched, good write stamps updatedAt/updatedBy, atomic temp+rename leaves
// no .tmp behind, and the [PIPELINE-SETTINGS] audit line is logged. Validation
// runs against a TEST schema — K.2/K.3 register their real schemas at the
// route layer (this module stays route-free by design).
const fs = require('fs');
const os = require('os');
const path = require('path');
const svc = require('../services/pipeline-settings-service');
const { logger } = require('../shared-lib');

const ENV_VAR = 'K1_TEST_SETTINGS_CONFIG';
const FALLBACK = '../../../configs/pipeline/llm-settings.seed.json';
const DEFAULTS = { generation: { temperature: 0.1, maxTokens: 512 }, version: 1 };

// Test schema: top-level key -> checker returning true or an error string.
const SCHEMA = {
  generation: (v) =>
    v && typeof v === 'object' && typeof v.temperature === 'number'
      ? true
      : 'generation.temperature must be a number',
};

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k1-settings-'));
  file = path.join(dir, 'llm-settings.json');
  process.env[ENV_VAR] = file;
  svc._resetCache();
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env[ENV_VAR];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolvePath', () => {
  test('env var wins; absent env falls back to the repo-relative seed', () => {
    expect(svc.resolvePath(ENV_VAR, FALLBACK)).toBe(file);

    delete process.env[ENV_VAR];
    const fallback = svc.resolvePath(ENV_VAR, FALLBACK);
    expect(fallback).toBe(
      path.resolve(__dirname, '../services', FALLBACK)
    );
    expect(fs.existsSync(fallback)).toBe(true); // the committed K.1 seed
  });
});

describe('readSettings', () => {
  test('partial file deep-merged over defaults; missing keys fall back', async () => {
    fs.writeFileSync(file, JSON.stringify({ generation: { temperature: 0.9 } }));
    const merged = await svc.readSettings(ENV_VAR, FALLBACK, DEFAULTS);
    expect(merged.generation.temperature).toBe(0.9);
    expect(merged.generation.maxTokens).toBe(512);
    expect(merged.version).toBe(1);
  });

  test('missing file returns defaults with one WARN (no log spam)', async () => {
    const first = await svc.readSettings(ENV_VAR, FALLBACK, DEFAULTS);
    const second = await svc.readSettings(ENV_VAR, FALLBACK, DEFAULTS);
    expect(first).toBe(DEFAULTS);
    expect(second).toBe(DEFAULTS);
    const warns = logger.warn.mock.calls.filter((c) => String(c[0]).includes(file));
    expect(warns.length).toBe(1);
  });

  test('top-level-array JSON returns defaults with a WARN naming the path', async () => {
    fs.writeFileSync(file, '[1, 2, 3]');
    const result = await svc.readSettings(ENV_VAR, FALLBACK, DEFAULTS);
    expect(result).toBe(DEFAULTS);
    const warns = logger.warn.mock.calls.filter((c) => String(c[0]).includes(file));
    expect(warns.length).toBe(1);
  });

  test('invalid JSON returns defaults with a WARN naming the path', async () => {
    fs.writeFileSync(file, '{not json');
    const merged = await svc.readSettings(ENV_VAR, FALLBACK, DEFAULTS);
    expect(merged).toBe(DEFAULTS); // never silent, never a thrown read
    const warns = logger.warn.mock.calls.filter(
      (c) => String(c[0]).includes(file) && /unreadable/.test(String(c[0]))
    );
    expect(warns.length).toBe(1);
  });

  test('write is visible to the next read without any restart', async () => {
    await svc.writeSettings(ENV_VAR, FALLBACK, {
      patch: { generation: { temperature: 0.42 } },
      schema: SCHEMA,
      updatedBy: 'u1',
    });
    const merged = await svc.readSettings(ENV_VAR, FALLBACK, DEFAULTS);
    expect(merged.generation.temperature).toBe(0.42);
  });
});

describe('writeSettings', () => {
  test('schema-rejected patch leaves the on-disk file untouched, no .tmp', async () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, marker: 'before' }));
    const before = fs.readFileSync(file, 'utf8');

    await expect(
      svc.writeSettings(ENV_VAR, FALLBACK, {
        patch: { generation: { temperature: 'hot' } },
        schema: SCHEMA,
        updatedBy: 'u1',
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('unknown keys and empty patches are rejected', async () => {
    await expect(
      svc.writeSettings(ENV_VAR, FALLBACK, { patch: { evil: 1 }, schema: SCHEMA, updatedBy: 'u1' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.writeSettings(ENV_VAR, FALLBACK, { patch: {}, schema: SCHEMA, updatedBy: 'u1' })
    ).rejects.toMatchObject({ status: 400 });
    expect(fs.existsSync(file)).toBe(false); // nothing was created
  });

  test('good patch: merged, stamped, atomic (no .tmp left), audit line logged', async () => {
    const merged = await svc.writeSettings(ENV_VAR, FALLBACK, {
      patch: { generation: { temperature: 0.42 } },
      schema: SCHEMA,
      updatedBy: 'admin-1',
    });

    expect(merged.updatedBy).toBe('admin-1');
    expect(Number.isNaN(Date.parse(merged.updatedAt))).toBe(false);
    expect(new Date(merged.updatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.generation.temperature).toBe(0.42);
    expect(onDisk.updatedBy).toBe('admin-1');
    expect(fs.readdirSync(dir)).toEqual(['llm-settings.json']); // rename did its job

    const audit = logger.info.mock.calls.filter(
      (c) => /\[PIPELINE-SETTINGS\]/.test(String(c[0])) && /updated by admin-1/.test(String(c[0]))
    );
    expect(audit.length).toBe(1);
  });

  test('write over an existing corrupt file rejects 409, file bytes unchanged', async () => {
    const garbage = '{ "version": 1, "oops": ';
    fs.writeFileSync(file, garbage);

    await expect(
      svc.writeSettings(ENV_VAR, FALLBACK, {
        patch: { generation: { temperature: 0.42 } },
        schema: SCHEMA,
        updatedBy: 'u1',
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(fs.readFileSync(file, 'utf8')).toBe(garbage);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('version increments across sequential writes (1 -> 2)', async () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, updatedBy: 'seed' }));

    const first = await svc.writeSettings(ENV_VAR, FALLBACK, {
      patch: { generation: { temperature: 0.42 } },
      schema: SCHEMA,
      updatedBy: 'u1',
    });
    const second = await svc.writeSettings(ENV_VAR, FALLBACK, {
      patch: { generation: { temperature: 0.45 } },
      schema: SCHEMA,
      updatedBy: 'u1',
    });

    expect(first.version).toBe(2);
    expect(second.version).toBe(3);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(3);
  });
});
