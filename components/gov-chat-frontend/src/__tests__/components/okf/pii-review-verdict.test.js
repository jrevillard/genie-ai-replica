'use strict';

/**
 * PII REVIEW VERDICT — the three states that used to look identical (2026-10-13).
 *
 * A real publish carried 107 flagged concepts while the repository's
 * acknowledgement record read 0. The UI had no way to say "107 found, nobody
 * looked" — it could only say, or fail to say, nothing. This pins the verdict
 * function that every publish surface now shares.
 *
 * NON-VACUOUS: mentally revert computePiiReview to `hits === 0 ? clean : blocked`
 * and most of these go red. The ordering assertions are the load-bearing ones —
 * they are what stop an unknown verdict from falling through to "clean".
 */

const {
  computePiiReview,
  isAckCurrent,
  tallyPiiStates,
  PII_CHECKING,
  PII_UNREADABLE,
  PII_UNSCANNED,
  PII_ERROR,
  PII_UNREVIEWED,
  PII_REVIEWED,
  PII_CLEAN
} = require('@/components/okf/piiReview');

const clean = (n) => Array.from({ length: n }, (_, i) => ({ concept_id: `c${i}`, pii_state: 'clean' }));
const hits = (n) => Array.from({ length: n }, (_, i) => ({ concept_id: `h${i}`, pii_state: 'hit' }));
const errored = (n) => Array.from({ length: n }, (_, i) => ({ concept_id: `e${i}`, pii_state: 'error' }));

// The repo as it looks AFTER a completed scan with nothing found.
const SCANNED = { repo_id: 'r1', pii_scan_status: 'complete', pii_scanned_at: '2026-10-13T00:00:00.000Z' };

describe('tallyPiiStates', () => {
  it('buckets every non-clean verdict as UNSCANNED, not as clean', () => {
    // 'unknown'/null/undefined are the three ways a never-scanned row arrives.
    const t = tallyPiiStates([
      { pii_state: 'clean' },
      { pii_state: 'hit' },
      { pii_state: 'error' },
      { pii_state: 'unknown' },
      { pii_state: null },
      {}
    ]);
    expect(t).toMatchObject({ total: 6, clean: 1, hit: 1, error: 1, unscanned: 3 });
  });

  it('tolerates a missing list without throwing', () => {
    expect(tallyPiiStates(null)).toMatchObject({ total: 0, clean: 0, hit: 0, error: 0, unscanned: 0 });
  });
});

describe('computePiiReview — the three states must not look alike', () => {
  it('scanned clean is the ONLY verdict that means all-clear', () => {
    const r = computePiiReview({ repo: SCANNED, concepts: clean(5) });
    expect(r.verdict).toBe(PII_CLEAN);
    expect(r.hits).toBe(0);
    expect(r.variant).toBe('success');
  });

  it('never scanned is NOT clean, even with zero rows on screen', () => {
    // The dangerous shape: an empty concept list plus no scan marker is the
    // state that used to render as "nothing found".
    const r = computePiiReview({ repo: { repo_id: 'r1' }, concepts: [] });
    expect(r.verdict).toBe(PII_UNSCANNED);
    expect(r.variant).toBe('error');
  });

  it('a concept the scan never reached is NOT clean', () => {
    const r = computePiiReview({ repo: SCANNED, concepts: [...clean(4), { concept_id: 'x', pii_state: 'unknown' }] });
    expect(r.verdict).toBe(PII_UNSCANNED);
    expect(r.unscanned).toBe(1);
  });

  it('a concept whose scan ERRORED is NOT clean and NOT merely unreviewed', () => {
    const r = computePiiReview({ repo: SCANNED, concepts: [...clean(3), ...errored(1)] });
    expect(r.verdict).toBe(PII_ERROR);
    expect(r.errors).toBe(1);
    expect(r.variant).toBe('error');
  });

  it('an unreadable read is UNKNOWN, never clean', () => {
    const r = computePiiReview({ repo: SCANNED, concepts: clean(5), readFailed: true });
    expect(r.verdict).toBe(PII_UNREADABLE);
  });

  it('a read still in flight is UNKNOWN, never clean', () => {
    // This is the regression the gate on `loaded` exists for: an empty list
    // mid-read would otherwise tally to zero hits and call a flagged repo clean.
    const r = computePiiReview({ repo: SCANNED, concepts: hits(107), loaded: false });
    expect(r.verdict).toBe(PII_CHECKING);
    expect(r.hits).toBe(107); // the counts are still reported — just not as a verdict
  });

  it('N hits with no acknowledgement is UNREVIEWED, not clean and not reviewed', () => {
    const r = computePiiReview({ repo: SCANNED, concepts: [...clean(34), ...hits(107)] });
    expect(r.verdict).toBe(PII_UNREVIEWED);
    expect(r.hits).toBe(107);
    expect(r.ackCurrent).toBe(false);
    expect(r.variant).toBe('warning');
  });
});

describe('isAckCurrent — a stale ack must not render as a completed review', () => {
  it('accepts an ack whose recorded count matches the live hits', () => {
    const ack = { by: 'steward@itu', at: '2026-10-13T10:00:00.000Z', flagged_concepts: 3 };
    expect(isAckCurrent(ack, 3, '2026-10-13T09:00:00.000Z')).toBe(true);
  });

  it('REJECTS the incident shape: ack recorded against 0 while 107 are flagged', () => {
    // Exactly what shipped: the acknowledgement said 0, the scan found 107.
    const ack = { by: 'steward@itu', at: '2026-10-13T10:00:00.000Z', flagged_concepts: 0 };
    expect(isAckCurrent(ack, 107, null)).toBe(false);
    expect(computePiiReview({ repo: { ...SCANNED, pii_ack: ack }, concepts: hits(107) }).verdict).toBe(PII_UNREVIEWED);
  });

  it('REJECTS an ack that predates the scan it claims to cover', () => {
    const ack = { by: 'steward@itu', at: '2026-10-01T10:00:00.000Z', flagged_concepts: 3 };
    expect(isAckCurrent(ack, 3, '2026-10-13T09:00:00.000Z')).toBe(false);
    expect(
      computePiiReview({
        repo: { ...SCANNED, pii_scanned_at: '2026-10-13T09:00:00.000Z', pii_ack: ack },
        concepts: hits(3)
      }).verdict
    ).toBe(PII_UNREVIEWED);
  });

  // Round 16, #80121: the two stamps come from different writers (an ISO
  // string vs a numeric epoch). Their RAW STRING comparison is meaningless
  // ('2026…' vs '1729…' lexicographic order is noise) and the old code let
  // that noise decide the PII gate — comparing PARSED instants, and failing
  // CLOSED on anything unparseable, is the whole point of the fix.
  it('compares PARSED instants: a numeric-epoch ack newer than an ISO scan is CURRENT', () => {
    const scanAt = '2026-10-13T09:00:00.000Z'; // Date.parse → 1791910800000
    const newerEpochMs = Date.parse(scanAt) + 60_000;
    const ack = { by: 'steward@itu', at: newerEpochMs, flagged_concepts: 3 };
    expect(isAckCurrent(ack, 3, scanAt)).toBe(true);
    const olderEpochMs = Date.parse(scanAt) - 60_000;
    expect(isAckCurrent({ ...ack, at: olderEpochMs }, 3, scanAt)).toBe(false);
  });

  it('a numeric-epoch SCAN stamp is parsed too, not string-compared', () => {
    const scanEpochMs = Date.parse('2026-10-13T09:00:00.000Z');
    const ack = { by: 'steward@itu', at: '2026-10-13T10:00:00.000Z', flagged_concepts: 2 };
    expect(isAckCurrent(ack, 2, scanEpochMs)).toBe(true);
    // Lexicographically '2026-…' vs the epoch digits is noise — the string
    // comparison could not be trusted in either direction.
    expect(isAckCurrent({ ...ack, at: '2026-10-13T08:00:00.000Z' }, 2, scanEpochMs)).toBe(false);
  });

  it('an unparseable stamp on either side fails CLOSED (not current)', () => {
    const ack = { by: 'steward@itu', at: 'not-a-date', flagged_concepts: 2 };
    expect(isAckCurrent(ack, 2, '2026-10-13T09:00:00.000Z')).toBe(false);
    const goodAck = { by: 'steward@itu', at: '2026-10-13T10:00:00.000Z', flagged_concepts: 2 };
    expect(isAckCurrent(goodAck, 2, 'garbage')).toBe(false);
  });

  it('rejects a malformed / missing ack rather than defaulting to current', () => {
    expect(isAckCurrent(null, 2, null)).toBe(false);
    expect(isAckCurrent({}, 2, null)).toBe(false);
    expect(isAckCurrent({ by: 'x', at: 'y' }, 2, null)).toBe(false);
    expect(isAckCurrent({ flagged_concepts: 'two' }, 2, null)).toBe(false);
  });

  it('a REVIEWED verdict names who reviewed and when', () => {
    const r = computePiiReview({
      repo: { ...SCANNED, pii_ack: { by: 'steward@itu', at: '2026-10-13T11:00:00.000Z', flagged_concepts: 2 } },
      concepts: hits(2)
    });
    expect(r.verdict).toBe(PII_REVIEWED);
    expect(r.ack.by).toBe('steward@itu');
    expect(r.ackCurrent).toBe(true);
  });
});
