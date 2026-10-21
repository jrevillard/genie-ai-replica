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
