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
  assertPiiClean: jest.fn(),
  beginRepoConceptScan: jest.fn(),
  getRepoConceptScan: jest.fn()
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
    expect(repoService.getById).toHaveBeenCalledWith('r1', { authz: expect.any(Set) });
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

  it('DRAIN FREEZE (David, 2026-09-12): a GDPR scan mid-ingest is refused — the drain owns pii_state', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1', rag_drain_active: true });
    const r = res();
    let caught = null;
    await ctrl.piiScan(req({ discover: true }, { repo_id: 'r1' }), r, (e) => {
      caught = e;
    });
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('DRAIN_IN_PROGRESS');
    expect(caught.status).toBe(409);
    expect(piiService.scanConcept).not.toHaveBeenCalled();
    expect(piiService.markRepoPiiScanned).not.toHaveBeenCalled();
  });

  // ─── {scope:'concepts'} — the ASYNC repo-wide concept rescan ──────────────
  it('scope:concepts answers 202 + scan_key and does NOT scan synchronously', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    piiService.beginRepoConceptScan.mockResolvedValue({ scan_key: 'p123-abcdef', done: Promise.resolve({}) });
    const r = res();
    await ctrl.piiScan(req({ scope: 'concepts' }, { repo_id: 'r1' }), r, () => {});
    expect(piiService.beginRepoConceptScan).toHaveBeenCalledWith('r1', { actor: expect.any(Object) });
    expect(r.__out.statusCode).toBe(202);
    expect(r.__out.body).toEqual({ repo_id: 'r1', scan_key: 'p123-abcdef', status: 'running' });
    // The synchronous scan loop must NOT run for this mode.
    expect(piiService.scanConcept).not.toHaveBeenCalled();
  });

  it('scope:concepts is DRAIN-FROZEN too (it overwrites pii_state on EVERY row)', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1', rag_drain_active: true });
    const r = res();
    let caught = null;
    await ctrl.piiScan(req({ scope: 'concepts' }, { repo_id: 'r1' }), r, (e) => {
      caught = e;
    });
    expect(caught.code).toBe('DRAIN_IN_PROGRESS');
    expect(piiService.beginRepoConceptScan).not.toHaveBeenCalled();
  });

  it('scope:concepts surfaces an in-flight 409 with the adoptable scan_key', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    piiService.beginRepoConceptScan.mockRejectedValue(
      Object.assign(new Error('busy'), {
        code: 'PII_SCAN_IN_FLIGHT',
        status: 409,
        details: { scan_key: 'p999-aaaaaa' }
      })
    );
    const r = res();
    let caught = null;
    await ctrl.piiScan(req({ scope: 'concepts' }, { repo_id: 'r1' }), r, (e) => {
      caught = e;
    });
    expect(caught.code).toBe('PII_SCAN_IN_FLIGHT');
    expect(caught.status).toBe(409);
    expect(caught.details.scan_key).toBe('p999-aaaaaa');
    expect(r.__out.statusCode).toBe(200); // nothing written
  });

  it('the poll endpoint returns the running/complete envelope', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    piiService.getRepoConceptScan.mockResolvedValue({
      repo_id: 'r1',
      scan_key: 'p1',
      status: 'running',
      progress: { phase: 'scanning', done: 3, total: 141 }
    });
    const r = res();
    await ctrl.getPiiConceptScan({ params: { repo_id: 'r1', scan_key: 'p1' } }, r, () => {});
    expect(piiService.getRepoConceptScan).toHaveBeenCalledWith('r1', 'p1');
    expect(r.__out.statusCode).toBe(200);
    expect(r.__out.body.progress).toEqual({ phase: 'scanning', done: 3, total: 141 });
  });

  it('the poll endpoint 404s a repo outside the caller scopes (anti-enumeration)', async () => {
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    const r = res();
    let caught = null;
    await ctrl.getPiiConceptScan({ params: { repo_id: 'foreign', scan_key: 'p1' } }, r, (e) => {
      caught = e;
    });
    expect(caught.status).toBe(404);
    expect(piiService.getRepoConceptScan).not.toHaveBeenCalled();
  });

  // ─── NO FALSE ATTESTATION (defect 3d) ─────────────────────────────────────
  it('a discovery that examined NOTHING does NOT stamp the repo PII-scanned', async () => {
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    piiService.discoverRepoFiles.mockResolvedValue([]); // zero scannable files
    const r = res();
    let caught = null;
    await ctrl.piiScan(req({ discover: true }, { repo_id: 'r1' }), r, (e) => {
      caught = e;
    });
    expect(piiService.markRepoPiiScanned).not.toHaveBeenCalled();
    expect(caught.code).toBe('PII_SCAN_NOTHING_SCANNED');
    expect(caught.status).toBe(400);
    expect(caught.message).toMatch(/was NOT marked PII-scanned/);
    expect(r.__out.statusCode).toBe(200); // nothing written
  });
});
