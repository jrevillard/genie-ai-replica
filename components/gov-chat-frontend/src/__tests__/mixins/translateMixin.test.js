/**
 * Unit tests for the translateMixin. The mixin exposes `translate(key, fallback)`
 * to any Options API component that imports it; it must:
 *  - return the translation when $i18n resolves the key
 *  - return the fallback when the key is missing OR when $i18n is unavailable
 *  - never throw (even when $i18n.t itself throws)
 *
 * The mixin was introduced because every OKF component referenced `translate`
 * in templates/methods but only `AdminDashboard.vue` defined the method —
 * Vue 3's child render scope resolves identifiers against the child's own
 * instance, so the parent's method was unreachable (TypeError: e.translate is
 * not a function). See `mixins/translateMixin.js`.
 */
import translateMixin from '../../mixins/translateMixin';

function makeHarness(i18nMock) {
  // The mixin only needs `this.$i18n`. We stub the rest of the Vue instance.
  return {
    ...translateMixin.methods,
    $i18n: i18nMock
  };
}

describe('translateMixin', () => {
  it('returns the translated string when $i18n resolves the key', () => {
    const harness = makeHarness({
      locale: 'en',
      t: jest.fn().mockReturnValue('OKF Studio')
    });
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('OKF Studio');
    expect(harness.$i18n.t).toHaveBeenCalledWith('okf.studio.title', { locale: 'en' });
  });

  it('passes the active locale so reactive locale changes propagate', () => {
    const harness = makeHarness({
      locale: 'fr',
      t: jest.fn().mockReturnValue('Studio OKF')
    });
    harness.translate('okf.studio.title', 'OKF Studio');
    expect(harness.$i18n.t).toHaveBeenCalledWith('okf.studio.title', { locale: 'fr' });
  });

  it('returns the fallback when the key is missing (i18n echoes the key back)', () => {
    const harness = makeHarness({
      locale: 'en',
      t: jest.fn().mockImplementation((key) => key)
    });
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('OKF Studio');
  });

  it('returns the fallback when $i18n is missing (e.g. unit-test context)', () => {
    const harness = makeHarness(null);
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('OKF Studio');
  });

  it('returns the key as last resort when both i18n AND fallback are missing', () => {
    const harness = makeHarness(null);
    expect(harness.translate('okf.studio.title')).toBe('okf.studio.title');
  });

  it('never throws — catches and logs i18n errors then returns the fallback', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const harness = makeHarness({
      locale: 'en',
      t: jest.fn().mockImplementation(() => {
        throw new Error('i18n blew up');
      })
    });
    expect(harness.translate('okf.studio.title', 'OKF Studio')).toBe('OKF Studio');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns the key when the key is missing AND no fallback supplied', () => {
    const harness = makeHarness({
      locale: 'en',
      t: jest.fn().mockImplementation((key) => key)
    });
    expect(harness.translate('okf.studio.title')).toBe('okf.studio.title');
  });
});
