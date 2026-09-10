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

function texts(wrapper) {
  return wrapper.findAll('option').map((o) => o.text());
}

function elementValue(o) {
  return o.element && o.element.value !== undefined ? o.element.value : o.attributes().value;
}
