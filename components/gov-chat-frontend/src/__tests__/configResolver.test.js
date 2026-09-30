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

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty object', {}]
  ])('returns empty string for %s', (_label, input) => {
    expect(resolveConfigText(input, 'en')).toBe('');
  });

  it('handles single-entry locale map', () => {
    expect(resolveConfigText({ en: 'Only English' }, 'es')).toBe('Only English');
  });
});
