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
    // The decorative layer writes a real attribute onto documentElement, and
    // unlike the spied setProperty above that write outlives the mock. Clear
    // it so an assertion about the attribute's absence tests the config under
    // test rather than whichever test happened to run before it.
    delete document.documentElement.dataset.visual;
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

  it('rejects when the fetched config does not satisfy its own schema', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['theme'],
          properties: {
            theme: {
              type: 'object',
              required: ['brandColor'],
              properties: { brandColor: { type: 'string' } }
            }
          },
          theme: { brandColor: 42 }
        })
    });

    await expect(loadConfig()).rejects.toThrow(/failed schema validation/i);
  });

  it('names the failing path when the config is invalid', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['theme'],
          properties: {
            theme: {
              type: 'object',
              required: ['brandColor'],
              properties: { brandColor: { type: 'string' } }
            }
          },
          theme: {}
        })
    });

    await expect(loadConfig()).rejects.toThrow(/brandColor/);
  });

  it('accepts a config that satisfies its schema', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['theme'],
          properties: {
            theme: {
              type: 'object',
              required: ['brandColor'],
              properties: { brandColor: { type: 'string' } }
            }
          },
          theme: { brandColor: '#123456' }
        })
    });

    const result = await loadConfig();

    expect(result.theme.brandColor).toBe('#123456');
  });

  it('marks the decorative layer off and writes no asset properties when theme.visual is absent', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ theme: { brandColor: '#ff0000' } })
    });

    await loadConfig();

    expect(document.documentElement.getAttribute('data-visual')).toBeNull();
    expect(cssPropsSet()).not.toContain('--visual-hero');
  });

  it('marks the decorative layer off when it is disabled', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ theme: { brandColor: '#ff0000', visual: { enabled: false } } })
    });

    await loadConfig();

    expect(document.documentElement.getAttribute('data-visual')).toBe('off');
  });

  it('marks the decorative layer on and writes one property per known asset', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          theme: {
            brandColor: '#ff0000',
            visual: {
              enabled: true,
              assets: {
                hero: '/config/genie-visual/assets/genie-hero-transparent.png',
                waves: '/config/genie-visual/assets/genie-bottom-waves.svg',
                mesh: '/config/genie-visual/assets/genie-dot-mesh.svg',
                corner: '/config/genie-visual/assets/genie-corner-network.svg'
              }
            }
          }
        })
    });

    await loadConfig();

    expect(document.documentElement.getAttribute('data-visual')).toBe('on');
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-hero',
      'url("/config/genie-visual/assets/genie-hero-transparent.png")'
    );
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-waves',
      'url("/config/genie-visual/assets/genie-bottom-waves.svg")'
    );
    expect(setProperty).toHaveBeenCalledWith('--visual-mesh', 'url("/config/genie-visual/assets/genie-dot-mesh.svg")');
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-corner',
      'url("/config/genie-visual/assets/genie-corner-network.svg")'
    );
  });

  it('ignores an unknown asset key instead of writing an inert property', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          theme: {
            brandColor: '#ff0000',
            visual: { enabled: true, assets: { heor: '/config/typo.png' } }
          }
        })
    });

    await loadConfig();

    expect(cssPropsSet()).not.toContain('--visual-heor');
  });
});
