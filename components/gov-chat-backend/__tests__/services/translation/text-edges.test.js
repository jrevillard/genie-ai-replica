const { splitEdges } = require('../../../services/translation/text-edges');

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
