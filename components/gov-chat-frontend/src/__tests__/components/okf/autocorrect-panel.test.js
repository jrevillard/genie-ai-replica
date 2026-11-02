'use strict';

/**
 * AutocorrectPanel — #1037: autocorrectRepo returns warnings NESTED
 * ({concept_id, warnings:[{rule, severity, message}]}) but the panel rendered
 * the FLAT {concept_id, rule, message} shape — bare "id —" rows with no
 * message. The panel now flattens (tolerating both shapes) and renders
 * rule + message, with an info tip for the STALE_AFTER rules.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

const OkfAutocorrectPanel = require('@/components/okf/editor/AutocorrectPanel.vue').default;

function mountPanel(dryRunResult) {
  const store = new Vuex.Store({ modules: {} });
  store.dispatch = (type) => {
    if (type === 'okf/autocorrectRepo') return Promise.resolve(dryRunResult);
    return Promise.resolve({ ok: false });
  };
  // inline mode (the wizard surface): a plain card — the modal wrapper
  // teleports its content, invisible to wrapper.find().
  return mount(OkfAutocorrectPanel, {
    props: { visible: true, repoId: 'r1', inline: true },
    global: { plugins: [store] }
  });
}

const settle = async (w) => {
  await w.vm.$nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await w.vm.$nextTick();
};

describe('OkfAutocorrectPanel — warnings render (#1037)', () => {
  it('flattens the nested warnings envelope into rule + message rows', async () => {
    const w = mountPanel({
      ok: true,
      changes: [],
      warnings: [
        {
          concept_id: 'p7',
          warnings: [{ rule: 'STALE_AFTER_CLEARED', severity: 'warning', message: 'not a parseable date — cleared' }]
        }
      ]
    });
    await settle(w);
    const row = w.find('.okf-ac__warnings li');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('p7');
    expect(row.text()).toContain('STALE_AFTER_CLEARED: not a parseable date — cleared');
  });

  it('tolerates already-flat warning rows', async () => {
    const w = mountPanel({
      ok: true,
      changes: [],
      warnings: [{ concept_id: 'p2', rule: 'INVALID_STATUS', severity: 'warning', message: 'status "x" not in enum' }]
    });
    await settle(w);
    const row = w.find('.okf-ac__warnings li');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('INVALID_STATUS: status "x" not in enum');
  });

  it('shows the stale_after info tip only for STALE_AFTER rules', async () => {
    const w = mountPanel({
      ok: true,
      changes: [],
      warnings: [
        {
          concept_id: 'p7',
          warnings: [
            { rule: 'STALE_AFTER_CLEARED', severity: 'warning', message: 'not a parseable date — cleared' },
            { rule: 'INVALID_STATUS', severity: 'warning', message: 'bad status' }
          ]
        }
      ]
    });
    await settle(w);
    const rows = w.findAll('.okf-ac__warnings li');
    expect(rows.length).toBe(2);
    expect(rows[0].findComponent({ name: 'DsInfoTip' }).exists()).toBe(true);
    expect(rows[1].findComponent({ name: 'DsInfoTip' }).exists()).toBe(false);
  });

  it('renders no warnings block when the plan is clean', async () => {
    const w = mountPanel({ ok: true, changes: [], warnings: [] });
    await settle(w);
    expect(w.find('.okf-ac__warnings').exists()).toBe(false);
  });
});
