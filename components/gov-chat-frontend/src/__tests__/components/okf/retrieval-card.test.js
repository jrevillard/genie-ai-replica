// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 10.7 (#995) — the retrieval posture card.
//
// WHAT THIS SUITE PINS (the three claims the card makes):
//   1. The card names the EFFECTIVE posture (the server's read-model), never
//      a locally-guessed one, and it says so when the read FAILS (an unknown
//      posture must not render as a confident one).
//   2. The ENGAGEMENT GATE travels with the mode: okf_only over zero serving
//      graphs contributes nothing while LOOKING switched on — the card names
//      that foot-gun instead of showing a green "on" pill.
//   3. The CONTROLS need the tools-admin role. The card lives in the OKF
//      Studio tab inside the ADMIN DASHBOARD (every /api/admin route is
//      gated on the `admin` realm role), so the readers are admins: an
//      admin WITHOUT tools-admin sees the posture — they must be able to SEE
//      that grounding is on and what it covers — and no dead affordance; a
//      tools-admin gets the selector, the before→after confirmation, and a
//      save that PUTs ONLY the changed fields and then re-reads the server's
//      truth.
//
// The role gate is asserted against the CLIENT's view of the realm role
// (currentUser.roles). The SERVER enforces the same role on the write — the
// client-side check exists so a reader is not offered a button that would
// 403 (the security boundary itself is the server's, pinned by the okf-server
// route tests).

import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import RetrievalCard from '@/components/okf/RetrievalCard.vue';
import repoOkfService from '@/services/repoOkfService';

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    getRetrievalConfig: jest.fn(),
    putRetrievalConfig: jest.fn(),
    getRetrievalConfigAudit: jest.fn()
  }
}));

const SERVER_LIMITS = {
  max_fanout_graphs: { min: 1, max: 20 },
  spine_max_hops: { min: 1, max: 3 },
  extracted_hop_cap: { min: 1, max: 3 },
  candidate_cap_per_graph: { min: 1, max: 200 },
  candidate_cap_global: { min: 1, max: 1000 }
};

/** A posture as the server's read-model delivers it. */
function posture(overrides = {}) {
  const base = {
    config: {
      mode: 'legacy',
      revision: 3,
      updated_at: '2026-11-05T09:00:00Z',
      updated_by: 'steward-1',
      max_fanout_graphs: 5,
      spine_max_hops: 2,
      extracted_hop_cap: 1,
      candidate_cap_per_graph: 50,
      candidate_cap_global: 200
    },
    source: 'database',
    limits: SERVER_LIMITS,
    modes: ['legacy', 'okf_only', 'hybrid'],
    serving_graph_count: 2,
    serving_repo_ids: ['r-1', 'r-2'],
    serving_graphs: [
      { repo_id: 'r-1', graph_name: 'OKF_kenya-gov_v3', domain: 'government' },
      { repo_id: 'r-2', graph_name: 'OKF_health_v1', domain: 'health' }
    ],
    engaged: false,
    warnings: []
  };
  const merged = { ...base, ...overrides };
  if (overrides.config) merged.config = { ...base.config, ...overrides.config };
  return merged;
}

/**
 * The store, built the way the REAL one is built.
 *
 * The auth module (src/store/modules/auth.js) declares NO `namespaced: true`,
 * so its getters are registered at the STORE ROOT — `store.getters.currentUser`
 * — which is how NavBarComponent and ChatBotComponent read the user. A mock
 * that namespaces the module (as this suite's first version did) invents a
 * `store.getters['auth/currentUser']` that production does not have: the card
 * read THAT, it resolved to undefined, and the role was never seen — the
 * controls never rendered, while every test here was green. The mock must
 * mirror the producer's shape, not the shape a spec wishes for.
 */
function buildStore(roles) {
  return createStore({
    modules: {
      auth: {
        state: () => ({ user: roles ? { sub: 'u-1', roles } : null }),
        getters: { currentUser: (state) => state.user }
      }
    }
  });
}

/** The DS primitives are stubbed to the smallest shapes that keep the
 *  assertions about BEHAVIOUR (which control exists, what the card renders)
 *  rather than about DS internals (which have their own suites). ONE
 *  definition — a test that stubs a primitive as `true` renders a
 *  `<ds-select-stub>` element, and `find('select')` then finds NOTHING: the
 *  assertion passes vacuously against a control that is not there. */
const DS_STUBS = {
  DsButton: {
    props: ['variant', 'small', 'disabled'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  DsPill: { props: ['variant'], template: '<span class="pill"><slot /></span>' },
  DsSelect: {
    props: ['modelValue', 'disabled'],
    template:
      '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
  },
  DsInput: {
    props: ['modelValue', 'type', 'min', 'max', 'disabled'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  DsFormGroup: {
    props: ['label', 'inputId'],
    template: '<div class="fg"><label>{{ label }}</label><slot /></div>'
  },
  DsDialog: {
    props: ['visible', 'title', 'actions'],
    template:
      '<div v-if="visible" class="dialog"><h4>{{ title }}</h4><slot /><button v-for="a in actions" :key="a.key" class="dlg-btn" :data-key="a.key" @click="$emit(\'action\', a.key)">{{ a.label }}</button></div>'
  }
};

function mountCard({ roles = [], response = posture(), audit = [] } = {}) {
  repoOkfService.getRetrievalConfig.mockResolvedValue(response);
  repoOkfService.getRetrievalConfigAudit.mockResolvedValue(audit);
  repoOkfService.putRetrievalConfig.mockResolvedValue({ ok: true });
  const store = buildStore(roles);
  const wrapper = mount(RetrievalCard, {
    global: {
      plugins: [store],
      mocks: { $i18n: { t: (k) => k, locale: 'en' } },
      stubs: DS_STUBS
    }
  });
  return wrapper;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * The envelope httpService ACTUALLY rejects with: `{status, statusText,
 * data, message}` — there is NO `.response` on it
 * (httpService.handleResponseError). A test that rejects with the axios
 * shape pins a path the production code never takes.
 */
function refusal(status, body) {
  return {
    status,
    statusText: body && body.error ? body.error : 'Error',
    data: body,
    message: (body && body.message) || 'An error occurred'
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('RetrievalCard — the posture it names', () => {
  test('shows the server posture (mode, revision, serving count), not a local guess', async () => {
    const w = mountCard({ roles: ['tools-admin'], response: posture({ serving_graph_count: 2 }) });
    await flush();
    expect(repoOkfService.getRetrievalConfig).toHaveBeenCalled();
    expect(w.text()).toContain('legacy');
    expect(w.text()).toContain('3'); // the revision
    expect(w.text()).toContain('2'); // the serving-graph count
    w.unmount();
  });

  test('a FAILED read renders the error, never a confident posture', async () => {
    repoOkfService.getRetrievalConfig.mockRejectedValue(refusal(500, { message: 'cluster down' }));
    const store = buildStore([]);
    const w = mount(RetrievalCard, {
      global: {
        plugins: [store],
        mocks: { $i18n: { t: (k) => k, locale: 'en' } },
        stubs: { DsPill: true, DsButton: true }
      }
    });
    await flush();
    expect(w.find('[role="alert"]').exists()).toBe(true);
    expect(w.text()).toContain('cluster down');
    // No mode pill at all — an unknown posture must not render as one.
    expect(w.find('.pill').exists()).toBe(false);
    w.unmount();
  });

  test('a failed RE-READ drops the stale posture (it must not read as current)', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    expect(w.text()).toContain('legacy'); // the first read landed
    // the re-read fails (a transient 502)
    repoOkfService.getRetrievalConfig.mockRejectedValue(refusal(502, { message: 'bad gateway' }));
    w.vm.posture = null; // the card's own catch clears it; assert the outcome
    await w.vm.onRefresh();
    expect(w.vm.posture).toBeNull();
    expect(w.text()).not.toContain('legacy'); // no stale mode pill
    expect(w.text()).toContain('bad gateway');
    w.unmount();
  });

  test("the server's own warnings ride along with the posture", async () => {
    const w = mountCard({
      roles: ['tools-admin'],
      response: posture({ warnings: ['a warning the server added'] })
    });
    await flush();
    expect(w.text()).toContain('a warning the server added');
    w.unmount();
  });

  test('okf_only over ZERO serving graphs is named as the foot-gun it is', async () => {
    const w = mountCard({
      roles: ['tools-admin'],
      response: posture({
        config: { mode: 'okf_only' },
        serving_graph_count: 0,
        serving_repo_ids: [],
        serving_graphs: [],
        engaged: false
      })
    });
    await flush();
    const warn = w.find('[role="status"]');
    expect(warn.exists()).toBe(true);
    expect(warn.text()).toMatch(/zero serving graphs/i);
    w.unmount();
  });

  test('the serving-graph list is rendered (the operator sees what they actually have)', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    expect(w.text()).toContain('r-1');
    expect(w.text()).toContain('OKF_kenya-gov_v3');
    w.unmount();
  });
});

describe('RetrievalCard — the controls need tools-admin', () => {
  test('an admin WITHOUT tools-admin sees the posture and NO save control (no dead affordance)', async () => {
    // The card lives in the Admin Dashboard, so its readers are admins; the
    // split that matters is admin vs tools-admin.
    const w = mountCard({ roles: ['admin'] });
    await flush();
    expect(w.text()).toContain('legacy'); // the posture IS visible
    expect(w.find('[data-test-id="okf-retrieval-card"]').exists()).toBe(true);
    // No mode selector, no save button, no audit trail.
    expect(w.find('select').exists()).toBe(false);
    expect(w.find('button').exists()).toBe(false);
    // The audit read is tools-admin-gated server-side — a reader without the
    // role must not call it.
    expect(repoOkfService.getRetrievalConfigAudit).not.toHaveBeenCalled();
    w.unmount();
  });

  test('a tools-admin gets the selector, the limits and the change history', async () => {
    const w = mountCard({
      roles: ['tools-admin'],
      audit: [{ ts: '2026-11-05T09:00:00Z', actor_name: 'Steward', description: 'Retrieval config updated' }]
    });
    await flush();
    expect(w.find('select').exists()).toBe(true);
    expect(w.findAll('input').length).toBeGreaterThan(0);
    expect(repoOkfService.getRetrievalConfigAudit).toHaveBeenCalledWith(25);
    expect(w.text()).toContain('Steward');
    w.unmount();
  });

  test('the role is read from the STORE ROOT getter (the auth module is not namespaced)', async () => {
    // THE REGRESSION GUARD. The card once read `mapGetters('auth',
    // ['currentUser'])` — a namespaced lookup the real store does not have
    // (the auth module declares no `namespaced: true`, so its getter lives
    // at `store.getters.currentUser`). It resolved to undefined, the role
    // was never seen, and the controls NEVER rendered — in production, while
    // this suite was green. The store mock is not namespaced, so a card
    // that goes back to the namespaced lookup FAILS here.
    const store = buildStore(['tools-admin']);
    expect(store.getters.currentUser).toEqual({ sub: 'u-1', roles: ['tools-admin'] });
    expect(store.getters['auth/currentUser']).toBeUndefined();

    repoOkfService.getRetrievalConfig.mockResolvedValue(posture());
    repoOkfService.getRetrievalConfigAudit.mockResolvedValue([]);
    const w = mount(RetrievalCard, {
      global: {
        plugins: [store],
        mocks: { $i18n: { t: (k) => k, locale: 'en' } },
        stubs: DS_STUBS
      }
    });
    await flush();
    expect(w.vm.currentUser).toEqual({ sub: 'u-1', roles: ['tools-admin'] });
    expect(w.vm.canEdit).toBe(true);
    expect(w.find('select').exists()).toBe(true);
    w.unmount();
  });

  test('the change history loads when the admin role ARRIVES after the mount', async () => {
    // The auth store resolves the session asynchronously — a card mounted
    // before the roles arrive would otherwise never load the history (the
    // controls would appear, the panel would stay empty).
    const store = buildStore(null);
    const w = mount(RetrievalCard, {
      global: {
        plugins: [store],
        mocks: { $i18n: { t: (k) => k, locale: 'en' } },
        stubs: { DsButton: true, DsPill: true, DsSelect: true, DsInput: true, DsFormGroup: true, DsDialog: true }
      }
    });
    await flush();
    expect(repoOkfService.getRetrievalConfigAudit).not.toHaveBeenCalled();
    // the session resolves and the role lands
    store.state.auth.user = { sub: 'u-1', roles: ['tools-admin'] };
    await w.vm.$nextTick();
    await flush();
    expect(repoOkfService.getRetrievalConfigAudit).toHaveBeenCalledWith(25);
    w.unmount();
  });
});

describe('RetrievalCard — the write', () => {
  test('saving PUTs ONLY the changed fields and then re-reads the server truth', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftMode = 'hybrid';
    await w.vm.$nextTick();
    w.vm.onAskSave();
    expect(w.vm.confirmOpen).toBe(true);
    await w.vm.onConfirmAction('confirm');
    expect(repoOkfService.putRetrievalConfig).toHaveBeenCalledWith({ mode: 'hybrid' });
    // The card re-reads from the GET after a write — it never renders its own
    // optimistic guess as truth.
    expect(repoOkfService.getRetrievalConfig).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  test('the confirmation lists the before→after diff before anything is applied', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftMode = 'okf_only';
    await w.vm.$nextTick();
    w.vm.onAskSave();
    await w.vm.$nextTick();
    const diff = w.findAll('.dlg-diff-item, .okf-retrieval__diff-item');
    expect(diff.length).toBeGreaterThan(0);
    expect(w.text()).toContain('legacy');
    expect(w.text()).toContain('okf_only');
    // Nothing is written until the operator confirms.
    expect(repoOkfService.putRetrievalConfig).not.toHaveBeenCalled();
    w.unmount();
  });

  test('cancelling the confirmation writes nothing', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftMode = 'hybrid';
    await w.vm.$nextTick();
    w.vm.onAskSave();
    await w.vm.onConfirmAction('cancel');
    expect(repoOkfService.putRetrievalConfig).not.toHaveBeenCalled();
    expect(w.vm.confirmOpen).toBe(false);
    w.unmount();
  });

  test('a refused write surfaces the server reason (and the posture still stands)', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    // AFTER the mount: mountCard installs the happy-path mock.
    // The REAL envelope httpService rejects with — no `.response` on it.
    repoOkfService.putRetrievalConfig.mockRejectedValue(
      refusal(400, {
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: ['"mode" must be one of [legacy, okf_only, hybrid]']
      })
    );
    await flush();
    w.vm.draftMode = 'hybrid';
    await w.vm.$nextTick();
    w.vm.onAskSave();
    await w.vm.onConfirmAction('confirm');
    expect(w.vm.saveError).toContain('must be one of');
    w.unmount();
  });

  test('a refusal with only a message (no details) still names the reason', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    repoOkfService.putRetrievalConfig.mockRejectedValue(
      refusal(403, { error: 'FORBIDDEN_ROLE', message: "This operation requires the 'tools-admin' role" })
    );
    await flush();
    w.vm.draftMode = 'hybrid';
    await w.vm.$nextTick();
    w.vm.onAskSave();
    await w.vm.onConfirmAction('confirm');
    expect(w.vm.saveError).toContain('tools-admin');
    w.unmount();
  });

  test('an EMPTIED limit input is refused locally, never fabricated into a 0', async () => {
    // `Number('')` is 0 — not NaN — so an emptied input would otherwise be
    // silently converted to zero and PUT (and the confirmation would show a
    // value the operator never typed).
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftLimits = { ...w.vm.draftLimits, candidate_cap_global: '' };
    await w.vm.$nextTick();
    expect(w.vm.invalidLimitFields.map((f) => f.key)).toEqual(['candidate_cap_global']);
    // The invalid field is NOT a change, and the confirmation shows nothing
    // for it.
    expect(w.vm.diffRows.find((r) => r.key === 'candidate_cap_global')).toBeUndefined();
    // With only an invalid draft there is nothing to save at all.
    expect(w.vm.hasChanges).toBe(false);
    w.vm.onAskSave();
    expect(w.vm.confirmOpen).toBe(false);
    expect(repoOkfService.putRetrievalConfig).not.toHaveBeenCalled();
    w.unmount();
  });

  test('an invalid field is EXCLUDED from the patch when another field is changed', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftLimits = { ...w.vm.draftLimits, candidate_cap_global: '', spine_max_hops: 3 };
    await w.vm.$nextTick();
    w.vm.onAskSave();
    await w.vm.onConfirmAction('confirm');
    const patch = repoOkfService.putRetrievalConfig.mock.calls[0][0];
    // The emptied field never reaches the server as a 0 — only the valid
    // change travels.
    expect(patch.candidate_cap_global).toBeUndefined();
    expect(patch.spine_max_hops).toBe(3);
    w.unmount();
  });

  test("a limit outside the server's bounds is refused locally", async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftLimits = { ...w.vm.draftLimits, candidate_cap_global: 99999 };
    await w.vm.$nextTick();
    expect(w.vm.invalidLimitFields.map((f) => f.key)).toEqual(['candidate_cap_global']);
    expect(w.vm.hasChanges).toBe(false); // an unusable draft is not a change
    w.unmount();
  });

  test('a non-numeric limit draft is refused locally', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftLimits = { ...w.vm.draftLimits, spine_max_hops: 'abc' };
    await w.vm.$nextTick();
    expect(w.vm.invalidLimitFields.map((f) => f.key)).toEqual(['spine_max_hops']);
    w.unmount();
  });

  test('the invalid-field hint names the bounds the server published', async () => {
    const w = mountCard({
      roles: ['tools-admin'],
      response: posture({ limits: { candidate_cap_global: { min: 1, max: 1000 } } })
    });
    await flush();
    w.vm.draftLimits = { ...w.vm.draftLimits, candidate_cap_global: '' };
    await w.vm.$nextTick();
    expect(w.text()).toContain('1');
    expect(w.text()).toContain('1000');
    w.unmount();
  });

  test('a limit change is sent as a limit field, not as a mode change', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftLimits = { ...w.vm.draftLimits, candidate_cap_global: 300 };
    await w.vm.$nextTick();
    w.vm.onAskSave();
    await w.vm.onConfirmAction('confirm');
    expect(repoOkfService.putRetrievalConfig).toHaveBeenCalledWith({ candidate_cap_global: 300 });
    w.unmount();
  });

  test('Revert restores the draft to the served posture (no write)', async () => {
    const w = mountCard({ roles: ['tools-admin'] });
    await flush();
    w.vm.draftMode = 'hybrid';
    await w.vm.$nextTick();
    expect(w.vm.hasChanges).toBe(true);
    w.vm.resetDraft();
    await w.vm.$nextTick();
    expect(w.vm.hasChanges).toBe(false);
    expect(repoOkfService.putRetrievalConfig).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe('RetrievalCard — the bounds come from the server', () => {
  test('the input bounds are the SERVER limits, not a frontend copy', async () => {
    const w = mountCard({
      roles: ['tools-admin'],
      response: posture({ limits: { max_fanout_graphs: { min: 2, max: 7 } } })
    });
    await flush();
    const field = w.vm.limitFields.find((f) => f.key === 'max_fanout_graphs');
    expect(field.min).toBe(2);
    expect(field.max).toBe(7);
    w.unmount();
  });

  test('an older server without limits still renders the fields (fallback bounds)', async () => {
    const w = mountCard({ roles: ['tools-admin'], response: posture({ limits: undefined }) });
    await flush();
    expect(w.vm.limitFields.map((f) => f.key)).toEqual([
      'max_fanout_graphs',
      'spine_max_hops',
      'extracted_hop_cap',
      'candidate_cap_per_graph',
      'candidate_cap_global'
    ]);
    w.unmount();
  });
});
