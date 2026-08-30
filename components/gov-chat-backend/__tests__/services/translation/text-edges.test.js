const { splitEdges, startsWithWordSpacedScript } = require('../../../services/translation/text-edges');

describe('splitEdges', () => {
  test('leading colon-space is an edge; core keeps trailing punctuation', () => {
    // Source "**Hive Selection**: Choose hives." -> text node ": Choose hives."
    expect(splitEdges(': Choose hives.')).toEqual({
      lead: ': ',
      core: 'Choose hives.',
      trail: ''
    });
  });

  test('leading whitespace alone is an edge (text after **bold** with space)', () => {
    expect(splitEdges(' Choose hives')).toEqual({ lead: ' ', core: 'Choose hives', trail: '' });
  });

  test('trailing punctuation stays in the core (NOT re-applied -> no doubling)', () => {
    // The model keeps "." — keeping it in core avoids "word..".
    expect(splitEdges('Choose hives.')).toEqual({ lead: '', core: 'Choose hives.', trail: '' });
    expect(splitEdges('Really?')).toEqual({ lead: '', core: 'Really?', trail: '' });
  });

  test('trailing whitespace is an edge (re-applied); trailing punctuation stays in core', () => {
    expect(splitEdges('Choose hives. ')).toEqual({ lead: '', core: 'Choose hives.', trail: ' ' });
  });

  test('no edge chars -> empty lead/trail', () => {
    expect(splitEdges('Choose hives')).toEqual({ lead: '', core: 'Choose hives', trail: '' });
  });

  test('unicode letters/digits stay in the core', () => {
    expect(splitEdges('Selección de Hive')).toEqual({ lead: '', core: 'Selección de Hive', trail: '' });
    expect(splitEdges('3 beehives')).toEqual({ lead: '', core: '3 beehives', trail: '' });
  });

  test('whitespace-only value -> empty core', () => {
    expect(splitEdges('   ')).toEqual({ lead: '   ', core: '', trail: '' });
  });

  test('punctuation-only value -> empty core, all in lead', () => {
    expect(splitEdges(':')).toEqual({ lead: ':', core: '', trail: '' });
    expect(splitEdges(' - ')).toEqual({ lead: ' - ', core: '', trail: '' });
  });

  test('leading quote is an edge; trailing quote stays in core', () => {
    expect(splitEdges('«word»')).toEqual({ lead: '«', core: 'word»', trail: '' });
  });

  test('null-safe', () => {
    expect(splitEdges(null)).toEqual({ lead: '', core: '', trail: '' });
    expect(splitEdges(undefined)).toEqual({ lead: '', core: '', trail: '' });
    expect(splitEdges('')).toEqual({ lead: '', core: '', trail: '' });
  });

  test('round-trip: lead + core + trail reconstructs the original', () => {
    for (const v of [': Choose hives.', ' plain ', 'word', '  ', '«café»!', ':', 'Selección 123', 'Really? ']) {
      const { lead, core, trail } = splitEdges(v);
      expect(lead + core + trail).toBe(v);
    }
  });
});

// Multi-language coverage — splitEdges is language-agnostic (operates on
// whitespace/punctuation structure, not language rules). Verify it preserves
// each script's text as core and handles its structural edges.
describe('splitEdges across scripts', () => {
  test('Latin scripts (en, es, fr, de, pt) — accented chars stay in core', () => {
    expect(splitEdges('Choose hives').core).toBe('Choose hives');
    expect(splitEdges('Elige colmenas').core).toBe('Elige colmenas');
    expect(splitEdges('Choisissez les ruches').core).toBe('Choisissez les ruches');
    expect(splitEdges('Wählen Sie').core).toBe('Wählen Sie');
    expect(splitEdges('Escolha colmeias').core).toBe('Escolha colmeias');
  });
  test('Cyrillic (ru) — core preserved', () => {
    expect(splitEdges('Выберите ульи').core).toBe('Выберите ульи');
  });
  test('CJK (zh) — no inter-word spaces, core preserved', () => {
    expect(splitEdges('选择蜂箱').core).toBe('选择蜂箱');
  });
  test('Thai (th) — no inter-word spaces, core preserved', () => {
    expect(splitEdges('เลือกรังผึ้ง').core).toBe('เลือกรังผึ้ง');
  });
  test('Arabic (ar) — RTL, core preserved', () => {
    expect(splitEdges('اختر خلايا').core).toBe('اختر خلايا');
  });
  test('French space-before-colon typography preserved verbatim when in source', () => {
    // If the source uses French " :" spacing, it is preserved (not converted).
    const e = splitEdges(' : Choisissez les ruches');
    expect(e).toEqual({ lead: ' : ', core: 'Choisissez les ruches', trail: '' });
  });
});

// The run-in-bold space injection is gated to word-spaced scripts. Verify the
// gate so CJK/Thai (no inter-word spaces) are never given an unwanted space.
describe('startsWithWordSpacedScript', () => {
  test.each([
    ['Choose hives', 'English (Latin)'],
    ['Elige colmenas', 'Spanish (Latin)'],
    ['Choisissez les ruches', 'French (Latin)'],
    ['Wählen Sie', 'German (Latin)'],
    ['Escolha colmeias', 'Portuguese (Latin)'],
    ['Pilih sarang', 'Indonesian (Latin)'],
    ['Выберите', 'Russian (Cyrillic)'],
    ['Επιλέξτε', 'Greek']
  ])('%s (%s) -> true (inject space OK)', (value) => {
    expect(startsWithWordSpacedScript(value)).toBe(true);
  });

  test.each([
    ['选择蜂箱', 'Chinese (Han/CJK)'],
    ['選択', 'Japanese (Han/CJK)'],
    ['เลือก', 'Thai'],
    ['ສະບາຍ', 'Lao'],
    ['មានជ័យ', 'Khmer'],
    ['اختر', 'Arabic (RTL)'],
    ['বেছে', 'Bengali'],
    ['चुनें', 'Devanagari/Hindi']
  ])('%s (%s) -> false (no space injected)', (value) => {
    expect(startsWithWordSpacedScript(value)).toBe(false);
  });

  test('punctuation/whitespace start -> false', () => {
    expect(startsWithWordSpacedScript(': text')).toBe(false);
    expect(startsWithWordSpacedScript(' text')).toBe(false);
    expect(startsWithWordSpacedScript('')).toBe(false);
    expect(startsWithWordSpacedScript(null)).toBe(false);
  });
});
