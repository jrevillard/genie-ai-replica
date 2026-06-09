import { mount } from '@vue/test-utils';
import DsTabs from '@/components/ds/Tabs.vue';

const TABS = [
  { label: 'Tab A', value: 'a' },
  { label: 'Tab B', value: 'b' },
  { label: 'Tab C', value: 'c' }
];

const mountTabs = (props = {}, slots = {}) => {
  return mount(DsTabs, {
    props: { tabs: TABS, ...props },
    slots
  });
};

describe('DsTabs (AC11)', () => {
  describe('Default mode', () => {
    it('renders all tab buttons', () => {
      const wrapper = mountTabs();
      const buttons = wrapper.findAll('.ds-tabs__btn');
      expect(buttons).toHaveLength(3);
    });

    it('renders tab labels', () => {
      const wrapper = mountTabs();
      expect(wrapper.text()).toContain('Tab A');
      expect(wrapper.text()).toContain('Tab B');
      expect(wrapper.text()).toContain('Tab C');
    });

    it('does not apply fill class by default', () => {
      const wrapper = mountTabs();
      expect(wrapper.find('.ds-tabs').classes()).not.toContain('ds-tabs--fill');
    });
  });

  describe('Fill mode', () => {
    it('applies fill class when fill is true', () => {
      const wrapper = mountTabs({ fill: true });
      expect(wrapper.find('.ds-tabs').classes()).toContain('ds-tabs--fill');
    });
  });

  describe('Tab switching', () => {
    it('emits update:modelValue when tab is clicked', async () => {
      const wrapper = mountTabs();
      await wrapper.findAll('.ds-tabs__btn')[1].trigger('click');
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['b']);
    });
  });

  describe('modelValue binding', () => {
    it('marks the active tab with active class', () => {
      const wrapper = mountTabs({ modelValue: 'b' });
      const buttons = wrapper.findAll('.ds-tabs__btn');
      expect(buttons[0].classes()).not.toContain('ds-tabs__btn--active');
      expect(buttons[1].classes()).toContain('ds-tabs__btn--active');
      expect(buttons[2].classes()).not.toContain('ds-tabs__btn--active');
    });

    it('defaults modelValue to 0 (first tab active by index)', () => {
      const wrapper = mount(DsTabs, {
        props: {
          tabs: [{ label: 'Tab A' }, { label: 'Tab B' }]
        }
      });
      const buttons = wrapper.findAll('.ds-tabs__btn');
      expect(buttons[0].classes()).toContain('ds-tabs__btn--active');
      expect(buttons[1].classes()).not.toContain('ds-tabs__btn--active');
    });

    it('uses tab.value for comparison when present', () => {
      const wrapper = mountTabs({ modelValue: 'b' });
      const buttons = wrapper.findAll('.ds-tabs__btn');
      expect(buttons[1].classes()).toContain('ds-tabs__btn--active');
    });

    it('no tab is active when modelValue (0) does not match any tab value', () => {
      const wrapper = mount(DsTabs, {
        props: {
          tabs: [
            { label: 'Tab A', value: 'a' },
            { label: 'Tab B', value: 'b' }
          ]
        }
      });
      const buttons = wrapper.findAll('.ds-tabs__btn');
      expect(buttons[0].classes()).not.toContain('ds-tabs__btn--active');
      expect(buttons[1].classes()).not.toContain('ds-tabs__btn--active');
    });
  });

  describe('Slots', () => {
    it('renders default slot in content area', () => {
      const wrapper = mountTabs({}, { default: '<div class="panel">Panel</div>' });
      expect(wrapper.find('.ds-tabs__content .panel').exists()).toBe(true);
    });

    it('renders scoped tab slot with active state', () => {
      const wrapper = mount(DsTabs, {
        props: { tabs: TABS, modelValue: 'a' },
        slots: {
          tab: `<template #tab="scope">
            <span class="custom-tab" :data-active="scope.active">{{ scope.tab.label }}</span>
          </template>`
        }
      });
      const customTabs = wrapper.findAll('.custom-tab');
      expect(customTabs).toHaveLength(3);
      expect(customTabs[0].attributes('data-active')).toBe('true');
      expect(customTabs[1].attributes('data-active')).toBe('false');
    });
  });
});
