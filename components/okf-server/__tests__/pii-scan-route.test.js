// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.8 — piiScan controller route test (code-review #15: endpoint auth/report).

jest.mock('../services/repository-service', () => ({
  getById: jest.fn()
}));
jest.mock('../services/pii-service', () => ({
  scanConcept: jest.fn(),
  discoverRepoFiles: jest.fn(),
  recordIngestVersion: jest.fn(),
  markRepoPiiScanned: jest.fn(),
  assertPiiClean: jest.fn()
}));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const ctrl = require('../controllers/repository-controller');
const repoService = require('../services/repository-service');
const piiService = require('../services/pii-service');

function req(body, params = {}, user = { sub: 'u', name: 'U' }) {
  return { body, params, user, ip: '127.0.0.1' };
}
function res() {
  const r = { statusCode: 200 };
  return {
    status: jest.fn((c) => ({
      json: jest.fn((d) => {
        r.statusCode = c;
        r.body = d;
        return r;
      })
    })),
    json: jest.fn((d) => {
      r.body = d;
      return r;
    }),
    __out: r
  };
}

describe('piiScan controller (code-review #15)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enforces repo existence + domain BEFORE writing anything', async () => {
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    const r = res();
    await ctrl
      .piiScan(req({ concepts: [{ concept_id: 'c', body: 'x' }] }, { repo_id: 'r1' }), r, (e) => {
        throw e;
      })
      .catch(() => {});
    expect(repoService.getById).toHaveBeenCalledWith('r1', { domain: undefined });
    expect(piiService.scanConcept).not.toHaveBeenCalled();
  });

  it('scans explicit concepts, marks the repo scanned, returns the gate', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    piiService.scanConcept.mockResolvedValue({ concept_id: 'c', pii_state: 'clean', pii_hits_summary: {} });
    piiService.markRepoPiiScanned.mockResolvedValue();
    piiService.assertPiiClean.mockResolvedValue({ blocked: false, reasons: [] });
    const r = res();
    await ctrl.piiScan(req({ concepts: [{ concept_id: 'c', body: 'x' }] }, { repo_id: 'r1' }), r, () => {});
    expect(piiService.scanConcept).toHaveBeenCalledWith('r1', 'c', undefined, 'x');
    expect(piiService.markRepoPiiScanned).toHaveBeenCalledWith('r1');
    expect(r.__out.statusCode).toBe(200);
    expect(r.__out.body.gate.blocked).toBe(false);
    expect(r.__out.body.scanned).toBe(1);
  });

  it('rejects a body with no mode (no concepts/file_ids/discover)', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    const r = res();
    let caught = null;
    await ctrl.piiScan(req({}, { repo_id: 'r1' }), r, (e) => {
      caught = e;
    });
    expect(caught).toBeTruthy();
    expect(caught.status).toBe(400);
    expect(piiService.scanConcept).not.toHaveBeenCalled();
  });
});
