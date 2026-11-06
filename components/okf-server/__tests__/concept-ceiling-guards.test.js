// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// THE CONCEPT-DOCUMENT CEILING — the two write paths that enforce it (the
// plan's §6 / §7, and requirement R11 of the archived ceiling test plan).
//
// The property under test is NOT "a big document is refused". It is: **no
// oversized concept may persist by any path**, and **a refusal creates no
// state**. A gate that refuses after the mint would burn a version number; a
// refusal after the write would leave a row behind. Both are asserted here.
//
// The archived ceiling test plan records R11 ("Editor save (patchConcept) over
// the ceiling → 409, not a silent split") and then ticks its exit criterion
// "R1–R13 each covered by ≥1 executed case" — a tick that was FALSE: R11 was
// never implemented and never had an executed case. This file is that case.
jest.mock('../shared-lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({
    counter: () => ({ add: jest.fn() }),
    createCounter: () => ({ add: jest.fn() })
  })
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));

const { maxConceptDocChars, conceptTooLargeError } = require('../services/concept-ceiling');

describe('concept-ceiling — the single authority', () => {
  const ORIGINAL = process.env.OKF_MAX_CONCEPT_DOC_CHARS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
    else process.env.OKF_MAX_CONCEPT_DOC_CHARS = ORIGINAL;
  });

  test('the default is 250000 and the variable overrides it', () => {
    delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
    expect(maxConceptDocChars()).toBe(250000);
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = '1234';
    expect(maxConceptDocChars()).toBe(1234);
  });

  test('an unset / unusable value falls back to the default (never 0, never NaN)', () => {
    for (const bad of ['', 'abc', '0', '-5']) {
      process.env.OKF_MAX_CONCEPT_DOC_CHARS = bad;
      expect(maxConceptDocChars()).toBe(250000);
    }
  });

  test('the refusal carries the code, the status and the structured facts', () => {
    const err = conceptTooLargeError({ label: 'concept "x"', chars: 300, ceiling: 250 });
    expect(err.code).toBe('CONCEPT_TOO_LARGE');
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ concept_id: 'concept "x"', chars: 300, ceiling: 250 });
    // The message names the size, the ceiling AND the remedy — a refusal that
    // does not say what to do is a dead end.
    expect(err.message).toMatch(/300 characters/);
    expect(err.message).toMatch(/250-character ceiling/);
    expect(err.message).toMatch(/split it into smaller concepts/i);
  });
});

describe('R11 — the editor save refuses an over-ceiling body', () => {
  const CEILING = '200';
  let patchConcept;
  let conceptMeta;
  let parser;

  beforeEach(() => {
    jest.resetModules();
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = CEILING;

    conceptMeta = {
      patchConceptMeta: jest.fn().mockResolvedValue({ concept_id: 'c1', body: 'written' }),
      patchConceptFields: jest.fn().mockResolvedValue({ concept_id: 'c1', body: 'written' })
    };
    parser = {
      // gray-matter's parse: frontmatter in `data`, the text in `content`.
      parseConcept: jest.fn(async (markdown) => {
        const m = /^---\n([\s\S]*?)\n---\n?/.exec(String(markdown || ''));
        return {
          frontmatter: m ? { raw: m[1] } : {},
          body: m ? String(markdown).slice(m[0].length) : String(markdown || '')
        };
      })
    };
    jest.doMock('../services/concept-meta-service', () => conceptMeta);
    jest.doMock('../services/parser-service', () => parser);
    jest.doMock('../services/repository-service', () => ({
      getById: jest.fn().mockResolvedValue({ repo_id: 'r1', lifecycle_state: 'draft' })
    }));
    jest.doMock('../services/pii-service', () => ({
      scanConcept: jest.fn().mockResolvedValue({ pii_state: 'clean', occurrences: [] })
    }));
    jest.doMock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));

    const controller = require('../controllers/repository-controller');
    patchConcept = controller.patchConcept;
  });

  afterEach(() => {
    delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
    jest.dontMock('../services/concept-meta-service');
    jest.dontMock('../services/parser-service');
  });

  /** Drive the handler the way the route does: a req, a res, and a next(). */
  function call(body, { concept_id = 'c1', markdown = null } = {}) {
    const req = {
      params: { repo_id: 'r1', concept_id },
      body: markdown === null ? { body } : { markdown },
      user: { sub: 'steward-1', name: 'Steward' },
      ip: '127.0.0.1'
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
    return patchConcept(req, res, next).then(() => ({ res, nextErr }));
  }

  test('a body patch over the ceiling → 409 CONCEPT_TOO_LARGE, and NO row is written', async () => {
    const { res, nextErr } = await call('x'.repeat(500));
    expect(nextErr).toBeTruthy();
    expect(nextErr.code).toBe('CONCEPT_TOO_LARGE');
    expect(nextErr.status).toBe(409);
    // THE load-bearing assertion: a refusal writes NOTHING.
    expect(conceptMeta.patchConceptFields).not.toHaveBeenCalled();
    expect(conceptMeta.patchConceptMeta).not.toHaveBeenCalled();
    expect(res.statusCode).toBeNull(); // nothing was answered — the error propagates
  });

  test('the refusal names the size, the ceiling and the remedy', async () => {
    const { nextErr } = await call('x'.repeat(500));
    expect(nextErr.message).toMatch(/500 characters/);
    expect(nextErr.message).toMatch(/200-character ceiling/);
    expect(nextErr.message).toMatch(/split/i);
    expect(nextErr.details).toEqual({ concept_id: 'concept "c1"', chars: 500, ceiling: 200 });
  });

  test('a body patch UNDER the ceiling is written', async () => {
    const { nextErr, res } = await call('x'.repeat(10));
    expect(nextErr).toBeNull();
    expect(conceptMeta.patchConceptFields).toHaveBeenCalledWith('r1', 'c1', { body: 'x'.repeat(10) });
    expect(res.statusCode).toBe(200);
  });

  test('a body patch EXACTLY at the ceiling is allowed (the ceiling is inclusive)', async () => {
    const { nextErr } = await call('x'.repeat(200));
    expect(nextErr).toBeNull();
    expect(conceptMeta.patchConceptFields).toHaveBeenCalled();
  });

  test('a MARKDOWN patch over the ceiling → the same 409, measured on the BODY', async () => {
    // A large FRONTMATTER with a small body: the ceiling governs the body,
    // so this is ALLOWED — the frontmatter is metadata the ceiling does not
    // describe, and the import path measures the body too.
    const bigFm = '---\n' + 'k: v\n'.repeat(200) + '---\nsmall body';
    const { nextErr } = await call(null, { markdown: bigFm });
    expect(nextErr).toBeNull();
    expect(conceptMeta.patchConceptMeta).toHaveBeenCalled();

    // A small frontmatter with a large body: refused.
    conceptMeta.patchConceptMeta.mockClear();
    const { nextErr: err2 } = await call(null, { markdown: '---\nk: v\n---\n' + 'x'.repeat(500) });
    expect(err2).toBeTruthy();
    expect(err2.code).toBe('CONCEPT_TOO_LARGE');
    expect(conceptMeta.patchConceptMeta).not.toHaveBeenCalled();
  });

  test('the `index` concept is NOT exempt — its markdown is still a concept document', async () => {
    const { nextErr } = await call(null, { concept_id: 'index', markdown: 'x'.repeat(500) });
    expect(nextErr).toBeTruthy();
    expect(nextErr.code).toBe('CONCEPT_TOO_LARGE');
    expect(conceptMeta.patchConceptMeta).not.toHaveBeenCalled();
  });
});

// ─── THE IMPORT PATH — the same refusal, on a different status ──────────────
//
// The import path is the FIRST of the three write paths, and the one that
// predates this slice. It refuses an over-ceiling document it cannot split
// without losing content — never a mid-sentence hard split, because a worse
// document is a worse outcome than a refused one.
//
// Its status stays 400 (a malformed IMPORT is a bad request) while the two
// write paths use 409 (a well-formed write that conflicts with the state it
// targets). The CODE is the same in all three, so one curator-facing
// vocabulary spans the whole surface.
describe('the import path — the same refusal, with the import status', () => {
  const ORIGINAL = process.env.OKF_MAX_CONCEPT_DOC_CHARS;

  beforeEach(() => {
    jest.resetModules();
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = '200';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
    else process.env.OKF_MAX_CONCEPT_DOC_CHARS = ORIGINAL;
  });

  function loadIngest() {
    jest.doMock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));
    jest.doMock('../shared-lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
    jest.doMock('../shared-lib/metrics', () => ({
      getMeter: () => ({ counter: () => ({ add: jest.fn() }), createCounter: () => ({ add: jest.fn() }) })
    }));
    return require('../services/ingest-service');
  }

  test('an UNSPLITTABLE over-ceiling document is refused with the shared code and a 400', () => {
    const { applyDocumentCeiling } = loadIngest();
    // One unbroken line longer than the ceiling: no heading, no paragraph and
    // no line boundary to split on.
    const raw = [
      {
        concept_id: 'c1',
        path: 'concepts/huge.md',
        frontmatter: { type: 'topic' },
        body: 'x'.repeat(500)
      }
    ];
    let err = null;
    try {
      applyDocumentCeiling(raw);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    // The SAME code as the editor save and the publish gate — one vocabulary.
    expect(err.code).toBe('CONCEPT_TOO_LARGE');
    // The import path keeps its 400.
    expect(err.status).toBe(400);
    // The refusal names the size, the ceiling and the reason it cannot split.
    expect(err.message).toMatch(/500 characters/);
    expect(err.message).toMatch(/200-character ceiling/);
    expect(err.message).toMatch(/cannot be split without losing content/i);
    expect(err.details).toEqual({
      concept_id: 'concept "concepts/huge.md"',
      chars: 500,
      ceiling: 200
    });
  });

  test('a document UNDER the ceiling passes through untouched', () => {
    const { applyDocumentCeiling } = loadIngest();
    const raw = [
      {
        concept_id: 'c1',
        path: 'concepts/small.md',
        frontmatter: { type: 'topic' },
        body: 'short body'
      }
    ];
    const out = applyDocumentCeiling(raw);
    expect(out.inputs).toHaveLength(1);
    expect(out.inputs[0].body).toBe('short body');
    expect(out.splits).toEqual([]);
  });

  test('a SPLITTABLE over-ceiling document becomes parts — never a refusal', () => {
    const { applyDocumentCeiling } = loadIngest();
    const body = ['# One', 'a'.repeat(100), '# Two', 'b'.repeat(100)].join('\n');
    const out = applyDocumentCeiling([
      { concept_id: 'c1', path: 'concepts/split.md', frontmatter: { type: 'topic' }, body }
    ]);
    expect(out.inputs.length).toBeGreaterThan(1);
    expect(out.splits[0]).toMatchObject({ from: 'concepts/split.md' });
    // Part 1 keeps the original concept_id — inbound links keep resolving.
    expect(out.inputs[0].concept_id).toBe('c1');
  });
});
