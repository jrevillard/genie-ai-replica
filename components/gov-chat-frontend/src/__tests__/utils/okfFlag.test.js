'use strict';

const { isOkfEnabled } = require('@/utils/okfFlag');

// The OKF feature flag semantics, pinned (!622 wave 1, revised round 16
// #80120): the ONLY enabling value is the exact string '1' (what
// compose/ansible write for OKF_ENABLED=1); the exact string '0' and ANY
// OTHER recognized-but-unintended value disable (fail-closed — an operator
// writing OKF_ENABLED=false must never silently get the Studio ON). No
// APP_CONFIG at all is the one enabling arm beyond '1': a dev server
// (`npm run serve`) ships no runtime config, and production ALWAYS has one
// (the entrypoint writes it, defaulting okfEnabled to '0'). The store
// registration and every gated surface read THIS helper — these tests pin
// the exact truth table they all share.
describe('okfFlag.isOkfEnabled', () => {
  afterEach(() => {
    delete window.APP_CONFIG;
  });

  it("explicit '1' enables (what compose/ansible write when OKF_ENABLED=1)", () => {
    window.APP_CONFIG = { okfEnabled: '1' };
    expect(isOkfEnabled()).toBe(true);
  });

  it("explicit '0' disables — the deployed kill-switch", () => {
    window.APP_CONFIG = { okfEnabled: '0' };
    expect(isOkfEnabled()).toBe(false);
  });

  it('a runtime config WITHOUT the key disables — the entrypoint always writes it, so absence means a foreign config writer (fail closed)', () => {
    window.APP_CONFIG = {};
    expect(isOkfEnabled()).toBe(false);
  });

  it('no APP_CONFIG at all enables (npm run serve has no runtime config)', () => {
    delete window.APP_CONFIG;
    expect(isOkfEnabled()).toBe(true);
  });

  it('near-miss values fail CLOSED — an operator writing them must not get the Studio silently on (round 16, #80120)', () => {
    for (const v of [
      'false',
      'FALSE',
      'no',
      'off',
      ' 0',
      '0 ',
      'true',
      'yes',
      '',
      '01',
      1,
      0,
      true,
      false,
      null,
      undefined
    ]) {
      window.APP_CONFIG = { okfEnabled: v };
      expect(isOkfEnabled()).toBe(false);
    }
  });

  it('re-reads on every call (no import-time capture)', () => {
    window.APP_CONFIG = { okfEnabled: '1' };
    expect(isOkfEnabled()).toBe(true);
    window.APP_CONFIG = { okfEnabled: '0' };
    expect(isOkfEnabled()).toBe(false);
  });
});
