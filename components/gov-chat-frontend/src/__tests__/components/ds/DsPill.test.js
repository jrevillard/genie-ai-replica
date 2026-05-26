import { mount } from '@vue/test-utils';
import DsPill from '@/components/ds/Pill.vue';

describe('DsPill (AC8)', () => {
  it('renders accent variant by default', () => {
    const wrapper = mount(DsPill);
    expect(wrapper.classes()).toContain('ds-pill--accent');
  });

  it('renders success variant', () => {
    const wrapper = mount(DsPill, { props: { variant: 'success' } });
    expect(wrapper.classes()).toContain('ds-pill--success');
  });

  it('renders warning variant', () => {
    const wrapper = mount(DsPill, { props: { variant: 'warning' } });
    expect(wrapper.classes()).toContain('ds-pill--warning');
  });

  it('renders danger variant', () => {
    const wrapper = mount(DsPill, { props: { variant: 'danger' } });
    expect(wrapper.classes()).toContain('ds-pill--danger');
  });

  it('renders info variant', () => {
    const wrapper = mount(DsPill, { props: { variant: 'info' } });
    expect(wrapper.classes()).toContain('ds-pill--info');
  });

  it('renders slot content', () => {
    const wrapper = mount(DsPill, {
      slots: { default: 'Active' }
    });
    expect(wrapper.text()).toBe('Active');
  });

  it('has base ds-pill class', () => {
    const wrapper = mount(DsPill);
    expect(wrapper.classes()).toContain('ds-pill');
  });
});
