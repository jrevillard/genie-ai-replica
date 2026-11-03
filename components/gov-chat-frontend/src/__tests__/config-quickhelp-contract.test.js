// The Quick Help button contract (#1238), checked against every shipped
// configuration file on BOTH platforms.
//
// The id is the button's ONLY identity — the tag a saved conversation
// carries and the key the restore reads — so every button must carry a
// non-empty string id, and no two buttons may share one. The loader
// (src/config-loader.js, validateQuickHelpButtons) enforces the contract
// at runtime; this test enforces it on the files that ship, so a config
// that would be refused at boot fails the build instead.
//
// Both sources are walked on purpose: the web serves its configs from
// public/config/ while the mobile app bundles its own under
// mobile/genie_ai_mobile/assets/config/ — one source drifting past the
// contract would ship a deployment the other platform refuses.

const fs = require('fs');
const path = require('path');

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

const quickHelpButtons = (doc) => doc?.features?.chat?.quickHelp?.buttons;

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
    '%s: every button carries a unique non-empty string id',
    (_label, source) => {
      const files = fs
        .readdirSync(source.dir)
        .filter((name) => source.pattern.test(name))
        .sort();

      for (const name of files) {
        const doc = readJson(path.join(source.dir, name));
        const buttons = quickHelpButtons(doc) || [];
        const seen = new Map();

        for (const [index, button] of buttons.entries()) {
          const id = button?.id;
          if (typeof id !== 'string' || id === '') {
            throw new Error(
              `${name}: Quick Help button #${index} has no valid "id" — every button must carry a non-empty string id.`
            );
          }
          if (seen.has(id)) {
            throw new Error(
              `${name}: Quick Help button #${index} duplicates the id "${id}" of button #${seen.get(id)}.`
            );
          }
          seen.set(id, index);
        }
      }
    }
  );
});
