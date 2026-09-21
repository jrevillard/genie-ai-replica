'use strict';

/**
 * Weather-aware advisor helpers in query-service.js: which messages are
 * commands for weather-mcp-service, and how the live context block is attached
 * to the OPEA payload. The routing decision itself has no LLM in it, so these
 * are pure functions.
 */

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);
jest.mock('../../shared-lib/validation-utils', () => require('../mocks/shared-lib'), { virtual: true });
jest.mock('arangojs', () => ({ aql: (strings, ...values) => ({ _aql: true, strings, values }) }));
jest.mock('worker_threads', () => ({ Worker: jest.fn() }));
jest.mock('path', () => ({ join: jest.fn((...parts) => parts.join('/')) }));

const { _weather } = require('../../services/query-service');
const { isWeatherCommand, weatherCommandKind, ensureCommandKeyword, withWeatherContext, withEnglishQuestion } =
  _weather;

describe('isWeatherCommand', () => {
  const previous = process.env.WEATHER_ENABLED;
  beforeEach(() => {
    process.env.WEATHER_ENABLED = 'true';
  });
  afterAll(() => {
    process.env.WEATHER_ENABLED = previous;
  });

  it('is off entirely when the weather profile is disabled', () => {
    process.env.WEATHER_ENABLED = 'false';
    expect(isWeatherCommand('delineate my field near Dhaka')).toBe(false);
  });

  it.each([
    'delineate my field near Dhaka',
    'map my fields',
    'Map my farm please',
    'show my fields on the map',
    'field map for Naogaon',
    'outline my fields',
    'show field boundaries around Bogra',
    'run flood detection for Sylhet',
    'show the flood map for Khulna',
    'show me the national agromet bulletin'
  ])('treats "%s" as a command', (message) => {
    expect(isWeatherCommand(message)).toBe(true);
  });

  it.each([
    'Will it rain in Dhaka tomorrow?',
    'Is potato suitable given the current weather forecast?',
    'When should I plant potato this year?',
    'Is there a risk of flooding after the expected rainfall?',
    'Is there a drought warning for Dhaka?'
  ])('leaves the question "%s" to the LLM', (message) => {
    expect(isWeatherCommand(message)).toBe(false);
  });

  it.each([
    ['আমার জমির সীমানা দেখাও', 'delineate'],
    ['আমার জমি ম্যাপ করো', 'delineate'],
    ['আমার জমিগুলো মানচিত্রে দেখাও', 'delineate'],
    ['ক্ষেতগুলোর ম্যাপ চাই', 'delineate'],
    ['ম্যাপ করুন আমার খেত', 'delineate'],
    ['amar jomi map koro', 'delineate'],
    ['amar jomi gulo map koro', 'delineate'],
    ['khet gulo map dekhan', 'delineate'],
    ['বন্যা এলাকা দেখাও', 'flood'],
    ['ক্ষেতের মানচিত্র দেখান', 'delineate'],
    ['amar jomir simana dekhao', 'delineate'],
    ['kheter map dekhan', 'delineate'],
    ['বন্যার মানচিত্র দেখাও', 'flood'],
    ['bonnar map dekhao', 'flood'],
    ['কৃষি আবহাওয়া বুলেটিন দেখান', 'bulletin']
  ])('recognises the Bengali/Banglish command "%s" as %s', (message, kind) => {
    expect(weatherCommandKind(message)).toBe(kind);
    expect(isWeatherCommand(message)).toBe(true);
  });

  it.each(['আগামীকাল বৃষ্টি হবে কি?', 'আমার এলাকায় খরার অবস্থা কেমন?', 'abohawa kemon thakbe'])(
    'leaves the Bengali/Banglish question "%s" to the LLM',
    (message) => {
      expect(weatherCommandKind(message)).toBeNull();
    }
  );

  it('prefixes a canonical English command when the translation lacks the stem', () => {
    expect(ensureCommandKeyword('Draw the borders of my crops in Naogaon', 'delineate')).toBe(
      'Delineate field boundaries: Draw the borders of my crops in Naogaon'
    );
    expect(ensureCommandKeyword('delineate my field in Naogaon', 'delineate')).toBe('delineate my field in Naogaon');
    expect(ensureCommandKeyword('Where is the water in Sylhet', 'flood')).toBe(
      'Show the satellite flood map: Where is the water in Sylhet'
    );
  });

  it('matches at word starts only, so "suitable" is not "table"', () => {
    expect(isWeatherCommand('is the weather suitable for potato')).toBe(false);
  });
});

describe('withWeatherContext', () => {
  const context = 'Today is Sunday 13 September 2026.\n7-day forecast for Dhaka: ...';

  it('returns the payload unchanged when there is no context', () => {
    const payload = { messages: 'When should I plant potato?', stream: true };
    expect(withWeatherContext(payload, 'single-message', 'When should I plant potato?', '')).toBe(payload);
  });

  it('prepends the block to a single-message payload', () => {
    const payload = { messages: 'When should I plant potato?', stream: true };
    const out = withWeatherContext(payload, 'single-message', 'When should I plant potato?', context);
    expect(out.messages.startsWith('[Live weather and farm data')).toBe(true);
    expect(out.messages).toContain('Question: When should I plant potato?');
    expect(out.messages).toContain(context);
    expect(out.messages).toContain('do not state weather values that are not listed above.');
    expect(out.messages).toContain('🌡️ temperature, 🌧️ rain, 💨 wind, 💧 humidity and ⚠️ warnings');
    // The instruction is weighted most when it follows the question, not the data block.
    expect(out.messages.indexOf('Answer only this question')).toBeGreaterThan(
      out.messages.indexOf('Question: When should I plant potato?')
    );
    expect(out.stream).toBe(true);
    expect(payload.messages).toBe('When should I plant potato?');
  });

  it('prepends the block to the latest user turn only, leaving history intact', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'Should I irrigate today?' }
      ],
      context: { language: 'en' },
      stream: true
    };
    const out = withWeatherContext(payload, 'multi', 'Should I irrigate today?', context);
    expect(out.messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(out.messages[1]).toEqual({ role: 'assistant', content: 'hi' });
    expect(out.messages[2].content).toContain('[End of live data]');
    expect(out.messages[2].content).toContain('Question: Should I irrigate today?');
    expect(out.context).toEqual({ language: 'en' });
    expect(payload.messages[2].content).toBe('Should I irrigate today?');
  });
});

describe('withWeatherContext - sources citation line', () => {
  const context = 'Today is Sunday 13 September 2026.\n7-day forecast for Sapahar (Open-Meteo): ...';
  const payload = { messages: 'Will it rain tomorrow?', stream: true };

  it('tells the model the exact closing line built from the providers weather-mcp used', () => {
    const out = withWeatherContext(payload, 'single-message', 'Will it rain tomorrow?', context, ['Open-Meteo', 'BMD']);
    expect(out.messages).toContain('exactly: Sources: Open-Meteo, BMD.');
    expect(out.messages).toContain('For a question that is not about the weather, do not add that line.');
  });

  it('adds no citation instruction when weather-mcp reported no sources', () => {
    const out = withWeatherContext(payload, 'single-message', 'Will it rain tomorrow?', context, []);
    expect(out.messages).not.toContain('Sources:');
    // Fifth argument is optional: existing 4-arg callers behave the same.
    expect(withWeatherContext(payload, 'single-message', 'Will it rain tomorrow?', context).messages).toBe(
      out.messages
    );
  });
});

describe('withEnglishQuestion - Bengali questions reach chatqna in English', () => {
  const bn = 'আমার জেলায় এই সপ্তাহের আবহাওয়ার পূর্বাভাস কী?';
  const en = 'What is the weather forecast for this week in my district?';

  it('swaps the last user turn for the English text, keeps the Bengali under it, and labels the payload EN', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: bn },
        { role: 'assistant', content: '' }
      ],
      context: { categoryLabel: null, serviceLabels: [], language: 'BN' },
      stream: true
    };
    const { payload: out, question } = withEnglishQuestion(payload, 'conversation-with-context-labels', bn, en);
    expect(question).toBe(`${en}\n(Original question in Bengali: ${bn})`);
    expect(out.messages[2].content).toBe(question);
    expect(out.messages[3]).toEqual({ role: 'assistant', content: '' });
    expect(out.context).toEqual({ categoryLabel: null, serviceLabels: [], language: 'EN' });
    // The caller's payload (and the stored query built from it) is untouched.
    expect(payload.messages[2].content).toBe(bn);
    expect(payload.context.language).toBe('BN');
  });

  it('targets the same message withWeatherContext wraps, so the live data wraps the English question', () => {
    const payload = {
      messages: [
        { role: 'user', content: bn },
        { role: 'assistant', content: '' }
      ],
      context: { language: 'BN' },
      stream: true
    };
    const { payload: swapped, question } = withEnglishQuestion(payload, 'conversation-with-context-labels', bn, en);
    const out = withWeatherContext(swapped, 'conversation-with-context-labels', question, 'Today is Monday.', ['BMD']);
    expect(out.messages[0].content).toContain(`Question: ${en}`);
    expect(out.messages[0].content).toContain(bn);
    expect(out.context.language).toBe('EN');
  });

  it('handles single-message mode', () => {
    const { payload: out, question } = withEnglishQuestion({ messages: bn, stream: true }, 'single-message', bn, en);
    expect(out.messages).toBe(question);
    expect(out.context).toEqual({ language: 'EN' });
  });

  it('keeps the Bengali text when the routing translation failed, but still labels the payload EN', () => {
    // chatqna would otherwise re-run its capped history translation and empty the query.
    const payload = { messages: [{ role: 'user', content: bn }], context: { language: 'BN' } };
    const { payload: out, question } = withEnglishQuestion(payload, 'conversation-with-context-labels', bn, bn);
    expect(question).toBe(bn);
    expect(out.messages[0].content).toBe(bn);
    expect(out.context.language).toBe('EN');
  });

  it('labels an English preset prompt EN too, leaving the text alone (quick-help buttons under a Bengali UI)', () => {
    const preset = 'What is the weather forecast for this week in Sapahar?';
    const payload = { messages: [{ role: 'user', content: preset }], context: { language: 'BN' } };
    const { payload: out, question } = withEnglishQuestion(payload, 'conversation-with-context-labels', preset, preset);
    expect(question).toBe(preset);
    expect(out.messages[0].content).toBe(preset);
    expect(out.context.language).toBe('EN');
  });
});
