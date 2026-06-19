const { splitEdges } = require('../../../services/translation/text-edges');

describe('splitEdges', () => {
  test('separates a leading colon-space from the core (bold-heading text node)', () => {
    // Source "**Hive Selection**: Choose hives" -> text node ": Choose hives".
    // The model must translate only "Choose hives"; ": " is re-applied verbatim.
    expect(splitEdges(': Choose hives that suit')).toEqual({
      lead: ': ',
      core: 'Choose hives that suit',
      trail: ''
    });
  });

  test('keeps trailing punctuation as an edge', () => {
    expect(splitEdges('Choose hives.')).toEqual({ lead: '', core: 'Choose hives', trail: '.' });
  });

  test('handles both leading and trailing edges', () => {
    expect(splitEdges(': Choose hives.')).toEqual({
      lead: ': ',
      core: 'Choose hives',
      trail: '.'
    });
  });

  test('leading whitespace alone is an edge (text after **bold** with space)', () => {
    expect(splitEdges(' Choose hives')).toEqual({ lead: ' ', core: 'Choose hives', trail: '' });
  });

  test('no edge chars -> empty lead/trail, core is the whole value', () => {
    expect(splitEdges('Choose hives')).toEqual({ lead: '', core: 'Choose hives', trail: '' });
  });

  test('unicode letters/digits stay in the core (accented chars not treated as edges)', () => {
    expect(splitEdges('Selección de Hive')).toEqual({ lead: '', core: 'Selección de Hive', trail: '' });
    expect(splitEdges('3 beehives')).toEqual({ lead: '', core: '3 beehives', trail: '' });
  });

  test('whitespace-only value -> empty core', () => {
    expect(splitEdges('   ')).toEqual({ lead: '   ', core: '', trail: '' });
  });

  test('punctuation-only value -> empty core, edges preserved', () => {
    expect(splitEdges(':')).toEqual({ lead: ':', core: '', trail: '' });
    expect(splitEdges(' - ')).toEqual({ lead: ' - ', core: '', trail: '' });
  });

  test('quotes/brackets as edges', () => {
    expect(splitEdges('«word»')).toEqual({ lead: '«', core: 'word', trail: '»' });
  });

  test('null-safe', () => {
    expect(splitEdges(null)).toEqual({ lead: '', core: '', trail: '' });
    expect(splitEdges(undefined)).toEqual({ lead: '', core: '', trail: '' });
    expect(splitEdges('')).toEqual({ lead: '', core: '', trail: '' });
  });

  test('round-trip: lead + core + trail reconstructs the original', () => {
    for (const v of [': Choose hives.', ' plain ', 'word', '  ', '«café»!', ':', 'Selección 123']) {
      const { lead, core, trail } = splitEdges(v);
      expect(lead + core + trail).toBe(v);
    }
  });
});
