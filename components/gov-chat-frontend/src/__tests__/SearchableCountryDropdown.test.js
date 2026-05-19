'use strict';

const { mount } = require('@vue/test-utils');
const SearchableCountryDropdown = require('@/components/SearchableCountryDropdown.vue').default;

// Mock i18n
const mockT = jest.fn((key) => key);
const mockTe = jest.fn(() => false);

function createWrapper(props = {}) {
  return mount(SearchableCountryDropdown, {
    props: {
      modelValue: '',
      placeholder: 'Select a country',
      searchPlaceholder: 'Search...',
      noResultsText: 'No results',
      ...props
    },
    global: {
      mocks: {
        $i18n: { t: mockT, te: mockTe, locale: 'en' },
        $t: mockT,
        $te: mockTe
      }
    }
  });
}

describe('SearchableCountryDropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('v-model support (modelValue prop)', () => {
    it('should declare modelValue prop', () => {
      const wrapper = createWrapper({ modelValue: 'FR' });
      expect(wrapper.props('modelValue')).toBe('FR');
    });

    it('should emit update:modelValue when a country is selected', async () => {
      const wrapper = createWrapper();

      const combobox = wrapper.findComponent({ name: 'DsCombobox' });
      expect(combobox.exists()).toBe(true);
      combobox.vm.$emit('update:modelValue', 'FR');

      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['FR']);
    });

    it('should update parent value through v-model on selection', async () => {
      const wrapper = createWrapper();
      const combobox = wrapper.findComponent({ name: 'DsCombobox' });
      combobox.vm.$emit('update:modelValue', 'DE');

      await wrapper.vm.$nextTick();

      const emitted = wrapper.emitted('update:modelValue');
      expect(emitted).toHaveLength(1);
      expect(emitted[0][0]).toBe('DE');
    });

    it('should also emit change event for backward compatibility', async () => {
      const wrapper = createWrapper();
      const combobox = wrapper.findComponent({ name: 'DsCombobox' });
      combobox.vm.$emit('update:modelValue', 'US');

      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('change')).toBeTruthy();
      expect(wrapper.emitted('change')[0]).toEqual(['US']);
    });

    it('should emit update:name with country name on selection', async () => {
      const wrapper = createWrapper();
      const combobox = wrapper.findComponent({ name: 'DsCombobox' });
      combobox.vm.$emit('update:modelValue', 'FR');

      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:name')).toBeTruthy();
      expect(wrapper.emitted('update:name')[0][0]).toBe('France');
    });
  });

  describe('display value reactivity', () => {
    it('should reflect modelValue changes in display', async () => {
      const wrapper = createWrapper({ modelValue: 'FR' });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayCode).toBe('France');
    });

    it('should return empty display for empty modelValue', async () => {
      const wrapper = createWrapper({ modelValue: '' });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayCode).toBe('');
    });
  });
});
