// Parity test: every runtime config file declares the same set of asset
// keys under `properties.theme.properties.visual.properties.assets.properties`.
//
// The loader in src/config-loader.js derives its asset key list from the
// schema each fetched config carries, so the loader cannot accept a key
// the schema rejects, and cannot ignore a key the schema accepts. The
// catch is that an operator hand-edits the schema and forgets the
// runtime config — the layer would silently drop the asset they added
// (or accept a stale one the schema no longer carries). This test makes
// that drift loud: one config drifting from the others breaks the suite.
//
// The set is asserted as Object.keys() equality (order is preserved by
// the JSON parsers we ship) — the schema is the single source of truth.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'public', 'config');

const files = fs
  .readdirSync(CONFIG_DIR)
  .filter((name) => /^genie-ai-config.*\.json$/.test(name))
  .sort();

const EXPECTED_ASSET_KEYS = ['hero', 'waves', 'mesh', 'corner', 'ambient'];

describe('asset schema parity across runtime configs', () => {
  it('discovers every runtime config on disk', () => {
    // The test only has value if it walks all seven — a config added
    // later must be asserted against the same key set.
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files)('%s declares exactly the expected asset key set', (name) => {
    const doc = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
    const properties = doc?.properties?.theme?.properties?.visual?.properties?.assets?.properties;
    expect(properties).toBeDefined();
    expect(Object.keys(properties).sort()).toEqual([...EXPECTED_ASSET_KEYS].sort());
  });

  it.each(files)('%s rejects unknown asset keys at validation time', (name) => {
    // Round-trip the document against itself with an unknown key added —
    // additionalProperties:false on assets makes the addition a validation
    // error, not a silent no-op.
    const doc = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
    doc.theme = doc.theme || {};
    doc.theme.visual = doc.theme.visual || { enabled: true, assets: {} };
    doc.theme.visual.assets = { ...doc.theme.visual.assets, typo: '/config/x.png' };

    const validate = new Ajv({ allErrors: true, strict: false }).compile(doc);
    expect(validate(doc)).toBe(false);
    expect(
      validate.errors.some(
        (err) => err.keyword === 'additionalProperties' && err.params && err.params.additionalProperty === 'typo'
      )
    ).toBe(true);
  });
});
