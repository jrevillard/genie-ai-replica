// #2195 — the operation-wait overlay (AdminDashboard-mounted, fence-clean).
//
// The overlay renders OFF the data path the operations feed: it holds only
// service snapshots (plain objects bridged into component state via the
// subscription), so a saturated main thread never blocks its truth on the
// operation's own reactive arrays.
import { mount } from '@vue/test-utils';

describe('OperationWaitOverlay', () => {
  let opWait;
  let OperationWaitOverlay;
  let wrapper;

  beforeEach(() => {
    // NO jest.resetModules() here: it forks the `vue` module between the
    // file-top VTU import and the component's own require — two runtimes,
    // and component resolution inside the SFC render breaks (the ds children
    // render as unknown elements no matter how they are registered).
    // Isolation comes from opWait.resetForTests() in afterEach instead.
    jest.useFakeTimers();
    opWait = require('@/services/operationWaitService').default;
    OperationWaitOverlay = require('@/components/admin/OperationWaitOverlay.vue').default;
    wrapper = mount(OperationWaitOverlay, {
      global: {
        // NO translate mock: the component carries the REAL translateMixin
        // (code review !1094: the mock hid that the shipped component lacked
        // the method — the mocked-boundary trap). Without $i18n the mixin
        // returns the fallback, which is exactly what these assertions want.
        // House convention (ragas-panel): DS primitives are stubbed — the
        // real nested SFC children are heavy for unit assertions. The button
        // stub keeps the real element shape the overlay styles and selects.
        stubs: {
          DsButton: { template: '<button class="ds-btn"><slot /></button>' },
          DsSpinner: { template: '<span class="ds-spinner" />' },
          DsProgress: { template: '<span class="ds-progress" />' }
        }
      }
    });
  });

  afterEach(() => {
    wrapper && wrapper.unmount();
    opWait.resetForTests();
    jest.useRealTimers();
  });

  test('renders nothing while no operation is active', () => {
    expect(wrapper.find('.op-wait').exists()).toBe(false);
  });

  test('shows the operation label and progress count while active', async () => {
    const handle = opWait.begin('concept-list-fetch', { label: 'Loading concepts', total: 10 });
    handle.setProgress(4, 10);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.op-wait').exists()).toBe(true);
    expect(wrapper.find('.op-wait__label').text()).toBe('Loading concepts');
    expect(wrapper.find('.op-wait__count').text()).toBe('4/10');
  });

  test('hides again once the last operation completes and the min-visible window elapses', async () => {
    const handle = opWait.begin('repos-list', { label: 'Loading repositories' });
    handle.complete();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.op-wait').exists()).toBe(true); // min-visible window

    jest.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.op-wait').exists()).toBe(false);
  });

  test('the cancel affordance cancels the operation through the service', async () => {
    // Opt-in contract: the button exists only when a real onCancel abort is
    // wired (code review !1094).
    const handle = opWait.begin('pii-scan', {
      label: 'Scanning for PII',
      cancellable: true,
      onCancel: () => {}
    });
    await wrapper.vm.$nextTick();

    // located by the DECLARED handle (the e2e-handle-locators contract's
    // spirit, and stub-rendering-agnostic: the attr falls through to the
    // stub root whatever element the stub renders)
    await wrapper.find('[data-test-id="op-wait-cancel"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(handle.state).toBe('removed');
    expect(wrapper.find('.op-wait').exists()).toBe(false);
  });

  test('a non-cancellable operation renders no cancel button', async () => {
    opWait.begin('ragas-generate', { label: 'Generating benchmark', cancellable: false });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.op-wait').exists()).toBe(true);
    expect(wrapper.findAll('[data-test-id="op-wait-cancel"]')).toHaveLength(0);
  });

  test('a failed operation surfaces its message', async () => {
    const handle = opWait.begin('conformance-pass', { label: 'Validating repo' });
    handle.fail('validation endpoint unreachable');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.op-wait__failure').exists()).toBe(true);
    expect(wrapper.find('.op-wait__failure').text()).toContain('validation endpoint unreachable');
  });

  test('a labelKey operation resolves through the REAL translateMixin and $i18n', async () => {
    // The store modules register ops with i18n KEYS (see okf.js header:
    // "the store has no translate context"); the overlay's translateMixin
    // owns the lookup. This drives the mixin's RAW message tree (its
    // documented $t-bypass) with a minimal $i18n — no translate mock.
    const w2 = mount(OperationWaitOverlay, {
      global: {
        mocks: {
          $i18n: {
            locale: 'en',
            messages: {
              en: { okf: { opwait: { ops: { conceptList: 'KONZEPTE-LADEN' } } } }
            }
          }
        },
        stubs: {
          DsButton: { template: '<button class="ds-btn"><slot /></button>' },
          DsSpinner: true,
          DsProgress: true
        }
      }
    });
    opWait.begin('concept-list-fetch', { label: 'Loading concepts', labelKey: 'okf.opwait.ops.conceptList' });
    opWait.begin('links-fetch', { label: 'Loading links' });
    await w2.vm.$nextTick();

    const labels = w2.findAll('.op-wait__label').map((n) => n.text());
    expect(labels).toContain('KONZEPTE-LADEN'); // labelKey resolved via the mixin + $i18n
    expect(labels).toContain('Loading links'); // plain label renders as given
    w2.unmount();
  });

  test('a completing row keeps NO live Cancel during its min-visible window', async () => {
    // Code review !1094: the Cancel button gated only on op.cancellable, so
    // a finished-but-still-listed op offered a working Cancel — clicking it
    // fired the server cancel for a job that already ended.
    const handle = opWait.begin('ragas-generate', {
      label: 'Generating benchmark',
      cancellable: true,
      onCancel: () => {}
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('[data-test-id="op-wait-cancel"]')).toHaveLength(1); // active: cancel visible

    handle.complete();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.op-wait').exists()).toBe(true); // min-visible window
    expect(wrapper.findAll('[data-test-id="op-wait-cancel"]')).toHaveLength(0); // no live Cancel

    jest.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.op-wait').exists()).toBe(false);
  });
});
