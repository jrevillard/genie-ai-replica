const { protectTokens, restoreTokens, createMarkerScrubber } = require('../../../services/translation/protect-tokens');

describe('protectTokens / restoreTokens', () => {
  test('shields the proper nouns the translator mangled in the flood answer, and restores them', () => {
    const en =
      '0.0% of the analyzed area is classified as flooded by the Prithvi-EO-2.0 model (IBM × NASA, Sen1Floods11).';
    const { text, tokens } = protectTokens(en);
    expect(tokens).toEqual(['Prithvi-EO-2.0', 'IBM', 'NASA', 'Sen1Floods11']);
    expect(text).toBe('0.0% of the analyzed area is classified as flooded by the ⟦0⟧ model (⟦1⟧ × ⟦2⟧, ⟦3⟧).');
    expect(restoreTokens('০.০% এলাকা ⟦0⟧ মডেল (⟦1⟧ × ⟦2⟧, ⟦3⟧) দ্বারা।', tokens)).toBe(
      '০.০% এলাকা Prithvi-EO-2.0 মডেল (IBM × NASA, Sen1Floods11) দ্বারা।'
    );
  });

  test('shields data-source names and acronyms (Open-Meteo, SEAS5, BMD, RH, BAMIS)', () => {
    expect(protectTokens('Sources: Open-Meteo, Copernicus SEAS5, BMD. RH above 95% per BAMIS.').tokens).toEqual([
      'Open-Meteo',
      'SEAS5',
      'BMD',
      'RH',
      'BAMIS'
    ]);
  });

  test('does NOT shield ordinary hyphenated English or unknown single capitalised words', () => {
    // "Monday" is capitalised but not a known place name: it must reach the
    // model so it gets translated. (Known districts ARE shielded - see below.)
    const { text, tokens } = protectTokens('Monday had cloud-free, well-drained soil today.');
    expect(tokens).toEqual([]);
    expect(text).toBe('Monday had cloud-free, well-drained soil today.');
  });

  test('leaves markdown link destinations untouched', () => {
    const en = '[View full drought report](/api/weather/drought-report/x.pdf)';
    const { text, tokens } = protectTokens(en);
    expect(text).toBe(en);
    expect(tokens).toEqual([]);
  });

  test('leaves plain numbers and percentages readable', () => {
    const { text, tokens } = protectTokens('Rain 14.1 mm, humidity 96%, temperature 31.2°C.');
    expect(tokens).toEqual([]);
    expect(text).toBe('Rain 14.1 mm, humidity 96%, temperature 31.2°C.');
  });

  test('restore is a no-op without tokens and drops an unknown placeholder cleanly', () => {
    expect(restoreTokens('abc', [])).toBe('abc');
    // A placeholder with no table entry can only be model noise: better a
    // missing word than a literal bracket in the farmer's answer.
    expect(restoreTokens('x ⟦7⟧ y', ['only'])).toBe('x y');
  });
});

describe('mangled-bracket markers (the model echoed \u27e70\u27e7 for \u27e60\u27e7)', () => {
  test('restoreTokens resolves a marker whose opener came back as a closing bracket', () => {
    expect(restoreTokens('\u27e70\u27e7-এ চাষ করা ফসল', ['Sapahar'], 'bn')).toBe('সাপাহার-এ চাষ করা ফসল');
    expect(restoreTokens('\u27e60\u27e6 x', ['Sapahar'], 'bn')).toBe('সাপাহার x');
  });

  test('stripUnresolved removes a mangled marker with no table entry', () => {
    const { stripUnresolved } = require('../../../services/translation/protect-tokens');
    expect(stripUnresolved('x \u27e75\u27e7 y')).toBe('x y');
    expect(stripUnresolved('x \u27e75 y')).toBe('x y');
  });

  test('the streaming scrubber holds back and then drops a mangled partial marker', () => {
    const { createMarkerScrubber } = require('../../../services/translation/protect-tokens');
    const out = [];
    const s = createMarkerScrubber((d) => out.push(d));
    s.push('আম \u27e7');
    s.push('0\u27e7 গাছ');
    s.flush();
    // The marker is gone and both words survive. Spacing across a delta
    // boundary is not tidied here (deltas are emitted as they arrive); the
    // batch path runs tidyGaps on the whole unit instead.
    const joined = out.join('');
    expect(joined).not.toMatch(/[\u27e6\u27e7]/);
    expect(joined.replace(/\s+/g, ' ')).toBe('আম গাছ');
  });
});

describe('protectTokens / restoreTokens - crop names', () => {
  test('shields the three crop names and restores the vetted Bengali spelling', () => {
    const { text, tokens } = protectTokens(
      '- 🥭 Mango: outside the season. - 🌾 Rice Aman: Grain Formation. - 🍆 Eggplant: Harvesting.'
    );
    expect(tokens).toEqual(['Mango', 'Rice Aman', 'Eggplant']);
    expect(text).toBe('- 🥭 ⟦0⟧: outside the season. - 🌾 ⟦1⟧: Grain Formation. - 🍆 ⟦2⟧: Harvesting.');
    expect(restoreTokens('🥭 ⟦0⟧: মৌসুমের বাইরে। 🌾 ⟦1⟧: শস্য গঠন। 🍆 ⟦2⟧: ফসল সংগ্রহ।', tokens, 'bn')).toBe(
      '🥭 আম: মৌসুমের বাইরে। 🌾 আমন ধান: শস্য গঠন। 🍆 বেগুন: ফসল সংগ্রহ।'
    );
  });

  test('does not shield lowercase common-noun uses (the word "rice" mid-sentence stays translatable)', () => {
    const { tokens } = protectTokens('the rice fields are wet and mango trees are bare');
    expect(tokens).toEqual([]);
  });
});

describe('stripUnresolved', () => {
  test('removes closed AND cut-off markers on the batch path, closing the gap they leave', () => {
    const { stripUnresolved } = require('../../../services/translation/protect-tokens');
    expect(stripUnresolved('x ⟦3⟧ y ⟦12 z')).toBe('x y z');
    expect(stripUnresolved('ধান ⟦0⟧, আম।')).toBe('ধান, আম।');
    expect(stripUnresolved('no markers here')).toBe('no markers here');
  });
});

describe('protectTokens / restoreTokens - place names', () => {
  test('shields a district after a dash and restores it in Bengali for a bn target', () => {
    const { text, tokens } = protectTokens('## Satellite Flood Analysis — Sapahar');
    expect(tokens).toEqual(['Sapahar']);
    expect(text).toBe('## Satellite Flood Analysis — ⟦0⟧');
    expect(restoreTokens('## স্যাটেলাইট বন্যা বিশ্লেষণ — ⟦0⟧', tokens, 'bn')).toBe(
      '## স্যাটেলাইট বন্যা বিশ্লেষণ — সাপাহার'
    );
  });

  test('restores the Latin name for non-Bengali targets and for unknown names', () => {
    const { tokens } = protectTokens('Weather in Naogaon');
    expect(restoreTokens('Clima en ⟦0⟧', tokens, 'es')).toBe('Clima en Naogaon');
    expect(restoreTokens('x ⟦0⟧', ['Prithvi-EO-2.0'], 'bn')).toBe('x Prithvi-EO-2.0');
  });

  test("prefers the longest place name (Cox's Bazar, not a prefix) and shields inside prose", () => {
    const { text, tokens } = protectTokens("Rain in Cox's Bazar and Dhaka today.");
    expect(tokens).toEqual(["Cox's Bazar", 'Dhaka']);
    expect(text).toBe('Rain in ⟦0⟧ and ⟦1⟧ today.');
  });
});

describe('unresolved placeholders never reach the user', () => {
  it('drops a marker the model invented for an index that has no token', () => {
    // Observed in production: the model emitted a bare ⟦0⟧ into a Bengali
    // forecast, and restoreTokens returned it verbatim.
    expect(restoreTokens('বৃষ্টি ⟦0⟧-এ ছয় দিনে হবে।', ['Sapahar'], 'bn')).toBe('বৃষ্টি সাপাহার-এ ছয় দিনে হবে।');
    expect(restoreTokens('বৃষ্টি ⟦3⟧-এ ছয় দিনে হবে।', ['Sapahar'], 'bn')).toBe('বৃষ্টি -এ ছয় দিনে হবে।');
  });

  it('tidies the gap a dropped marker leaves', () => {
    expect(restoreTokens('Rain in ⟦7⟧ today.', ['Dhaka'])).toBe('Rain in today.');
    expect(restoreTokens('Rain ⟦7⟧, today.', ['Dhaka'])).toBe('Rain, today.');
  });

  it('leaves resolvable markers alone', () => {
    expect(restoreTokens('Rain in ⟦0⟧ and ⟦1⟧ today.', ['Sapahar', 'Dhaka'])).toBe('Rain in Sapahar and Dhaka today.');
  });
});

describe('createMarkerScrubber', () => {
  const run = (deltas) => {
    const out = [];
    const scrub = createMarkerScrubber((d) => out.push(d));
    deltas.forEach(scrub.push);
    scrub.flush();
    return out.join('');
  };

  it('passes clean deltas through unchanged', () => {
    expect(run(['Rain ', 'in Sapahar ', 'today.'])).toBe('Rain in Sapahar today.');
  });

  it('drops a marker contained in one delta', () => {
    expect(run(['Rain ⟦0⟧', ' today.'])).toBe('Rain  today.');
  });

  it('drops a marker straddling two deltas', () => {
    expect(run(['Rain ⟦', '0⟧ today.'])).toBe('Rain  today.');
  });

  it('drops an unterminated marker at the end of the stream', () => {
    expect(run(['Rain ⟦1'])).toBe('Rain ');
  });

  it('does not hold back a lone bracket that is not a marker', () => {
    expect(run(['Rain ⟦x⟧ today.'])).toBe('Rain ⟦x⟧ today.');
  });
});
