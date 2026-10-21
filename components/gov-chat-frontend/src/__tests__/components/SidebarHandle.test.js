import { mount } from '@vue/test-utils';
import SidebarHandle from '@/components/SidebarHandle.vue';

const PROPS = { value: 450, min: 240, max: 600 };

const mountHandle = (props = {}) => mount(SidebarHandle, { props: { ...PROPS, ...props }, attachTo: document.body });

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
      const wrapper = mountHandle({ side: 'left' });
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowRight' });
      expect(wrapper.emitted('input')[0]).toEqual([458]);

      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowLeft' });
      expect(wrapper.emitted('input')[1]).toEqual([442]);
    });

    // The keys move the strip in screen space; the panel follows. On
    // the right the strip is the panel's LEFT edge, so ArrowRight
    // narrows. Keyboard and pointer must not disagree about which way
    // is wider — an earlier revision widened on both sides while the
    // drag narrowed the right, and only the drag assertion caught it.
    it('mirrors the arrow direction on the right side, matching the drag', async () => {
      const wrapper = mountHandle({ side: 'right' });
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowRight' });
      expect(wrapper.emitted('input')[0]).toEqual([442]);

      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowLeft' });
      expect(wrapper.emitted('input')[1]).toEqual([458]);
    });

    it('clamps the arrow-key step to min and max', async () => {
      // Side pinned to left so ArrowRight is the widening direction;
      // on the right it would step away from the cap being tested.
      const wrapper = mountHandle({ side: 'left', value: 596 });
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowRight' });
      expect(wrapper.emitted('input')[0]).toEqual([600]);

      const atFloor = mountHandle({ side: 'left', value: 244 });
      await atFloor.find('.sidebar-handle').trigger('keydown', { key: 'ArrowLeft' });
      expect(atFloor.emitted('input')[0]).toEqual([240]);
    });

    it('takes a larger step with Shift held', async () => {
      const wrapper = mountHandle({ side: 'left' });
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'ArrowRight', shiftKey: true });
      expect(wrapper.emitted('input')[0]).toEqual([490]);
    });

    it('jumps to the bounds on Home and End', async () => {
      const wrapper = mountHandle();
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'Home' });
      expect(wrapper.emitted('input')[0]).toEqual([240]);
      await wrapper.find('.sidebar-handle').trigger('keydown', { key: 'End' });
      expect(wrapper.emitted('input')[1]).toEqual([600]);
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
      const wrapper = mountHandle({
        collapsed: true,
        collapseLabel: 'Collapse sidebar',
        expandLabel: 'Expand sidebar'
      });
      const button = wrapper.find('.sidebar-handle__button');
      expect(button.attributes('aria-label')).toBe('Expand sidebar');
      expect(button.attributes('aria-expanded')).toBe('false');
    });
  });

  describe('pointer drag', () => {
    // A drag moves the strip in screen space; the panel follows. The
    // strip is the LEFT panel's right edge, so moving it right grows
    // it, and it is the RIGHT panel's left edge, so moving it right
    // shrinks that. The keyboard keys route through the same sign —
    // see the mirror assertion under accessibility.
    it('widens the left panel when the strip moves right', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 500 });
      expect(wrapper.emitted('input')[0]).toEqual([500]);
    });

    it('narrows the left panel when the strip moves left', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 400 });
      expect(wrapper.emitted('input')[0]).toEqual([400]);
    });

    it('widens the right panel when the strip moves left', async () => {
      const wrapper = mountHandle({ side: 'right' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 1400 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 1450 });
      expect(wrapper.emitted('input')[0]).toEqual([400]);
    });

    it('narrows the right panel when the strip moves right', async () => {
      const wrapper = mountHandle({ side: 'right' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 1400 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 1350 });
      expect(wrapper.emitted('input')[0]).toEqual([500]);
    });

    it('does not drag when the secondary button starts the gesture', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 2, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 400 });
      expect(wrapper.emitted('input')).toBeUndefined();
    });

    // The chevron is 24 px wide in a 24 px strip, so a press anywhere
    // on the only visible control targets the button. Refusing those
    // presses made the feature unreachable for anyone who aimed at it:
    // the strip above the chevron resized, the chevron did nothing.
    // Drag and click are separated by movement instead.
    it('drags from a press that starts on the chevron', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 500 });
      expect(wrapper.emitted('input')[0]).toEqual([500]);
      expect(wrapper.emitted('drag-start')).toHaveLength(1);
    });

    // A press that never travels is a click, and the DOM delivers it
    // to the button on its own — the strip must not resize it.
    it('does not resize a press that stays inside the movement threshold', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 452 });
      await wrapper.find('.sidebar-handle').trigger('pointerup', { pointerId: 1 });
      expect(wrapper.emitted('input')).toBeUndefined();
      expect(wrapper.emitted('drag-start')).toBeUndefined();
      expect(wrapper.emitted('drag-end')).toBeUndefined();
    });

    // A drag that began on the chevron ends with the browser firing a
    // click on it, which would collapse the panel just resized.
    it('suppresses the click that follows a drag', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 500 });
      await wrapper.find('.sidebar-handle').trigger('pointerup', { pointerId: 1 });
      await wrapper.find('.sidebar-handle').trigger('click');
      expect(wrapper.emitted('collapse')).toBeUndefined();
      // …and only that one: the next press-and-release is a click again.
      await wrapper.find('.sidebar-handle__button').trigger('click');
      expect(wrapper.emitted('collapse')).toHaveLength(1);
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

    // The announcement follows the movement, not the press: a press
    // arms the gesture, and only crossing the threshold is a drag.
    it('announces the start when the movement crosses the threshold and the end on release', async () => {
      const wrapper = mountHandle({ side: 'left' });
      stubStripGeometry(wrapper);
      await wrapper.find('.sidebar-handle').trigger('pointerdown', { pointerId: 1, button: 0, clientX: 450 });
      // The press alone is not yet a drag.
      expect(wrapper.emitted('drag-start')).toBeUndefined();

      await wrapper.find('.sidebar-handle').trigger('pointermove', { pointerId: 1, clientX: 460 });
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
