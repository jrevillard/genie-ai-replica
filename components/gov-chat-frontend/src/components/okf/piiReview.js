/**
 * PII REVIEW VERDICT — the single source of truth for "what does the PII
 * scan actually say about this repository right now".
 *
 * WHY THIS EXISTS (2026-10-13 follow-up to the 141-concept PII incident).
 * A real publish carried 107 flagged concepts while the acknowledgement
 * record on the repository read 0. Three different states render as
 * indistinguishable "nothing to see here":
 *
 *   - never scanned / a scan errored  →  the truth is UNKNOWN
 *   - scanned, genuinely clean          →  the truth is "found nothing"
 *   - N hits, nobody reviewed them      →  the truth is "found N, nobody looked"
 *
 * Only the third may be waived by an acknowledgement (`pii_ack`), and only
 * when the acknowledgement actually covers the findings that are on screen
 * NOW. An ack recorded against a different flagged count — or recorded before
 * the scan that produced the current count — describes a scan nobody has
 * reviewed, so it must NOT render as a completed review.
 *
 * FAIL-CLOSED, mirroring services/pii-service.js#assertPiiClean: an unread
 * page is never a clean page. The verdict order below is deliberate — the
 * blocking states are evaluated BEFORE the clean state, so no future edit can
 * make an unknown verdict fall through to "clean".
 */

/** Not loaded yet: we do not know, and "do not know" must never read as clean. */
export const PII_CHECKING = 'checking';
/** The read failed outright. Also unknown — never "clean". */
export const PII_UNREADABLE = 'unreadable';
/** No completed repo scan, or concepts the scan never reached. */
export const PII_UNSCANNED = 'unscanned';
/** At least one concept's scan FAILED. Blocking, and explicitly not "clean". */
export const PII_ERROR = 'error';
/** N flagged, and no acknowledgement covers them. */
export const PII_UNREVIEWED = 'unreviewed';
/** N flagged, and a current acknowledgement covers exactly those N. */
export const PII_REVIEWED = 'reviewed';
/** Scanned end to end, nothing found. The ONLY state that means "all clear". */
export const PII_CLEAN = 'clean';

/** Verdict → DS status tag variant. */
export const PII_VARIANT = {
  [PII_CHECKING]: 'pending',
  [PII_UNREADABLE]: 'error',
  [PII_UNSCANNED]: 'error',
  [PII_ERROR]: 'error',
  [PII_UNREVIEWED]: 'warning',
  [PII_REVIEWED]: 'info',
  [PII_CLEAN]: 'success'
};

/** The PII vocabulary the concept projection actually carries. */
function bucket(state) {
  if (state === 'hit') return 'hit';
  if (state === 'error') return 'error';
  // 'clean' is the only state that means "this page was read and is clean".
  // null / undefined / 'unknown' / 'pending' are all "never scanned".
  if (state === 'clean') return 'clean';
  return 'unscanned';
}

/**
 * Tally the per-concept PII verdicts. Every count is coerced to a number so a
 * missing counter renders 0 — never "undefined" and never NaN.
 *
 * @param {Array<object>} concepts concept meta rows (pii_state rides on them)
 * @returns {{total:number, hit:number, error:number, clean:number, unscanned:number}}
 */
export function tallyPiiStates(concepts) {
  const rows = Array.isArray(concepts) ? concepts.filter(Boolean) : [];
  const out = { total: rows.length, hit: 0, error: 0, clean: 0, unscanned: 0 };
  for (const row of rows) out[bucket(row.pii_state)] += 1;
  return out;
}

/**
 * Does `ack` (the repository's pii_ack) cover the findings on screen NOW?
 *
 * A stewardship acknowledgement is a claim about a specific scan: "I reviewed
 * the N flagged pages this repository had at time T". It stops being true when
 * EITHER
 *   - the flagged count moved (new findings the reviewer never saw), or
 *   - the acknowledgement predates the scan that produced the current count.
 *
 * @param {object|null} ack  repository.pii_ack ({by, at, flagged_concepts})
 * @param {number} hitCount  concepts currently flagged
 * @param {string|null} scannedAt  repository.pii_scanned_at
 * @returns {boolean}
 */
export function isAckCurrent(ack, hitCount, scannedAt) {
  if (!ack || typeof ack !== 'object') return false;
  const flagged = Number(ack.flagged_concepts);
  if (!Number.isFinite(flagged)) return false;
  // The recorded count is a NUMBER OF PAGES. A record that disagrees with what
  // the scan found now describes a different set of pages.
  if (flagged !== Number(hitCount)) return false;
  // An acknowledgement older than the scan is a review of a previous scan.
  // Compare PARSED instants, never the raw strings (round 16, #80121): the
  // two sides come from different writers (an ISO stamp vs a numeric epoch
  // serializes to '2026…' vs '1729…', whose lexicographic order is
  // meaningless) — and a meaningless comparison here fails OPEN on the PII
  // gate. Anything unparseable also fails CLOSED (not current).
  if (scannedAt && ack.at) {
    const toMs = (v) => {
      // Numeric epochs are normalized to MILLISECONDS (round 17, #80357): a
      // seconds-scale epoch (1729…) compared against an ISO-derived millis
      // instant (1791…) is always "smaller", `ackMs < scanMs` never fires,
      // and every acknowledgement reads current — the PII gate failing open
      // on exactly the mixed-writer input this comparison exists for.
      // < 1e11 ms ≈ 1973-5138 → any sane modern stamp in SECONDS; millis
      // stamps are ≥ 1e11 until the year 5138.
      if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    };
    const ackMs = toMs(ack.at);
    const scanMs = toMs(scannedAt);
    if (ackMs === null || scanMs === null) return false;
    if (ackMs < scanMs) return false;
  }
  return true;
}

/**
 * The one verdict function. Every surface that talks about a repository's PII
 * state at publish time must go through this, so the three states can never
 * drift apart between screens again.
 *
 * @param {object} input
 * @param {object|null} input.repo  the repository row (pii_scan_status, pii_ack…)
 * @param {Array<object>} input.concepts  concept meta rows for this repo
 * @param {boolean} input.loaded  false while the concept list is in flight
 * @param {boolean} [input.readFailed]  true when the concept read failed
 * @returns {{verdict:string, variant:string, hits:number, errors:number,
 *            unscanned:number, clean:number, total:number,
 *            ack:object|null, ackCurrent:boolean, scanned:boolean}}
 */
export function computePiiReview({ repo = null, concepts = null, loaded = true, readFailed = false } = {}) {
  const counts = tallyPiiStates(concepts);
  const scanned = !!(repo && repo.pii_scan_status === 'complete');
  const ack = (repo && repo.pii_ack) || null;
  const ackCurrent = isAckCurrent(ack, counts.hit, (repo && repo.pii_scanned_at) || null);

  const base = {
    hits: counts.hit,
    errors: counts.error,
    unscanned: counts.unscanned,
    clean: counts.clean,
    total: counts.total,
    ack,
    ackCurrent,
    scanned
  };

  // ORDER IS THE CONTRACT. Blocking / unknown states are decided BEFORE the
  // clean state, so an unknown verdict can never fall through to "all clear".
  let verdict;
  if (!loaded) verdict = PII_CHECKING;
  else if (readFailed) verdict = PII_UNREADABLE;
  else if (counts.error > 0) verdict = PII_ERROR;
  else if (counts.unscanned > 0 || !scanned) verdict = PII_UNSCANNED;
  else if (counts.hit > 0) verdict = ackCurrent ? PII_REVIEWED : PII_UNREVIEWED;
  else verdict = PII_CLEAN;

  return { ...base, verdict, variant: PII_VARIANT[verdict] || 'pending' };
}
