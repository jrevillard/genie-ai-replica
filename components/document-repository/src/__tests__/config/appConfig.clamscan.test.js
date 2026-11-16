'use strict';

// #1064 — the clamscan localFallback default is MODE-AWARE, decided at
// require time inside appConfig.js (a load-time IIFE, like every other
// appConfig knob). The contract:
//
//   - LOCAL mode (CLAMSCAN_HOST unset or loopback): default ON — falling
//     back to the local binary is what a local-scanner deployment has
//     always done; `CLAMSCAN_LOCAL_FALLBACK=false` opts out.
//   - REMOTE mode (CLAMSCAN_HOST set to a non-local host): default OFF —
//     no local daemon exists to fall back to, and the clamscan library's
//     fallback attempt would just stall every scan against a socket
//     nothing listens on.
//   - An explicit CLAMSCAN_LOCAL_FALLBACK wins in BOTH modes.
//
// appConfig reads process.env at require time, so every case resets the
// module registry and re-requires with a staged environment.

describe('appConfig clamscan localFallback matrix (#1064 remote-canonical)', () => {
  const originalHost = process.env.CLAMSCAN_HOST;
  const originalFallback = process.env.CLAMSCAN_LOCAL_FALLBACK;

  const loadWith = (env) => {
    jest.resetModules();
    delete process.env.CLAMSCAN_HOST;
    delete process.env.CLAMSCAN_LOCAL_FALLBACK;
    Object.assign(process.env, env);
    return require('../../config/appConfig');
  };

  afterAll(() => {
    // Restore the caller's environment exactly as we found it.
    if (originalHost === undefined) {
      delete process.env.CLAMSCAN_HOST;
    } else {
      process.env.CLAMSCAN_HOST = originalHost;
    }
    if (originalFallback === undefined) {
      delete process.env.CLAMSCAN_LOCAL_FALLBACK;
    } else {
      process.env.CLAMSCAN_LOCAL_FALLBACK = originalFallback;
    }
    jest.resetModules();
  });

  test('nothing set → local mode, fallback ON (the historical default preserved)', () => {
    expect(loadWith({}).clamscan.localFallback).toBe(true);
  });

  test.each(['127.0.0.1', 'localhost', '::1'])('CLAMSCAN_HOST=%s → still local mode, fallback ON', (host) => {
    expect(loadWith({ CLAMSCAN_HOST: host }).clamscan.localFallback).toBe(true);
  });

  test('CLAMSCAN_HOST=<remote host>, no explicit fallback → fallback OFF (the ruling)', () => {
    expect(loadWith({ CLAMSCAN_HOST: 'clamav' }).clamscan.localFallback).toBe(false);
  });

  test('explicit CLAMSCAN_LOCAL_FALLBACK=true wins over remote mode', () => {
    expect(loadWith({ CLAMSCAN_HOST: 'clamav', CLAMSCAN_LOCAL_FALLBACK: 'true' }).clamscan.localFallback).toBe(true);
  });

  test('explicit CLAMSCAN_LOCAL_FALLBACK=false wins over local mode', () => {
    expect(loadWith({ CLAMSCAN_LOCAL_FALLBACK: 'false' }).clamscan.localFallback).toBe(false);
  });

  test('explicit CLAMSCAN_LOCAL_FALLBACK=false wins over remote mode', () => {
    expect(loadWith({ CLAMSCAN_HOST: 'clamav', CLAMSCAN_LOCAL_FALLBACK: 'false' }).clamscan.localFallback).toBe(false);
  });
});
