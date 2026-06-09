import { mount } from '@vue/test-utils';
import DsCard from '@/components/ds/Card.vue';

const mountCard = (props = {}, slots = {}) => {
  return mount(DsCard, { props, slots });
};

describe('DsCard', () => {
  describe('AC2: Variants', () => {
    it('renders default variant with correct class', () => {
      const wrapper = mountCard({ variant: 'default' });
      expect(wrapper.classes()).toContain('ds-card--default');
    });

    it('renders flat variant with correct class', () => {
      const wrapper = mountCard({ variant: 'flat' });
      expect(wrapper.classes()).toContain('ds-card--flat');
    });

    it('renders elevated variant with correct class', () => {
      const wrapper = mountCard({ variant: 'elevated' });
      expect(wrapper.classes()).toContain('ds-card--elevated');
    });

    it('renders outline variant with correct class', () => {
      const wrapper = mountCard({ variant: 'outline' });
      expect(wrapper.classes()).toContain('ds-card--outline');
    });

    it('defaults to default variant', () => {
      const wrapper = mountCard();
      expect(wrapper.classes()).toContain('ds-card--default');
    });
  });

  describe('Props', () => {
    it('applies padding class', () => {
      const wrapper = mountCard({ padding: 'lg' });
      expect(wrapper.classes()).toContain('ds-card--pad-lg');
    });

    it('defaults to md padding', () => {
      const wrapper = mountCard();
      expect(wrapper.classes()).toContain('ds-card--pad-md');
    });

    it('applies radius class', () => {
      const wrapper = mountCard({ radius: 'sm' });
      expect(wrapper.classes()).toContain('ds-card--radius-sm');
    });

    it('defaults to md radius', () => {
      const wrapper = mountCard();
      expect(wrapper.classes()).toContain('ds-card--radius-md');
    });

    it('applies hoverable class when hoverable is true', () => {
      const wrapper = mountCard({ hoverable: true });
      expect(wrapper.classes()).toContain('ds-card--hoverable');
    });

    it('does not apply hoverable class by default', () => {
      const wrapper = mountCard();
      expect(wrapper.classes()).not.toContain('ds-card--hoverable');
    });
  });

  describe('Slots', () => {
    it('renders default slot in card body', () => {
      const wrapper = mountCard({}, { default: 'Body content' });
      expect(wrapper.find('.ds-card__body').text()).toBe('Body content');
    });

    it('renders header slot when provided', () => {
      const wrapper = mountCard({}, { header: 'Header content' });
      expect(wrapper.find('.ds-card__header').exists()).toBe(true);
      expect(wrapper.find('.ds-card__header').text()).toBe('Header content');
    });

    it('does not render header section when no header slot', () => {
      const wrapper = mountCard({}, { default: 'Body only' });
      expect(wrapper.find('.ds-card__header').exists()).toBe(false);
    });
  });
});
