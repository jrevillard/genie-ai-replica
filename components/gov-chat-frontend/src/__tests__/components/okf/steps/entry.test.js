'use strict';

/**
 * SUBJECT AREAS follow the Knowledge Hierarchy (David, 2026-09-04/05 — "in
 * the wizard and however else in the editor"): wizard step 1 (Entry) uses
 * the SAME shared okfRepoOps.loadSubjectAreaOptions loader as the dashboard
 * filter and create dialog. The old hard-coded DOMAINS list with its
 * 'transport' default is dead — an empty value forces an explicit choice,
 * and a legacy draft value stays selectable (domain is immutable
 * post-create: whatever the draft carries is what the repo is born with).
 */

const mockLoad = jest.fn();

jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: { loadSubjectAreaOptions: (...a) => mockLoad(...a) }
}));

const { mount } = require('@vue/test-utils');
const OkfStepEntry = require('@/components/okf/steps/Entry.vue').default;

const KH = [
  { value: 'Water Supply', label: 'Water Supply' },
  { value: 'Health Services', label: 'Health Services' }
];

function mountEntry(draft) {
  return mount(OkfStepEntry, {
    props: { draft: draft || null, expert: false },
    // DsFormGroup must NOT be stubbed — the DsSelect lives in its slot and a
    // stub swallows it. DsInput is slot-less, so stubbing it is safe.
    global: { stubs: { DsInput: true } }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('renders the KH options via the shared loader and forces an explicit choice', async () => {
  mockLoad.mockResolvedValue(KH);
  const wrapper = mountEntry(null);
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick(); // loader resolves → options render
  const opts = wrapper.findAll('option').map((o) => elementValue(o));
  expect(mockLoad).toHaveBeenCalledWith([]);
  expect(texts(wrapper)).toContain('Water Supply');
  expect(texts(wrapper)).toContain('Health Services');
  // the 'transport' default is DEAD: empty until the steward picks
  expect(wrapper.vm.local.domain).toBe('');
  expect(opts).toContain('');
});

it('a legacy draft domain stays selectable via the loader (immutable post-create)', async () => {
  mockLoad.mockImplementation(async (domains) => [...KH, { value: domains[0], label: domains[0] + ' (legacy)' }]);
  const wrapper = mountEntry({ name: 'Permits', domain: 'transport' });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  expect(mockLoad).toHaveBeenCalledWith(['transport']);
  expect(wrapper.vm.local.domain).toBe('transport'); // draft value kept, not reset
  expect(texts(wrapper)).toContain('transport (legacy)');
});

it('a KH-listed draft domain is kept as-is (no legacy duplicate)', async () => {
  mockLoad.mockResolvedValue(KH);
  const wrapper = mountEntry({ domain: 'Water Supply' });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  expect(mockLoad).toHaveBeenCalledWith(['Water Supply']);
  expect(wrapper.vm.local.domain).toBe('Water Supply');
  expect(texts(wrapper).filter((t) => t.includes('(legacy)'))).toEqual([]);
});

describe('Amendment A — A1 write-back / A2 gate / A3 create-on-advance', () => {
  function mountWithStore(draft, dispatchImpl) {
    const dispatch = jest.fn(dispatchImpl || (() => Promise.resolve({ ok: true })));
    const wrapper = mount(OkfStepEntry, {
      props: { draft: draft || null, expert: false },
      global: {
        stubs: { DsInput: true },
        mocks: { $store: { dispatch } }
      }
    });
    return { wrapper, dispatch };
  }

  it('emits gate=false when nothing is filled, gate=true once name + domain are set', async () => {
    mockLoad.mockResolvedValue(KH);
    const { wrapper } = mountWithStore(null);
    await wrapper.vm.$nextTick();
    const gates = wrapper.emitted('gate') || [];
    expect(gates[gates.length - 1]).toEqual([false]);
    wrapper.vm.local.name = 'Permits';
    wrapper.vm.local.domain = 'Water Supply';
    await wrapper.vm.$nextTick();
    const gates2 = wrapper.emitted('gate') || [];
    expect(gates2[gates2.length - 1]).toEqual([true]);
  });

  it('A1: selections write back to the draft via the update event', async () => {
    mockLoad.mockResolvedValue(KH);
    const draft = {};
    const { wrapper } = mountWithStore(draft);
    await wrapper.vm.$nextTick();
    wrapper.vm.local.name = 'Transport permits';
    wrapper.vm.local.domain = 'Water Supply';
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted('update') || [];
    const last = updates[updates.length - 1][0];
    expect(last).toMatchObject({ name: 'Transport permits', domain: 'Water Supply' });
  });

  it('A3: beforeAdvance CREATES the repo and writes the minted identity back', async () => {
    mockLoad.mockResolvedValue(KH);
    const { wrapper, dispatch } = mountWithStore(null, () =>
      Promise.resolve({ ok: true, repo: { repo_id: 'r-1', name: 'Permits', domain: 'Water Supply' } })
    );
    await wrapper.vm.$nextTick();
    wrapper.vm.local.name = 'Permits';
    wrapper.vm.local.domain = 'Water Supply';
    await wrapper.vm.$nextTick();
    const ok = await wrapper.vm.beforeAdvance();
    expect(ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('okf/createRepo', { name: 'Permits', domain: 'Water Supply' });
    const updates = wrapper.emitted('update') || [];
    expect(updates[updates.length - 1][0]).toMatchObject({ repo_id: 'r-1' });
  });

  it('A3: a DUPLICATE_REPO refusal BLOCKS the advance and surfaces the error', async () => {
    mockLoad.mockResolvedValue(KH);
    const { wrapper } = mountWithStore(null, () => Promise.resolve({ ok: false, code: 'DUPLICATE_REPO' }));
    await wrapper.vm.$nextTick();
    wrapper.vm.local.name = 'Permits';
    wrapper.vm.local.domain = 'Water Supply';
    await wrapper.vm.$nextTick();
    const ok = await wrapper.vm.beforeAdvance();
    expect(ok).toBe(false);
    expect(wrapper.text()).toMatch(/already exists/i);
  });

  it('A3 idempotency: a draft with a repo_id never creates again', async () => {
    mockLoad.mockResolvedValue(KH);
    const { wrapper, dispatch } = mountWithStore({ repo_id: 'r-exists', name: 'X', domain: 'Water Supply' });
    await wrapper.vm.$nextTick();
    const ok = await wrapper.vm.beforeAdvance();
    expect(ok).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('A2: an existing repo (repo_id present) gates OPEN from the start', async () => {
    mockLoad.mockResolvedValue(KH);
    const { wrapper } = mountWithStore({ repo_id: 'r-exists', name: 'X', domain: 'Water Supply' });
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.canAdvance).toBe(true);
    const gates = wrapper.emitted('gate') || [];
    expect(gates[gates.length - 1]).toEqual([true]);
  });
});

function texts(wrapper) {
  return wrapper.findAll('option').map((o) => o.text());
}

function elementValue(o) {
  return o.element && o.element.value !== undefined ? o.element.value : o.attributes().value;
}
