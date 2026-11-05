// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// REPO BULK PII ACTION (David, 2026-09-12): Redact / Remove / Accept applied
// to EVERY flagged concept in one steward decision. Scan-free — the stored
// unresolved summary is the ledger — and the repo scan marker is stamped
// complete so publish neither blocks nor re-scans afterwards.

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
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn(async () => ({}))
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const piiService = require('../services/pii-service');
const auditService = require('../services/audit-service');
const ACTOR = { sub: 'steward-1', name: 'Steward One' };

async function seedRepo() {
  await mockDb.collection('okf_repositories').save({ _key: 'repoA', name: 'Repo A' });
}

async function seedFlagged(concept_id, summary) {
  await mockDb.collection('okf_concepts_meta').save({
    _key: concept_id, // the mock keys docs by _key — seed per-concept rows
    repo_id: 'repoA',
    concept_id,
    frontmatter: { title: concept_id },
    body: `Contact data for ${concept_id}`,
    pii_state: 'hit',
    pii_hits_summary: summary || { PERSON: 2 },
    pii_resolutions: []
  });
}

async function seedClean(concept_id) {
  await mockDb.collection('okf_concepts_meta').save({
    _key: concept_id,
    repo_id: 'repoA',
    concept_id,
    frontmatter: { title: concept_id },
    body: 'clean content',
    pii_state: 'clean',
    pii_hits_summary: {},
    pii_resolutions: []
  });
}

function flaggedDocs() {
  return Object.values(mockDb._stores.okf_concepts_meta).filter((d) => d.pii_state === 'hit');
}

beforeEach(() => {
  mockDb._reset();
  jest.clearAllMocks();
});

describe('pii repo bulk action', () => {
  test('accept zeroes every flagged concept, records the ledger, stamps the marker — scan-free', async () => {
    await seedRepo();
    await seedFlagged('c1');
    await seedFlagged('c2', { EMAIL_ADDRESS: 1 });
    await seedClean('clean1');
    mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });

    const out = await piiService.repoBulkAction('repoA', { action: 'accept' }, ACTOR);

    expect(out).toMatchObject({ ok: true, action: 'accept', concepts_affected: 2 });
    for (const id of ['c1', 'c2']) {
      const doc = mockDb._stores.okf_concepts_meta[id];
      expect(doc.pii_state).toBe('clean');
      expect(doc.pii_hits_summary).toEqual({});
      expect(doc.pii_resolutions[doc.pii_resolutions.length - 1]).toMatchObject({
        // Was 'accept_repo', which subtractAccepted never matched — the bulk
        // Accept could not suppress anything and the curator's decision did not
        // survive a rescan. Now the durable whole-concept marker.
        action: 'accept_all_findings',
        hits_summary: expect.any(Object)
      });
    }
    // The untouched clean concept keeps its state; no body change for accepts.
    expect(mockDb._stores.okf_concepts_meta.clean1.pii_state).toBe('clean');
    expect(mockDb._stores.okf_concepts_meta.c1.body).toBe('Contact data for c1');
    // The review doubles as the completed scan for the publish gate.
    expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');
    expect(auditService.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.pii_bulk_accept' }));
  });

  // ── BULK ACCEPT DURABILITY (David, 2026-10-13) ────────────────────────────
  //
  // "The Accept All should just bulk accept everything the same way the
  //  individual accepts work." The per-item path suppressed correctly; the bulk
  // path wrote 'accept_repo', which subtractAccepted never matched, so every
  // finding came back on the next scan and the curator's decision was lost.
  describe('bulk accept is durable', () => {
    const OCC = [
      { where: 'body', type: 'PERSON', start: 0, end: 5, score: 0.85 },
      { where: 'body', type: 'EMAIL_ADDRESS', start: 10, end: 30, score: 1 }
    ];

    test('a whole-concept accept suppresses EVERY finding on the next scan', () => {
      // Direct unit on the suppression rule — the durability contract.
      const accepted = [{ action: 'accept_all_findings', type: null, where: null, before: null }];
      expect(piiService.subtractAccepted(OCC, accepted)).toEqual([]);
    });

    test('per-item accept still suppresses ONLY the matching finding', () => {
      // The per-item path must be untouched by the bulk change.
      const accepted = [{ action: 'accept', where: 'body', type: 'PERSON', before: 'MARIA' }];
      const out = piiService.subtractAccepted(
        [
          { where: 'body', type: 'PERSON', excerpt: { hit: 'MARIA' } },
          { where: 'body', type: 'EMAIL_ADDRESS', excerpt: { hit: 'a@b.org' } }
        ],
        accepted
      );
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('EMAIL_ADDRESS');
    });

    test('the LEGACY accept_repo action stays inert — no retroactive masking', () => {
      // CRITICAL SAFETY PROPERTY. 321 accept_repo records already exist on live
      // repositories. If the legacy name became durable, every finding those
      // curators accepted under the broken semantics would vanish silently —
      // masking content they never agreed to suppress.
      const legacy = [{ action: 'accept_repo', type: null, where: null, before: null }];
      const occs = [{ where: 'body', type: 'PERSON', excerpt: { hit: 'MARIA' } }];
      expect(piiService.subtractAccepted(occs, legacy)).toHaveLength(1);
    });

    test('no accepted resolutions at all leaves every finding outstanding', () => {
      expect(piiService.subtractAccepted(OCC, [])).toHaveLength(2);
    });
  });

  // ── THE CALL-PATH TEST (adversarial review 2026-10-13) ───────────────────
  //
  // The test above is a UNIT on subtractAccepted and it stayed GREEN while the
  // feature was dead: both real call sites pre-filtered the ledger to
  // action === 'accept' before calling it, so the whole-concept marker was
  // discarded and the suppression branch was unreachable. Two independent
  // verifiers found this. A unit test cannot catch a bug in the wiring that
  // feeds it, so this one goes through inspectConcept — the function a curator
  // actually hits — with persisted findings and a persisted ledger.
  //
  // FALSIFICATION: restore `.filter((r) => r && r.action === 'accept')` at both
  // call sites and this test FAILS (2 occurrences come back instead of 0).
  describe('bulk accept survives the REAL call path (not just the unit)', () => {
    const FRONTMATTER = { title: 'c1' };
    const BODY = 'Contact MARIA at maria@example.org';
    const OCCURRENCES = [
      { where: 'body', type: 'PERSON', start: 8, end: 13, score: 0.85 },
      { where: 'body', type: 'EMAIL_ADDRESS', start: 17, end: 35, score: 1 }
    ];

    async function seedWithLedger(resolutions) {
      await seedRepo();
      const fmText = Object.values(FRONTMATTER).join('\n');
      await mockDb.collection('okf_concepts_meta').save({
        _key: 'c1',
        repo_id: 'repoA',
        concept_id: 'c1',
        frontmatter: FRONTMATTER,
        body: BODY,
        pii_state: 'hit',
        pii_hits_summary: { PERSON: 1, EMAIL_ADDRESS: 1 },
        // Cached findings + a matching signature take inspectConcept down its
        // CACHE-HIT path — no sidecar call, so this isolates the suppression
        // wiring rather than the HTTP client.
        pii_findings: {
          content_sig: piiService.findingsSignature(fmText, BODY),
          occurrences: OCCURRENCES,
          counts_by_type: { PERSON: 1, EMAIL_ADDRESS: 1 }
        },
        pii_resolutions: resolutions
      });
    }

    test('a whole-concept marker leaves ZERO outstanding findings', async () => {
      await seedWithLedger([{ action: 'accept_all_findings', type: null, where: null, before: null }]);
      const out = await piiService.inspectConcept('repoA', 'c1', FRONTMATTER, BODY);
      expect(out.occurrences).toEqual([]);
    });

    test('the legacy accept_repo marker still leaves every finding outstanding', async () => {
      // Same path, inert marker — proves the test is sensitive to WHICH action
      // is in the ledger, not merely to a non-empty ledger.
      await seedWithLedger([{ action: 'accept_repo', type: null, where: null, before: null }]);
      const out = await piiService.inspectConcept('repoA', 'c1', FRONTMATTER, BODY);
      expect(out.occurrences).toHaveLength(2);
    });

    test('no ledger leaves every finding outstanding', async () => {
      await seedWithLedger([]);
      const out = await piiService.inspectConcept('repoA', 'c1', FRONTMATTER, BODY);
      expect(out.occurrences).toHaveLength(2);
    });
  });

  test('redact replaces every flagged body with the notice; remove empties them', async () => {
    await seedRepo();
    await seedFlagged('c1');
    await seedFlagged('c2');
    mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });
    await piiService.repoBulkAction('repoA', { action: 'redact' }, ACTOR);
    expect(mockDb._stores.okf_concepts_meta.c1.body).toMatch(/^# REDACTED/);
    expect(mockDb._stores.okf_concepts_meta.c1.pii_resolutions[0]).toMatchObject({ action: 'redact_file' });
    expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');

    await seedRepo();
    await seedFlagged('c3');
    mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });
    await piiService.repoBulkAction('repoA', { action: 'remove' }, ACTOR);
    expect(mockDb._stores.okf_concepts_meta.c3.body.trim()).toBe('');
    expect(mockDb._stores.okf_concepts_meta.c3.pii_state).toBe('clean');
  });

  test('zero flagged concepts → ok, marker untouched (nothing reviewed)', async () => {
    await seedRepo();
    await seedClean('only-clean');
    const out = await piiService.repoBulkAction('repoA', { action: 'accept' }, ACTOR);
    expect(out).toMatchObject({ ok: true, concepts_affected: 0 });
    expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBeUndefined();
  });

  test('invalid action → 400 VALIDATION_ERROR; unknown repo → 404 REPO_NOT_FOUND', async () => {
    await expect(piiService.repoBulkAction('repoA', { action: 'nuke' }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    await expect(piiService.repoBulkAction('missing-repo', { action: 'accept' }, ACTOR)).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
  });

  // ── DETACHED BULK JOB (UX-4, #1514) ──────────────────────────────────────
  // The editor's progress bar needs processed-of-total; the synchronous
  // action cannot provide it (one request, no interim reads). The job wraps
  // the SAME action and updates the registry per concept.
  describe('startRepoBulkPiiJob — the detached progress job', () => {
    async function awaitJobSettled(jobId) {
      // the worker is fire-and-forget; poll the registry until terminal
      for (let i = 0; i < 100; i++) {
        const job = piiService.getRepoBulkPiiJob(jobId);
        if (job && job.status !== 'running') return job;
        await new Promise((r) => setTimeout(r, 5));
      }
      return piiService.getRepoBulkPiiJob(jobId);
    }

    test('a bad action throws the VALIDATION_ERROR shape BEFORE any job exists (same 400 the sync route answers)', () => {
      // startRepoBulkPiiJob is SYNCHRONOUS up to the arm: the validation
      // throws before a job is registered, so the route answers 400 with no
      // orphan job in the registry.
      let thrown = null;
      try {
        piiService.startRepoBulkPiiJob('repoA', { action: 'nuke' }, ACTOR);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(piiService.getRepoBulkPiiJob('repoA')).toBeNull();
    });

    test('the job runs the action and reports processed-of-total to the final tally', async () => {
      await seedRepo();
      await seedFlagged('c1');
      await seedFlagged('c2', { EMAIL_ADDRESS: 1 });
      mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });

      const armed = piiService.startRepoBulkPiiJob('repoA', { action: 'accept' }, ACTOR);
      expect(armed).toMatchObject({ repo_id: 'repoA', action: 'accept', status: 'running', total: 0, processed: 0 });

      const settled = await awaitJobSettled(armed.job_id);
      expect(settled.status).toBe('done');
      expect(settled.total).toBe(2);
      expect(settled.processed).toBe(2);
      expect(settled.result).toMatchObject({ ok: true, action: 'accept', concepts_affected: 2 });
      // the concepts really were processed (not a phantom tally)
      expect(mockDb._stores.okf_concepts_meta.c1.pii_state).toBe('clean');
      expect(mockDb._stores.okf_concepts_meta.c2.pii_state).toBe('clean');
    });

    test('a failing job carries the error and the failed status', async () => {
      await seedRepo();
      await seedFlagged('c1');
      mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });
      // force the write path to explode mid-run: upsertPiiState on a missing
      // collection save would be swallowed by the mock, so break the LEDGER
      // append instead — appendResolution saves into pii_resolutions via
      // concept meta update; make the meta collection throw once.
      const orig = mockDb.collection('okf_concepts_meta').update;
      let broke = false;
      mockDb.collection('okf_concepts_meta').update = async (...a) => {
        if (!broke) {
          broke = true;
          throw new Error('disk full');
        }
        return orig(...a);
      };
      const armed = piiService.startRepoBulkPiiJob('repoA', { action: 'accept' }, ACTOR);
      const settled = await awaitJobSettled(armed.job_id);
      mockDb.collection('okf_concepts_meta').update = orig;
      expect(settled.status).toBe('failed');
      expect(settled.error).toBe('disk full');
    });

    test('an unknown job id reads as null (the route answers 404 from this)', () => {
      expect(piiService.getRepoBulkPiiJob('bp-never')).toBeNull();
    });
  });
});
