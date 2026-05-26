import { mount } from '@vue/test-utils';
import DsFormGroup from '@/components/ds/FormGroup.vue';

describe('DsFormGroup (AC7)', () => {
  it('renders label text when label prop is provided', () => {
    const wrapper = mount(DsFormGroup, {
      props: { label: 'Email' }
    });
    expect(wrapper.find('.ds-form-group__label').text()).toBe('Email');
  });

  it('does not render label when no label prop and no label slot', () => {
    const wrapper = mount(DsFormGroup);
    expect(wrapper.find('.ds-form-group__label').exists()).toBe(false);
  });

  it('associates label with generated formGroupId via for attribute', () => {
    const wrapper = mount(DsFormGroup, {
      props: { label: 'Name' }
    });
    const label = wrapper.find('.ds-form-group__label');
    expect(label.attributes('for')).toBe(wrapper.vm.formGroupId);
  });

  it('uses inputId prop when provided instead of auto-generated ID', () => {
    const wrapper = mount(DsFormGroup, {
      props: { label: 'Name', inputId: 'custom-id' }
    });
    const label = wrapper.find('.ds-form-group__label');
    expect(label.attributes('for')).toBe('custom-id');
  });

  it('renders label slot content', () => {
    const wrapper = mount(DsFormGroup, {
      props: { label: 'Default' },
      slots: { label: '<span class="custom-label">Custom</span>' }
    });
    expect(wrapper.find('.custom-label').exists()).toBe(true);
    expect(wrapper.find('.custom-label').text()).toBe('Custom');
  });

  it('renders default slot', () => {
    const wrapper = mount(DsFormGroup, {
      slots: { default: '<input type="text" />' }
    });
    expect(wrapper.find('input').exists()).toBe(true);
  });

  it('provides formGroupId to children', () => {
    const wrapper = mount(DsFormGroup, {
      props: { inputId: 'test-id' }
    });
    expect(wrapper.vm.formGroupId).toBe('test-id');
  });
});
