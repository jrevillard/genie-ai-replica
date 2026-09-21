const { findForeignWords, foreignWordHint } = require('../../../services/translation/foreign-words');

describe('findForeignWords', () => {
  const source =
    'Currently, mangoes in Sapahar are at risk of the following diseases based on the official BAMIS crop calendar.';

  test('reports a Latin word that is not in the source (the deterministic "oficiais" leak)', () => {
    expect(findForeignWords(source, 'বর্তমানে, সাপাহার-এ oficiais BAMIS শস্য ক্যালেন্ডার')).toEqual(['oficiais']);
  });

  test('exempts Latin tokens that appear in the source (BAMIS, RH, place names, units)', () => {
    expect(findForeignWords(source + ' RH 95%', 'BAMIS ক্যালেন্ডার, RH ৯৫%, Sapahar')).toEqual([]);
  });

  test('ignores markdown link destinations', () => {
    expect(findForeignWords('See the report.', '[প্রতিবেদন দেখুন](/api/weather/drought-report/x.pdf)')).toEqual([]);
  });

  test('is case-insensitive and de-duplicates', () => {
    expect(findForeignWords('the official calendar', 'Oficiais ... oficiais ... previstas')).toEqual([
      'Oficiais',
      'previstas'
    ]);
  });

  test('returns [] for clean Bengali and for non-strings', () => {
    expect(findForeignWords(source, 'বর্তমানে সাপাহারে আম গাছ ঝুঁকিতে')).toEqual([]);
    expect(findForeignWords(source, '')).toEqual([]);
    expect(findForeignWords(source, null)).toEqual([]);
  });
});

describe('foreignWordHint', () => {
  test('names each leaked word and the target language', () => {
    const h = foreignWordHint(['oficiais', 'previstas'], 'Bengali');
    expect(h).toContain('"oficiais", "previstas"');
    expect(h).toContain('Bengali');
    expect(h).toMatch(/words .* untranslated/);
  });

  test('is empty when nothing leaked', () => {
    expect(foreignWordHint([], 'Bengali')).toBe('');
  });
});

describe('findForeignWords - non-Latin scripts', () => {
  test('reports an Arabic word dropped into Bengali output', () => {
    expect(findForeignWords('classified as flooded/water', 'বন্যা/ المياه হিসাবে শ্রেণীবদ্ধ')).toEqual(['المياه']);
  });

  test('does not report Bengali itself, digits, or emojis', () => {
    expect(findForeignWords('rain 14.1 mm', '🌧️ বৃষ্টি ১৪.১ মিমি')).toEqual([]);
  });
});
