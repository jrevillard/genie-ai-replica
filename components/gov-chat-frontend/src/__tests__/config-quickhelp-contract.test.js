// The Quick Help button contract (#1238), checked against every shipped
// configuration file on BOTH platforms.
//
// The id is the button's ONLY identity — the tag a saved conversation
// carries and the key the restore reads — so every button must carry a
// non-blank string id, and no two buttons may share one. The loader
// (src/config-loader.js, validateQuickHelpButtons) enforces the contract
// at runtime; this test calls that SAME exported validator on the files
// that ship, so a config that would be refused at boot fails the build
// instead — and the two gates can never drift apart, because they are
// one copy of the rules.
//
// Both sources are walked on purpose: the web serves its configs from
// public/config/ while the mobile app bundles its own under
// mobile/genie_ai_mobile/assets/config/ — one source drifting past the
// contract would ship a deployment the other platform refuses.

const fs = require('fs');
const path = require('path');

const { validateQuickHelpButtons } = require('../config-loader');

const SOURCES = [
  {
    label: 'web (public/config)',
    dir: path.join(__dirname, '..', '..', 'public', 'config'),
    pattern: /^genie-ai-config.*\.json$/
  },
  {
    label: 'mobile (assets/config)',
    dir: path.join(__dirname, '..', '..', '..', '..', 'mobile', 'genie_ai_mobile', 'assets', 'config'),
    pattern: /^genie-ai-config.*\.json$/
  }
];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const assertFileHonoursContract = (dir, name) => {
  try {
    validateQuickHelpButtons(readJson(path.join(dir, name)));
  } catch (error) {
    // Re-label the runtime message with the offending FILE — the runtime
    // always reads /config/genie-ai-config.json, the build walks every
    // shipped variant.
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
};

describe('Quick Help button contract across every shipped configuration', () => {
  it('walks both platform sources', () => {
    // The twin check is the point: a source that contributes no files
    // makes the whole test vacuous, and a vacuous pass reads as OK.
    for (const source of SOURCES) {
      const files = fs.existsSync(source.dir)
        ? fs.readdirSync(source.dir).filter((name) => source.pattern.test(name))
        : [];
      expect(files.length).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(SOURCES.map((source) => [source.label, source]))(
    '%s: every button carries a unique non-blank string id',
    (_label, source) => {
      const files = fs
        .readdirSync(source.dir)
        .filter((name) => source.pattern.test(name))
        .sort();

      for (const name of files) {
        assertFileHonoursContract(source.dir, name);
      }
    }
  );

  // The placement vocabulary, on both platforms: the field a button
  // declares decides WHERE it renders — a tile in the welcome grid or
  // the composer entry that replaces the Just Chat action. Both readers
  // compare STRICTLY (`placement === 'composer'`): a misspelled or
  // non-string value silently renders a tile on the web and DROPS the
  // card on mobile (a composer-placed entry has no mobile grid surface),
  // with no error anywhere — so the shipped files may only carry the two
  // declared values. A placement a deployment never declared (the field
  // is optional; absence is the tile default) asserts nothing here.
  const PLACEMENT_VALUES = ['tile', 'composer'];

  it.each(SOURCES.map((source) => [source.label, source]))(
    '%s: every declared placement is a declared vocabulary value',
    (_label, source) => {
      const files = fs
        .readdirSync(source.dir)
        .filter((name) => source.pattern.test(name))
        .sort();

      // One assertion for the whole source: the failure names every
      // offending button. A value outside the vocabulary silently renders
      // a tile on the web and vanishes from the mobile grid, with no
      // error anywhere — the readers compare strictly.
      const offenders = [];
      for (const name of files) {
        const buttons = readJson(path.join(source.dir, name))?.features?.chat?.quickHelp?.buttons || [];
        for (const button of buttons) {
          if (button.placement === undefined) continue;
          if (!PLACEMENT_VALUES.includes(button.placement)) {
            offenders.push(`${name}:${button.id} = ${JSON.stringify(button.placement)}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    }
  );

  // The web's composer entry: the shipped web configurations point the
  // just-chat button at the composer, and the served document's own
  // schema declares the field with the two-value enum — without the
  // schema clause a config carrying the field would fail the frontend's
  // Ajv validation at boot. (The mobile files deliberately declare NO
  // placement on just-chat: a composer-placed entry has no mobile grid
  // surface, so the mobile Just Chat entry stays a tile.)
  it('web: the just-chat entry is the composer, and the schema declares the placement enum', () => {
    const source = SOURCES[0];
    const files = fs
      .readdirSync(source.dir)
      .filter((name) => source.pattern.test(name))
      .sort();

    // One assertion per clause across the whole source, with the
    // offending file named in the collected values: the web composer is
    // the just-chat entry, and a config carrying a placement field
    // without the schema's two-value enum fails the frontend's Ajv
    // validation at boot.
    const missingEntry = [];
    const wrongPlacement = [];
    const missingSchema = [];
    const schemaWithoutEnum = [];

    for (const name of files) {
      const cfg = readJson(path.join(source.dir, name));
      const buttons = cfg?.features?.chat?.quickHelp?.buttons || [];
      const justChat = buttons.find((b) => b.id === 'just-chat');
      if (!justChat) {
        missingEntry.push(name);
        continue;
      }
      if (justChat.placement !== 'composer') {
        wrongPlacement.push(`${name} = ${JSON.stringify(justChat.placement)}`);
      }

      const placementSchema =
        cfg?.properties?.features?.properties?.chat?.properties?.quickHelp?.properties?.buttons?.items?.properties
          ?.placement;
      if (!placementSchema) {
        missingSchema.push(name);
      } else if (
        !Array.isArray(placementSchema.enum) ||
        !placementSchema.enum.every((v) => PLACEMENT_VALUES.includes(v))
      ) {
        schemaWithoutEnum.push(`${name} = ${JSON.stringify(placementSchema.enum)}`);
      }
    }

    expect(missingEntry).toEqual([]);
    expect(wrongPlacement).toEqual([]);
    expect(missingSchema).toEqual([]);
    expect(schemaWithoutEnum).toEqual([]);
  });
});
