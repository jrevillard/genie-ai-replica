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

  // The optional serviceLabels array (the category→service narrowing) is
  // shape-pinned by the SAME exported validator, so these synthetic cases
  // keep the runtime gate and this build gate one copy of the rule: a
  // well-formed array passes, anything else is refused at boot and would
  // fail this suite on a shipped file.
  describe('serviceLabels shape rule', () => {
    const doc = (serviceLabels) => ({
      features: {
        chat: {
          quickHelp: {
            buttons: [
              {
                id: 'probe',
                title: { en: 'Probe' },
                icon: { type: 'file', value: '/config/quickhelp/probe.svg' },
                category: 'Hadith',
                styles: { backgroundColor: '#fff', hoverColor: '#fff', outlineColor: '#fff' },
                ...(serviceLabels === undefined ? {} : { serviceLabels })
              }
            ]
          }
        }
      }
    });

    it('accepts an absent serviceLabels', () => {
      expect(() => validateQuickHelpButtons(doc(undefined))).not.toThrow();
    });

    it('accepts an array of non-blank strings', () => {
      expect(() => validateQuickHelpButtons(doc(['Sunni']))).not.toThrow();
      expect(() => validateQuickHelpButtons(doc(['Indonesia — MUI', 'Sunni']))).not.toThrow();
    });

    it.each([
      ['a bare string', 'Sunni'],
      ['an entry that is not a string', [42]],
      ['a blank-string entry', ['  ']],
      ['an empty-string entry', ['']]
    ])('refuses %s', (_label, value) => {
      expect(() => validateQuickHelpButtons(doc(value))).toThrow(/serviceLabels/);
    });
  });
});
