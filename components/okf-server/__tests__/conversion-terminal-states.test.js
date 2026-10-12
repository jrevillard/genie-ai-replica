// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// THE CONVERSION-SWEEP VOCABULARY GUARD (David's blocker, 2026-10-12).
//
// The boot sweep that reaps interrupted conversions used to enumerate the ACTIVE
// states ['queued','downloading','splitting','adding']. The DOCUMENT import path
// writes four more — 'converting', 'cross-linking', 'classifying',
// 'linking-topics' — and none of them were in that list. Because the sweep is the
// ONLY thing that resolves a conversion stranded by a restart, an okf-server
// restart during any of those four left the repository non-terminal FOREVER, with
// no error and no way out except a manual intervention. The monthly image rebuild
// makes the trigger routine.
//
// The fix inverted the predicate to enumerate TERMINAL states instead. These tests
// exist so the vocabulary cannot drift apart again — silently, which is how four
// statuses were missed in the first place.

const fs = require('fs');
const path = require('path');

jest.mock('../shared-lib/db-connection-service', () => ({
  getConnection: jest.fn(),
  getDb: jest.fn()
}));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn((_n, fn) => fn({ setAttribute: jest.fn() }))
}));

const conv = require('../services/crawl-conversion-service');
const dbService = require('../shared-lib/db-connection-service');

const SERVICES = path.join(__dirname, '..', 'services');

/** Statuses that mean "this conversion finished, one way or another". */
const COMPLETION_STATUSES = ['done', 'failed'];

/**
 * Every non-terminal status either conversion path can write.
 *
 * KEEP IN SYNC BY READING THE SOURCES — `everyStatusEmittedByAPathIsCovered`
 * below asserts each of these actually appears in a writer, so a status that is
 * removed from the code fails here rather than silently going untested.
 */
const NON_TERMINAL_STATUSES = {
  crawl: ['queued', 'downloading', 'splitting', 'adding'],
  documents: ['queued', 'converting', 'cross-linking', 'classifying', 'linking-topics']
};

const readSource = (name) => fs.readFileSync(path.join(SERVICES, name), 'utf8');

describe('conversion sweep vocabulary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The sweep is a once-per-process latch; reset it by re-requiring per test so
    // each test observes a real first sweep rather than a memoised no-op.
    jest.resetModules();
  });

  describe('the vocabulary itself', () => {
    it('enumerates TERMINAL states, not ACTIVE ones', () => {
      // The regression this file exists for: an ACTIVE list must be edited every
      // time a writer adds a status, and nothing enforced that.
      expect(Array.isArray(conv.TERMINAL_STATES)).toBe(true);
      expect(conv.TERMINAL_STATES).toEqual(expect.arrayContaining(COMPLETION_STATUSES));
    });

    it('does NOT classify an in-flight status as terminal', () => {
      const allInFlight = [...NON_TERMINAL_STATUSES.crawl, ...NON_TERMINAL_STATUSES.documents];
      for (const s of allInFlight) {
        expect(conv.TERMINAL_STATES).not.toContain(s);
      }
    });

    it('never lists a status as BOTH terminal and in-flight', () => {
      const allInFlight = [...NON_TERMINAL_STATUSES.crawl, ...NON_TERMINAL_STATUSES.documents];
      const overlap = conv.TERMINAL_STATES.filter((s) => allInFlight.includes(s));
      expect(overlap).toEqual([]);
    });
  });

  /**
   * The guard that would have caught the original bug: a status the code writes
   * but the sweep does not know about is the exact failure, so assert the sweep's
   * set is derived by EXCLUSION and therefore covers every non-terminal status by
   * construction — and separately that the writers still emit what we documented.
   */
  describe('writer coverage', () => {
    it('every documented in-flight status is still emitted by a writer', () => {
      const sources = [readSource('crawl-conversion-service.js'), readSource('producer-service.js')].join('\n');
      const missing = [];
      for (const list of Object.values(NON_TERMINAL_STATUSES)) {
        for (const s of list) {
          // The documents path also writes 'adding' via ingest-service's zip write.
          if (!new RegExp(`status:\\s*'${s}'`).test(sources)) missing.push(s);
        }
      }
      expect(missing).toEqual([]);
    });

    it('the four document-path statuses the sweep used to miss are still emitted', () => {
      // Named explicitly, not derived: these four are the regression. If a future
      // refactor renames one, this test fails and forces a deliberate decision
      // rather than letting the vocabulary drift apart unnoticed.
      const producer = readSource('producer-service.js');
      for (const s of ['converting', 'cross-linking', 'classifying', 'linking-topics']) {
        expect(new RegExp(`status:\\s*'${s}'`).test(producer)).toBe(true);
      }
    });
  });

  describe('the sweep query', () => {
    /**
     * Build an isolated module world with a mocked db.
     *
     * jest.resetModules() creates a NEW registry, so the service under test gets
     * a DIFFERENT db-connection-service instance than the one imported at the top
     * of this file. Configuring the old instance and then re-requiring is a
     * silent no-op — the first version of this test did exactly that and the
     * query was never captured. Configure INSIDE the fresh world, then require.
     */
    const withMockedDb = async (db) => {
      jest.resetModules();
      const freshDbService = require('../shared-lib/db-connection-service');
      freshDbService.getConnection.mockResolvedValue(db);
      freshDbService.getDb.mockResolvedValue(db);
      const fresh = require('../services/crawl-conversion-service');
      await fresh.sweepInterruptedOnce();
      return fresh;
    };

    it('selects by exclusion (NOT IN terminal), never by enumerating active states', async () => {
      const captured = [];
      const db = {
        query: jest.fn(async (aql, bind) => {
          captured.push({ aql, bind });
          return { all: async () => [] };
        }),
        collection: jest.fn(() => ({ document: jest.fn(async () => ({})), update: jest.fn() }))
      };

      await withMockedDb(db);

      expect(captured).toHaveLength(1);
      const { aql, bind } = captured[0];
      expect(aql).toMatch(/NOT IN @terminal/);
      // The old shape. If this ever matches again, the bug is back.
      expect(aql).not.toMatch(/status IN @active/);
      expect(bind.terminal).toEqual(expect.arrayContaining(['done', 'failed']));
      expect(bind).not.toHaveProperty('active');
    });

    it('leaves a finished conversion untouched and reaps an in-flight one', async () => {
      // Behavioural: the exclusion predicate must reap a document-path status.
      const swept = [];
      const db = {
        query: jest.fn(async (_aql, bind) => {
          // Model the AQL server-side: everything not in the terminal bind is swept.
          const terminal = bind.terminal || [];
          swept.push(
            ...['queued', 'converting', 'classifying', 'linking-topics', 'done'].filter(
              (s) => !terminal.includes(s)
            )
          );
          return { all: async () => [] };
        }),
        collection: jest.fn(() => ({ document: jest.fn(async () => ({})), update: jest.fn() }))
      };

      await withMockedDb(db);

      expect(swept).toEqual(expect.arrayContaining(['converting', 'classifying', 'linking-topics']));
      expect(swept).not.toContain('done');
    });
  });
});