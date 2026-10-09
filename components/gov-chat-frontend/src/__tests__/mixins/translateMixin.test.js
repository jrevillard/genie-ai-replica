/**
 * Unit tests for the translateMixin. The mixin exposes `translate(key, fallback)`
 * to any Options API component that imports it; it must:
 *  - return the RAW locale string when the key resolves (interpolation
 *    placeholders intact — callers .replace('{x}') themselves)
 *  - fall back locale → 'en' → the fallback argument
 *  - never throw
 *
 * RAW lookup contract (2026-10-09): translate used to delegate to
 * $i18n.t(), whose message compiler renders {name} slots EMPTY when called
 * without params — the advisor scorecard displayed "positives / claimed ·
 * negatives / suppressed" live while jest (no $i18n → fallback verbatim)
 * stayed green. The mixin now walks the raw message tree instead; the
 * {'{'}-escape workaround in locale strings is no longer needed.
 */
import translateMixin from '../../mixins/translateMixin';

const TREE = {
  en: {
    okf: {
      studio: { title: 'OKF Studio' },
      headTest: {
        advisor: { scorecard: 'positives {p}/{pt} claimed · negatives {n}/{nt} suppressed' },
        suites: { tripwire: 'This cycle broke {n} positive tests' }
      }
    }
  },
  fr: {
    okf: {
      studio: { title: 'Studio OKF' }
      // advisor.* deliberately missing in fr → en fallback path
    }
  }
};

function makeHarness(i18nMock) {
  // The mixin only needs `this.$i18n`. We stub the rest of the Vue instance.
  return {
    ...translateMixin.methods,
    $i18n: i18nMock
  };
}

describe('translateMixin', () => {
  it('returns the RAW string from the active locale — placeholders intact (the scorecard regression)', () => {
    const harness = makeHarness({ locale: 'en', messages: TREE });
    expect(harness.translate('okf.headTest.advisor.scorecard', 'x')).toBe(
      'positives {p}/{pt} claimed · negatives {n}/{nt} suppressed'
    );
  });

  it('resolves the active locale (fr) from the message tree', () => {
    const harness = makeHarness({ locale: 'fr', messages: TREE });
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('Studio OKF');
  });

  it('falls back to the en tree when the active locale lacks the key', () => {
    const harness = makeHarness({ locale: 'fr', messages: TREE });
    expect(harness.translate('okf.headTest.advisor.scorecard', 'x')).toBe(
      'positives {p}/{pt} claimed · negatives {n}/{nt} suppressed'
    );
  });

  it('returns the fallback when the key is missing from every tree', () => {
    const harness = makeHarness({ locale: 'en', messages: TREE });
    expect(harness.translate('okf.studio.nope', 'OKF Studio')).toBe('OKF Studio');
  });

  it('returns the fallback when $i18n is missing (e.g. unit-test context)', () => {
    const harness = makeHarness(null);
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('OKF Studio');
  });

  it('returns the key as last resort when both i18n AND fallback are missing', () => {
    const harness = makeHarness(null);
    expect(harness.translate('okf.studio.title')).toBe('okf.studio.title');
  });

  it('never throws — catches and logs lookup errors then returns the fallback', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const harness = makeHarness({
      get locale() {
        throw new Error('i18n blew up');
      },
      messages: TREE
    });
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('OKF Studio');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
