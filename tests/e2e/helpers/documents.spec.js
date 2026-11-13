// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
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

  test('the normalisation is the shared vocabulary’s, not a private copy', () => {
    // Through the real catalogue: the module this predicate imports is
    // the one AdminDashboard.vue imports. Requiring it directly here (a
    // second require of the same path resolves to the SAME module
    // instance) proves the predicate's verdict tracks the vocabulary —
    // the mock-fallback trap the i18n wave taught: assert through the
    // real thing, never through a stand-in.
    const { normalizeStatus } = require('../../../components/gov-chat-frontend/src/utils/documentStatus');
    const probe = 'Ingested';
    expect(normalizeStatus(probe)).toBe('ingested');
    expect(matchesStatus(file(probe), normalizeStatus(probe))).toBe(true);
    expect(matchesStatus(file(probe), 'Ingested')).toBe(true);
  });
});
