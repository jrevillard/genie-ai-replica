'use strict';

/**
 * Step 4 per-stage bars must render the TRUE state (curation-counter fix).
 *
 * REGRESSION GUARD for a live defect (2026-10-12): the "Curating" bar froze at
 * "61 of 141 concepts labelled" on a repository whose conversion had reached
 * status done, while the database actually held 80 labelled concepts. Three of
 * eight repositories showed the same frozen bar.
 *
 * The root cause was server-side — `curated` counted what THIS pass newly
 * labelled while `total` counted every concept that existed (pre-labelled ones
 * and the index row included), so the two numbers described different
 * populations and `curated >= total` was unreachable by construction. This file
 * guards the FRONTEND half: whatever the server sends, the bar must never
 * render a confident wrong percentage, and a stage the server has explicitly
 * finished must render DONE.
 *
 * The three properties asserted here are the ones a curator's publish decision
 * rests on:
 *
 *  1. A stage the server marked FINISHED renders done, even when its counters
 *     are stale or contradictory (curated < total).
 *  2. Counters that DISAGREE with each other do NOT produce a confident
 *     percentage — they degrade to an honest indeterminate state.
 *  3. The new server fields are read PREFERENTIALLY when present, and the OLD
 *     shape (a stale cached bundle served against a fixed server) still renders
 *     sanely rather than crashing or blanking the panel.
 */

const { mount } = require('@vue/test-utils');

const mockRepoGet = jest.fn();
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockRepoGet(...a),
    listConcepts: jest.fn(() => Promise.resolve([])),
    importDocuments: jest.fn(() => Promise.resolve({ status: 202 })),
    convertFromCrawlInto: jest.fn(() => Promise.resolve({ status: 202 })),
    loadSubjectAreaOptions: jest.fn(() => Promise.resolve([]))
  }
}));
jest.mock('oidc-client-ts', () => ({ UserManager: jest.fn() }));

const OkfStepProduce = require('@/components/okf/steps/Produce.vue').default;

const DRAFT = { repo_id: 'r1', name: 'Solar System', input: { document_ids: ['d1', 'd2'] } };

// The exact live shape that froze: a REPO built from 5 documents (pdf, xlsx,
// csv, docx) producing 141 concepts, of which 19 arrived PRE-LABELLED via the
// FR-42 tabular path. The heuristics pass correctly skipped those 19 and
// curated 61 more; 61 + 19 = 80, which is what the database actually held
// while the UI read "61 of 141".
const LIVE_REPO_FROZEN = {
  repo_id: 'r1',
  conversion: {
    status: 'done',
    stage: 'done',
    files_done: 5,
    files_total: 5,
    concepts_done: 141,
    concepts_total: 141
  },
  // The OLD (buggy) server shape: pass-local numerator over a corpus-wide
  // denominator, and no `final` flag — the terminal write was throttled away.
  curation: { method: 'heuristics', total: 141, curated: 61, labeled: 61, described: 0, typed: 0, fallbacks: 0 }
};

// The FIXED server shape per the counter contract in llm-curation-service.js:
// one population on both sides, `done` an alias of `curated`, and `final: true`
// on the terminal write.
const LIVE_REPO_FIXED = {
  repo_id: 'r1',
  conversion: {
    status: 'done',
    stage: 'done',
    files_done: 5,
    files_total: 5,
    concepts_done: 141,
    concepts_total: 141
  },
  curation: {
    method: 'heuristics',
    total: 140, // the index root is out of the curatable population
    pre_labelled: 19,
    curated: 80, // 19 pre-labelled + 61 this pass — ground truth
    done: 80, // the alias the UI is told to prefer
    final: true,
    labeled: 61,
    described: 0,
    typed: 0,
    fallbacks: 0
  }
};

function fakeStore() {
  return {
    getters: {
      'okf/isExpert': false,
      'okf/repoById': jest.fn(() => null),
      'okf/activeDraft': jest.fn(() => null)
    },
    dispatch: jest.fn(() => Promise.resolve({ ok: true, result: null }))
  };
}

const flush = async () => {
  await new Promise((r) => setTimeout(r, 25));
};

async function mountProduce(draft = DRAFT) {
  const wrapper = mount(OkfStepProduce, {
    global: {
      mocks: { $store: fakeStore() },
      stubs: { DsButton: true, DsProgress: true }
    },
    props: { draft, expert: false }
  });
  if (wrapper.vm.pollTimer) clearInterval(wrapper.vm.pollTimer);
  await flush();
  return wrapper;
}

/** Mount, then drive the bars from an explicit repo document.
 *
 * NO JSON round-trip here: JSON.stringify turns NaN into null, which would
 * silently convert a corrupt-counter case into the (different, legitimate)
 * absent-counter case and make these tests pass for the wrong reason. */
async function renderWith(repo, { status = 'done' } = {}) {
  const w = await mountProduce();
  w.vm.liveRepo = repo;
  w.vm.status = status;
  await w.vm.$nextTick();
  return w;
}

const rowOf = (w, key) => w.vm.stageList.find((r) => r.key === key);

let w;
afterEach(() => {
  if (w) w.unmount();
  w = null;
  mockRepoGet.mockReset();
});

beforeEach(() => {
  mockRepoGet.mockResolvedValue(JSON.parse(JSON.stringify(LIVE_REPO_FIXED)));
});

describe('Produce — a stage the server marked finished renders DONE', () => {
  test('the live frozen case: curated (61) < total (141) but the conversion is done ⇒ done, not 44%', async () => {
    w = await renderWith(LIVE_REPO_FROZEN);
    const curating = rowOf(w, 'curating');

    // The bug: this row sat at pctOf(61, 141) = 43% forever.
    expect(curating.pct).not.toBe(43);
    expect(curating.done).toBe(true);
    // A finished stage must read 100% — the bar answers "still working?".
    expect(curating.pct).toBe(100);
    // …and it must not keep animating after the stage ended.
    expect(curating.active).toBe(false);
    expect(curating.indeterminate).toBe(false);
  });

  test('the counters stay VISIBLE on a finished row — nothing is hidden by rounding the bar up', async () => {
    w = await renderWith(LIVE_REPO_FROZEN);
    // The bar says "finished"; the text still carries the precise measurement,
    // so the curator is never shown a rounded-up bar with nothing behind it.
    expect(rowOf(w, 'curating').count).toContain('61');
    expect(rowOf(w, 'curating').count).toContain('141');
    expect(w.text()).toContain('61');
    expect(w.text()).toContain('141');
  });

  test("the curation pass's OWN final flag finishes the row while the conversion is still running", async () => {
    // Real sequencing (producer-service.js:625 then :693): the curation pass
    // writes `final: true` BEFORE the conversion flips to done, because
    // cross-linking runs in between. A row that waited for conv.status === 'done'
    // would keep animating through that whole window.
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'linking-topics' }
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');

    expect(curating.done).toBe(true);
    expect(curating.pct).toBe(100);
    expect(curating.active).toBe(false);
  });

  test('every row finishes when the conversion finishes, whatever its own counters say', async () => {
    const repo = {
      ...LIVE_REPO_FROZEN,
      conversion: { ...LIVE_REPO_FROZEN.conversion, files_done: 1, files_total: 5 }
    };
    w = await renderWith(repo);
    for (const row of w.vm.stageList) {
      expect(row.done).toBe(true);
      expect(row.active).toBe(false);
    }
  });

  test('saturation alone also reaches the terminal state (a fixed server need not send `final`)', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      curation: { ...LIVE_REPO_FIXED.curation, done: 140, curated: 140, final: undefined }
    };
    w = await renderWith(repo, { status: 'running' });
    expect(rowOf(w, 'curating').done).toBe(true);
    expect(rowOf(w, 'curating').pct).toBe(100);
  });
});

describe('Produce — disagreeing counters never render a confident percentage', () => {
  test('a numerator larger than its total degrades instead of showing >100%', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { method: 'llm', total: 141, curated: 200, done: 200 }
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');

    // The number is arithmetically impossible — at least one of the two is
    // wrong, so neither may be turned into a percentage the curator trusts.
    expect(curating.pct).toBe(0);
    expect(curating.indeterminate).toBe(true);
    expect(curating.variant).toBe('warning');
    // …and it must not claim to be done, nor confidently highlight as running.
    expect(curating.done).toBe(false);
    expect(curating.active).toBe(false);
  });

  test('mismatched counters do not highlight the row as the running leg', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { total: 10, curated: 99, done: 99 }
    };
    w = await renderWith(repo, { status: 'running' });
    expect(rowOf(w, 'curating').active).toBe(false);
    expect(w.findAll('.okf-step__stage--active')).toHaveLength(0);
  });

  test('a CORRUPT numerator (NaN / negative / non-numeric) never becomes a confident count', async () => {
    // These values are PRESENT but unusable — the payload is malformed, and
    // rendering it as "0 of 141" would be a confident zero invented from
    // garbage, the same class of lie as the frozen bar.
    for (const bad of [NaN, -5, 'many', {}]) {
      const repo = {
        ...LIVE_REPO_FIXED,
        conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
        curation: { total: 141, curated: bad, done: bad }
      };
      w = await renderWith(repo, { status: 'running' });
      const curating = rowOf(w, 'curating');
      expect(curating.count).toBe('Count unavailable');
      expect(curating.count).not.toContain('0 of 141');
      expect(curating.pct).toBe(0);
      expect(curating.variant).toBe('warning');
      expect(Number.isNaN(curating.pct)).toBe(false);
      expect(w.text()).not.toContain('NaN');
    }
  });

  test('an ABSENT numerator is the ordinary start-of-pass state and reads as a true zero', async () => {
    // Distinct from garbage: the server knows the population (141) and has
    // counted nothing yet. "0 of 141" is a TRUE statement here and the curator
    // needs to see it, so it must NOT be degraded to "Count unavailable".
    for (const absent of [null, undefined]) {
      const repo = {
        ...LIVE_REPO_FIXED,
        conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
        curation: { total: 141, curated: absent, done: absent }
      };
      w = await renderWith(repo, { status: 'running' });
      const curating = rowOf(w, 'curating');
      expect(curating.count).toContain('0 of 141');
      expect(curating.pct).toBe(0);
      expect(curating.variant).toBe('accent');
      expect(curating.active).toBe(true);
    }
  });

  test('a corrupt numerator with an ABSENT total does not crash the row', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { total: undefined, curated: NaN, done: 'nonsense' }
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');
    expect(Number.isNaN(curating.pct)).toBe(false);
    expect(w.text()).not.toContain('NaN');
  });

  test('an out-of-range total does not produce a negative or infinite percentage', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { total: 141, curated: 50, done: 50 }
    };
    w = await renderWith(repo, { status: 'running' });
    const pct = rowOf(w, 'curating').pct;
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

describe('Produce — new server fields are preferred, old shape degrades sanely', () => {
  test('`done` is read PREFERENTIALLY over `curated` when both are present', async () => {
    // The fixed server guarantees done === curated. A payload where they
    // disagree means one is a stale pass-local count: `done` is the field the
    // counter contract pins as the honest alias, so it wins.
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { total: 140, curated: 61, done: 80 }
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');
    expect(curating.count).toContain('80');
    expect(curating.count).not.toContain('61');
  });

  test('the old shape (no `done` field) still renders — the stale-bundle case', async () => {
    // A stale cached bundle served against a server that DOES write `done`:
    // the fallback chain must reach it rather than rendering nothing.
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { total: 140, curated: 80 } // `done` deliberately absent
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');
    expect(curating.count).toContain('80');
    expect(curating.count).toContain('140');
    // 80 of 140 is a genuine mid-pass reading: still running, not finished, and
    // NOT falsely claimed done. The point is that it renders at all.
    expect(curating.done).toBe(false);
    expect(curating.pct).toBe(57);
    expect(curating.active).toBe(true);
  });

  test('a genuinely older server (no `done`, no `final`) does not crash or blank the panel', async () => {
    // Pre-fix shape entirely: only total + curated. The panel must still render
    // every row with a real number — this is the case the live bug came from.
    const repo = {
      ...LIVE_REPO_FROZEN,
      conversion: { ...LIVE_REPO_FROZEN.conversion, status: 'running', stage: 'curating' },
      curation: { total: 141, curated: 61 }
    };
    w = await renderWith(repo, { status: 'running' });
    const text = w.text();
    expect(text).toContain('Curating');
    expect(text).toContain('61');
    expect(text).toContain('141');
    expect(w.findAll('.okf-step__stage')).toHaveLength(3);
  });

  test('the fixed server renders the TRUE labelled count the old one could not', async () => {
    // 80 of 140 (index row excluded) — the honest ground truth the database
    // held, versus the old "61 of 141" that divided two different populations.
    w = await renderWith(LIVE_REPO_FIXED);
    const curating = rowOf(w, 'curating');
    expect(curating.count).toContain('80');
    expect(curating.count).toContain('140');
    expect(curating.count).not.toContain('141');
    expect(curating.done).toBe(true);
  });

  test('an entirely absent curation payload renders Waiting, not NaN', async () => {
    const repo = { repo_id: 'r1', conversion: { status: 'running', stage: 'downloading' } };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');
    expect(curating.count).toBe('Waiting');
    expect(Number.isNaN(curating.pct)).toBe(false);
    expect(w.text()).not.toContain('NaN');
  });

  test('a finished pass with no total renders Complete, not 0%', async () => {
    // A repo whose concepts were ALL labelled at creation: total is 0 because
    // the server never had to schedule work. "0%" would be a lie about a
    // finished stage.
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: { total: 0, curated: 0, done: 0, final: true }
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');
    expect(curating.done).toBe(true);
    expect(curating.pct).toBe(100);
    expect(curating.count).toBe('Complete');
  });
});

describe('Produce — monotonic rendering across ticks', () => {
  test('the curating row never shows the count going backwards as ticks land', async () => {
    w = await renderWith(LIVE_REPO_FIXED, { status: 'running' });
    const seen = [];
    // The server's terminal write takes the DB count with Math.max, so a
    // concurrent writer can only RAISE it. The UI must not show a drop either.
    for (const n of [0, 19, 20, 61, 80]) {
      w.vm.liveRepo = {
        ...LIVE_REPO_FIXED,
        conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
        curation: { total: 140, curated: n, done: n }
      };
      await w.vm.$nextTick();
      seen.push(rowOf(w, 'curating').count);
    }
    const numbers = seen.map((c) => parseInt(c, 10));
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]).toBeGreaterThanOrEqual(numbers[i - 1]);
    }
    expect(numbers[numbers.length - 1]).toBe(80);
  });

  test('a running stage with no total yet animates indeterminate rather than a false 0%', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { ...LIVE_REPO_FIXED.conversion, status: 'running', stage: 'curating' },
      curation: {}
    };
    w = await renderWith(repo, { status: 'running' });
    const curating = rowOf(w, 'curating');
    expect(curating.pct).toBe(0);
    expect(curating.indeterminate).toBe(true);
    expect(curating.active).toBe(true);
  });
});

describe('Produce — the other stages keep their real counts', () => {
  test('files, concepts and cross-link each report their own numerator/denominator', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: {
        ...LIVE_REPO_FIXED.conversion,
        status: 'running',
        stage: 'linking-topics',
        files_done: 5,
        files_total: 5,
        concepts_done: 141,
        concepts_total: 141,
        link_progress: { batches_done: 2, batches_total: 8, written: 17 }
      }
    };
    w = await renderWith(repo, { status: 'running' });
    const files = rowOf(w, 'files');
    const concepts = rowOf(w, 'concepts');
    const cross = rowOf(w, 'crosslink');

    expect(files.count).toContain('5');
    expect(files.count).toContain('5');
    expect(files.done).toBe(true);
    expect(concepts.done).toBe(true);
    expect(cross.count).toContain('2');
    expect(cross.count).toContain('8');
    expect(cross.count).toContain('17');
  });

  test('the cross-link row finishes on its own `final` flag', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: {
        ...LIVE_REPO_FIXED.conversion,
        status: 'running',
        stage: 'linking-topics',
        link_progress: { batches_done: 8, batches_total: 8, written: 42, final: true }
      }
    };
    w = await renderWith(repo, { status: 'running' });
    expect(rowOf(w, 'crosslink').done).toBe(true);
    expect(rowOf(w, 'crosslink').pct).toBe(100);
  });

  test('the crawl leg still counts PAGES rather than documents', async () => {
    w = await mountProduce({ repo_id: 'r1', input: { crawl_seeds: [{ url: 'https://example.org' }] } });
    w.vm.liveRepo = {
      repo_id: 'r1',
      conversion: { status: 'running', stage: 'downloading', pages_done: 12, pages_total: 120 },
      curation: {}
    };
    await w.vm.$nextTick();
    const files = rowOf(w, 'files');
    expect(files.pct).toBe(10);
    expect(files.count).toContain('12');
    expect(files.count).toContain('120');
  });

  test('a concepts pass with progress but no total still reports what it has', async () => {
    const repo = {
      ...LIVE_REPO_FIXED,
      conversion: { status: 'running', stage: 'classifying', concepts_done: 913, concepts_total: 0 },
      curation: {}
    };
    w = await renderWith(repo, { status: 'running' });
    const concepts = rowOf(w, 'concepts');
    expect(concepts.count).toContain('913');
    expect(concepts.active).toBe(true);
  });
});
