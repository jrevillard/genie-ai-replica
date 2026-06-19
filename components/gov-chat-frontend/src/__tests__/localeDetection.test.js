import { detectInitialLocale } from '../utils/localeDetection';

describe('detectInitialLocale', () => {
  const availableLocales = ['en', 'es'];

  it('returns saved locale when present', () => {
    expect(detectInitialLocale('es', 'fr', availableLocales)).toBe('es');
  });

  it('returns browser locale when supported and no saved preference', () => {
    expect(detectInitialLocale(null, 'es', availableLocales)).toBe('es');
  });

  it('handles browser locale with region code (e.g. es-ES)', () => {
    expect(detectInitialLocale(null, 'es-ES', availableLocales)).toBe('es');
  });

  it('falls back to en when browser locale is not supported', () => {
    expect(detectInitialLocale(null, 'fr', availableLocales)).toBe('en');
  });

  it('falls back to en when browser locale is not supported (with region)', () => {
    expect(detectInitialLocale(null, 'fr-FR', availableLocales)).toBe('en');
  });

  it('falls back to en when no saved locale and no browser language', () => {
    expect(detectInitialLocale(null, '', availableLocales)).toBe('en');
  });

  it('falls back to en when no saved locale and browser language is null', () => {
    expect(detectInitialLocale(null, null, availableLocales)).toBe('en');
  });

  it('prioritizes saved locale over browser locale', () => {
    expect(detectInitialLocale('en', 'es', availableLocales)).toBe('en');
  });

  it('works with a single locale (en only)', () => {
    expect(detectInitialLocale(null, 'fr', ['en'])).toBe('en');
    expect(detectInitialLocale(null, 'en-GB', ['en'])).toBe('en');
  });

  it('falls back to browser locale when saved locale is no longer available', () => {
    // User previously selected a locale that was later removed — fall through
    expect(detectInitialLocale('sw', 'es', availableLocales)).toBe('es');
  });

  it('falls back to en when saved locale removed and browser locale unsupported', () => {
    expect(detectInitialLocale('sw', 'fr', availableLocales)).toBe('en');
  });
});
