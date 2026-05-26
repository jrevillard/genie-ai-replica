'use strict';

const { mount } = require('@vue/test-utils');
const LanguageSelector = require('@/components/LanguageSelector.vue').default;

// Mock languageConfig
jest.mock('../../config/languageConfig', () => ({
  localeNames: {
    en: 'English',
    fr: 'French'
  }
}));

describe('LanguageSelector', () => {
  let wrapper;

  const stubs = {
    DsSelect: {
      template: '<select :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
      props: ['modelValue']
    }
  };

  const mockI18n = {
    locale: 'en',
    availableLocales: ['en', 'fr']
  };

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }

    // Clear localStorage after each test
    localStorage.clear();
  });

  describe('initial rendering', () => {
    test('renders with initial locale from $i18n', () => {
      wrapper = mount(LanguageSelector, {
        global: {
          stubs,
          mocks: {
            $i18n: mockI18n
          }
        }
      });

      expect(wrapper.vm.currentLocale).toBe('en');
      expect(wrapper.vm.localeNames).toEqual({
        en: 'English',
        fr: 'French'
      });
    });

    test('renders DsSelect with correct initial value', () => {
      wrapper = mount(LanguageSelector, {
        global: {
          stubs,
          mocks: {
            $i18n: mockI18n
          }
        }
      });

      const select = wrapper.find('select');
      expect(select.attributes().value).toBe('en');
    });

    test('renders options for all available locales', () => {
      wrapper = mount(LanguageSelector, {
        global: {
          stubs,
          mocks: {
            $i18n: mockI18n
          }
        }
      });

      const options = wrapper.findAll('option');
      expect(options.length).toBe(2);
      expect(options[0].text()).toBe('English');
      expect(options[1].text()).toBe('French');
    });
  });

  describe('watchers', () => {
    describe('$i18n.locale watcher', () => {
      test('initializes currentLocale from $i18n.locale', () => {
        const i18nMock = { ...mockI18n, locale: 'fr' };
        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: i18nMock
            }
          }
        });

        expect(wrapper.vm.currentLocale).toBe('fr');
      });
    });

    describe('currentLocale watcher', () => {
      test('updates $i18n.locale when currentLocale changes', async () => {
        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: { ...mockI18n }
            }
          }
        });

        expect(wrapper.vm.$i18n.locale).toBe('en');

        // Change currentLocale
        wrapper.vm.currentLocale = 'fr';
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.$i18n.locale).toBe('fr');
      });

      test('saves to localStorage when currentLocale changes', async () => {
        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: { ...mockI18n }
            }
          }
        });

        wrapper.vm.currentLocale = 'fr';
        await wrapper.vm.$nextTick();

        expect(localStorage.getItem('userLocale')).toBe('fr');
      });

      test('does not update $i18n.locale when newLocale is falsy', async () => {
        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: { ...mockI18n }
            }
          }
        });

        const originalLocale = wrapper.vm.$i18n.locale;

        wrapper.vm.currentLocale = '';
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.$i18n.locale).toBe(originalLocale);
      });

      test('does not update $i18n.locale when it is the same', async () => {
        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: { ...mockI18n }
            }
          }
        });

        // Clear localStorage first
        localStorage.clear();

        wrapper.vm.currentLocale = 'en';
        await wrapper.vm.$nextTick();

        // Should not save to localStorage since locale didn't change
        expect(localStorage.getItem('userLocale')).toBeNull();
      });

      test('handles localStorage errors silently', async () => {
        // Make localStorage.setItem throw an error
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = jest.fn(() => {
          throw new Error('localStorage is full');
        });

        // Suppress console.error for this test
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: { ...mockI18n }
            }
          }
        });

        // This should not throw an error
        expect(() => {
          wrapper.vm.currentLocale = 'fr';
        }).not.toThrow();

        // Restore original localStorage.setItem
        localStorage.setItem = originalSetItem;
        consoleSpy.mockRestore();
      });

      test('saves correct locale to localStorage on change', async () => {
        wrapper = mount(LanguageSelector, {
          global: {
            stubs,
            mocks: {
              $i18n: { ...mockI18n }
            }
          }
        });

        wrapper.vm.currentLocale = 'fr';
        await wrapper.vm.$nextTick();

        expect(localStorage.getItem('userLocale')).toBe('fr');
        expect(wrapper.vm.$i18n.locale).toBe('fr');
      });
    });
  });

  describe('data properties', () => {
    test('initializes currentLocale from $i18n.locale', () => {
      wrapper = mount(LanguageSelector, {
        global: {
          stubs,
          mocks: {
            $i18n: { ...mockI18n, locale: 'fr' }
          }
        }
      });

      expect(wrapper.vm.currentLocale).toBe('fr');
    });

    test('contains localeNames from languageConfig', () => {
      wrapper = mount(LanguageSelector, {
        global: {
          stubs,
          mocks: {
            $i18n: mockI18n
          }
        }
      });

      expect(wrapper.vm.localeNames).toEqual({
        en: 'English',
        fr: 'French'
      });
    });
  });

  describe('v-model binding', () => {
    test('updates currentLocale when select value changes', async () => {
      wrapper = mount(LanguageSelector, {
        global: {
          stubs,
          mocks: {
            $i18n: { ...mockI18n }
          }
        }
      });

      const select = wrapper.find('select');

      await select.setValue('fr');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentLocale).toBe('fr');
      expect(wrapper.vm.$i18n.locale).toBe('fr');
      expect(localStorage.getItem('userLocale')).toBe('fr');
    });
  });
});
