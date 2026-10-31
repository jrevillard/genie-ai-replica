// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// ONE async-job gate (review !622 round 9, #78664): the check-then-set race
// the ragas service fixed on 2026-10-21 (review F12 — a double-click passed
// the check twice across awaited pre-checks and started two GPU jobs) kept
// re-appearing in every new copy of the pattern. The gate owns the map AND
// the reservation, so `reserve` re-checks SYNCHRONOUSLY after the caller's
// awaited pre-checks — the fix exists in exactly one place.

class AsyncJobGate {
  constructor() {
    this._inFlight = new Map(); // key -> job marker (suite_key / run_key)
  }

  /** Fast-fail check for UX: 409 with the in-flight marker if held. The
   * predicate is `!== undefined`, IDENTICAL to reserve's (round 21): a
   * truthy check let a reserved-but-falsy marker (0, '', false, null) slip
   * assertFree while reserve kept refusing it — the two disagreed about
   * whether the key was held. */
  assertFree(key, { code = 'GENERATION_IN_FLIGHT', message } = {}) {
    const inflight = this._inFlight.get(key);
    if (inflight !== undefined) {
      const err = new Error(message || 'a job is already running for this key');
      err.code = code;
      err.status = 409;
      err.details = { suite_key: inflight };
      throw err;
    }
  }

  /** Reserve SYNCHRONOUSLY — re-checks (the F12 fix), then claims. */
  reserve(key, value, { code = 'GENERATION_IN_FLIGHT', message } = {}) {
    const inflight = this._inFlight.get(key);
    if (inflight !== undefined) {
      const err = new Error(message || 'a job is already running for this key');
      err.code = code;
      err.status = 409;
      err.details = { suite_key: inflight };
      throw err;
    }
    this._inFlight.set(key, value);
  }

  release(key) {
    this._inFlight.delete(key);
  }

  get(key) {
    return this._inFlight.get(key);
  }

  has(key) {
    return this._inFlight.has(key);
  }
}

module.exports = { AsyncJobGate };
