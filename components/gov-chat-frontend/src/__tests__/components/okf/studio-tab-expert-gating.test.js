'use strict';

/**
 * W2 (David, 2026-11-12): Basic shows the swimlane board ONLY — the
 * Retrieval Posture card and the Conformance Debt panel are EXPERT surfaces,
 * arriving with the subject-area filter and search. The rig's real Vuex
 * store drives isExpert; the dashboard stays mounted in BOTH modes (the
 * lanes are never mode-gated).
 */

const { buildStore, mountTab } = require('../../helpers/studioTab');

const findCard = (wrapper) => wrapper.findComponent({ name: 'OkfRetrievalCard' });
const findDebt = (wrapper) => wrapper.findComponent({ name: 'OkfConformanceDebtPanel' });
const findDashboard = (wrapper) => wrapper.findComponent({ name: 'OkfStudioDashboard' });

describe('StudioTab Basic/Expert gating (W2)', () => {
  test('Basic mode: no posture card, no debt panel, dashboard present', async () => {
    const { store } = buildStore();
    store.commit('okf/setExpertMode', false);
    const wrapper = mountTab(store);
    await wrapper.vm.$nextTick();
    expect(findCard(wrapper).exists()).toBe(false);
    expect(findDebt(wrapper).exists()).toBe(false);
    expect(findDashboard(wrapper).exists()).toBe(true);
    wrapper.unmount();
  });

  test('Expert mode: posture card and debt panel arrive, dashboard stays', async () => {
    const { store } = buildStore();
    store.commit('okf/setExpertMode', true);
    const wrapper = mountTab(store);
    await wrapper.vm.$nextTick();
    expect(findCard(wrapper).exists()).toBe(true);
    expect(findDebt(wrapper).exists()).toBe(true);
    expect(findDashboard(wrapper).exists()).toBe(true);
    wrapper.unmount();
  });

  test('flipping to Basic mid-session removes them without unmounting the board', async () => {
    const { store } = buildStore();
    store.commit('okf/setExpertMode', true);
    const wrapper = mountTab(store);
    await wrapper.vm.$nextTick();
    expect(findCard(wrapper).exists()).toBe(true);
    store.commit('okf/setExpertMode', false);
    await wrapper.vm.$nextTick();
    expect(findCard(wrapper).exists()).toBe(false);
    expect(findDebt(wrapper).exists()).toBe(false);
    expect(findDashboard(wrapper).exists()).toBe(true);
    wrapper.unmount();
  });
});
