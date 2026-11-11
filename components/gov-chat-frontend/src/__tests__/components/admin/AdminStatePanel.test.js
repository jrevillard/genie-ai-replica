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
    // No retry affordance without `retryable` — the error is a dead end
    // unless the caller wires one. The WIRING prop is retryable; the test
    // id is a passive attribute and must never gate behavior.
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('renders the retry affordance from `retryable`, emitting retry on click', async () => {
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'error',
        message: 'Security data is unavailable right now.',
        testId: 'security-error',
        retryable: true,
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

  it('renders a retryable button even without a test id (the id is passive)', async () => {
    // The contract inversion guard: a future call site that forgets
    // retry-test-id still gets a working Retry button.
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'error',
        message: 'Database statistics are unavailable right now.',
        retryable: true,
        retryLabel: 'Retry'
      }
    });

    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('data-test-id')).toBeUndefined();

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
});
