// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// #1577 story 1 — the CURATOR-INITIATED, PER-CONCEPT, LOSSLESS split
// (concept-split-operation.js + its route/controller surface).
//
// The properties under test mirror the spec (spec-okf-curator-split):
//   CAP-1  the parts rejoin byte-for-byte and each fits the ceiling;
//   CAP-2  the unsplittable case refuses 409 with ZERO rows written;
//   the drain constraint — every part row is born-right (index_status
//   'parsed' + the repo's current graph name) through the ONE upsert path;
//   CAP-4  the route is admin-scoped and the controller gates on
//   assertWritable before any write.
// The REAL concept-splitter runs in these tests — the lossless engine is
// party to the contract, not mocked away.
jest.mock('../shared-lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ counter: () => ({ add: jest.fn() }), createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));

const ORIGINAL_CEILING = process.env.OKF_MAX_CONCEPT_DOC_CHARS;

// A multi-heading body: with the env ceiling at 200 the real splitter yields
// THREE parts (sections merge greedily under the bound: A+B, C+D, E).
const BODY = [
  '# Alpha',
  '',
  'alpha paragraph with enough words to be a real section of the document.',
  '',
  '# Beta',
  '',
  'beta paragraph with enough words to be a real section of the document.',
  '',
  '# Gamma',
  '',
  'gamma paragraph with enough words to be a real section of the document.',
  '',
  '# Delta',
  '',
  'delta paragraph with enough words to be a real section of the document.',
  '',
  '# Epsilon',
  '',
  'epsilon paragraph with enough words to be a real section of the document.'
].join('\n');

const META_ROW = (over = {}) => ({
  repo_id: 'r1',
  concept_id: 'big-concept',
  path: 'docs/big-concept.md',
  title: 'Big Concept',
  frontmatter: { type: 'topic', title: 'Big Concept', tags: ['k'] },
  links: [{ to_concept_id: 'other', label: 'Other' }],
  sources: [{ kind: 'document', resource: 'https://x/file', file_id: 'f-1' }],
  body: BODY,
  lifecycle_status: 'draft',
  trust_tier: 'curated',
  bundle_version: 4,
  ingest_labels: ['acl:open'],
  graph_name: 'OKF_r1_v1',
  content_hash: 'old-hash',
  index_status: 'indexed',
  ...over
});

let upsertConceptMeta;
let getConceptMeta;
let deleteConceptMeta;
let scanConcept;
let workingGraphName;

beforeEach(() => {
  jest.resetModules();
  process.env.OKF_MAX_CONCEPT_DOC_CHARS = '200';
  upsertConceptMeta = jest.fn().mockImplementation(async (_repo, parsed) => ({
    action: parsed.concept_id === 'big-concept' ? 'updated' : 'created'
  }));
  // Default: only the ORIGINAL concept row exists; the -part-N ids are free
  // (the collision pre-check probes them before any write).
  getConceptMeta = jest
    .fn()
    .mockImplementation(async (_repo, concept_id) => (concept_id === 'big-concept' ? META_ROW() : null));
  deleteConceptMeta = jest.fn().mockResolvedValue({});
  scanConcept = jest.fn().mockResolvedValue({ pii_state: 'clean', occurrences: [] });
  workingGraphName = jest.fn(() => 'OKF_r1_v3');

  jest.doMock('../services/concept-meta-service', () => ({
    getConceptMeta: (...a) => getConceptMeta(...a),
    upsertConceptMeta: (...a) => upsertConceptMeta(...a),
    deleteConceptMeta: (...a) => deleteConceptMeta(...a),
    contentHash: (s) => `hash:${String(s).length}`
  }));
  jest.doMock('../services/graph-lifecycle-service', () => ({
    workingGraphName: (...a) => workingGraphName(...a)
  }));
  jest.doMock('../services/pii-service', () => ({ scanConcept: (...a) => scanConcept(...a) }));
});

afterEach(() => {
  if (ORIGINAL_CEILING === undefined) delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
  else process.env.OKF_MAX_CONCEPT_DOC_CHARS = ORIGINAL_CEILING;
});

function svc() {
  return require('../services/concept-split-operation');
}

describe('splitConcept — CAP-1: the lossless, ceiling-bounded split', () => {
  test('the parts REJOIN the original body byte-for-byte and each fits the ceiling', async () => {
    const result = await svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {});
    expect(result.parts.length).toBeGreaterThan(1);
    for (const p of result.parts) expect(p.chars).toBeLessThanOrEqual(200);
    // The one invariant the whole initiative exists for: nothing lost, nothing
    // added. The parts are contiguous line ranges — re-joined in FORWARD part
    // order (result.parts is forward-ordered; the WRITE order underneath is
    // deliberately not) with the document's OWN line ending they reproduce the
    // body exactly (the newline between parts is the document's, not an
    // addition).
    const bodiesById = Object.fromEntries(upsertConceptMeta.mock.calls.map((c) => [c[1].concept_id, c[1].body]));
    expect(result.parts.map((p) => bodiesById[p.concept_id]).join('\n')).toBe(BODY);
    const sum = result.parts.reduce((a, p) => a + p.chars, 0) + (result.parts.length - 1);
    expect(sum).toBe(BODY.length);
  });

  test('part 1 keeps the concept_id; parts 2..N take -part-N ids and suffixed titles', async () => {
    const result = await svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {});
    expect(result.parts[0].concept_id).toBe('big-concept');
    // The suffix sequence follows the parts (the count comes from the real
    // splitter's seams, not from this test's arithmetic).
    result.parts.slice(1).forEach((p, i) => {
      expect(p.concept_id).toBe(`big-concept-part-${i + 2}`);
    });
    const byId = Object.fromEntries(upsertConceptMeta.mock.calls.map((c) => [c[1].concept_id, c[1]]));
    expect(byId['big-concept'].frontmatter.title).toBe('Big Concept');
    expect(byId['big-concept-part-2'].frontmatter.title).toBe('Big Concept — part 2');
    // The path suffix is partPath's own convention: ZERO-based index in, so
    // part 2 (i=1) is `-part-2.md` — the LIVE smoke caught an off-by-one
    // here (-part-3) that the id/title assertions alone let through. Ids and
    // paths must never disagree across parts.
    expect(byId['big-concept'].path).toBe('docs/big-concept.md');
    for (const u of Object.values(byId)) {
      if (u.concept_id === 'big-concept') continue;
      expect(u.path).toBe(`docs/${u.concept_id}.md`);
    }
  });

  test('the writes run parts 2..N FIRST and the part-1 overwrite LAST — a mid-loop failure can never truncate the original', async () => {
    await svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {});
    const writtenIds = upsertConceptMeta.mock.calls.map((c) => c[1].concept_id);
    expect(writtenIds[writtenIds.length - 1]).toBe('big-concept'); // the overwrite is the FINAL write
    // every non-final write is a fresh -part-N row, in DESCENDING part order
    const partIds = writtenIds.slice(0, -1);
    for (const id of partIds) expect(id).not.toBe('big-concept');
    const nums = partIds.map((id) => Number(id.match(/-part-(\d+)$/)[1]));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  });

  test('every row is born-right: index_status parsed, the CURRENT graph name, bundle + labels carried, claim stamps RESET', async () => {
    await svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {});
    for (const call of upsertConceptMeta.mock.calls) {
      const opts = call[2];
      expect(opts.graph_name).toBe('OKF_r1_v3'); // workingGraphName(repo), not the row's stale value
      expect(opts.bundle_version).toBe(4);
      expect(opts.ingest_labels).toEqual(['acl:open']);
      // Born-right means CLAIMABLE: a previously FAILED row's backoff park
      // and spent attempt budget must not survive the split (the #1020 reset
      // contract — the claim query gates on these).
      expect(opts.patch).toEqual({
        next_attempt_after: null,
        worker_claimed_at: null,
        ingest_attempts: 0,
        reindex_retry: 0,
        last_error: null
      });
    }
    // Part 1 carries the row's own metadata through the update...
    const lastCall = upsertConceptMeta.mock.calls[upsertConceptMeta.mock.calls.length - 1];
    expect(lastCall[1].links).toEqual(META_ROW().links);
    // ...and parts 2..N carry sources[] UNCHANGED — provenance is not partitioned.
    for (const call of upsertConceptMeta.mock.calls.slice(0, -1)) {
      expect(call[1].sources).toEqual(META_ROW().sources);
    }
  });

  test('the summary counts one update (part 1) and the rest created, and PII scans every part', async () => {
    const result = await svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {});
    expect(result.created).toBe(result.parts.length - 1);
    expect(result.updated).toBe(1);
    expect(result.ceiling).toBe(200);
    expect(scanConcept).toHaveBeenCalledTimes(result.parts.length);
    // The scans see each part's OWN content (frontmatter + body) — exactly
    // what the upsert wrote for that part, never the whole concept. (The
    // scan pool makes completion order irrelevant; assert the SET.)
    const scanned = scanConcept.mock.calls.map((c) => [c[1], c[3]]); // [concept_id, body]
    for (const call of upsertConceptMeta.mock.calls) {
      expect(scanned).toContainEqual([call[1].concept_id, call[1].body]);
    }
  });
});

describe('splitConcept — CAP-2: honest refusals, zero partial state', () => {
  test('an unsplittable concept (one line over the ceiling) → 409 CONCEPT_TOO_LARGE, ZERO rows written', async () => {
    getConceptMeta.mockResolvedValue(META_ROW({ body: 'x'.repeat(500) }));
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      code: 'CONCEPT_TOO_LARGE',
      status: 409
    });
    expect(upsertConceptMeta).not.toHaveBeenCalled();
    expect(scanConcept).not.toHaveBeenCalled();
  });

  test('the 409 names the size, the ceiling and the remedy', async () => {
    getConceptMeta.mockResolvedValue(META_ROW({ body: 'x'.repeat(500) }));
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      message: expect.stringMatching(/500 characters/)
    });
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      message: expect.stringMatching(/200-character ceiling/)
    });
  });

  test('a within-ceiling concept is an honest 400 no-op (CONCEPT_WITHIN_CEILING), not a fake success', async () => {
    getConceptMeta.mockResolvedValue(META_ROW({ body: 'short body' }));
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      code: 'CONCEPT_WITHIN_CEILING',
      status: 400
    });
    expect(upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('a split beyond the part cap refuses 400 TOO_MANY_PARTS with zero writes', async () => {
    // ~260 short single-line paragraphs with a 10-char ceiling: every PAIR of
    // lines exceeds the bound (so greedyMerge keeps one part each) while every
    // line itself fits (so nothing is unsplittable) — past the 200-part cap.
    const many = Array.from({ length: 260 }, (_, i) => `w${i} x`).join('\n\n');
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = '10';
    getConceptMeta.mockResolvedValue(META_ROW({ body: many }));
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      code: 'TOO_MANY_PARTS',
      status: 400
    });
    expect(upsertConceptMeta).not.toHaveBeenCalled();
  });

  test('a missing concept is a 404, not a silent success', async () => {
    getConceptMeta.mockResolvedValue(null);
    await expect(svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'ghost', {})).rejects.toMatchObject({
      code: 'CONCEPT_NOT_FOUND',
      status: 404
    });
  });

  test('an unrelated concept already holding a -part-N id → 409 PART_ID_CONFLICT, ZERO rows written', async () => {
    // A real `foo-part-2.md` in the corpus yields exactly such a row — the
    // split must never silently overwrite it (the upsert WOULD: same repo_id
    // + concept_id hits the update path).
    getConceptMeta.mockImplementation(async (_repo, concept_id) =>
      concept_id === 'big-concept' || concept_id === 'big-concept-part-2' ? META_ROW() : null
    );
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      code: 'PART_ID_CONFLICT',
      status: 409
    });
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      message: expect.stringMatching(/big-concept-part-2/)
    });
    expect(upsertConceptMeta).not.toHaveBeenCalled();
    expect(deleteConceptMeta).not.toHaveBeenCalled();
  });

  test('a mid-write failure ROLLS BACK the created rows and never truncates the original (SPLIT_WRITE_FAILED 500)', async () => {
    // The write order is parts 2..N DESCENDING then part 1: part-3 succeeds,
    // part-2 fails — the original row must never have been touched, and the
    // rollback must remove the row created before the failure.
    upsertConceptMeta.mockImplementation(async (_repo, parsed) => {
      if (parsed.concept_id !== 'big-concept' && /part-2$/.test(parsed.concept_id)) {
        throw new Error('arango transient');
      }
      return { action: parsed.concept_id === 'big-concept' ? 'updated' : 'created' };
    });
    await expect(
      svc().splitConcept({ repo_id: 'r1', lifecycle_state: 'draft' }, 'big-concept', {})
    ).rejects.toMatchObject({
      code: 'SPLIT_WRITE_FAILED',
      status: 500
    });
    // The part-1 overwrite NEVER ran (it is the last write; the failure beat it).
    const upsertedIds = upsertConceptMeta.mock.calls.map((c) => c[1].concept_id);
    expect(upsertedIds).not.toContain('big-concept');
    // The row created before the failure was rolled back.
    expect(deleteConceptMeta).toHaveBeenCalledTimes(1);
    expect(deleteConceptMeta.mock.calls[0]).toEqual(['r1', 'big-concept-part-3']);
    // The PII scans never ran on a rolled-back split.
    expect(scanConcept).not.toHaveBeenCalled();
  });
});

describe('splitConcept controller — CAP-4: the write surface holds', () => {
  let splitConceptHandler;
  let repoService;
  let auditService;

  beforeEach(() => {
    repoService = {
      getById: jest.fn().mockResolvedValue({ repo_id: 'r1', lifecycle_state: 'draft' })
    };
    auditService = { writeAudit: jest.fn().mockResolvedValue(null) };
    jest.doMock('../services/repository-service', () => repoService);
    jest.doMock('../services/audit-service', () => auditService);
    const controller = require('../controllers/repository-controller');
    splitConceptHandler = controller.splitConcept;
  });

  function call(params = {}) {
    const req = {
      params: { repo_id: 'r1', concept_id: 'big-concept', ...params },
      user: { sub: 'steward-1', name: 'Steward' },
      ip: '127.0.0.1',
      body: {}
    };
    const res = {
      statusCode: null,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      }
    };
    let nextErr = null;
    const next = (e) => {
      nextErr = e;
    };
    return splitConceptHandler(req, res, next).then(() => ({ res, nextErr }));
  }

  test('a draft repo splits and answers ok with the summary + audit record', async () => {
    const op = svc();
    const spy = jest.spyOn(op, 'splitConcept');
    const { res, nextErr } = await call();
    expect(nextErr).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.parts.length).toBeGreaterThan(1);
    // The service's opts contract is { actor } — actorFrom() passed FLAT was
    // the resplit audit-actor bug class; this handler must not repeat it.
    expect(spy.mock.calls[0][2]).toEqual({ actor: expect.objectContaining({ sub: 'steward-1' }) });
    expect(auditService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'concept.split', actor: 'steward-1', repo_id: 'r1' })
    );
  });

  test('a SERVING repo refuses through assertWritable — nothing split', async () => {
    // assertWritable keys on the INGESTED flag (the serving state), not the
    // lifecycle label — an ingested repo is read-only until retracted.
    repoService.getById.mockResolvedValue({ repo_id: 'r1', ingested_at: '2026-11-14T00:00:00Z' });
    const { nextErr } = await call();
    expect(nextErr).toBeTruthy();
    expect(upsertConceptMeta).not.toHaveBeenCalled();
    expect(auditService.writeAudit).not.toHaveBeenCalled();
  });

  test('a missing/foreign repo propagates the getById refusal (anti-enumeration) before anything runs', async () => {
    repoService.getById.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const { nextErr } = await call();
    expect(nextErr).toBeTruthy();
    expect(nextErr.status).toBe(404);
    expect(upsertConceptMeta).not.toHaveBeenCalled();
  });
});
