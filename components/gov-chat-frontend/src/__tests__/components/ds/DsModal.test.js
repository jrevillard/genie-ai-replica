import { mount } from '@vue/test-utils';
import DsModal from '@/components/ds/Modal.vue';

const mountAndOpen = async (props = {}, slots = {}) => {
  const wrapper = mount(DsModal, {
    props: { visible: false, ...props },
    slots,
    attachTo: document.body
  });
  await wrapper.setProps({ visible: true });
  await wrapper.vm.$nextTick();
  return wrapper;
};

const getBody = () => document.body;

describe('DsModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  describe('AC3: Sizes', () => {
    it('renders with md size class by default', async () => {
      const wrapper = await mountAndOpen();
      expect(getBody().querySelector('.ds-modal').classList).toContain('ds-modal--md');
      wrapper.unmount();
    });

    it('renders with sm size class', async () => {
      const wrapper = await mountAndOpen({ size: 'sm' });
      expect(getBody().querySelector('.ds-modal').classList).toContain('ds-modal--sm');
      wrapper.unmount();
    });

    it('renders with lg size class', async () => {
      const wrapper = await mountAndOpen({ size: 'lg' });
      expect(getBody().querySelector('.ds-modal').classList).toContain('ds-modal--lg');
      wrapper.unmount();
    });

    it('renders with xl size class', async () => {
      const wrapper = await mountAndOpen({ size: 'xl' });
      expect(getBody().querySelector('.ds-modal').classList).toContain('ds-modal--xl');
      wrapper.unmount();
    });
  });

  describe('Props', () => {
    it('does not render when visible is false', () => {
      const wrapper = mount(DsModal, {
        props: { visible: false },
        attachTo: document.body
      });
      expect(getBody().querySelector('.ds-modal-backdrop')).toBeNull();
      wrapper.unmount();
    });

    it('renders title in header', async () => {
      const wrapper = await mountAndOpen({ title: 'Test Title' });
      expect(getBody().querySelector('.ds-modal__header h2').textContent).toBe('Test Title');
      wrapper.unmount();
    });

    it('does not render h2 when no title', async () => {
      const wrapper = await mountAndOpen({ title: '' });
      expect(getBody().querySelector('.ds-modal__header h2')).toBeNull();
      wrapper.unmount();
    });

    it('applies scrollable class to body by default', async () => {
      const wrapper = await mountAndOpen();
      expect(getBody().querySelector('.ds-modal__body').classList).toContain('ds-modal__body--scrollable');
      wrapper.unmount();
    });

    it('does not apply scrollable class when scrollable is false', async () => {
      const wrapper = await mountAndOpen({ scrollable: false });
      expect(getBody().querySelector('.ds-modal__body').classList).not.toContain('ds-modal__body--scrollable');
      wrapper.unmount();
    });

    it('sets role="dialog" on modal', async () => {
      const wrapper = await mountAndOpen();
      expect(getBody().querySelector('.ds-modal').getAttribute('role')).toBe('dialog');
      wrapper.unmount();
    });

    it('sets aria-modal="true" on modal', async () => {
      const wrapper = await mountAndOpen();
      expect(getBody().querySelector('.ds-modal').getAttribute('aria-modal')).toBe('true');
      wrapper.unmount();
    });
  });

  describe('Close emission', () => {
    it('emits close when backdrop is clicked', async () => {
      const wrapper = await mountAndOpen();
      getBody().querySelector('.ds-modal-backdrop').click();
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('close')).toHaveLength(1);
      wrapper.unmount();
    });

    it('emits close when close button is clicked', async () => {
      const wrapper = await mountAndOpen();
      getBody().querySelector('.ds-modal__close').click();
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('close')).toHaveLength(1);
      wrapper.unmount();
    });

    it('emits close on Escape key', async () => {
      const wrapper = await mountAndOpen();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('close')).toHaveLength(1);
      wrapper.unmount();
    });
  });

  describe('Slots', () => {
    it('renders default slot in body', async () => {
      const wrapper = await mountAndOpen({}, { default: '<p>Body content</p>' });
      expect(getBody().querySelector('.ds-modal__body p').textContent).toBe('Body content');
      wrapper.unmount();
    });

    it('renders header slot overriding default title', async () => {
      const wrapper = await mountAndOpen(
        { title: 'Default Title' },
        { header: '<h2>Custom Header</h2>' }
      );
      expect(getBody().querySelector('.ds-modal__header h2').textContent).toContain('Custom Header');
      wrapper.unmount();
    });

    it('renders footer slot when provided', async () => {
      const wrapper = await mountAndOpen({}, { footer: '<button>Save</button>' });
      expect(getBody().querySelector('.ds-modal__footer')).not.toBeNull();
      expect(getBody().querySelector('.ds-modal__footer').textContent).toBe('Save');
      wrapper.unmount();
    });

    it('does not render footer section when no footer slot', async () => {
      const wrapper = await mountAndOpen();
      expect(getBody().querySelector('.ds-modal__footer')).toBeNull();
      wrapper.unmount();
    });
  });

  describe('Body overflow management', () => {
    it('hides body overflow when opened', async () => {
      const wrapper = await mountAndOpen();
      expect(document.body.style.overflow).toBe('hidden');
      wrapper.unmount();
    });

    it('restores body overflow when closed', async () => {
      const wrapper = await mountAndOpen();
      expect(document.body.style.overflow).toBe('hidden');
      await wrapper.setProps({ visible: false });
      await wrapper.vm.$nextTick();
      expect(document.body.style.overflow).toBe('');
      wrapper.unmount();
    });
  });
});
