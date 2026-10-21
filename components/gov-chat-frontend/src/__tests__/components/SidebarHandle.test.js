import { mount } from '@vue/test-utils';
import SidebarHandle from '@/components/SidebarHandle.vue';

const PROPS = { value: 450, min: 240, max: 600 };

const mountHandle = (props = {}) =>
  mount(SidebarHandle, { props: { ...PROPS, ...props }, attachTo: document.body });

// jsdom gives every element a zero-width rect, so a drag has nothing to
// read. The handler only needs the strip's identity (to reject a
// pointerdown that started on the inner button) and pointer capture,
// so a stub satisfies both without faking geometry.
function stubStripGeometry(wrapper) {
  const strip = wrapper.find('.sidebar-handle').element;
  strip.getBoundingClientRect = () => ({ left: 0, right: 24, top: 0, bottom: 800, width: 24, height: 800 });
  strip.setPointerCapture = () => {};
  strip.releasePointerCapture = () => {};
}

describe('SidebarHandle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('accessibility', () => {
    it('exposes itself as a focusable separator with the value range in ARIA', () => {
      const wrapper = mountHandle();
      const strip = wrapper.find('.sidebar-handle');
      expect(strip.attributes('role')).toBe('separator');
      expect(strip.attributes('aria-orientation')).toBe('vertical');
      expect(strip.attributes('tabindex')).toBe('0');
      expect(strip.attributes('aria-valuemin')).toBe('240');
      expect(strip.attributes('aria-valuemax')).toBe('600');
      expect(strip.attributes('aria-valuenow')).toBe('450');
    });

    // A resize widget that cannot be driven from the keyboard is an
    // accessibility defect, not a refinement — so the strip is focusable
    // and carries the arrow-key contract.
    it('is reachable by keyboard and resizes on the arrow keys', async () => {
      const wrapper = mountHandle();
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowRight' });
      expect(wrapper.emitted('input')[0]).toEqual([458]);

      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowLeft' });
      expect(wrapper.emitted('input')[1]).toEqual([442]);
    });

    it('clamps the arrow-key step to min and max', async () => {
      const wrapper = mountHandle({ value: 596 });
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowRight' });
      expect(wrapper.emitted('input')[0]).toEqual([600]);

      const atFloor = mountHandle({ value: 244 });
      await atFloor.find('.sidebar-handle').trigger('keydown', { key: 'ArrowLeft' });
      expect(atFloor.emitted('input')[0]).toEqual([240]);
    });

    it('jumps to the bounds on Home and End', async () => {
      const wrapper = mountHandle();
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'Home' });
      expect(wrapper.emitted('input')[0]).toEqual([600]);
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'End' });
      expect(wrapper.emitted('input')[1]).toEqual([240]);
    });

    it('collapses from the keyboard with Enter and Space', async () => {
      const wrapper = mountHandle();
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'Enter' });
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: ' ' });
      expect(wrapper.emitted('collapse')).toHaveLength(2);
      // Collapsing is not a resize; no width change is implied.
      expect(wrapper.emitted('input')).toBeUndefined();
    });

    it('collapses from the chevron button, which is a real button in the tab order', async () => {
      const wrapper = mountHandle();
      const button = wrapper.find('.sidebar-handle__button');
      expect(button.element.tagName).toBe('BUTTON');
      expect(button.attributes('type')).toBe('button');
      expect(button.attributes('aria-expanded')).toBe('true');
      await button.trigger('click');
      expect(wrapper.emitted('collapse')).toHaveLength(1);
      // The click must not start a drag — the two gestures are separate.
      expect(wrapper.emitted('input')).toBeUndefined();
    });

    it('labels the button with the opposite action when collapsed', () => {
      const wrapper = mountHandle({ collapsed: true, collapseLabel: 'Collapse sidebar', expandLabel: 'Expand sidebar' });
      const button = wrapper.find('.sidebar-handle__button');
      expect(button.attributes('aria-label')).toBe('Expand sidebar');
      expect(button.attributes('aria-expanded')).toBe('false');
    });
  });

  describe('pointer drag', () => {
    it('widens when the pointer moves toward the panel (left side)', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 400 });
      expect(wrapper.emitted('input')[0]).toEqual([500]);
    });

    it('widens when the pointer moves away from the panel (right side)', async () => {
      const wrapper = mountHandle({ side: 'right' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 1400 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 1450 });
      expect(wrapper.emitted('input')[0]).toEqual([500]);
    });

    it('does not drag when the secondary button starts the gesture', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 2, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 400 });
      expect(wrapper.emitted('input')).toBeUndefined();
    });

    it('stops emitting once the pointer is released', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 400 });
      await wrapper.find('.sidebar-handle').trigger('pointerup', { pointerId: 1 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 300 });
      expect(wrapper.emitted('input')).toHaveLength(1);
    });

    it('announces the start and end of a drag', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      expect(wrapper.emitted('drag-start')).toHaveLength(1);
      await wrapper.find('.sidebar-handle').trigger('pointerup', { pointerId: 1 });
      expect(wrapper.emitted('drag-end')).toHaveLength(1);
    });
  });

  it('restores the default width on double-click', async () => {
    const wrapper = mountHandle();
    await wrapper.find('.sidebar-handle').trigger('dblclick');
    expect(wrapper.emitted('reset')).toHaveLength(1);
    expect(wrapper.emitted('input')).toBeUndefined();
  });
});