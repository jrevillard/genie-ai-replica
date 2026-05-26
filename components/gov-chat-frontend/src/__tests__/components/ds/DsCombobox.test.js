import { mount } from '@vue/test-utils';
import DsCombobox from '@/components/ds/Combobox.vue';

const FRUITS = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' }
];

const mountCombobox = (props = {}) => {
  return mount(DsCombobox, {
    props: { options: FRUITS, ...props },
    attachTo: document.body
  });
};

describe('DsCombobox', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('AC6: Searchable dropdown', () => {
    it('shows trigger element by default (closed state)', () => {
      const wrapper = mountCombobox();
      expect(wrapper.find('.ds-combobox__trigger').exists()).toBe(true);
      wrapper.unmount();
    });

    it('opens search input when trigger is clicked', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      expect(wrapper.findComponent({ name: 'DsInput' }).exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows dropdown list when open', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      expect(wrapper.find('.ds-combobox__list').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('Options rendering', () => {
    it('renders all options in the dropdown', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      const options = wrapper.findAll('.ds-combobox__option');
      expect(options).toHaveLength(3);
      expect(options[0].text()).toBe('Apple');
      wrapper.unmount();
    });

    it('renders string options', async () => {
      const wrapper = mount(DsCombobox, {
        props: { options: ['Red', 'Green', 'Blue'] }
      });
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      const options = wrapper.findAll('.ds-combobox__option');
      expect(options).toHaveLength(3);
      expect(options[0].text()).toBe('Red');
      wrapper.unmount();
    });
  });

  describe('Selection', () => {
    it('emits update:modelValue when option is clicked', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      await wrapper.findAll('.ds-combobox__option')[1].trigger('mousedown');
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['banana']);
      wrapper.unmount();
    });

    it('closes dropdown after selection', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      await wrapper.findAll('.ds-combobox__option')[0].trigger('mousedown');
      expect(wrapper.find('.ds-combobox__list').exists()).toBe(false);
      wrapper.unmount();
    });

    it('displays selected option text on trigger', () => {
      const wrapper = mountCombobox({ modelValue: 'banana' });
      expect(wrapper.find('.ds-combobox__trigger').text()).toBe('Banana');
      wrapper.unmount();
    });

    it('shows placeholder when no value selected', () => {
      const wrapper = mountCombobox({ placeholder: 'Pick a fruit' });
      expect(wrapper.find('.ds-combobox__trigger').text()).toBe('Pick a fruit');
      wrapper.unmount();
    });
  });

  describe('Search filtering', () => {
    it('filters options by search term', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      const input = wrapper.find('input');
      await input.setValue('ap');
      await wrapper.vm.$nextTick();
      const filtered = wrapper.findAll('.ds-combobox__option');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].text()).toBe('Apple');
      wrapper.unmount();
    });

    it('filters case-insensitively', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      const input = wrapper.find('input');
      await input.setValue('AP');
      await wrapper.vm.$nextTick();
      const filtered = wrapper.findAll('.ds-combobox__option');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].text()).toBe('Apple');
      wrapper.unmount();
    });

    it('shows no results message when filter matches nothing', async () => {
      const wrapper = mountCombobox();
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      const input = wrapper.find('input');
      await input.setValue('zzz');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.ds-combobox__empty').exists()).toBe(true);
      expect(wrapper.find('.ds-combobox__empty').text()).toBe('No results');
      wrapper.unmount();
    });

    it('uses custom noResultsText when provided', async () => {
      const wrapper = mountCombobox({ noResultsText: 'Aucun résultat' });
      await wrapper.find('.ds-combobox__trigger').trigger('click');
      const input = wrapper.find('input');
      await input.setValue('zzz');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.ds-combobox__empty').text()).toBe('Aucun résultat');
      wrapper.unmount();
    });
  });

  describe('Disabled state', () => {
    it('applies disabled class to trigger', () => {
      const wrapper = mountCombobox({ disabled: true });
      expect(wrapper.find('.ds-combobox__trigger--disabled').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('Size classes', () => {
    it('applies sm class', () => {
      const wrapper = mountCombobox({ size: 'sm' });
      expect(wrapper.find('.ds-combobox').classes()).toContain('ds-combobox--sm');
      wrapper.unmount();
    });

    it('applies lg class', () => {
      const wrapper = mountCombobox({ size: 'lg' });
      expect(wrapper.find('.ds-combobox').classes()).toContain('ds-combobox--lg');
      wrapper.unmount();
    });
  });
});
