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
});
