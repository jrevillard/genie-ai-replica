// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The ONE async-job gate (!622 round 9, #78664). No direct coverage existed
// until round 21 — the round-21 predicate fix (assertFree `!== undefined`,
// matching reserve) is pinned here: a reserved-but-falsy marker used to slip
// assertFree while reserve kept refusing the key.
const { AsyncJobGate } = require('../services/async-job-gate');

describe('AsyncJobGate', () => {
  it('assertFree throws 409 with the in-flight marker when held; passes when free', () => {
    const gate = new AsyncJobGate();
    expect(() => gate.assertFree('k')).not.toThrow();
    gate.reserve('k', 'suite-1');
    let err = null;
    try {
      gate.assertFree('k');
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'GENERATION_IN_FLIGHT', status: 409 });
    expect(err.details).toEqual({ suite_key: 'suite-1' });
    gate.release('k');
    expect(() => gate.assertFree('k')).not.toThrow();
  });

  it('a reserved-but-FALSY marker is still held — assertFree and reserve agree (round 21)', () => {
    const gate = new AsyncJobGate();
    gate.reserve('k', 0);
    expect(gate.has('k')).toBe(true);
    expect(() => gate.assertFree('k')).toThrow(); // was: truthy check let 0 slip
    expect(() => gate.reserve('k', 'again')).toThrow(); // reserve always refused it
    // Empty-string marker, same story.
    gate.release('k');
    gate.reserve('k', '');
    expect(() => gate.assertFree('k')).toThrow();
  });

  it('reserve is the synchronous re-check: a second reserve of a held key throws', () => {
    const gate = new AsyncJobGate();
    gate.reserve('k', 'first');
    let err = null;
    try {
      gate.reserve('k', 'second');
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 409 });
    expect(gate.get('k')).toBe('first'); // the original claim survives
  });

  it('custom code/message ride the 409', () => {
    const gate = new AsyncJobGate();
    gate.reserve('k', 'run-9');
    let err = null;
    try {
      gate.reserve('k', 'x', { code: 'RUN_IN_FLIGHT', message: 'already running' });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'RUN_IN_FLIGHT', message: 'already running' });
  });
});
