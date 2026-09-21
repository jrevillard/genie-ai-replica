const { repairScriptLeak } = require('../../../services/translation/script-repair');

describe('repairScriptLeak', () => {
  test('maps leaked Devanagari letters inside a Bengali word (Rajshahi, as the translator emitted it)', () => {
    // রাজ + शाह (DEVANAGARI SHA, VOWEL SIGN AA, HA) + ীতে
    expect(repairScriptLeak('রাজशाहীতে', 'bn')).toBe('রাজশাহীতে');
  });

  test('leaves pure Bengali untouched (and returns the same string)', () => {
    const s = 'আজ আমে কী রোগ হতে পারে?';
    expect(repairScriptLeak(s, 'bn')).toBe(s);
  });

  test('maps Devanagari digits to Bengali digits', () => {
    expect(repairScriptLeak('१२ মিমি', 'bn')).toBe('১২ মিমি');
  });

  test('keeps the shared danda (U+0964) — its parallel Bengali slot is unassigned', () => {
    expect(repairScriptLeak('ধান।', 'bn')).toBe('ধান।');
  });

  test('maps VA to Bengali BA (Bengali has no VA letter)', () => {
    expect(repairScriptLeak('व', 'bn')).toBe('ব');
  });

  test('accepts region-qualified Bengali codes', () => {
    expect(repairScriptLeak('श', 'bn-BD')).toBe('শ');
  });

  test('is a no-op for non-Bengali targets (Devanagari is correct Hindi output)', () => {
    const hi = 'राजशाही';
    expect(repairScriptLeak(hi, 'hi')).toBe(hi);
    expect(repairScriptLeak(hi, 'en')).toBe(hi);
    expect(repairScriptLeak(hi, undefined)).toBe(hi);
  });

  test('passes through empty and non-string input', () => {
    expect(repairScriptLeak('', 'bn')).toBe('');
    expect(repairScriptLeak(null, 'bn')).toBe(null);
    expect(repairScriptLeak(undefined, 'bn')).toBe(undefined);
  });
});
