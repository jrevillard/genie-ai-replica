'use strict';

const { isOkfEnabled } = require('@/utils/okfFlag');

// The OKF feature flag semantics, pinned (!622 review wave 1): the deployed
// kill-switch is explicit '0' and the IMAGE defaults to it (fail-closed
// entrypoint); absent config means a dev server with no runtime config and
// stays enabled. The store registration and every gated surface read THIS
// helper — these tests pin the exact truth table they all share.
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

  it('absent key enables (a runtime config without the key)', () => {
    window.APP_CONFIG = {};
    expect(isOkfEnabled()).toBe(true);
  });

  it('null key enables', () => {
    window.APP_CONFIG = { okfEnabled: null };
    expect(isOkfEnabled()).toBe(true);
  });

  it('no APP_CONFIG at all enables (npm run serve has no runtime config)', () => {
    delete window.APP_CONFIG;
    expect(isOkfEnabled()).toBe(true);
  });

  it('any other value enables (boolean/number forms)', () => {
    window.APP_CONFIG = { okfEnabled: 1 };
    expect(isOkfEnabled()).toBe(true);
    window.APP_CONFIG = { okfEnabled: true };
    expect(isOkfEnabled()).toBe(true);
  });

  it('re-reads on every call (no import-time capture)', () => {
    window.APP_CONFIG = { okfEnabled: '1' };
    expect(isOkfEnabled()).toBe(true);
    window.APP_CONFIG = { okfEnabled: '0' };
    expect(isOkfEnabled()).toBe(false);
  });
});
