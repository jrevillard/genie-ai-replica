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

// Round 20, #80798: the dev server ships the TRACKED public/runtime/config.js
// (index.html loads it in every build) — without okfEnabled in it the strict
// read left every OKF surface dark under `npm run serve` (a config EXISTS, so
// the "no config → enabled" dev arm never fired). Production is unaffected:
// the container entrypoint overwrites the file from VUE_APP_OKF_ENABLED.
describe('the DEV runtime config keeps the dev server surfaces visible', () => {
  it('public/runtime/config.js loads and sets okfEnabled: "1"', () => {
    // Owner-boundary check (round 21, #80881): EVALUATE the file the way
    // the dev server serves it and read the flag off window.APP_CONFIG —
    // the round-20 raw grep passed on a commented-out assignment (delete
    // the real one, keep `// okfEnabled: "1"` and it stayed green while
    // the dev server went dark). Evaluation also proves the file is still
    // valid JS, which a substring search never did.
    const src = require('fs').readFileSync('public/runtime/config.js', 'utf8');
    delete window.APP_CONFIG;
    window.eval(src);
    expect(window.APP_CONFIG && window.APP_CONFIG.okfEnabled).toBe('1');
  });
});
