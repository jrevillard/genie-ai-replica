// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repo-wide CONCEPT PII rescan (pii-service) — the unblock for a concept
// stuck in pii_state='error'. Covers:
//   - enumeration of the concept rows the publish gate actually reads
//   - the real persisting scanConcept over each of them (not file discovery)
//   - the ASYNC 202 + poll lifecycle (running -> complete) and its in-flight
//     guard, mirroring head-suite's beginRunSuite
//   - NO FALSE ATTESTATION: zero scanned => markRepoPiiScanned is NEVER
//     called and the failure says so (defect 3d)
//   - FAIL-CLOSED preserved: a transport failure stays 'error' and blocking

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));

// The Presidio sidecar — programmed per test. Every concept scan posts the
// two-region payload {frontmatter, body}, so the mock discriminates on the
// body text to make ONE concept fail.
const mockSidecarPost = jest.fn();
jest.mock('axios', () => ({
  default: { get: jest.fn() },
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => ({ post: mockSidecarPost }))
}));

const piiService = require('../services/pii-service');
const conceptMetaService = require('../services/concept-meta-service');
const mockDb = require('../shared-lib/db-connection-service').__mockDb;

/** Two-region sidecar response (frontmatter + body). */
const sidecarRegions = (fmHits = [], bodyHits = [], bodyText = '') => ({
  data: {
    results: [
      { id: 'frontmatter', hits: fmHits, counts_by_type: {} },
      { id: 'body', text: bodyText, hits: bodyHits, counts_by_type: {} }
    ]
  }
});

/** Seed okf_concepts_meta rows (repo_id + concept_id + stored content). */
function seedConcepts(repo_id, conceptIds, bodyFor = (cid) => `body of ${cid}`) {
  const rows = {};
  for (const cid of conceptIds) {
    rows[cid] = {
      _key: cid,
      repo_id,
      concept_id: cid,
      frontmatter: { title: cid },
      body: bodyFor(cid)
    };
  }
  mockDb._stores.okf_concepts_meta = rows;
  return rows;
}

/** Program the enumeration query — the ONLY subject set this mode reads. */
function programEnumeration(conceptIds) {
  mockDb.query.mockImplementation(async (q) => {
    const text = typeof q === 'string' ? q : q && q.query ? String(q.query) : '';
    // listRepoConceptIds: the concept_id projection over okf_concepts_meta.
    if (text.includes('RETURN m.concept_id')) {
      return { all: async () => [...conceptIds] };
    }
    // assertPiiClean: the per-state COLLECT.
    if (text.includes('COLLECT state = d.pii_state')) {
      return { all: async () => [] };
    }
    // sweepInterruptedScans' AQL UPDATE.
    if (text.includes('PII_SCAN_INTERRUPTED')) {
      return { all: async () => [] };
    }
    return { all: async () => [] };
  });
}

describe('repo-wide CONCEPT PII rescan (the pii_state=error unblock)', () => {
  beforeEach(() => {
    mockDb._reset();
    jest.clearAllMocks();
    // Cases that produce an ERRORED concept now ride out a sidecar worker
    // respawn with real pauses (3 tries x 8/16/24s). Collapse the pause so the
    // suite asserts the behaviour rather than the wall clock.
    process.env.PII_CONCEPT_RETRY_PAUSE_MS = '1';
    // The repo doc must exist — markRepoPiiScanned updates it.
    mockDb._stores.okf_repositories = { repoA: { _key: 'repoA', repo_id: 'repoA', pii_scan_status: 'pending' } };
  });

  afterEach(() => {
    delete process.env.PII_CONCEPT_RETRY_PAUSE_MS;
  });

  describe('listRepoConceptIds (enumeration)', () => {
    it('enumerates every concept_id of the repo, sorted, as bare strings', async () => {
      programEnumeration(['c1', 'c2', 'c3']);
      await expect(piiService.listRepoConceptIds('repoA')).resolves.toEqual(['c1', 'c2', 'c3']);
    });

    it('tolerates a full-doc return (unwraps .concept_id)', async () => {
      mockDb.query.mockResolvedValue({ all: async () => [{ concept_id: 'c1' }, null, { concept_id: 'c2' }] });
      await expect(piiService.listRepoConceptIds('repoA')).resolves.toEqual(['c1', 'c2']);
    });

    it('returns [] without a repo (no repo-wide query)', async () => {
      mockDb.query.mockClear();
      await expect(piiService.listRepoConceptIds(null)).resolves.toEqual([]);
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  describe('scanRepoConcepts (the real persisting scan)', () => {
    it('scans EVERY concept of the repo and persists pii_state on each row', async () => {
      seedConcepts('repoA', ['c1', 'c2', 'c3']);
      programEnumeration(['c1', 'c2', 'c3']);
      mockSidecarPost.mockResolvedValue(sidecarRegions());

      const tally = await piiService.scanRepoConcepts('repoA');

      expect(tally.scanned).toBe(3);
      expect(tally.clean).toBe(3);
      expect(tally.hit).toBe(0);
      expect(tally.error).toBe(0);
      expect(tally.results.map((r) => r.concept_id)).toEqual(['c1', 'c2', 'c3']);
      // The PERSISTING part — this is what the inspect endpoint cannot do.
      const rows = Object.values(mockDb._stores.okf_concepts_meta);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.pii_state).toBe('clean');
        expect(row.pii_scanned_at).toEqual(expect.any(String));
      }
      // One sidecar round-trip per concept.
      expect(mockSidecarPost).toHaveBeenCalledTimes(3);
    });

    it('an errored concept comes back error, a clean one comes back clean', async () => {
      seedConcepts('repoA', ['good', 'broken']);
      programEnumeration(['broken', 'good']); // sorted: broken < good
      // FAIL-CLOSED: the sidecar refuses exactly one concept's body.
      mockSidecarPost.mockImplementation(async (_path, body) => {
        const bodyText = (body.texts || []).find((t) => t.id === 'body').text;
        if (bodyText.includes('broken')) throw { code: 'ECONNRESET' };
        return sidecarRegions([], [], bodyText);
      });

      const tally = await piiService.scanRepoConcepts('repoA');

      expect(tally.results.find((r) => r.concept_id === 'broken').pii_state).toBe('error');
      expect(tally.results.find((r) => r.concept_id === 'good').pii_state).toBe('clean');
      expect(tally.clean).toBe(1);
      expect(tally.error).toBe(1);
      // The error is PERSISTED — the gate keeps blocking on it (fail-closed).
      expect(mockDb._stores.okf_concepts_meta.broken.pii_state).toBe('error');
      expect(mockDb._stores.okf_concepts_meta.good.pii_state).toBe('clean');
    });

    it('a PII hit is reported as hit (never silently clean)', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1']);
      mockSidecarPost.mockResolvedValue(
        sidecarRegions([], [{ type: 'EMAIL_ADDRESS', start: 0, end: 11, score: 0.9 }], 'body of c1')
      );
      const tally = await piiService.scanRepoConcepts('repoA');
      expect(tally.hit).toBe(1);
      expect(tally.results[0].pii_state).toBe('hit');
      expect(tally.results[0].pii_hits_summary).toEqual({ EMAIL_ADDRESS: 1 });
    });

    it('reports a vanished meta row as missing, never as a clean pass', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1', 'ghost']); // ghost is enumerated but not stored
      mockSidecarPost.mockResolvedValue(sidecarRegions());

      const tally = await piiService.scanRepoConcepts('repoA');

      expect(tally.scanned).toBe(1); // only c1 actually scanned
      expect(tally.missing).toBe(1);
      expect(tally.results.find((r) => r.concept_id === 'ghost').pii_state).toBeNull();
    });

    it('marks the repo PII-scanned ONLY after concepts were actually scanned', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1']);
      mockSidecarPost.mockResolvedValue(sidecarRegions());
      await piiService.scanRepoConcepts('repoA');
      expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');
    });

    // ── THE REGRESSION (2026-10-13): a worker respawn must not brick a repo ──
    //
    // The sidecar's uvicorn worker crashes mid-request under sustained scan
    // load (observed: 5 deaths during one 140-concept run). scanConcept
    // correctly fails closed on the reset connection — but recording a
    // PERMANENT pii_state='error' for a failure that heals ~10s later is
    // exactly what made one blip block a repository indefinitely, with no
    // re-scan able to clear it.
    it('a concept whose scan fails ONCE then succeeds is NOT left in error', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1']);
      mockSidecarPost.mockRejectedValueOnce({ code: 'ECONNRESET', message: 'socket hang up' });
      mockSidecarPost.mockResolvedValue(sidecarRegions());

      const out = await piiService.scanRepoConcepts('repoA');

      expect(mockDb._stores.okf_concepts_meta.c1.pii_state).toBe('clean');
      expect(out.error).toBe(0);
      // It really did retry rather than getting lucky on the first call.
      expect(mockSidecarPost.mock.calls.length).toBeGreaterThanOrEqual(2);
      // And the repo is attestable, so the publish gate can pass.
      expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');
    });

    it('still ends fail-closed when the sidecar is genuinely down, and bounded', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1']);
      mockSidecarPost.mockRejectedValue({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });

      let caught = null;
      try {
        await piiService.scanRepoConcepts('repoA');
      } catch (e) {
        caught = e;
      }
      // FAIL-CLOSED must survive the resilience work: a permanently-down sidecar
      // is an error, never a silent 'clean' — and the run refuses to attest.
      expect(mockDb._stores.okf_concepts_meta.c1.pii_state).toBe('error');
      expect(caught.code).toBe('PII_SCAN_NOTHING_SCANNED');
      expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('pending');
      // Bounded, never unbounded. The bounds COMPOUND deliberately: the
      // client's own 3 fast attempts die inside a worker respawn, while the
      // scan worker's slower tries (8/16/24s) outlast it. Worst case is
      // 4 scanConcept calls x 3 client attempts = 12, and only on failure.
      expect(mockSidecarPost.mock.calls.length).toBeLessThanOrEqual(12);
    }, 20000);
  });

  describe('NO FALSE ATTESTATION (defect 3d)', () => {
    it('ZERO concepts => markRepoPiiScanned is NEVER called and the run fails', async () => {
      programEnumeration([]); // discovery matched nothing
      mockSidecarPost.mockResolvedValue(sidecarRegions());

      await expect(piiService.scanRepoConcepts('repoA')).rejects.toMatchObject({
        code: 'PII_SCAN_NOTHING_SCANNED',
        status: 400
      });

      // The repo must NOT be stamped "PII scanned / complete".
      expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('pending');
      expect(mockSidecarPost).not.toHaveBeenCalled();
    });

    it('EVERY concept errored => also zero scanned => no attestation', async () => {
      seedConcepts('repoA', ['c1', 'c2']);
      programEnumeration(['c1', 'c2']);
      mockSidecarPost.mockRejectedValue({ code: 'ECONNREFUSED' }); // sidecar down

      let caught = null;
      try {
        await piiService.scanRepoConcepts('repoA');
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe('PII_SCAN_NOTHING_SCANNED');
      // The per-concept rows ARE honest ('error', fail-closed)…
      expect(mockDb._stores.okf_concepts_meta.c1.pii_state).toBe('error');
      expect(mockDb._stores.okf_concepts_meta.c2.pii_state).toBe('error');
      // …but the repo-level "complete" attestation is withheld.
      expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('pending');
      // The response says why.
      expect(caught.message).toMatch(/examined no concepts/);
      expect(caught.details.error).toBe(2);
      // Both concepts are errored, and each now rides out the worker-respawn
      // retry (4 scanConcept calls x 3 client attempts = 24 sidecar calls for
      // what used to be 2), so the default 5s budget is too tight.
    }, 20000);
  });

  describe('ASYNC 202 + poll lifecycle', () => {
    it('running -> complete, and the poll returns the tally', async () => {
      seedConcepts('repoA', ['c1', 'c2']);
      programEnumeration(['c1', 'c2']);
      mockSidecarPost.mockResolvedValue(sidecarRegions());

      const { scan_key, done } = await piiService.beginRepoConceptScan('repoA', { actor: { sub: 'curator-1' } });
      expect(scan_key).toMatch(/^p\d+-[0-9a-f]{6}$/);
      // The placeholder is persisted with status 'running' BEFORE the answer.
      const running = await piiService.getRepoConceptScan('repoA', scan_key);
      expect(running.status).toBe('running');
      expect(running.progress).toBeDefined();

      const doc = await done;

      expect(doc.status).toBe('complete');
      expect(doc.scanned).toBe(2);
      expect(doc.clean).toBe(2);
      expect(doc.gate).toBeDefined();
      const polled = await piiService.getRepoConceptScan('repoA', scan_key);
      expect(polled.status).toBe('complete');
      expect(polled.scanned).toBe(2);
      expect(polled.results).toHaveLength(2);
      expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');
    });

    it('a failed worker still reaches a TERMINAL failed doc (the poll never spins)', async () => {
      programEnumeration([]);
      mockSidecarPost.mockResolvedValue(sidecarRegions());

      const { scan_key, done } = await piiService.beginRepoConceptScan('repoA');
      await expect(done).rejects.toMatchObject({ code: 'PII_SCAN_NOTHING_SCANNED' });

      const polled = await piiService.getRepoConceptScan('repoA', scan_key);
      expect(polled.status).toBe('failed');
      expect(polled.error.code).toBe('PII_SCAN_NOTHING_SCANNED');
      expect(polled.tally.scanned).toBe(0);
    });

    it('in-flight guard: a second scan is 409 and carries the adoptable key in details', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1']);
      // Hold the worker open INSIDE the sidecar call so the lock is provably
      // still held when the second begin arrives.
      let release;
      let entered;
      const reachedSidecar = new Promise((resolve) => {
        entered = resolve;
      });
      mockSidecarPost.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve(sidecarRegions());
            entered();
          })
      );

      const first = await piiService.beginRepoConceptScan('repoA');
      await reachedSidecar;
      let caught = null;
      try {
        await piiService.beginRepoConceptScan('repoA');
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe('PII_SCAN_IN_FLIGHT');
      expect(caught.status).toBe(409);
      expect(caught.details.scan_key).toBe(first.scan_key);

      release();
      await first.done;
      // The lock is released on completion — a new scan can start.
      mockSidecarPost.mockResolvedValue(sidecarRegions());
      const second = await piiService.beginRepoConceptScan('repoA');
      await second.done;
    });

    it("an orphan 'running' doc (dead worker) is reaped to failed, not spun on", async () => {
      // No live lock for this key — a restart left it running.
      mockDb._stores.okf_pii_scan_runs = {
        orphan: { _key: 'orphan', repo_id: 'repoA', status: 'running', created_at: new Date().toISOString() }
      };
      const doc = await piiService.getRepoConceptScan('repoA', 'orphan');
      expect(doc.status).toBe('failed');
      expect(doc.error.code).toBe('PII_SCAN_INTERRUPTED');
      expect(mockDb._stores.okf_pii_scan_runs.orphan.status).toBe('failed');
    });

    it('a foreign/unknown scan key 404s (anti-enumeration)', async () => {
      mockDb._stores.okf_pii_scan_runs = {
        k1: { _key: 'k1', repo_id: 'repoB', status: 'complete', created_at: new Date().toISOString() }
      };
      await expect(piiService.getRepoConceptScan('repoA', 'k1')).rejects.toMatchObject({
        code: 'PII_SCAN_NOT_FOUND',
        status: 404
      });
    });
  });

  describe('boot sweep (orphans after a restart)', () => {
    it('marks interrupted running scans as failed and reports the count', async () => {
      await piiService.sweepInterruptedScans();
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('PII_SCAN_INTERRUPTED'));
    });
  });

  describe('the concept rows are the ones the publish gate reads', () => {
    it('a rescan writes pii_state onto okf_concepts_meta (version-service gate subject)', async () => {
      seedConcepts('repoA', ['c1']);
      programEnumeration(['c1']);
      mockSidecarPost.mockRejectedValue({ code: 'ETIMEDOUT' });

      await piiService.scanRepoConcepts('repoA').catch(() => {});

      const row = mockDb._stores.okf_concepts_meta.c1;
      expect(row.pii_state).toBe('error');
      expect(row.concept_id).toBe('c1');
      expect(row.repo_id).toBe('repoA');
      // getConceptMeta (the same loader inspectPii uses) sees it.
      const meta = await conceptMetaService.getConceptMeta('repoA', 'c1');
      expect(meta.pii_state).toBe('error');
    });
  });
});
