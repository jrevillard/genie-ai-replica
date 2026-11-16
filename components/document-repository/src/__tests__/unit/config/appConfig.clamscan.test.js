// appConfig reads process.env once at require time, so each case re-requires
// the module with the variables it cares about set.
function loadAppConfig(env = {}) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  jest.resetModules();
  try {
    return require('../../../config/appConfig').default || require('../../../config/appConfig');
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

describe('appConfig.clamscan toggles', () => {
  afterEach(() => jest.resetModules());

  it('allows the local-binary fallback by default', () => {
    const config = loadAppConfig({ CLAMSCAN_LOCAL_FALLBACK: undefined });
    expect(config.clamscan.localFallback).toBe(true);
  });

  it('honours CLAMSCAN_LOCAL_FALLBACK=false', () => {
    const config = loadAppConfig({ CLAMSCAN_LOCAL_FALLBACK: 'false' });
    expect(config.clamscan.localFallback).toBe(false);
  });

  it('keeps the scanner active by default and honours CLAMSCAN_ACTIVE=false', () => {
    expect(loadAppConfig({ CLAMSCAN_ACTIVE: undefined }).clamscan.active).toBe(true);
    expect(loadAppConfig({ CLAMSCAN_ACTIVE: 'false' }).clamscan.active).toBe(false);
  });

  it('reads the clamd host and port from the environment', () => {
    const config = loadAppConfig({ CLAMSCAN_HOST: 'clamav', CLAMSCAN_PORT: '3311' });
    expect(config.clamscan.host).toBe('clamav');
    expect(config.clamscan.port).toBe(3311);
  });
});

// #1064 remote-canonical: the localFallback default is MODE-AWARE, decided at
// require time in appConfig.js. The loopback list lives in THREE hand-synced
// places — this matrix, the appConfig IIFE, and the `is_local_host` case list
// in scripts/clamav-node.sh — keep them in lock-step when a form is added.
// The LOCAL-mode defaults (unset → ON, explicit 'false' → OFF) are already
// pinned by the toggles describe above — this matrix owns only the
// REMOTE-mode shapes and the explicit-over-mode interactions.
describe('appConfig.clamscan localFallback matrix (#1064 remote-canonical)', () => {
  afterEach(() => jest.resetModules());

  it.each([
    ['127.0.0.1'],
    ['localhost'],
    ['::1'],
    // compose pass-through shapes: an operator who leaves a knob out of .env
    // delivers '' into the container, and '' must count as unset
    ['']
  ])('CLAMSCAN_HOST=%s (LOCAL_FALLBACK unset) → local mode, fallback ON', (host) => {
    expect(loadAppConfig({ CLAMSCAN_HOST: host }).clamscan.localFallback).toBe(true);
  });

  it('CLAMSCAN_HOST=<remote>, no explicit fallback → fallback OFF (the ruling)', () => {
    expect(loadAppConfig({ CLAMSCAN_HOST: 'clamav' }).clamscan.localFallback).toBe(false);
  });

  it('CLAMSCAN_HOST=<remote>, fallback passed through as compose-empty → fallback OFF', () => {
    expect(loadAppConfig({ CLAMSCAN_HOST: 'clamav', CLAMSCAN_LOCAL_FALLBACK: '' }).clamscan.localFallback).toBe(false);
  });

  it('explicit CLAMSCAN_LOCAL_FALLBACK=true wins over remote mode', () => {
    expect(loadAppConfig({ CLAMSCAN_HOST: 'clamav', CLAMSCAN_LOCAL_FALLBACK: 'true' }).clamscan.localFallback).toBe(
      true
    );
  });

  it('explicit CLAMSCAN_LOCAL_FALLBACK=false wins over remote mode', () => {
    expect(loadAppConfig({ CLAMSCAN_HOST: 'clamav', CLAMSCAN_LOCAL_FALLBACK: 'false' }).clamscan.localFallback).toBe(
      false
    );
  });
});
