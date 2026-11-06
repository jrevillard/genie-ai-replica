'use strict';

/**
 * THE CONCEPT-DOCUMENT CEILING — the editor's advisory and the refusal the
 * curator sees (the plan's §8: "server splits; the UI tells the user what
 * happened").
 *
 * The property under test is NOT "a counter renders". It is: **the curator is
 * told the rule BEFORE they hit it, and told WHY their save was refused**.
 *
 * A refusal that arrives as a generic "Save failed — retry" is advice that
 * cannot work: retrying an over-ceiling save fails identically forever. So the
 * editor must render the server's message for that one case, and keep the
 * generic wording for every other failure.
 */

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { get: jest.fn(), listForRepo: jest.fn(), update: jest.fn() }
}));
jest.mock('@/services/frontmatterService', () => ({
  __esModule: true,
  patchFrontmatter: jest.fn().mockResolvedValue({ ok: true })
}));

const { mount, flushPromises } = require('@vue/test-utils');

const OkfConceptEditor = require('@/components/okf/editor/ConceptEditor.vue').default;

const CEILING = 250;

/** A store whose getConcept carries the server's ceiling, and whose
 *  patchConcept resolves as the test needs. */
function fakeStore({ concept = {}, patchResult = { ok: true } } = {}) {
  const dispatched = [];
  const store = {
    dispatched,
    getters: {
      'okf/editorSubTab': 'editor',
      'okf/repoById': () => ({ repo_id: 'r-1', name: 'Repo One', lifecycle_state: 'draft' })
    },
    commit(type, payload) {
      dispatched.push({ type, payload });
    },
    dispatch(type, payload) {
      dispatched.push({ type, payload });
      if (type === 'okf/getConcept') {
        return Promise.resolve({
          ok: true,
          concept: {
            concept_id: 'c-1',
            frontmatter: { type: 'topic', title: 'C1' },
            body: '# C1 body',
            ...concept
          }
        });
      }
      if (type === 'okf/patchConcept') {
        return Promise.resolve(patchResult);
      }
      return Promise.resolve({ ok: true });
    }
  };
  return store;
}

async function mountEditor(store) {
  const wrapper = mount(OkfConceptEditor, {
    global: { mocks: { $store: store } },
    props: { repoId: 'r-1', conceptId: 'c-1' }
  });
  await flushPromises();
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('the concept-document ceiling — the editor advisory', () => {
  test('the ceiling comes from the SERVER (the concept read), not a frontend copy', async () => {
    const wrapper = await mountEditor(fakeStore({ concept: { max_doc_chars: CEILING } }));
    expect(wrapper.vm.maxDocChars).toBe(CEILING);
  });

  test('a server that does not send the ceiling simply shows no advisory', async () => {
    const wrapper = await mountEditor(fakeStore());
    expect(wrapper.vm.maxDocChars).toBeNull();
    expect(wrapper.find('[data-test-id="concept-ceiling"]').exists()).toBe(false);
  });

  test('the advisory shows the LIVE body length against the ceiling', async () => {
    const wrapper = await mountEditor(fakeStore({ concept: { max_doc_chars: CEILING } }));
    wrapper.vm.markdown = 'x'.repeat(40);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.bodyChars).toBe(40);
    expect(wrapper.vm.overCeiling).toBe(false);
    expect(wrapper.vm.ceilingLabel).toContain('40');
    expect(wrapper.vm.ceilingLabel).toContain(String(CEILING));
    expect(wrapper.find('[data-test-id="concept-ceiling"]').exists()).toBe(true);
  });

  test('going OVER the ceiling turns the warning on BEFORE the save is refused', async () => {
    const wrapper = await mountEditor(fakeStore({ concept: { max_doc_chars: CEILING } }));
    wrapper.vm.markdown = 'x'.repeat(CEILING + 1);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.overCeiling).toBe(true);
    const advisory = wrapper.find('[data-test-id="concept-ceiling"]');
    expect(advisory.exists()).toBe(true);
    // The warning variant is what tells the curator this is not a normal state.
    expect(advisory.html()).toContain('ds-pill--warning');
  });

  // The ceiling governs the BODY, not the markdown: the frontmatter is
  // metadata the ceiling does not describe — the same measure the server
  // takes (the import path measures raw.body, not the markdown).
  test('the counter measures the BODY — a large frontmatter does not count against the ceiling', async () => {
    const wrapper = await mountEditor(fakeStore({ concept: { max_doc_chars: CEILING } }));
    // Unique YAML keys — gray-matter rejects a duplicate key.
    const fm = Array.from({ length: 60 }, (_, i) => `k${i}: v`).join('\n');
    wrapper.vm.markdown = `---\n${fm}\n---\nshort body`;
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.bodyChars).toBe('short body'.length);
    expect(wrapper.vm.overCeiling).toBe(false);
  });
});

describe('the concept-document ceiling — the refusal the curator sees', () => {
  test('a CONCEPT_TOO_LARGE refusal renders the SERVER\'s message, not "retry"', async () => {
    const store = fakeStore({
      patchResult: {
        ok: false,
        code: 'CONCEPT_TOO_LARGE',
        message: 'concept "c-1" is 300000 characters, over the 250000-character ceiling. Split it.'
      }
    });
    const wrapper = await mountEditor(store);
    wrapper.vm.markdown = 'x'.repeat(300);
    await wrapper.vm.saveNow();

    expect(wrapper.vm.saveError).toBe(true);
    // THE assertion that matters: the curator is told WHY, not told to retry.
    expect(wrapper.vm.saveStatusLabel).toContain('300000 characters');
    expect(wrapper.vm.saveStatusLabel).not.toContain('retry');
  });

  test('every OTHER failure keeps the generic "Save failed — retry" wording', async () => {
    const store = fakeStore({ patchResult: { ok: false, code: 'PATCH_FAILED', message: 'boom' } });
    const wrapper = await mountEditor(store);
    wrapper.vm.markdown = 'x'.repeat(300);
    await wrapper.vm.saveNow();

    expect(wrapper.vm.saveError).toBe(true);
    expect(wrapper.vm.saveStatusLabel).toContain('retry');
  });
});
