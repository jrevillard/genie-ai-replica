import { mount } from '@vue/test-utils';
import DsSelect from '@/components/ds/Select.vue';

const mountSelect = (props = {}, slots = {}) => {
  return mount(DsSelect, {
    props,
    slots,
    global: { provide: { formGroupId: 'test-form-group-id' } }
  });
};

describe('DsSelect', () => {
  describe('AC5: Sizes', () => {
    it('renders with default md size (no size class)', () => {
      const wrapper = mountSelect();
      expect(wrapper.classes()).toContain('ds-select');
      expect(wrapper.classes()).not.toContain('ds-select--sm');
      expect(wrapper.classes()).not.toContain('ds-select--lg');
    });

    it('applies sm size class', () => {
      const wrapper = mountSelect({ size: 'sm' });
      expect(wrapper.classes()).toContain('ds-select--sm');
    });

    it('applies lg size class', () => {
      const wrapper = mountSelect({ size: 'lg' });
      expect(wrapper.classes()).toContain('ds-select--lg');
    });
  });

  describe('modelValue binding', () => {
    it('sets value attribute from modelValue', () => {
      const wrapper = mountSelect({ modelValue: 'opt1' });
      expect(wrapper.attributes('value')).toBe('opt1');
    });

    it('emits update:modelValue on change', async () => {
      const wrapper = mountSelect({ modelValue: '' });
      await wrapper.setValue('opt1');
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['opt1']);
    });
  });

  describe('Placeholder', () => {
    it('renders placeholder option when provided', () => {
      const wrapper = mountSelect({ placeholder: 'Choose...' });
      const placeholderOption = wrapper.find('option[disabled]');
      expect(placeholderOption.exists()).toBe(true);
      expect(placeholderOption.text()).toBe('Choose...');
    });

    it('does not render placeholder option when not provided', () => {
      const wrapper = mountSelect();
      expect(wrapper.find('option[disabled]').exists()).toBe(false);
    });
  });

  describe('Disabled state', () => {
    it('sets disabled attribute', () => {
      const wrapper = mountSelect({ disabled: true });
      expect(wrapper.element.disabled).toBe(true);
    });

    it('is not disabled by default', () => {
      const wrapper = mountSelect();
      expect(wrapper.element.disabled).toBe(false);
    });
  });

  describe('Option rendering', () => {
    it('renders slot options', () => {
      const wrapper = mountSelect(
        {},
        {
          default:
            '<option value="a">Alpha</option><option value="b">Beta</option>'
        }
      );
      expect(wrapper.findAll('option')).toHaveLength(2);
      expect(wrapper.text()).toContain('Alpha');
      expect(wrapper.text()).toContain('Beta');
    });
  });

  describe('Props', () => {
    it('renders as select element', () => {
      const wrapper = mountSelect();
      expect(wrapper.element.tagName).toBe('SELECT');
    });

    it('sets inputId attribute', () => {
      const wrapper = mountSelect({ inputId: 'my-select' });
      expect(wrapper.attributes('id')).toBe('my-select');
    });
  });
});
