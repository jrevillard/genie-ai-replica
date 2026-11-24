'use strict';

/**
 * #2061 phase 4 (E-5) — the Evaluation Context SURFACES: the composer tab,
 * the picker, and the context id the Lab's calls carry.
 *
 * The gap these pin (David, 2026-11-24): the phase-1..3 engine was live and
 * unreachable — the Lab's dialog had no context affordance at all, so every
 * suite was minted against the whole deployment and every run measured the
 * deployment rather than a principal's scope. The operator's question ("does
 * this group's scope hold?") had no way to be asked.
 *
 * The contracts:
 *   1. the PICKER names a context (its id), and its label says what is
 *      about to be measured (name, version, reach);
 *   2. the COMPOSER composes GROUP memberships and can PREVIEW the
 *      resolution BEFORE the (immutable, undeletable) create;
 *   3. the head run carries the context id — the RED proof of the defect the
 *      party panel found: `headTestService.runSuite` posted NO BODY at all,
 *      so the server's binding was null and a context-bound suite could
 *      never be run from the UI (it answered 409 CROSS_CONTEXT_BLOCKED).
 */

const { mount } = require('@vue/test-utils');

jest.mock('@/services/evalContextService', () => ({
  __esModule: true,
  default: {
    listContexts: jest.fn(),
    getContext: jest.fn(),
    createContext: jest.fn(),
    refreshContext: jest.fn(),
    listGroups: jest.fn(),
    previewContext: jest.fn()
  }
}));
jest.mock('@/services/httpService', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() }
}));

const evalContextService = require('@/services/evalContextService').default;
const httpService = require('@/services/httpService').default;
const EvalContextPicker = require('@/components/okf/editor/EvalContextPicker.vue').default;
const EvalContextPanel = require('@/components/okf/editor/EvalContextPanel.vue').default;
const headTestService = require('@/services/headTestService').default;

// No $i18n in tests: the translateMixin returns the fallback — the English
// sentences below are what the assertions read.

const CONTEXTS = [
  {
    _key: 'ec-1',
    name: 'ministry-a readers',
    version: 2,
    principal_refs: ['group-a', 'group-b'],
    resolved: { repos: [{ repo_id: 'r-1' }, { repo_id: 'r-2' }] }
  }
];

const GROUPS = [
  { id: 'g-a', name: 'group-a', grants: ['okf:t:r-1:read'], members: ['alice'], privileged: false },
  { id: 'g-b', name: 'group-b', grants: ['okf:t:r-2:read'], members: ['bob'], privileged: false }
];

describe('#2061 E-5: the picker names the context a suite is minted for', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    evalContextService.listContexts.mockResolvedValue(CONTEXTS);
  });

  test('it offers the contexts and their reach, and emits the chosen id', async () => {
    const wrapper = mount(EvalContextPicker);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    const options = wrapper.findAll('option');
    const contextOption = options.find((o) => o.attributes('value') === 'ec-1');
    expect(contextOption).toBeTruthy();
    // The label says WHAT is about to be measured — name, version, reach.
    expect(contextOption.text()).toContain('ministry-a readers');
    expect(contextOption.text()).toContain('v2');
    expect(contextOption.text()).toContain('2');

    await wrapper.find('select').setValue('ec-1');
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['ec-1']);
  });

  test('a failed catalogue read says so instead of showing an empty list as if it were the truth', async () => {
    evalContextService.listContexts.mockRejectedValue({ data: { message: 'the catalogue is not readable' } });
    const wrapper = mount(EvalContextPicker);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('the catalogue is not readable');
  });
});

describe('#2061 E-5: the composer composes memberships and previews before it commits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    evalContextService.listContexts.mockResolvedValue(CONTEXTS);
    evalContextService.listGroups.mockResolvedValue(GROUPS);
    evalContextService.previewContext.mockResolvedValue({
      resolved: { repos: [{ repo_id: 'r-1' }] },
      unreadable: [],
      warnings: []
    });
    evalContextService.createContext.mockResolvedValue({ _key: 'ec-2', name: 'new one', version: 1 });
  });

  test('the preview carries the memberships and stores NOTHING', async () => {
    const wrapper = mount(EvalContextPanel);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    wrapper.vm.onAddMembership('group-a');
    wrapper.vm.onAddMembership('group-b');
    await wrapper.vm.onPreview();

    expect(evalContextService.previewContext).toHaveBeenCalledWith({
      principal_refs: ['group-a', 'group-b']
    });
    // A context is immutable and has no delete route — the preview is the
    // only chance to see the union before it is committed.
    expect(evalContextService.createContext).not.toHaveBeenCalled();
  });

  test('the create carries the name AND the memberships', async () => {
    const wrapper = mount(EvalContextPanel);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    wrapper.vm.name = 'ministry-a readers';
    wrapper.vm.onAddMembership('group-a');
    await wrapper.vm.onCreate();

    expect(evalContextService.createContext).toHaveBeenCalledWith({
      name: 'ministry-a readers',
      principal_refs: ['group-a']
    });
  });

  test('a membership that cannot be read is REPORTED, not silently widened', async () => {
    evalContextService.previewContext.mockResolvedValue({
      resolved: { repos: [] },
      unreadable: ['ghost-group'],
      warnings: ['the principal reference(s) ghost-group could not be read']
    });
    const wrapper = mount(EvalContextPanel);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    wrapper.vm.onAddMembership('ghost-group');
    await wrapper.vm.onPreview();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('ghost-group');
  });

  test('the refresh re-resolves through the service and says so', async () => {
    evalContextService.refreshContext.mockResolvedValue({ _key: 'ec-1', version: 3 });
    const wrapper = mount(EvalContextPanel);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    await wrapper.vm.onRefresh(CONTEXTS[0]);
    await wrapper.vm.$nextTick();
    expect(evalContextService.refreshContext).toHaveBeenCalledWith('ec-1');
    // The English fallback carries the verb — the operator learns the
    // version moved, not just that a button was pressed.
    expect(wrapper.text()).toContain('re-resolved');
  });

  test('a refused create says what was refused', async () => {
    evalContextService.createContext.mockRejectedValue({ data: { message: 'the name is already taken' } });
    const wrapper = mount(EvalContextPanel);
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    wrapper.vm.name = 'taken name';
    wrapper.vm.onAddMembership('group-a');
    await wrapper.vm.onCreate();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('the name is already taken');
  });
});

describe('#2061 E-5: the run carries the context id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    httpService.post.mockResolvedValue({ data: { run_key: 'run-1', status: 'running' } });
  });

  test('the head run posts the context id — the body it did NOT post before', async () => {
    await headTestService.runSuite('r-1', 'suite-1', 'ec-1');
    expect(httpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/okf/repos/r-1/routing-testsuite/suite-1/run'),
      { context_id: 'ec-1' }
    );
  });

  test('with no context the run posts an empty body, not a broken one', async () => {
    await headTestService.runSuite('r-1', 'suite-1');
    expect(httpService.post).toHaveBeenCalledWith(expect.stringContaining('/run'), {});
  });
});

describe('#2061 E-5: the client maps every call to its route', () => {
  // The module mock above intercepts the composer/picker paths; THESE tests
  // pin the REAL client's URL mapping, so pull the actual module (its
  // './httpService' import still resolves to the mock above).
  const realClient = jest.requireActual('@/services/evalContextService').default;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the catalogue reads the items envelope', async () => {
    httpService.get.mockResolvedValue({ data: { items: CONTEXTS } });
    await expect(realClient.listContexts()).resolves.toEqual(CONTEXTS);
    expect(httpService.get).toHaveBeenCalledWith('/okf/eval-contexts');
  });

  test('a degenerate envelope degrades to an empty list, never a throw', async () => {
    httpService.get.mockResolvedValue({ data: { items: null } });
    await expect(realClient.listContexts()).resolves.toEqual([]);
    httpService.get.mockResolvedValue({ data: {} });
    await expect(realClient.listGroups('')).resolves.toEqual([]);
  });

  test('one context, create and refresh carry the id and the payload verbatim', async () => {
    httpService.get.mockResolvedValue({ data: CONTEXTS[0] });
    await realClient.getContext('ec-1');
    expect(httpService.get).toHaveBeenCalledWith('/okf/eval-contexts/ec-1');

    httpService.post.mockResolvedValue({ data: { _key: 'ec-2' } });
    await realClient.createContext({ name: 'n', principal_refs: ['g'] });
    expect(httpService.post).toHaveBeenCalledWith('/okf/eval-contexts', { name: 'n', principal_refs: ['g'] });

    await realClient.refreshContext('ec 1');
    // the id is encoded — a space cannot break the path
    expect(httpService.post).toHaveBeenCalledWith('/okf/eval-contexts/ec%201/refresh');
  });

  test('the groups search carries the term; the preview posts the memberships', async () => {
    httpService.get.mockResolvedValue({ data: { items: GROUPS } });
    await realClient.listGroups('min');
    expect(httpService.get).toHaveBeenCalledWith('/okf/eval-contexts/groups?q=min');

    httpService.post.mockResolvedValue({ data: { resolved: { repos: [] } } });
    await realClient.previewContext({ principal_refs: ['g'] });
    expect(httpService.post).toHaveBeenCalledWith('/okf/eval-contexts/preview', { principal_refs: ['g'] });
  });
});

describe('#2061 E-5: the Lab gates the context surfaces on the superadmin role', () => {
  const OkfTestingLabDialog = require('@/components/okf/editor/TestingLabDialog.vue').default;

  function mountLab(user) {
    return mount(OkfTestingLabDialog, {
      global: {
        mocks: {
          $store: {
            getters: { currentUser: user || null },
            commit() {},
            dispatch: jest.fn().mockResolvedValue({ ok: true, runs: [] })
          }
        },
        stubs: {
          DsDialog: { template: '<div><slot /></div>' },
          DsTabs: { template: '<div><slot /></div>' },
          DsInfoTip: true,
          DsSpinner: true
        }
      },
      props: {
        visible: true,
        repo: { repo_id: 'r-1', name: 'NCD Information', head: null, frontmatter: {} }
      }
    });
  }

  test('a tools-admin gets the contexts tab; a repo admin does not', async () => {
    evalContextService.listContexts.mockResolvedValue(CONTEXTS);
    evalContextService.listGroups.mockResolvedValue(GROUPS);

    const admin = mountLab({ roles: ['tools-admin'], okf_scopes: [] });
    await new Promise((r) => setTimeout(r, 0));
    await admin.vm.$nextTick();
    expect(admin.vm.canUseContexts).toBe(true);
    expect(admin.vm.tabDefs.map((t) => t.value)).toContain('contexts');

    // The server's SECOND superadmin population: the wildcard scope without
    // the realm role. Hiding the tab from them was a gate drift the backend
    // test already pins the other side of.
    const wildcard = mountLab({ roles: [], okf_scopes: ['okf:*:*:admin'] });
    await new Promise((r) => setTimeout(r, 0));
    await wildcard.vm.$nextTick();
    expect(wildcard.vm.canUseContexts).toBe(true);
    expect(wildcard.vm.tabDefs.map((t) => t.value)).toContain('contexts');

    const scoped = mountLab({ roles: ['okf-some-repo'], okf_scopes: ['okf:t:r-1:read'] });
    await new Promise((r) => setTimeout(r, 0));
    await scoped.vm.$nextTick();
    expect(scoped.vm.canUseContexts).toBe(false);
    expect(scoped.vm.tabDefs.map((t) => t.value)).not.toContain('contexts');
  });

  test('the binding badge names the suite context — or says it is the deployment', async () => {
    const lab = mountLab(null);
    await new Promise((r) => setTimeout(r, 0));
    await lab.vm.$nextTick();

    lab.vm.suite = {
      suite_key: 's1',
      payload: {
        positive: [],
        negative: [],
        context: {
          id: 'ec-1',
          name: 'ministry-a readers',
          version: 2,
          resolved: { repos: [{ repo_id: 'r-1' }, { repo_id: 'r-2' }] }
        }
      }
    };
    await lab.vm.$nextTick();
    expect(lab.vm.suiteBindingLabel).toContain('ministry-a readers');
    expect(lab.vm.suiteContextIdFor(lab.vm.suite)).toBe('ec-1');

    lab.vm.suite = { suite_key: 's2', payload: { positive: [], negative: [] } };
    await lab.vm.$nextTick();
    expect(lab.vm.suiteBindingLabel).toContain('no evaluation context');
    expect(lab.vm.suiteContextIdFor(lab.vm.suite)).toBe('');
  });
});
