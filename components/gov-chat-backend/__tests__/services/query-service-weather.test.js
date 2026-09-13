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
const { isWeatherCommand, withWeatherContext } = _weather;

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
    expect(out.messages.endsWith('not listed above.')).toBe(true);
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
