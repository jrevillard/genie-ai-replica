'use strict';

/**
 * #1056 — the DEGRADED-DRAFT NOTICE.
 *
 * The NOT_READY fallback used to be silent: when the draft endpoint is not
 * available in the session, saves stayed in memory and a refresh lost the
 * curation state, with nothing telling the curator. The notice lives on the
 * Studio TAB (not the wizard) because the latch is session-global and the
 * zip-import path lands on the dashboard without ever entering the wizard.
 *
 * The suite mounts with the REAL English catalogue, so the assertions cover
 * the copy that ships — and the last test pins the inline fallback to the
 * same sentence (the two sources of a string must not drift).
 */

const { buildStore, mountTab } = require('../../helpers/studioTab');
const { realI18nMessagesMock } = require('../../helpers/realI18n');
const en = require('@/i18n/locales/en.js').default;

beforeEach(() => {
  jest.clearAllMocks();
});

it('a healthy session renders NO degraded-draft notice', async () => {
  const { store } = buildStore();
  const wrapper = mountTab(store, { i18n: realI18nMessagesMock() });
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.okf-studio-tab__draft-notice').exists()).toBe(false);
  wrapper.unmount();
});

it('#1056: the NOT_READY latch surfaces the degraded-draft notice on the tab', async () => {
  const { store } = buildStore();
  const wrapper = mountTab(store, { i18n: realI18nMessagesMock() });
  await wrapper.vm.$nextTick();
  store.commit('okf/setDraftsUnavailable');
  await wrapper.vm.$nextTick();
  const notice = wrapper.find('.okf-studio-tab__draft-notice');
  expect(notice.exists()).toBe(true);
  // The SHIPPED English copy, not the inline fallback.
  expect(notice.text()).toBe(en.okf.studio.draft.notReady);
  wrapper.unmount();
});

it('#1056: the shipped notice states the consequence, not a reload, and names both stale parties', () => {
  // Drafts live in the Vuex store only — a reload clears them, so the copy
  // must state the consequence instead of advising the curator to reload. A
  // 404 alone cannot tell an older server from a stale page — the copy must
  // not assert the backend is the stale one. It must NOT blame the
  // repository either: the tab notice is the session-wide latch, and a gone
  // repo has its own repo-scoped message.
  expect(en.okf.studio.draft.notReady).not.toMatch(/reload the page/i);
  expect(en.okf.studio.draft.notReady).toMatch(/lost/i);
  expect(en.okf.studio.draft.notReady).toMatch(/may be out of sync/i);
  expect(en.okf.studio.draft.notReady).not.toMatch(/repository/i);
});

it('#1056: the inline fallback and the shipped copy say the same thing', async () => {
  // Two sources of one sentence: the locale catalogue (what ships) and the
  // component's inline default (what renders when the i18n tree is absent).
  // They drifted once already — the new copy landed under the WRONG key and
  // the shipped sentence never changed.
  const { store } = buildStore();
  const withI18n = mountTab(store, { i18n: realI18nMessagesMock() });
  await withI18n.vm.$nextTick();
  store.commit('okf/setDraftsUnavailable');
  await withI18n.vm.$nextTick();
  const { store: store2 } = buildStore();
  const withoutI18n = mountTab(store2);
  await withoutI18n.vm.$nextTick();
  store2.commit('okf/setDraftsUnavailable');
  await withoutI18n.vm.$nextTick();
  expect(withoutI18n.find('.okf-studio-tab__draft-notice').text()).toBe(
    withI18n.find('.okf-studio-tab__draft-notice').text()
  );
  withI18n.unmount();
  withoutI18n.unmount();
});
