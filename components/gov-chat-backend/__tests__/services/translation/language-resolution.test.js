'use strict';

require('../../setup-env');

jest.mock(
  '../../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    ...jest.requireActual('../../../../shared/lib/validation-utils')
  }),
  { virtual: true }
);

const TranslationService = require('../../../services/translation-service');

// The service is a singleton: the tests put their own backend on it and
// restore it afterwards.
const realBackend = TranslationService.backend;
const realBackendType = TranslationService.backendType;
const realInitialized = TranslationService.initialized;

/**
 * A backend whose language map is under the test's control: the model
 * codes are deliberately different from the canonical ones ("fr" -> "fr_FR"),
 * so a log line that names the model code instead of the canonical one is
 * visible.
 */
function stubBackend({ codes = { en: 'en', fr: 'fr_FR' }, translate } = {}) {
  return {
    getLanguageCode: jest.fn((code) => (Object.prototype.hasOwnProperty.call(codes, code) ? codes[code] : null)),
    isLanguageSupported: jest.fn((code) => Object.prototype.hasOwnProperty.call(codes, code)),
    getFallbackLanguage: jest.fn(() => null),
    translate: translate || jest.fn().mockResolvedValue(['translated']),
    getBackendInfo: jest.fn(() => ({ model: 'stub-model', type: 'stub' }))
  };
}

function useBackend(backend) {
  TranslationService.backend = backend;
  TranslationService.backendType = 'stub';
  TranslationService.initialized = true;
}

beforeEach(() => {
  jest.clearAllMocks();
  useBackend(stubBackend());
});

afterEach(() => {
  TranslationService.backend = realBackend;
  TranslationService.backendType = realBackendType;
  TranslationService.initialized = realInitialized;
});

describe('the language pair is resolved once', () => {
  it('hands the model-specific codes to the caller', () => {
    useBackend(stubBackend());

    const pair = TranslationService.resolveLanguagePair('en', 'fr');

    expect(pair.sourceLang).toBe('en');
    expect(pair.targetLang).toBe('fr');
    expect(pair.sourceLangCode).toBe('en');
    expect(pair.targetLangCode).toBe('fr_FR');
  });
});

describe('the languages a log line names', () => {
  it('translate() logs the resolved languages, not the requested ones', async () => {
    const { logger } = require('../../../shared-lib');
    useBackend(stubBackend());

    await TranslationService.translate(['hello'], 'FR', 'FR');

    const line = logger.info.mock.calls.map((call) => call[0]).find((message) => message.includes('Translating'));
    expect(line).toContain('from fr');
    expect(line).toContain('to fr');
    expect(line).not.toContain('from FR');
  });

  it('a failed translation names the canonical language pair, not the requested one', async () => {
    const { logger } = require('../../../shared-lib');
    useBackend(
      stubBackend({
        translate: jest.fn().mockRejectedValue(new Error('model unreachable'))
      })
    );

    // "FR" and "fr" are one language: the log names the canonical form, so a
    // query written against it finds the line.
    await expect(TranslationService.translate(['hello'], 'FR', 'fr')).rejects.toThrow('model unreachable');

    const failure = logger.error.mock.calls.find((call) => call[0].includes('Translation failed'));
    expect(failure).toBeDefined();
    const context = failure[1];
    expect(context.sourceLang).toBe('fr');
    expect(context.targetLang).toBe('fr');
  });
});
