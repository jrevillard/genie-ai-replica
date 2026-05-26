import { mount } from '@vue/test-utils';
import DsStateDisplay from '@/components/ds/StateDisplay.vue';

const mountState = (props = {}, slots = {}) => {
  return mount(DsStateDisplay, { props, slots });
};

describe('DsStateDisplay (AC12)', () => {
  describe('Empty state', () => {
    it('renders empty type by default', () => {
      const wrapper = mountState();
      expect(wrapper.classes()).toContain('ds-state--empty');
    });

    it('renders message text', () => {
      const wrapper = mountState({ message: 'Nothing here' });
      expect(wrapper.find('.ds-state__message').text()).toBe('Nothing here');
    });
  });

  describe('Loading state', () => {
    it('renders loading type', () => {
      const wrapper = mountState({ type: 'loading' });
      expect(wrapper.classes()).toContain('ds-state--loading');
    });
  });

  describe('Error state', () => {
    it('renders error type', () => {
      const wrapper = mountState({ type: 'error' });
      expect(wrapper.classes()).toContain('ds-state--error');
    });
  });

  describe('Message rendering', () => {
    it('does not render message element when no message or slot', () => {
      const wrapper = mountState();
      expect(wrapper.find('.ds-state__message').exists()).toBe(false);
    });

    it('renders message from prop', () => {
      const wrapper = mountState({ message: 'An error occurred' });
      expect(wrapper.find('.ds-state__message').text()).toBe('An error occurred');
    });

    it('renders default slot as message', () => {
      const wrapper = mountState({}, { default: 'Custom message' });
      expect(wrapper.find('.ds-state__message').text()).toBe('Custom message');
    });
  });

  describe('Icon slot', () => {
    it('renders icon slot when provided', () => {
      const wrapper = mountState({}, { icon: '<svg class="icon"></svg>' });
      expect(wrapper.find('.ds-state__icon').exists()).toBe(true);
      expect(wrapper.find('.icon').exists()).toBe(true);
    });

    it('does not render icon section when no icon slot or prop', () => {
      const wrapper = mountState();
      expect(wrapper.find('.ds-state__icon').exists()).toBe(false);
    });
  });

  describe('Action slot', () => {
    it('renders action slot when provided', () => {
      const wrapper = mountState({}, { action: '<button>Retry</button>' });
      expect(wrapper.find('.ds-state__action').exists()).toBe(true);
      expect(wrapper.find('.ds-state__action').text()).toBe('Retry');
    });

    it('does not render action section when no action slot', () => {
      const wrapper = mountState();
      expect(wrapper.find('.ds-state__action').exists()).toBe(false);
    });
  });

  it('has base ds-state class', () => {
    const wrapper = mountState();
    expect(wrapper.classes()).toContain('ds-state');
  });
});
