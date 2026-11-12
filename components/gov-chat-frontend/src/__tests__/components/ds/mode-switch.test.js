'use strict';

/**
 * DsModeSwitch — the pills must READ as toggled (David, 2026-11-12): the
 * active side carries the --active class + aria-pressed, and the active
 * RULE paints the accent (accent-muted fill + accent ring) — the previous
 * surface+shadow treatment was invisible against the track.
 */

const fs = require('fs');
const path = require('path');
const { mount } = require('@vue/test-utils');
const DsModeSwitch = require('@/components/ds/ModeSwitch.vue').default;

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'components', 'ds', 'ModeSwitch.vue'), 'utf8');

describe('DsModeSwitch', () => {
  const mountSwitch = (mode) =>
    mount(DsModeSwitch, {
      props: { modelValue: mode, basicLabel: 'Basic', expertLabel: 'Expert' }
    });

  const activeButtons = (wrapper) => wrapper.findAll('.ds-mode-switch__btn--active');

  test('exactly one side is active in basic mode, with aria-pressed', () => {
    const wrapper = mountSwitch('basic');
    const active = activeButtons(wrapper);
    expect(active.length).toBe(1);
    expect(active[0].text()).toBe('Basic');
    expect(active[0].attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('.ds-mode-switch__btn')[1].attributes('aria-pressed')).toBe('false');
  });

  test('clicking Expert flips the active side', async () => {
    const wrapper = mountSwitch('basic');
    await wrapper.findAll('.ds-mode-switch__btn')[1].trigger('click');
    // The render binds the component's effective mode (localMode), so the
    // click alone flips the pills — no parent round-trip needed.
    expect(wrapper.emitted('update:modelValue')[0][0]).toBe('expert');
    const active = activeButtons(wrapper);
    expect(active.length).toBe(1);
    expect(active[0].text()).toBe('Expert');
  });

  test('the active rule paints the accent, not a surface shadow (the source contract)', () => {
    // jsdom computes no scoped-CSS paint, so the style contract is pinned at
    // the source: the --active rule must derive from the accent tokens —
    // --accent-muted fill + an accent ring — never the old surface+shadow.
    const rule = SOURCE.slice(SOURCE.indexOf('.ds-mode-switch__btn--active'));
    expect(rule).toContain('var(--accent-muted)');
    expect(rule).toContain('inset 0 0 0 1px var(--accent)');
    expect(rule).not.toContain('var(--shadow-sm)');
    expect(rule).not.toContain('background: var(--surface);');
  });
});
