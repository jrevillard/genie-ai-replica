'use strict';

/**
 * Step-7 Validate — the #1030/#1036 issue-list behaviours (David,
 * 2026-10-02): every issue lists concept + severity + remedy, and the three
 * new remedies work in place — orphan link suggestions (accept/reject),
 * near-duplicate keep-one-delete-the-rest, and the one-click citation hub
 * wiring (Option 2: wizard-only, no import-side automation).
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

jest.mock('@/components/okf/editor/PiiOccurrences.vue', () => ({
  name: 'OkfPiiOccurrences',
  props: ['repoId', 'conceptId', 'revision', 'readOnly'],
  template: '<div class="pii-stub" />'
}));

const OkfStepValidate = require('@/components/okf/steps/Validate.vue').default;

function mountValidate(dispatchOverrides) {
  const dispatched = [];
  const store = new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: {
          repoById: () => () => ({ repo_id: 'r1', lifecycle_state: 'draft' }),
          isExpert: () => false
        }
      }
    }
  });
  store.dispatch = (type, payload) => {
    dispatched.push({ type, payload });
    if (dispatchOverrides[type]) return Promise.resolve(dispatchOverrides[type](payload));
    if (type === 'okf/fetchConcepts') return Promise.resolve({ ok: true, concepts: [] });
    if (type === 'okf/fetchRepoMetrics') return Promise.resolve({ ok: true, metrics: null });
    return Promise.resolve({ ok: false });
  };
  const w = mount(OkfStepValidate, {
    props: { draft: { repo_id: 'r1', concept_count: 10 }, expert: false },
    global: { plugins: [store] }
  });
  return { w, dispatched, store };
}

const settle = async (w) => {
  await w.vm.$nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await w.vm.$nextTick();
};

function reportWith(issues) {
  return {
    issues,
    citations: { citing: [], hub_concept_id: null, needing_link: [] },
    summary: { total: issues.length }
  };
}

describe('OkfStepValidate — issue list (#1030)', () => {
  it('renders nothing to review when the report is clean', async () => {
    const { w } = mountValidate({ 'okf/fetchValidation': () => ({ ok: true, report: reportWith([]) }) });
    await settle(w);
    expect(w.text()).toContain('Looks good. Nothing to fix.');
    expect(w.vm.validationIssues).toHaveLength(0);
  });

  it('lists each issue with severity and a remedy (#1030 bar)', async () => {
    const { w } = mountValidate({
      'okf/fetchValidation': () =>
        Promise.resolve({
          ok: true,
          report: reportWith([
            {
              type: 'conformance',
              severity: 'blocker',
              concept_id: 'c1',
              title: 'Page One',
              code: 'MISSING_TYPE',
              message: 'type missing',
              remedy: 'Run Autocorrect (Step 8) — it fixes frontmatter issues automatically.'
            }
          ])
        })
    });
    await settle(w);
    expect(w.text()).toContain('Page One');
    expect(w.text()).toContain('How to fix');
    expect(w.text()).toContain('Run Autocorrect (Step 8) — it fixes frontmatter issues automatically.');
  });
});

describe('OkfStepValidate — orphan link suggestions (#1036 Class A)', () => {
  const orphanReport = () => ({
    ok: true,
    report: reportWith([
      {
        type: 'orphan',
        severity: 'warning',
        concept_id: 'lonely',
        title: 'Lonely Page',
        message: 'No page links to this concept.',
        remedy: 'Accept link suggestions.'
      }
    ])
  });

  it('fetches and renders proposals; accept wires the link and marks Done', async () => {
    const { w, dispatched } = mountValidate({
      'okf/fetchValidation': orphanReport,
      'okf/suggestLinks': () => ({
        ok: true,
        result: { concept_id: 'lonely', proposals: [{ to_concept_id: 'who-pen', label: 'PEN package', title: 'PEN' }] }
      }),
      'okf/acceptLink': () => ({ ok: true, result: { success: true } })
    });
    await settle(w);
    await w.find('.okf-step-validate__issue-actions button').trigger('click');
    await settle(w);
    expect(dispatched.some((d) => d.type === 'okf/suggestLinks' && d.payload.conceptId === 'lonely')).toBe(true);
    expect(w.text()).toContain('PEN package');
    const acceptBtn = w.findAll('button').find((b) => b.text() === 'Accept');
    expect(acceptBtn).toBeTruthy();
    await acceptBtn.trigger('click');
    await settle(w);
    expect(dispatched.some((d) => d.type === 'okf/acceptLink' && d.payload.toConceptId === 'who-pen')).toBe(true);
    expect(w.text()).toContain('Done');
  });

  it('shows the manual-fallback note when the LLM returns nothing', async () => {
    const { w } = mountValidate({
      'okf/fetchValidation': orphanReport,
      'okf/suggestLinks': () => ({ ok: true, result: { concept_id: 'lonely', proposals: [] } })
    });
    await settle(w);
    await w.find('.okf-step-validate__issue-actions button').trigger('click');
    await settle(w);
    expect(w.text()).toContain('No suggestions — link it manually in the editor.');
  });
});

describe('OkfStepValidate — near-duplicate remedy (#1036 Class B)', () => {
  it('lists the members and deletes through the store action', async () => {
    const { w, dispatched } = mountValidate({
      'okf/fetchValidation': () =>
        Promise.resolve({
          ok: true,
          report: reportWith([
            {
              type: 'near_duplicate',
              severity: 'warning',
              concept_id: null,
              title: '5 near-identical pages',
              members: ['set-1', 'set-2', 'set-3', 'set-4', 'set-5'],
              message: 'near-identical content',
              remedy: 'Keep one copy and delete the others.'
            }
          ])
        })
    });
    await settle(w);
    expect(w.text()).toContain('Keep one copy — delete the rest.');
    expect(w.text()).toContain('set-3');
    const deleteBtns = w.findAll('button').filter((b) => b.text() === 'Delete');
    expect(deleteBtns.length).toBe(5);
    await deleteBtns[2].trigger('click');
    await settle(w);
    expect(dispatched.some((d) => d.type === 'okf/deleteConcept' && d.payload.conceptId === 'set-3')).toBe(true);
  });
});

describe('OkfStepValidate — citation hub wiring (#1036 Option 2)', () => {
  it('offers one-click create-and-wire when no hub exists, then refreshes', async () => {
    const { w, dispatched } = mountValidate({
      'okf/fetchValidation': () =>
        Promise.resolve({
          ok: true,
          report: reportWith([
            {
              type: 'citation',
              severity: 'warning',
              concept_id: null,
              title: 'Citations have no Sources page',
              message: '46 page(s) cite documents but do not link to the Sources page.',
              remedy: 'Create the Sources page.',
              citing_count: 46,
              hub_concept_id: null
            }
          ])
        }),
      'okf/wireCitations': () => ({ ok: true, result: { hub_concept_id: 'sources', hub_created: true, wired: 46 } })
    });
    await settle(w);
    const btn = w.findAll('button').find((b) => b.text().includes('Create the Sources page'));
    expect(btn).toBeTruthy();
    expect(btn.text()).toContain('46');
    await btn.trigger('click');
    await settle(w);
    expect(dispatched.some((d) => d.type === 'okf/wireCitations')).toBe(true);
    expect(w.text()).toContain('Created the Sources page and linked 46 page(s).');
  });

  it('offers link-to-existing when the bundle shipped its own sources page', async () => {
    const { w } = mountValidate({
      'okf/fetchValidation': () =>
        Promise.resolve({
          ok: true,
          report: reportWith([
            {
              type: 'citation',
              severity: 'warning',
              concept_id: null,
              title: 'Citations not linked',
              message: '12 page(s) cite documents.',
              remedy: 'Link them.',
              citing_count: 12,
              hub_concept_id: 'who-sources'
            }
          ])
        })
    });
    await settle(w);
    const btn = w.findAll('button').find((b) => b.text().includes('who-sources'));
    expect(btn).toBeTruthy();
    expect(btn.text()).toContain('12');
  });
});

// #1038: the PII vocabulary is 'clean' | 'hit' | 'unknown' — the panel used
// to filter 'flagged', a value that never occurs, so flagged pages were
// invisible in Step 7.
describe('OkfStepValidate — PII panel (#1038)', () => {
  const conceptsShape = () => ({
    ok: true,
    concepts: [
      { concept_id: 'hit-1', title: 'Flagged Page', pii_state: 'hit', index_status: 'parsed' },
      { concept_id: 'clean-1', title: 'Clean Page', pii_state: 'clean', index_status: 'parsed' },
      { concept_id: 'unknown-1', title: 'Unknown Page', pii_state: 'unknown', index_status: 'parsed' }
    ]
  });

  it('shows the remediation panel for pii_state=hit pages only', async () => {
    const { w } = mountValidate({
      'okf/fetchConcepts': conceptsShape,
      'okf/fetchValidation': () => Promise.resolve({ ok: true, report: reportWith([]) })
    });
    await settle(w);
    expect(w.find('.okf-step-validate__pii').exists()).toBe(true);
    expect(w.text()).toContain('Flagged Page');
    expect(w.vm.piiConcepts.map((c) => c.concept_id)).toEqual(['hit-1']);
    expect(w.text()).not.toContain('Clean Page');
    // the occurrences panel mounts for the selected hit concept
    expect(w.find('.pii-stub').exists()).toBe(true);
  });

  it('renders no PII panel when nothing was flagged', async () => {
    const { w } = mountValidate({
      'okf/fetchConcepts': () => ({
        ok: true,
        concepts: [{ concept_id: 'clean-1', title: 'Clean Page', pii_state: 'clean', index_status: 'parsed' }]
      }),
      'okf/fetchValidation': () => Promise.resolve({ ok: true, report: reportWith([]) })
    });
    await settle(w);
    expect(w.find('.okf-step-validate__pii').exists()).toBe(false);
  });
});

// #1039: merged conformance rows — identical findings across many pages
// collapse into one row of concept chips instead of N identical rows.
describe('OkfStepValidate — merged conformance rows (#1039)', () => {
  const conformanceIssue = (cid) => ({
    type: 'conformance',
    severity: 'warning',
    concept_id: cid,
    title: cid,
    code: 'UNPARSEABLE_STALE_AFTER',
    message: 'stale_after is not a YYYY-MM-DD date',
    remedy: 'Run Autocorrect (Step 8).'
  });

  it('merges same code+message into one row with a chip per page', async () => {
    const { w } = mountValidate({
      'okf/fetchValidation': () =>
        Promise.resolve({ ok: true, report: reportWith([conformanceIssue('a1'), conformanceIssue('a2')]) })
    });
    await settle(w);
    expect(w.vm.validationIssues).toHaveLength(1);
    expect(w.vm.validationIssues[0].concepts).toEqual(['a1', 'a2']);
    expect(w.text()).toContain('a1');
    expect(w.text()).toContain('a2');
    expect(w.text()).toContain('2 pages');
  });

  it('keeps distinct codes as separate rows', async () => {
    const other = { ...conformanceIssue('b1'), code: 'MISSING_TYPE', message: 'type missing' };
    const { w } = mountValidate({
      'okf/fetchValidation': () => Promise.resolve({ ok: true, report: reportWith([conformanceIssue('a1'), other]) })
    });
    await settle(w);
    expect(w.vm.validationIssues).toHaveLength(2);
  });
});

// #1039: the steward must SEE the duplicate content before deleting anything.
describe('OkfStepValidate — near-duplicate preview (#1039)', () => {
  const dupIssue = () => ({
    type: 'near_duplicate',
    severity: 'warning',
    concept_id: null,
    title: '2 near-identical pages',
    members: ['dup-a', 'dup-b'],
    message: 'near-identical content',
    remedy: 'Keep one copy and delete the others.'
  });

  it('fetches member bodies on toggle and renders them side by side', async () => {
    const fetched = [];
    const { w } = mountValidate({
      'okf/fetchValidation': () => Promise.resolve({ ok: true, report: reportWith([dupIssue()]) }),
      'okf/getConcept': (p) => {
        fetched.push(p.conceptId);
        return {
          ok: true,
          concept: { concept_id: p.conceptId, title: p.conceptId.toUpperCase(), body: 'BODY-OF-' + p.conceptId }
        };
      }
    });
    await settle(w);
    const previewBtn = w.findAll('button').find((b) => b.text() === 'Preview duplicates');
    expect(previewBtn).toBeTruthy();
    await previewBtn.trigger('click');
    await settle(w);
    await settle(w);
    expect(fetched.sort()).toEqual(['dup-a', 'dup-b']);
    expect(w.text()).toContain('BODY-OF-dup-a');
    expect(w.text()).toContain('First 1500 characters');
    // toggle closed
    const hideBtn = w.findAll('button').find((b) => b.text() === 'Hide preview');
    await hideBtn.trigger('click');
    await settle(w);
    expect(w.text()).not.toContain('BODY-OF-dup-a');
  });

  it('caps the preview at 5 members', async () => {
    const fetched = [];
    const issue = dupIssue();
    issue.members = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    const { w } = mountValidate({
      'okf/fetchValidation': () => Promise.resolve({ ok: true, report: reportWith([issue]) }),
      'okf/getConcept': (p) => {
        fetched.push(p.conceptId);
        return { ok: true, concept: { concept_id: p.conceptId, title: p.conceptId, body: 'x' } };
      }
    });
    await settle(w);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Preview duplicates')
      .trigger('click');
    await settle(w);
    await settle(w);
    expect(fetched).toHaveLength(5);
  });
});
