import fs from 'fs';
import path from 'path';

const localesDir = path.join(__dirname, '..', 'i18n', 'locales');

function getLocaleFiles() {
  return fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace('.js', ''))
    .sort();
}

function getLocaleData(locale) {
  return require(`../i18n/locales/${locale}.js`).default;
}

describe('Locale consistency', () => {
  const localeFiles = getLocaleFiles();

  test('English locale file exists', () => {
    expect(localeFiles).toContain('en');
  });

  test('each locale file exports a valid object with content', () => {
    for (const locale of localeFiles) {
      const data = getLocaleData(locale);
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
      expect(Object.keys(data).length).toBeGreaterThan(0);
    }
  });

  test('all locale files share the same top-level keys', () => {
    if (localeFiles.length < 2) return;

    const referenceLocale = localeFiles[0];
    const referenceKeys = Object.keys(getLocaleData(referenceLocale)).sort();

    for (const locale of localeFiles.slice(1)) {
      const keys = Object.keys(getLocaleData(locale)).sort();
      const missing = referenceKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !referenceKeys.includes(k));

      if (missing.length > 0 || extra.length > 0) {
        // Provide details in the thrown error since this Jest version
        // doesn't support expect(message, value) syntax
        const details = [
          `Locale "${locale}" differs from "${referenceLocale}":`,
          missing.length > 0 ? `  Missing keys: ${missing.join(', ')}` : null,
          extra.length > 0 ? `  Extra keys: ${extra.join(', ')}` : null
        ]
          .filter(Boolean)
          .join('\n');

        throw new Error(details);
      }

      expect(keys).toEqual(referenceKeys);
    }
  });

  // Deep key-parity regression guard.
  //
  // The 14 locale files are NOT yet fully key-aligned (pre-existing
  // fragmentation — see localeParity.baseline.json). Enforcing an identical
  // deep key set would fail CI today; full alignment is tracked separately.
  // Instead this guard FAILS ONLY WHEN fragmentation GROWS: each locale's
  // missing/extra leaf-key counts vs `en` (source of truth) must not exceed the
  // committed baseline. Adding a key to en.js without propagating makes
  // `missing` grow → CI fails → forces cross-locale propagation (prevents
  // aiGeneratedNoDocs-class gaps). When divergence is intentionally reduced,
  // shrink the baseline numbers to lock the improvement.
  function flattenKeys(obj, prefix = '') {
    const keys = [];
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        keys.push(...flattenKeys(v, p));
      } else {
        keys.push(p);
      }
    }
    return keys;
  }

  test('locale deep key-parity has not regressed beyond baseline', () => {
    const baseline = require('./localeParity.baseline.json');
    const reference = new Set(flattenKeys(getLocaleData('en')));

    const regressions = [];
    for (const locale of localeFiles) {
      if (locale === 'en') continue;
      const keys = new Set(flattenKeys(getLocaleData(locale)));
      const missing = [...reference].filter((k) => !keys.has(k)).length;
      const extra = [...keys].filter((k) => !reference.has(k)).length;
      const base = baseline[locale] || { missing: 0, extra: 0 };
      if (missing > base.missing || extra > base.extra) {
        regressions.push(
          `${locale}: missing ${base.missing} → ${missing}, extra ${base.extra} → ${extra}. ` +
            'A key was likely added/removed in en.js without propagating to all locales. ' +
            'Align the locale files, or deliberately update localeParity.baseline.json.'
        );
      }
    }
    expect(regressions).toEqual([]);
  });
});
