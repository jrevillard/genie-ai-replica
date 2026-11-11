'use strict';

import { mount } from '@vue/test-utils';
import AdminStatePanel from '../../../components/admin/AdminStatePanel.vue';

describe('AdminStatePanel', () => {
  it('renders an error state; the panel handle rides plain attr fallthrough', () => {
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'error',
        message: 'System health is unavailable right now.'
      },
      attrs: {
        'data-test-id': 'health-error'
      }
    });

    // Single-root fallthrough carries the caller's data-test-id to the
    // rendered .ds-state div — the codebase-wide handle spelling, no
    // wrapper prop in between.
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

  it('renders a retryable button even without a test id (the id is passive)', () => {
    // The contract inversion guard: a future call site that forgets
    // retry-test-id still gets a working Retry button — with the
    // dashboard-wide default label from the mixin.
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'error',
        message: 'Database statistics are unavailable right now.',
        retryable: true
      }
    });

    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('Retry'); // translateMixin's fallback, no i18n needed
    expect(button.attributes('data-test-id')).toBeUndefined();
  });

  it('renders the loading state as the primitive itself', () => {
    // No stubs here: the REAL DsStateDisplay renders, so the type class
    // contract is pinned exactly as the browser sees it.
    const wrapper = mount(AdminStatePanel, {
      props: {
        type: 'loading',
        message: 'Measuring…'
      }
    });

    expect(wrapper.find('.ds-state--loading').exists()).toBe(true);
    expect(wrapper.text()).toContain('Measuring…');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
