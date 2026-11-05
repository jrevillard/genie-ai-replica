/**
 * pollJob — THE bounded poll loop behind every async OKF job (202 + poll).
 *
 * Extracted from store/modules/okf.js (round 16, #80124 — that extraction
 * replaced seven near-identical for(;;)+setTimeout copies; the UX-4 bulk-PII
 * detached job nearly became the ninth, which is why the helper moved here —
 * services can share it too, not only store actions).
 *
 * Contract, distilled from those loops (do not "simplify" any arm away):
 *  - deadline: a UI horizon only. The server NEVER kills a healthy long job;
 *    the timeout envelope says so and the job keeps running server-side.
 *  - transient tolerance: a gateway blip (kong restart = 502) must not end
 *    tracking — the server-side job completes regardless (live 2026-10-18
 *    incident). Solid failure for 60 consecutive polls rethrows.
 *  - signal: the component's cancel token ({aborted}). Checked before every
 *    tick AND after every sleep, so an unmount stops the loop within one
 *    cadence — a closed surface stops hammering the gateway; the job itself
 *    is untouched server-side (reopening re-adopts it).
 *  - backoff (opt-in): keep `pollMs` for the first `backoffAfter` polls, then
 *    widen to `backoffTo`. A minutes-long job's majority of polls carry an
 *    unchanged counter; at progress-bar granularity the widening is invisible.
 *
 * @param {object} p
 * @param {() => Promise<object>} p.fetchDoc      one poll attempt → job doc
 * @param {number} [p.pollMs]                     cadence (default 2000)
 * @param {number} [p.deadlineMs]                 UI horizon (default 24h)
 * @param {(doc: object) => boolean} [p.isRunning] keep-polling predicate
 * @param {(progress: object) => void} [p.onProgress] live progress tap —
 *        receives the WHOLE job doc (callers project their own counters)
 * @param {{code: string, message: string}} p.timeout   horizon-exceeded envelope
 * @param {{code: string, message: string}} p.failed    failed-status envelope
 * @param {(doc: object) => object} p.done        terminal mapping (cancelled
 *        branches and result-vs-payload differences live HERE, per caller)
 * @param {{aborted?: boolean}} [p.signal]        component cancel token
 * @param {{code: string, message: string}} [p.aborted] envelope when the
 *        signal is seen before a tick (default POLL_ABORTED)
 * @param {{code: string, message: string}} [p.abortedAfterSleep] envelope when
 *        the signal is seen after the sleep (default same as aborted)
 * @param {number} [p.backoffAfter]               polls before the cadence widens
 * @param {number} [p.backoffTo]                  widened cadence (ms)
 * @returns {Promise<{ok: boolean, code?: string, message?: string, result?: *}>}
 */
export async function pollJob({
  fetchDoc,
  pollMs = 2000,
  deadlineMs = 24 * 60 * 60 * 1000,
  isRunning = (doc) => !doc || doc.status === 'running',
  onProgress = null,
  timeout,
  failed,
  done,
  signal = null,
  aborted = null,
  abortedAfterSleep = null,
  backoffAfter = null,
  backoffTo = null
}) {
  const deadline = Date.now() + deadlineMs;
  let misses = 0;
  let polls = 0;
  // caller envelopes supply code+message; ok:false is the LOOP's own contract
  const abortEnvelope = (envelope) => ({
    ok: false,
    ...(envelope || { code: 'POLL_ABORTED', message: 'poll aborted' })
  });
  for (;;) {
    if (signal && signal.aborted) {
      return abortEnvelope(aborted);
    }
    if (Date.now() > deadline) return { ok: false, code: timeout.code, message: timeout.message };
    const cadence = backoffAfter != null && backoffTo != null && polls >= backoffAfter ? backoffTo : pollMs;
    await new Promise((resolve) => setTimeout(resolve, cadence));
    polls += 1;
    if (signal && signal.aborted) {
      return abortEnvelope(abortedAfterSleep || aborted);
    }
    let doc;
    try {
      doc = await fetchDoc();
      misses = 0;
    } catch (err) {
      if (++misses >= 60) throw err;
      continue;
    }
    if (isRunning(doc)) {
      if (onProgress && doc) onProgress(doc);
      continue;
    }
    if (doc && doc.status === 'failed') {
      return {
        ok: false,
        code: (doc.error && doc.error.code) || failed.code,
        // the Lab jobs carry error objects ({code, message}); the OKF
        // services store plain strings (job.error = e.message) — take the
        // string's text as the message rather than dropping it
        message: (doc.error && (doc.error.message || doc.error)) || failed.message
      };
    }
    return done(doc);
  }
}
