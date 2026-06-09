import { mount } from '@vue/test-utils';
import DsInput from '@/components/ds/Input.vue';

const mountInput = (props = {}) => {
  return mount(DsInput, { props });
};

describe('DsInput', () => {
  describe('AC4: Sizes', () => {
    it('renders with default md size (no size class)', () => {
      const wrapper = mountInput();
      expect(wrapper.classes()).toContain('ds-input');
      expect(wrapper.classes()).not.toContain('ds-input--sm');
      expect(wrapper.classes()).not.toContain('ds-input--lg');
    });

    it('applies sm size class', () => {
      const wrapper = mountInput({ size: 'sm' });
      expect(wrapper.classes()).toContain('ds-input--sm');
    });

    it('applies lg size class', () => {
      const wrapper = mountInput({ size: 'lg' });
      expect(wrapper.classes()).toContain('ds-input--lg');
    });
  });

  describe('Textarea mode', () => {
    it('renders textarea element when type is textarea', () => {
      const wrapper = mountInput({ type: 'textarea' });
      expect(wrapper.element.tagName).toBe('TEXTAREA');
    });

    it('renders input element by default', () => {
      const wrapper = mountInput();
      expect(wrapper.element.tagName).toBe('INPUT');
    });

    it('sets rows attribute on textarea', () => {
      const wrapper = mountInput({ type: 'textarea', rows: 6 });
      expect(wrapper.element.getAttribute('rows')).toBe('6');
    });

    it('does not set type attribute on textarea', () => {
      const wrapper = mountInput({ type: 'textarea' });
      expect(wrapper.attributes('type')).toBeUndefined();
    });
  });

  describe('modelValue binding', () => {
    it('renders with modelValue as value', () => {
      const wrapper = mountInput({ modelValue: 'hello' });
      expect(wrapper.element.value).toBe('hello');
    });

    it('emits update:modelValue on input', async () => {
      const wrapper = mountInput({ modelValue: '' });
      await wrapper.setValue('new value');
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['new value']);
    });
  });

  describe('Disabled and readonly', () => {
    it('sets disabled attribute', () => {
      const wrapper = mountInput({ disabled: true });
      expect(wrapper.element.disabled).toBe(true);
    });

    it('sets readonly attribute', () => {
      const wrapper = mountInput({ readonly: true });
      expect(wrapper.element.readOnly).toBe(true);
    });

    it('is not disabled by default', () => {
      const wrapper = mountInput();
      expect(wrapper.element.disabled).toBe(false);
    });
  });

  describe('Events', () => {
    it('emits focus event', async () => {
      const wrapper = mountInput();
      await wrapper.trigger('focus');
      expect(wrapper.emitted('focus')).toHaveLength(1);
    });

    it('emits blur event', async () => {
      const wrapper = mountInput();
      await wrapper.trigger('blur');
      expect(wrapper.emitted('blur')).toHaveLength(1);
    });

    it('emits enter event on keyup.enter', async () => {
      const wrapper = mountInput();
      await wrapper.trigger('keyup.enter');
      expect(wrapper.emitted('enter')).toHaveLength(1);
    });
  });

  describe('Props', () => {
    it('sets placeholder', () => {
      const wrapper = mountInput({ placeholder: 'Enter text...' });
      expect(wrapper.attributes('placeholder')).toBe('Enter text...');
    });

    it('sets inputId', () => {
      const wrapper = mountInput({ inputId: 'my-input' });
      expect(wrapper.attributes('id')).toBe('my-input');
    });
  });
});
