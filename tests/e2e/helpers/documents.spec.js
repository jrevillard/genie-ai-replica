// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { matchesStatus, sweepDeleteOneFile } = require('./documents');

/**
 * Unit spec for the document status predicate (#1781).
 *
 * `matchesStatus` mirrors what AdminDashboard.vue's `filteredDocuments`
 * renders, and it derives its normalisation from the SHARED vocabulary
 * (`components/gov-chat-frontend/src/utils/documentStatus.js`) — the same
 * `normalizeStatus` the admin filter applies. These cases pin the
 * predicate's own contract; the shared identity is structural (one
 * module), so a frontend change to the normalisation cannot leave this
 * copy stale.
 */
test.describe('the document status predicate', () => {
  const file = (status) => ({ file_name: 'a.pdf', dataprep: { status } });

  test("'all' lists every document, with or without a dataprep block", () => {
    expect(matchesStatus(file('Ingested'), 'all')).toBe(true);
    expect(matchesStatus({ file_name: 'b.pdf' }, 'all')).toBe(true);
  });

  test("a selection lists only the documents whose status equals it — case and padding don't matter", () => {
    expect(matchesStatus(file('Ingested'), 'ingested')).toBe(true);
    expect(matchesStatus(file('ingested'), 'Ingested')).toBe(true);
    expect(matchesStatus(file('  Ingested  '), ' ingested ')).toBe(true);
    expect(matchesStatus(file('Pending'), 'ingested')).toBe(false);
    expect(matchesStatus(file('ingestion error'), 'error')).toBe(false);
  });

  test('a document without a dataprep block is never in a filtered selection', () => {
    // The empty selection is the sharp edge: a missing status normalises
    // to '', and a selection of '' would otherwise match every
    // dataprep-less document.
    expect(matchesStatus({ file_name: 'b.pdf' }, 'ingested')).toBe(false);
    expect(matchesStatus({ file_name: 'b.pdf' }, '')).toBe(false);
    expect(matchesStatus(file('Ingested'), '')).toBe(false);
  });

  test('the require-of-ESM floor is named at load, not a bare SyntaxError', () => {
    // No behaviour test can see the guard: on a capable runner the
    // require simply works, and on an incapable one the failure happens
    // before any spec loads. Pin the guard's presence — without it the
    // below-floor runner gets Node's own `Unexpected token 'export'`
    // with nothing to act on (#1804 review of #1781).
    const source = fs.readFileSync(require.resolve('./documents'), 'utf8');
    expect(source).toContain('process.features.require_module');
  });

  test('the predicate IS the shared vocabulary, on behaviour, across a sample', () => {
    // Property-style: for every sampled document and selection the
    // predicate answers exactly what the shared vocabulary's rule
    // answers — the two cannot drift apart while this holds, and it
    // survives any refactor of how the helper reaches the module. A
    // dead require beside a private copy is caught by the tripwire
    // below, not here.
    const { normalizeStatus } = require('../../../components/gov-chat-frontend/src/utils/documentStatus');
    const statuses = [
      'all',
      'Ingested',
      'ingested ',
      ' PENDING',
      'Pending',
      'Ingestion Error',
      '',
      'killed',
      undefined
    ];
    const docs = [file('Ingested'), file('pending'), { file_name: 'no-block.pdf' }, file(undefined)];
    for (const doc of docs) {
      for (const selection of statuses) {
        const expected =
          normalizeStatus(selection) === 'all' ||
          (Boolean(doc.dataprep) && normalizeStatus(doc.dataprep.status) === normalizeStatus(selection));
        expect(matchesStatus(doc, selection)).toBe(expected);
      }
    }
  });

  test('no private normalisation is spelled inside matchesStatus', () => {
    // Tripwire for the drift the property test cannot see: a dead
    // require of the shared module with a hand-rolled copy inside the
    // predicate. Anchored to the predicate's own source — the whole
    // helper file may legitimately normalise other things (a file name,
    // a search term) and must not false-positive this gate.
    const source = fs.readFileSync(require.resolve('./documents'), 'utf8');
    const start = source.indexOf('function matchesStatus');
    // A negative start would make the slice vacuous (the tripwire would
    // pass on nothing): if the anchor is lost — say the predicate became
    // an arrow — the gate must fail loudly, not guard air.
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toMatch(/toLowerCase\(\)\.trim\(\)/);
  });
});

/**
 * Unit spec for the sweep's per-file delete (#1864).
 *
 * `sweepDeleteOneFile` is the sweep's whole per-file contract: a bare
 * DELETE, and — when the repository refuses with 409 STILL_SERVING — the
 * remedy that response itself prescribes, retract-then-delete. Before
 * #1864 the sweep issued the bare DELETE only, so any leftover that had
 * reached a serving state failed every later afterAll identically with a
 * bare `HTTP 409`: cleanup loud but structurally unable to succeed.
 *
 * The transport is injected (the same seam idea as auth.spec.js's
 * module-object swap, by parameter — the transport belongs to auth.js, so
 * documents.js has no module object of its own to swap). A scripted
 * transport answers exactly the calls the script lists and REFUSES any
 * further call: an extra request is a wrong sequence, not a pass.
 */
test.describe('the sweep per-file delete (retract-then-delete, #1864)', () => {
  const file = { file_name: 'test-document-leftover.pdf', file_id: 'f123' };

  // A transport that answers from a script in call order and fails any
  // call beyond it — the sequence IS the assertion subject, so an
  // unexpected call must fail loud, not fall off the script.
  function scriptedTransport(script) {
    const calls = [];
    const request = async (method, path) => {
      calls.push([method, path]);
      if (script.length === 0) {
        throw new Error(`unexpected call ${method} ${path} — the script is exhausted`);
      }
      return script.shift();
    };
    return { request, calls };
  }

  const serving = (code = 'STILL_SERVING') => ({
    status: 409,
    data: {
      success: false,
      code,
      error: 'File is still serving the corpus',
      message: `File f123 is still serving the corpus (dataprep status: ingested) — retract it before deleting`
    },
    headers: {}
  });

  test('a clean delete is one DELETE and no retract', async () => {
    const t = scriptedTransport([{ status: 200, data: { success: true }, headers: {} }]);
    expect(await sweepDeleteOneFile(t.request, file, 'tok')).toBeNull();
    expect(t.calls).toEqual([['DELETE', '/api/files/f123']]);
  });

  test('a STILL_SERVING refusal retracts and deletes again, in that order', async () => {
    const t = scriptedTransport([
      serving(),
      { status: 200, data: { success: true, message: 'File retracted successfully' }, headers: {} },
      { status: 200, data: { success: true }, headers: {} }
    ]);
    expect(await sweepDeleteOneFile(t.request, file, 'tok')).toBeNull();
    expect(t.calls).toEqual([
      ['DELETE', '/api/files/f123'],
      ['POST', '/api/files/f123/retract'],
      ['DELETE', '/api/files/f123']
    ]);
  });

  test('a failed retract names the retract step and never re-attempts the delete', async () => {
    const t = scriptedTransport([
      serving(),
      { status: 500, data: { success: false, error: 'Dataprep retract failed' }, headers: {} }
    ]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toBe(
      'test-document-leftover.pdf: retract failed before delete (HTTP 500 — Dataprep retract failed)'
    );
    expect(t.calls).toEqual([
      ['DELETE', '/api/files/f123'],
      ['POST', '/api/files/f123/retract']
    ]);
  });

  test('a delete that still refuses after a successful retract carries the refusal', async () => {
    const t = scriptedTransport([serving(), { status: 200, data: { success: true }, headers: {} }, serving()]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    // The refusal surfaces the server's own remedy text (the body's
    // message), not just the status — the whole point of #1864's minimum
    // ask, kept for the case the remedy itself fails.
    expect(failure).toBe(
      'test-document-leftover.pdf: HTTP 409 (STILL_SERVING) — ' +
        'File f123 is still serving the corpus (dataprep status: ingested) — retract it before deleting'
    );
    expect(t.calls).toEqual([
      ['DELETE', '/api/files/f123'],
      ['POST', '/api/files/f123/retract'],
      ['DELETE', '/api/files/f123']
    ]);
  });

  test('another 409 code takes no retract — the remedy keys on STILL_SERVING', async () => {
    const t = scriptedTransport([serving('CRAWL_ACTIVE')]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toMatch(/HTTP 409 \(CRAWL_ACTIVE\)/);
    expect(t.calls).toEqual([['DELETE', '/api/files/f123']]);
  });

  test('a 401 keeps the unauthorized description, without a retract', async () => {
    const t = scriptedTransport([{ status: 401, data: { error: 'TOKEN_EXPIRED' }, headers: {} }]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toContain('the endpoint answered TOKEN_EXPIRED');
    expect(t.calls).toEqual([['DELETE', '/api/files/f123']]);
  });

  test('a plain server failure names its status and the server error', async () => {
    const t = scriptedTransport([{ status: 500, data: { success: false, error: 'boom' }, headers: {} }]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toBe('test-document-leftover.pdf: HTTP 500 — boom');
  });

  test('a transport error is named in the failure string, not thrown', async () => {
    const t = scriptedTransport([]);
    const failure = await sweepDeleteOneFile(t.request, file, 'tok');
    expect(failure).toMatch(/^test-document-leftover\.pdf: unexpected call DELETE/);
  });
});
