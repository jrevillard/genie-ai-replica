import { resolveConfigText } from '../utils/configResolver';

describe('resolveConfigText', () => {
  it('resolves locale map with exact locale match', () => {
    const value = { en: 'Hello', es: 'Hola' };
    expect(resolveConfigText(value, 'en')).toBe('Hello');
    expect(resolveConfigText(value, 'es')).toBe('Hola');
  });

  it('falls back to en for missing locale', () => {
    const value = { en: 'Hello', es: 'Hola' };
    expect(resolveConfigText(value, 'fr')).toBe('Hello');
  });

  it('falls back to first value if en missing', () => {
    const value = { es: 'Hola', fr: 'Bonjour' };
    expect(resolveConfigText(value, 'de')).toBe('Hola');
  });

  it('returns plain string as-is', () => {
    expect(resolveConfigText('Direct value', 'en')).toBe('Direct value');
  });

  it('returns empty string for null', () => {
    expect(resolveConfigText(null, 'en')).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(resolveConfigText(undefined, 'en')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(resolveConfigText('', 'en')).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(resolveConfigText({}, 'en')).toBe('');
  });

  it('handles single-entry locale map', () => {
    expect(resolveConfigText({ en: 'Only English' }, 'es')).toBe('Only English');
  });
});
