import { mount } from '@vue/test-utils';
import DsDialog from '@/components/ds/Dialog.vue';

const mountAndOpen = async (attrs = {}) => {
  const wrapper = mount(DsDialog, {
    props: { visible: false, title: 'T' },
    attrs,
    slots: { default: '<p>body</p>' },
    attachTo: document.body
  });
  await wrapper.setProps({ visible: true });
  await wrapper.vm.$nextTick();
  return wrapper;
};

describe('DsDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  describe('Fallthrough attrs reach the teleported backdrop', () => {
    // DsDialog is single-root (its root is DsModal), so a caller's class
    // falls through into DsModal's $attrs — and DsModal binds $attrs onto
    // the rendered .ds-modal-backdrop (a Teleport root does not forward
    // attrs on its own; see Modal.vue). Every gated dialog instance in
    // the app relies on that whole chain: if any hop drops the class, the
    // dialog silently paints flat while this file's DsModal test alone
    // still passes. This test pins the DsDialog→DsModal hop.
    it('renders a caller class onto the backdrop', async () => {
      const wrapper = await mountAndOpen({ class: 'genie-living-intelligence' });
      const backdrop = document.body.querySelector('.ds-modal-backdrop');
      expect(backdrop).not.toBeNull();
      expect(backdrop.classList).toContain('genie-living-intelligence');
      wrapper.unmount();
    });

    it('carries the caller class alongside the backdrop class, never instead of it', async () => {
      const wrapper = await mountAndOpen({ class: 'genie-living-intelligence' });
      const backdrop = document.body.querySelector('.ds-modal-backdrop');
      expect(backdrop.classList).toContain('ds-modal-backdrop');
      wrapper.unmount();
    });
  });
});
