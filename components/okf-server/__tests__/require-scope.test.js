// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1 — requireScope / requireRepoScope middleware contract tests.
// Red-green: these FAIL before middleware/require-scope.js exists.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));

const { requireScope, requireRepoScope } = require('../middleware/require-scope');
const { writeAudit } = require('../services/audit-service');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const mkReq = ({ scopes = [], superAdmin = false, repo_id = 'repoA', sub = 'u1' } = {}) => ({
  headers: {},
  params: { repo_id },
  ip: '127.0.0.1',
  user: { sub, name: 'User' },
  okfScopes: scopes,
  okfIsSuperAdmin: superAdmin
});

describe('requireScope(read)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ANY okf read scope passes', async () => {
    const next = jest.fn();
    await requireScope('read')(mkReq({ scopes: ['okf:t1:repoA:read'] }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('an admin scope satisfies read', async () => {
    const next = jest.fn();
    await requireScope('read')(mkReq({ scopes: ['okf:t1:repoA:admin'] }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('wildcard scope passes', async () => {
    const next = jest.fn();
    await requireScope('read')(mkReq({ scopes: ['okf:*:*:read'] }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('super-admin (tools-admin, no scopes) passes — operator regression', async () => {
    const next = jest.fn();
    await requireScope('read')(mkReq({ scopes: [], superAdmin: true }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('scopeless non-admin → 403 FORBIDDEN_SCOPE + denial audit', async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireScope('read')(mkReq({ scopes: [] }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN_SCOPE' }));
    expect(writeAudit).toHaveBeenCalledWith({
      action: 'authz.denied.scope',
      actor: 'u1',
      repo_id: null,
      source_ip: '127.0.0.1'
    });
  });

  test('non-okf or malformed scopes do NOT pass', async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireScope('read')(mkReq({ scopes: ['openid', 'okf:t1:repoA:write', 'okf:only-three'] }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireScope/requireRepoScope strictness (2026-08-16 review fixes)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('unknown level THROWS at wiring time (no silent fail-open fallback)', () => {
    expect(() => requireScope('okf:read')).toThrow(/unknown level/);
    expect(() => requireRepoScope('repo_id', 'okf:admin')).toThrow(/unknown level/);
  });

  test('typo level (write) grants NOTHING — not wildcard, not read', async () => {
    const res = mockRes();
    await requireScope('read')(mkReq({ scopes: ['okf:t1:*:write'] }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("requireRepoScope(repo_id, 'admin')", () => {
  beforeEach(() => jest.clearAllMocks());

  test('exact repo admin scope passes', async () => {
    const next = jest.fn();
    await requireRepoScope('repo_id', 'admin')(mkReq({ scopes: ['okf:t1:repoA:admin'] }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('read on the SAME repo does NOT satisfy admin (read ≠ admin)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireRepoScope('repo_id', 'admin')(mkReq({ scopes: ['okf:t1:repoA:read'] }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.denied.repo', repo_id: 'repoA' }));
  });

  test('admin on a DIFFERENT repo does not pass (cross-tenant, G15)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await requireRepoScope('repo_id', 'admin')(mkReq({ scopes: ['okf:t1:repoB:admin'], repo_id: 'repoA' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('wildcard admin passes', async () => {
    const next = jest.fn();
    await requireRepoScope('repo_id', 'admin')(mkReq({ scopes: ['okf:*:*:admin'] }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('super-admin passes without scopes — operator regression', async () => {
    const next = jest.fn();
    await requireRepoScope('repo_id', 'admin')(mkReq({ superAdmin: true }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('missing repo_id param → 403 (defensive, never a bypass)', async () => {
    const res = mockRes();
    const req = mkReq({ scopes: ['okf:t1:repoA:admin'] });
    delete req.params.repo_id;
    await requireRepoScope('repo_id', 'admin')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a non-param literal argument DENIES (no literal-authorization mode — review fix)', async () => {
    // The first arg is a req.params KEY; a repo id not present in params is
    // treated as missing and denied — never authorized as the literal string.
    const res = mockRes();
    const req = mkReq({ scopes: ['okf:t1:repoZ:admin'] }); // scope for repoZ, but param key 'repoZ' is absent
    await requireRepoScope('repoZ', 'admin')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireScope/requireRepoScope strictness (2026-08-16 review fixes)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('unknown level THROWS at wiring time (no silent fail-open fallback)', () => {
    expect(() => requireScope('okf:read')).toThrow(/unknown level/);
    expect(() => requireRepoScope('repo_id', 'okf:admin')).toThrow(/unknown level/);
  });

  test('typo level (write) grants NOTHING — not wildcard, not read', async () => {
    const res = mockRes();
    await requireScope('read')(mkReq({ scopes: ['okf:t1:*:write'] }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('typo-level repo scope does not satisfy requireRepoScope', async () => {
    const res = mockRes();
    await requireRepoScope('repo_id', 'admin')(mkReq({ scopes: ['okf:t1:repoA:write'] }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
