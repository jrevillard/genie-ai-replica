'use strict';

import { mount } from '@vue/test-utils';
import AdminStatePanel from '../../../components/admin/AdminStatePanel.vue';

describe('AdminStatePanel', () => {
  it('renders an error state with the message and the test-id passthrough', () => {
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'error',
        message: 'System health is unavailable right now.',
        testId: 'health-error'
      }
    });

    expect(wrapper.find('[data-test-id="health-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('System health is unavailable right now.');
    // No retry affordance without retryTestId — the error is a dead end
    // unless the caller wires one.
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('renders the retry button with its own test-id and emits retry', async () => {
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'error',
        message: 'Security data is unavailable right now.',
        testId: 'security-error',
        retryTestId: 'security-retry',
        retryLabel: 'Retry'
      }
    });

    const button = wrapper.find('[data-test-id="security-retry"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('Retry');

    await button.trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('renders a loading state (no retry affordance)', () => {
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'loading',
        message: 'Measuring…'
      }
    });

    expect(wrapper.text()).toContain('Measuring…');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('rejects an unknown type', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mount(AdminStatePanel, {
      props: {
        type: 'spinner',
        message: 'x'
      }
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
