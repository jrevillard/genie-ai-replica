// The module-level `config` object is mutable and `loadConfig` rebinds it on
// every call, so each test re-requires a fresh module instance instead of
// sharing one across the file.

const CONFIG_URL = '/config/genie-ai-config.json';

// Bundled defaults, mirrored from src/config-loader.js. Asserted explicitly so a
// change to the shipped defaults surfaces here rather than passing silently.
const DEFAULT_BRAND_COLOR = '#4071cb';
const DEFAULT_WELCOME_MESSAGE = 'Welcome to GENIE.AI';

function freshModule() {
  jest.resetModules();
  return require('../config-loader').default;
}

describe('loadConfig', () => {
  let loadConfig;
  let setProperty;
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
    loadConfig = freshModule();
    setProperty = jest.spyOn(document.documentElement.style, 'setProperty');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const cssPropsSet = () => setProperty.mock.calls.map((call) => call[0]);

  it('attempts to fetch the runtime config URL on every call', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 });

    await loadConfig();
    await loadConfig();

    // Per-call re-fetch is the contract operators rely on for edit → browser
    // reload without a container restart; caching would break that workflow.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(CONFIG_URL);
  });

  it('uses bundled defaults when fetch returns 404 (no override applied)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await loadConfig();

    expect(result.theme.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(result.features.chat.welcomeMessage).toBe(DEFAULT_WELCOME_MESSAGE);
    // Fields absent from the defaults stay absent — nothing was merged in.
    expect(result.theme.colors).toBeUndefined();
    expect(result.theme.navbar).toBeUndefined();
    expect(result.theme.typography).toBeUndefined();
  });

  it('merges fetched JSON over defaults when fetch succeeds', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          theme: {
            brandColor: '#ff0000',
            colors: { success: '#00ff00', warning: '#ffff00' }
          }
        })
    });

    const result = await loadConfig();

    expect(result.theme.brandColor).toBe('#ff0000');
    expect(result.theme.colors.success).toBe('#00ff00');
    expect(result.theme.colors.warning).toBe('#ffff00');
    // Keys the payload does not mention survive the merge.
    expect(result.app.title).toBe('GENIE.AI');
    expect(result.features.chat.welcomeMessage).toBe(DEFAULT_WELCOME_MESSAGE);
  });

  it('injects CSS custom properties on document.documentElement when fetch succeeds', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          theme: {
            brandColor: '#ff0000',
            colors: { success: '#00ff00', warning: '#ffff00' },
            navbar: { background: '#000000', text: '#ffffff' },
            typography: { fontFamily: 'Arial', fontScale: 1.2 }
          }
        })
    });

    await loadConfig();

    expect(setProperty).toHaveBeenCalledWith('--brand', '#ff0000');
    expect(setProperty).toHaveBeenCalledWith('--success', '#00ff00');
    expect(setProperty).toHaveBeenCalledWith('--warning', '#ffff00');
    expect(setProperty).toHaveBeenCalledWith('--navbar-bg', '#000000');
    expect(setProperty).toHaveBeenCalledWith('--navbar-fg', '#ffffff');
    expect(setProperty).toHaveBeenCalledWith('--font-body', 'Arial');
    // fontScale is stringified before being handed to the CSSOM.
    expect(setProperty).toHaveBeenCalledWith('--font-scale', '1.2');
  });

  it('applies only the default brand on the fallback path — no theme properties leak', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await loadConfig();

    // --brand is unconditional and falls back to the bundled default.
    expect(setProperty).toHaveBeenCalledWith('--brand', DEFAULT_BRAND_COLOR);
    // Nothing else may be written: a failing fetch must not leave partial state.
    expect(cssPropsSet()).toEqual(['--brand']);
  });

  it('falls back to defaults on JSON parse error', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('invalid JSON'))
    });

    const result = await loadConfig();

    expect(global.fetch).toHaveBeenCalledWith(CONFIG_URL);
    expect(result.theme.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(cssPropsSet()).toEqual(['--brand']);
  });
});
