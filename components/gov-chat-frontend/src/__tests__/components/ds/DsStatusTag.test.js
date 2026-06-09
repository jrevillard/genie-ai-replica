import { mount } from '@vue/test-utils';
import DsStatusTag from '@/components/ds/StatusTag.vue';

describe('DsStatusTag (AC10)', () => {
  it('renders info variant by default', () => {
    const wrapper = mount(DsStatusTag);
    expect(wrapper.classes()).toContain('ds-status-tag--info');
  });

  it('renders success variant', () => {
    const wrapper = mount(DsStatusTag, { props: { variant: 'success' } });
    expect(wrapper.classes()).toContain('ds-status-tag--success');
  });

  it('renders error variant', () => {
    const wrapper = mount(DsStatusTag, { props: { variant: 'error' } });
    expect(wrapper.classes()).toContain('ds-status-tag--error');
  });

  it('renders warning variant', () => {
    const wrapper = mount(DsStatusTag, { props: { variant: 'warning' } });
    expect(wrapper.classes()).toContain('ds-status-tag--warning');
  });

  it('renders pending variant', () => {
    const wrapper = mount(DsStatusTag, { props: { variant: 'pending' } });
    expect(wrapper.classes()).toContain('ds-status-tag--pending');
  });

  it('renders slot content', () => {
    const wrapper = mount(DsStatusTag, {
      slots: { default: 'Completed' }
    });
    expect(wrapper.text()).toBe('Completed');
  });

  it('has base ds-status-tag class', () => {
    const wrapper = mount(DsStatusTag);
    expect(wrapper.classes()).toContain('ds-status-tag');
  });
});
