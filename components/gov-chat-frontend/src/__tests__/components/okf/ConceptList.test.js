// #2189 — the concept rail renders O(viewport), not O(collection).
//
// ConceptList.vue v-for'd the FULL concepts array (10k rows): every store
// commit re-diffused the entire list, and the measured wall on a
// 6,352-concept repo was ~32-80 s of pure rendering even after #2188 made
// the crawl itself network-fast (1.1 s). The rail now renders an initial
// window and extends it as the curator scrolls, with a tail spacer keeping
// the scrollbar honest.
//
// Pins:
//  - a 10k collection mounts O(viewport) rows, and a second full-array
//    commit does not grow the rendered count (the #2188 wave commits land
//    ~7 times per load);
//  - scrolling near the bottom extends the window;
//  - a truncated list carries a tail spacer (the scrollbar reflects the
//    whole collection);
//  - small lists render fully — a 150-concept repo is indistinguishable
//    from today's DOM;
//  - the filter renders its (small) result fully;
//  - selection still emits from a rendered row.
import { mount } from '@vue/test-utils';

function makeConcepts(n) {
  const out = [
    {
      concept_id: 'index',
      title: 'Index',
      is_index: true,
      labels: [],
      sources: [{ resource: 'src.md' }],
      index_status: 'indexed'
    }
  ];
  for (let i = 0; i < n; i++) {
    out.push({
      concept_id: `c${i}`,
      title: `Concept ${i}`,
      labels: [],
      sources: [{ resource: `src-${i}.md` }],
      index_status: 'indexed'
    });
  }
  return out;
}

const STUBS = {
  DsButton: { template: '<button class="ds-btn"><slot /></button>' },
  DsSpinner: { template: '<span class="ds-spinner" />' },
  DsPill: { template: '<span class="ds-pill"><slot /></span>' },
  // the filter drives data through v-model — the stub must carry the same
  // contract or setValue() never reaches the component
  DsInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input class="ds-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  DsInfoTip: { template: '<span class="ds-infotip" />' },
  DsProgress: { template: '<span class="ds-progress" />' },
  DsSelect: { template: '<select class="ds-select"><slot /></select>' }
};

function mountList(concepts, extraProps = {}) {
  const OkfConceptList = require('@/components/okf/editor/ConceptList.vue').default;
  return mount(OkfConceptList, {
    props: { concepts, selectedId: null, ...extraProps },
    global: { stubs: STUBS }
  });
}

describe('ConceptList — #2189 virtualized rail', () => {
  test('a 10k collection mounts O(viewport) rows, not 10,001', () => {
    const wrapper = mountList(makeConcepts(9999));
    const rows = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(rows).toBeLessThan(300);
    // the scrollbar stays honest: a tail spacer stands in for the unrendered rows
    expect(wrapper.find('[data-test-id="okf-cl-tail"]').exists()).toBe(true);
    wrapper.unmount();
  });

  test('a second full-array commit (a wave commit) does not grow the rendered count', async () => {
    const wrapper = mountList(makeConcepts(9999));
    const before = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    await wrapper.setProps({ concepts: makeConcepts(9999) });
    const after = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(after).toBeLessThan(300);
    expect(after).toBeLessThanOrEqual(before + 50);
    wrapper.unmount();
  });

  test('scrolling near the bottom extends the rendered window', async () => {
    const wrapper = mountList(makeConcepts(9999));
    const list = wrapper.find('.okf-cl__list');
    const before = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    // jsdom has no layout: pin the geometry the handler reads
    const el = list.element;
    Object.defineProperty(el, 'scrollTop', { value: 5000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 8000, configurable: true });
    await list.trigger('scroll');
    await wrapper.vm.$nextTick();
    const after = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(2000); // extended, not fully rendered
    wrapper.unmount();
  });

  test('a small repo (150 concepts) renders fully — indistinguishable from today', () => {
    const wrapper = mountList(makeConcepts(149));
    const rows = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(rows).toBe(150);
    expect(wrapper.find('[data-test-id="okf-cl-tail"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test('the filter renders its (small) result fully', async () => {
    const concepts = makeConcepts(9999);
    const wrapper = mountList(concepts);
    // narrow the collection to a handful by the filter input — 'Concept 424'
    // substring-matches exactly 11 titles (c424 + c4240..c4249)
    const filter = wrapper.find('.ds-input');
    await filter.setValue('Concept 424');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const rows = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(rows).toBe(11);
    expect(wrapper.find('[data-test-id="okf-cl-tail"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test('selection still emits from a rendered row', async () => {
    const wrapper = mountList(makeConcepts(9999));
    const row = wrapper.find('[data-test-id="okf-concept-row-c3"]');
    expect(row.exists()).toBe(true); // inside the initial window
    await row.trigger('click');
    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')[0]).toEqual(['c3']);
    wrapper.unmount();
  });
});
