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

const OkfConceptList = require('@/components/okf/editor/ConceptList.vue').default;

function mountList(concepts, extraProps = {}) {
  return mount(OkfConceptList, {
    props: { concepts, selectedId: null, ...extraProps },
    global: { stubs: STUBS }
  });
}

// jsdom has no layout: pin the exact geometry a handler reads
function pinListGeometry(el, scrollTop, clientHeight, scrollHeight) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
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
    pinListGeometry(list.element, 5000, 600, 8000);
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

  // ---- review-round pins (the #2189 code-review findings) ----------------

  // The dialog's "Show more" and a re-crawl on a small repo both grow a
  // FULLY-rendered collection past the limit: the window must carry over,
  // or rendered rows VANISH mid-session (review round 1, finding 2b).
  test('a full collection growing past the limit keeps its rows (Show more)', async () => {
    const wrapper = mountList(makeConcepts(149));
    expect(wrapper.findAll('[data-test-id^="okf-concept-row-"]').length).toBe(150);
    // the dialog's next page arrives: 150 -> 400, now over the limit
    await wrapper.setProps({ concepts: makeConcepts(399) });
    const rows = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    // the window seeded from the full count (bounded at the limit), not the
    // bare initial chunk — nothing the curator was looking at disappears
    expect(rows).toBe(300);
    expect(wrapper.find('[data-test-id="okf-cl-tail"]').exists()).toBe(true);
    wrapper.unmount();
  });

  // Collapsed children render nothing, yet each extension shrinks the spacer
  // (rows swap for spacer height) — scrolling a collapsed 10k rail would
  // lurch the scrollbar and render thousands of hidden rows (finding 4).
  test('the collapsed rail does not extend while its children are hidden', async () => {
    const wrapper = mountList(makeConcepts(9999));
    await wrapper.find('.okf-cl__twist').trigger('click'); // collapse
    const before = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    const list = wrapper.find('[data-test-id="okf-cl-list"]');
    pinListGeometry(list.element, 5000, 600, 8000);
    await list.trigger('scroll');
    await wrapper.vm.$nextTick();
    const after = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(after).toBe(before); // no hidden-row churn while collapsed
    wrapper.unmount();
  });

  // The wizard workbench and the concept browser scroll AROUND the rail —
  // the rail's own ul never scrolls, so extension must also key on the
  // spacer entering the viewport through ANY ancestor scroll container
  // (finding 2). Pinned rects stand in for layout, as with scrollTop above.
  test('an ancestor scroll that reveals the spacer fills the window (outer-scroller mounts)', async () => {
    const wrapper = mountList(makeConcepts(2999));
    const spacer = wrapper.find('[data-test-id="okf-cl-tail"]');
    expect(spacer.exists()).toBe(true);
    Object.defineProperty(spacer.element, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 100000, left: 0, right: 300, width: 300, height: 99900 }),
      configurable: true
    });
    document.dispatchEvent(new Event('scroll'));
    // the re-check chain fills chunk by chunk across nextTicks
    for (let i = 0; i < 40; i++) await wrapper.vm.$nextTick();
    const rows = wrapper.findAll('[data-test-id^="okf-concept-row-"]').length;
    expect(rows).toBe(3000); // filled completely: a deep jump renders the prefix
    expect(wrapper.find('[data-test-id="okf-cl-tail"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test('the ancestor extension stays parked while the spacer is below the fold', async () => {
    const wrapper = mountList(makeConcepts(2999));
    const spacer = wrapper.find('[data-test-id="okf-cl-tail"]');
    Object.defineProperty(spacer.element, 'getBoundingClientRect', {
      value: () => ({ top: window.innerHeight + 700, bottom: 999999, left: 0, right: 300, width: 300, height: 999999 }),
      configurable: true
    });
    document.dispatchEvent(new Event('scroll'));
    for (let i = 0; i < 5; i++) await wrapper.vm.$nextTick();
    expect(wrapper.findAll('[data-test-id^="okf-concept-row-"]').length).toBeLessThan(200);
    wrapper.unmount();
  });
});
