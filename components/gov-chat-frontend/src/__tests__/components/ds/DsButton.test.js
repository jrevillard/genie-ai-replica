import { mount } from '@vue/test-utils';
import DsButton from '@/components/ds/Button.vue';

const mountButton = (props = {}, slotContent = 'Click me') => {
  return mount(DsButton, {
    props,
    slots: { default: slotContent }
  });
};

describe('DsButton', () => {
  describe('AC1: Variants', () => {
    it('renders primary variant with correct class', () => {
      const wrapper = mountButton({ variant: 'primary' });
      expect(wrapper.classes()).toContain('ds-btn--primary');
    });

    it('renders secondary variant with correct class', () => {
      const wrapper = mountButton({ variant: 'secondary' });
      expect(wrapper.classes()).toContain('ds-btn--secondary');
    });

    it('renders ghost variant with correct class', () => {
      const wrapper = mountButton({ variant: 'ghost' });
      expect(wrapper.classes()).toContain('ds-btn--ghost');
    });

    it('renders danger variant with correct class', () => {
      const wrapper = mountButton({ variant: 'danger' });
      expect(wrapper.classes()).toContain('ds-btn--danger');
    });

    it('defaults to secondary variant', () => {
      const wrapper = mountButton();
      expect(wrapper.classes()).toContain('ds-btn--secondary');
    });
  });

  describe('Props', () => {
    it('renders as button tag by default', () => {
      const wrapper = mountButton();
      expect(wrapper.element.tagName).toBe('BUTTON');
    });

    it('renders as anchor when tag is "a"', () => {
      const wrapper = mountButton({ tag: 'a' });
      expect(wrapper.element.tagName).toBe('A');
    });

    it('applies small class when small prop is true', () => {
      const wrapper = mountButton({ small: true });
      expect(wrapper.classes()).toContain('ds-btn--sm');
    });

    it('does not apply small class by default', () => {
      const wrapper = mountButton();
      expect(wrapper.classes()).not.toContain('ds-btn--sm');
    });

    it('sets disabled attribute on button tag', () => {
      const wrapper = mountButton({ disabled: true });
      expect(wrapper.element.disabled).toBe(true);
    });

    it('does not set disabled attribute on non-button tags', () => {
      const wrapper = mountButton({ tag: 'a', disabled: true });
      expect(wrapper.attributes('disabled')).toBeUndefined();
    });
  });

  describe('Click emission', () => {
    it('emits click when not disabled', async () => {
      const wrapper = mountButton();
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('does not emit click when disabled', async () => {
      const wrapper = mountButton({ disabled: true });
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeUndefined();
    });

    it('does not emit click when disabled on anchor tag', async () => {
      const wrapper = mountButton({ tag: 'a', disabled: true });
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeUndefined();
    });
  });

  describe('Slot rendering', () => {
    it('renders default slot content', () => {
      const wrapper = mountButton({}, 'Hello World');
      expect(wrapper.text()).toBe('Hello World');
    });

    it('renders complex slot content', () => {
      const wrapper = mount(DsButton, {
        slots: {
          default: '<span class="icon">+</span> Add'
        }
      });
      expect(wrapper.find('.icon').exists()).toBe(true);
      expect(wrapper.text()).toContain('Add');
    });
  });
});
