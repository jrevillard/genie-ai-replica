// Every asset a deployment can point at through the runtime config is
// operator-editable: it lives under public/config/, which is bind-mounted
// read-only into the container so it can be swapped on the host without a
// rebuild. Ajv validates the shape of these references but cannot know that
// the file behind one exists, so a typo'd path would ship as a broken image
// and surface only at runtime. This reads the real config files from disk —
// config-loader.test.js deliberately mocks fetch and never sees them.

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'public', 'config');
const CONFIG_FILES = fs
  .readdirSync(CONFIG_DIR)
  .filter((name) => /^genie-ai-config.*\.json$/.test(name))
  .sort();

const readConfig = (name) => JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));

// Every /config/-rooted reference the schema can carry. `type: 'file'` is
// the only variant that names a path on disk.
const assetPaths = (config) => {
  const paths = [];
  const push = (label, reference) => {
    if (reference && reference.type === 'file' && typeof reference.value === 'string') {
      paths.push([label, reference.value]);
    }
  };

  push('app.icon', config.app && config.app.icon);
  push('app.splash', config.app && config.app.splash);

  const visual = config.theme && config.theme.visual;
  if (visual && visual.assets) {
    for (const [name, value] of Object.entries(visual.assets)) {
      push(`theme.visual.assets.${name}`, { type: 'file', value });
    }
  }

  return paths;
};

const BASE_CONFIG = 'genie-ai-config.json';
const FLAVOUR_CONFIGS = CONFIG_FILES.filter((name) => name !== BASE_CONFIG);

// One row per (config file, asset, path), so a failing row names the exact
// asset rather than only the file it sits in. Jest 29 removed `expect`'s
// second argument, which is where this label would otherwise live.
const REFERENCES = CONFIG_FILES.flatMap((name) =>
  assetPaths(readConfig(name)).map(([label, value]) => [name, label, value])
);

describe('runtime config asset references', () => {
  it('finds the config files', () => {
    expect(CONFIG_FILES).toHaveLength(7);
  });

  it.each(REFERENCES)('%s: %s is served from /config/', (name, label, value) => {
    expect(value).toMatch(/^\/config\//);
    expect(fs.existsSync(path.join(CONFIG_DIR, value.replace(/^\/config\//, '')))).toBe(true);
  });

  it('points the base theme at the deployment splash (el-salvador base config)', () => {
    expect(readConfig(BASE_CONFIG).app.splash).toStrictEqual({
      type: 'file',
      value: '/config/agro-genio-splash.png'
    });
  });

  it('counts six flavour themes alongside the base one', () => {
    expect(FLAVOUR_CONFIGS).toHaveLength(6);
  });

  it.each(FLAVOUR_CONFIGS)('%s does not opt in', (name) => {
    expect(readConfig(name).app.splash).toBeUndefined();
  });
});
