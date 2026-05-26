import { mount } from '@vue/test-utils';
import DsSpinner from '@/components/ds/Spinner.vue';

describe('DsSpinner (AC9)', () => {
  describe('Sizes', () => {
    it('renders with md size class by default', () => {
      const wrapper = mount(DsSpinner);
      expect(wrapper.find('.ds-spinner').classes()).toContain('ds-spinner--md');
    });

    it('renders with sm size class', () => {
      const wrapper = mount(DsSpinner, { props: { size: 'sm' } });
      expect(wrapper.find('.ds-spinner').classes()).toContain('ds-spinner--sm');
    });

    it('renders with lg size class', () => {
      const wrapper = mount(DsSpinner, { props: { size: 'lg' } });
      expect(wrapper.find('.ds-spinner').classes()).toContain('ds-spinner--lg');
    });
  });

  describe('Overlay mode', () => {
    it('does not apply overlay class by default', () => {
      const wrapper = mount(DsSpinner);
      expect(wrapper.classes()).not.toContain('ds-spinner-wrapper--overlay');
      expect(wrapper.classes()).not.toContain('ds-spinner-wrapper--fixed');
    });

    it('applies overlay class when overlay is true', () => {
      const wrapper = mount(DsSpinner, { props: { overlay: true } });
      expect(wrapper.classes()).toContain('ds-spinner-wrapper--overlay');
    });

    it('applies fixed class when fixed is true', () => {
      const wrapper = mount(DsSpinner, { props: { fixed: true } });
      expect(wrapper.classes()).toContain('ds-spinner-wrapper--fixed');
    });

    it('sets min-height CSS variable in overlay mode', () => {
      const wrapper = mount(DsSpinner, { props: { overlay: true } });
      expect(wrapper.attributes('style')).toContain('--ds-spinner-min-height');
    });

    it('sets correct min-height for sm overlay', () => {
      const wrapper = mount(DsSpinner, { props: { overlay: true, size: 'sm' } });
      expect(wrapper.attributes('style')).toContain('100px');
    });

    it('sets correct min-height for lg overlay', () => {
      const wrapper = mount(DsSpinner, { props: { overlay: true, size: 'lg' } });
      expect(wrapper.attributes('style')).toContain('400px');
    });

    it('does not set style in non-overlay mode', () => {
      const wrapper = mount(DsSpinner);
      expect(wrapper.attributes('style')).toBeUndefined();
    });
  });

  it('renders slot content', () => {
    const wrapper = mount(DsSpinner, {
      slots: { default: '<span>Loading...</span>' }
    });
    expect(wrapper.text()).toContain('Loading...');
  });

  it('has wrapper class', () => {
    const wrapper = mount(DsSpinner);
    expect(wrapper.classes()).toContain('ds-spinner-wrapper');
  });
});
