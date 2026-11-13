// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { matchesStatus } = require('./documents');

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
      undefined,
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
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toMatch(/toLowerCase\(\)\.trim\(\)/);
  });
});
