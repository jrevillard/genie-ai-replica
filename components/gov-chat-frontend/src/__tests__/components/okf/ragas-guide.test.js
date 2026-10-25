// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 — the RAGAS operator guide (David, 2026-10-23: "a fairly
// detailed help section … the things to do and not to do … make it
// comprehensive").
//
// Two things are worth pinning here:
//
//   1. The guide is a PLAYBOOK, not the field glossary. If a chapter ever
//      loses its do / don't / expect triple it has stopped answering "what
//      should I do?" and become decoration — that is the failure mode this
//      file exists to catch.
//
//   2. Every locale must RESOLVE every guide key to a non-empty string.
//      localeConsistency.test.js proves the keys exist; it cannot tell a
//      translated sentence from an empty string, which renders as a blank
//      bullet with no error anywhere.

import { mount } from '@vue/test-utils';
import RagasGuideDialog from '@/components/okf/editor/RagasGuideDialog.vue';
import en from '@/i18n/locales/en.js';

const LOCALES = ['ar', 'bn', 'de', 'en', 'es', 'fr', 'id', 'man', 'pt', 'ru', 'st', 'sw', 'th', 'zh'];

// The shape every locale must reproduce.
const CHAPTERS = ['generate', 'curate', 'run', 'models', 'read', 'errors'];

// The error→result mapping (David 2026-10-25: "whatever you decide to do
// with errors and how they are mapped to benchmark results must be
// documented in the embedded guide for users"). The table is a chapter
// like any other — it has its own keys, and they must resolve too.
const ERROR_STATES = ['error', 'abstained', 'unmeasured', 'belowThreshold', 'outOfScope'];
const ERROR_COLUMNS = ['state', 'meaning', 'effect'];

// The OUTPUT reading table (David 2026-10-25: "You have not updated the
// guide to explain how to read the 55/100 etc. in the output"). The rows are
// the ON-SCREEN pieces — the mean, the coverage fraction, the invalid-run
// banner, the run name, the re-score and the status — never the metrics
// themselves: the metric list is the product's, and a guide that hardcoded
// them would go stale the day one is added.
const OUTPUT_ELEMENTS = ['mean', 'coverage', 'banner', 'runName', 'rescore', 'status'];
const OUTPUT_COLUMNS = ['element', 'meaning', 'effect'];

const guideKeyPaths = () => {
  const paths = ['open', 'title', 'intro', 'close', 'more', 'labels.do', 'labels.dont', 'labels.expect'];
  for (const ch of CHAPTERS) {
    paths.push(`chapters.${ch}.title`, `chapters.${ch}.intro`, `chapters.${ch}.expect`);
    for (let i = 1; i <= 4; i += 1) paths.push(`chapters.${ch}.d${i}`);
    for (let i = 1; i <= 3; i += 1) paths.push(`chapters.${ch}.x${i}`);
  }
  paths.push('chapters.errors.table.title');
  for (const c of ERROR_COLUMNS) paths.push(`chapters.errors.table.col.${c}`);
  for (const s of ERROR_STATES) {
    for (const c of ERROR_COLUMNS) paths.push(`chapters.errors.table.${s}.${c}`);
  }
  paths.push('chapters.read.table.title');
  for (const c of OUTPUT_COLUMNS) paths.push(`chapters.read.table.col.${c}`);
  for (const e of OUTPUT_ELEMENTS) {
    for (const c of OUTPUT_COLUMNS) paths.push(`chapters.read.table.${e}.${c}`);
  }
  return paths;
};

function mountGuide(props = {}) {
  return mount(RagasGuideDialog, {
    props: { visible: true, ...props },
    global: {
      mocks: { $i18n: { locale: 'en', messages: { en } } },
      stubs: {
        DsDialog: { template: '<div class="dialog-stub"><slot /></div>' },
        DsTabs: { template: '<div class="tabs-stub"><slot /></div>' },
        DsCard: { template: '<div class="card-stub"><slot /></div>' },
        DsPill: { template: '<span class="pill-stub"><slot /></span>' },
        DsTable: {
          props: ['columns', 'rows', 'rowKey'],
          template: `
            <div class="table-stub">
              <div v-for="c in columns" :key="'col-' + c.key" class="table-stub__head">{{ c.label }}</div>
              <div v-for="r in rows" :key="'row-' + r[rowKey]" class="table-stub__row">
                <span v-for="c in columns" :key="'cell-' + c.key" class="table-stub__cell">
                  <slot :name="'cell-' + c.key" :row="r" :column="c" :value="r[c.key]">{{ r[c.key] }}</slot>
                </span>
              </div>
            </div>
          `
        }
      }
    }
  });
}

/** The guide renders EVERY chapter (v-show), so a table assertion has to be
 * scoped to its own chapter. The panes are in CHAPTERS order. */
const paneFor = (w, key) => w.findAll('.okf-guide__pane')[CHAPTERS.indexOf(key)];

describe('RagasGuideDialog', () => {
  it('exposes all six chapters in the order an operator works in', () => {
    const w = mountGuide();
    expect(w.vm.chapters.map((c) => c.key)).toEqual(CHAPTERS);
    expect(w.vm.tabDefs.map((t) => t.label)).toEqual(w.vm.chapters.map((c) => c.title));
    // the tab opens on the first chapter, not on a stale one
    expect(w.vm.tab).toBe('generate');
  });

  it("every chapter carries 4 dos, 3 don'ts and one expectation", () => {
    const w = mountGuide();
    for (const ch of w.vm.chapters) {
      expect(ch.do).toHaveLength(4);
      expect(ch.dont).toHaveLength(3);
      expect(ch.expect).not.toBe('');
      expect(ch.intro).not.toBe('');
    }
  });

  it('renders the guide content from the locale tree, not from a hard-coded English fallback', () => {
    const w = mountGuide();
    const text = w.text();
    // Two facts that only appear in the guide (not in the field glossary),
    // proving the chapter bodies actually render.
    expect(text).toContain('knowledge-graph pass');
    expect(text).toContain('runs backwards');
    // no key leaked through as a raw dotted path
    expect(text).not.toContain('okf.ragas.guide.chapters');
  });

  it("do/don't bullets are grouped under their own headings", () => {
    const w = mountGuide();
    const text = w.text();
    expect(text).toContain('Do this');
    expect(text).toContain("Don't");
    expect(text).toContain('What to expect');
    expect(w.findAll('.okf-guide__item')).toHaveLength(CHAPTERS.length * 7);
  });

  it('close (footer action and backdrop) emits close; nothing else does', async () => {
    const w = mountGuide();
    await w.vm.onAction('close');
    expect(w.emitted('close')).toHaveLength(1);
    await w.vm.onAction('something-else');
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('reopening resets to the first chapter', async () => {
    const w = mountGuide({ visible: false });
    w.vm.tab = 'run';
    await w.setProps({ visible: true });
    expect(w.vm.tab).toBe('generate');
  });

  // The gap localeConsistency cannot see: a key that EXISTS but holds an
  // empty string renders as a blank bullet and fails silently.
  it.each(LOCALES)('%s resolves every guide key to a non-empty string', (locale) => {
    const data = require(`@/i18n/locales/${locale}.js`).default;
    const get = (path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), data);
    const empty = [];
    for (const path of guideKeyPaths()) {
      const v = get(`okf.ragas.guide.${path}`);
      if (typeof v !== 'string' || v.trim() === '') empty.push(path);
    }
    expect(empty).toEqual([]);
  });

  // The error→result mapping is the part an operator reads when a number
  // looks wrong, so it has to be a real table with a row per state — not a
  // paragraph that mentions the states.
  describe('the error→result mapping', () => {
    it('gives every documented state a row, with a meaning and an effect', () => {
      const w = mountGuide();
      const chapter = w.vm.chapters.find((c) => c.key === 'errors');
      expect(chapter.table).not.toBeNull();
      expect(chapter.table.columns.map((c) => c.key)).toEqual(ERROR_COLUMNS);
      expect(chapter.table.rows).toHaveLength(ERROR_STATES.length);
      for (const row of chapter.table.rows) {
        for (const c of ERROR_COLUMNS) {
          expect(row[c]).toEqual(expect.any(String));
          expect(row[c].trim()).not.toBe('');
        }
      }
    });

    it('renders the mapping as a table, so a state is findable by its label', () => {
      const w = mountGuide();
      const text = w.text();
      expect(paneFor(w, 'errors').findAll('.table-stub__row')).toHaveLength(ERROR_STATES.length);
      // the labels an operator will actually see
      expect(text).toContain('error');
      expect(text).toContain('not measured');
      expect(text).toContain('out of scope');
    });

    it('says the two things that are easy to get wrong: an abstention is not an error, and an unmeasured metric is not a zero', () => {
      const w = mountGuide();
      const text = w.text();
      expect(text).toMatch(/never in the error column/i);
      expect(text).toMatch(/does not invalidate the run/i);
      expect(text).toMatch(/never a zero/i);
    });

    // The two states that look alike and are NOT alike (2026-10-25). A row
    // that produced NO ANSWER has nothing to judge, so it is never handed to
    // the judge and it never counts as a zero. A row that DECLINED still has
    // an answer, so it IS judged — and with nothing supporting it, its
    // context metrics come back 0, and those zeros ARE in the averages.
    //
    // The guide used to claim the opposite for the failed row (it said every
    // row reaches the judge). That was true of the code until the run path
    // was fixed to judge only the rows that produced an answer.
    it('says that a failed row is NOT judged, and never counts as a zero', () => {
      const w = mountGuide();
      const chapter = w.vm.chapters.find((c) => c.key === 'errors');
      const errorRow = chapter.table.rows.find((r) => r.state === 'errored');
      expect(errorRow.effect).toMatch(/NOT handed to the judge/i);
      expect(errorRow.effect).toMatch(/never counted as a zero/i);
      // The retracted claim must be gone for the ERRORED row.
      expect(errorRow.effect).not.toMatch(/still handed to the judge/i);
    });

    it('says that an abstention IS judged, and its zeros ARE in the averages', () => {
      const w = mountGuide();
      const chapter = w.vm.chapters.find((c) => c.key === 'errors');
      const abstainedRow = chapter.table.rows.find((r) => r.state === 'abstained');
      expect(abstainedRow.effect).toMatch(/still handed to the judge/i);
      expect(abstainedRow.effect).toMatch(/zeros ARE counted in the averages/i);
    });

    it('the chapter says the failed row is excluded and the abstention is not', () => {
      const w = mountGuide();
      const text = w.text();
      expect(text).toMatch(/NO ANSWER is never handed to the judge/i);
      expect(text).toMatch(/DECLINED still has an answer/i);
    });
  });

  // The OUTPUT reading table (David 2026-10-25: "You have not updated the
  // guide to explain how to read the 55/100 etc. in the output"). The
  // coverage fraction is the number operators misread most: "0.87 55/100" is
  // a mean over 55 rows, not a score for 100 — so it gets its own row.
  describe('the output reading table', () => {
    it('gives every on-screen piece a row, with a meaning and an effect', () => {
      const w = mountGuide();
      const chapter = w.vm.chapters.find((c) => c.key === 'read');
      expect(chapter.table).not.toBeNull();
      expect(chapter.table.columns.map((c) => c.key)).toEqual(OUTPUT_COLUMNS);
      expect(chapter.table.rows).toHaveLength(OUTPUT_ELEMENTS.length);
      for (const row of chapter.table.rows) {
        for (const c of OUTPUT_COLUMNS) {
          expect(row[c]).toEqual(expect.any(String));
          expect(row[c].trim()).not.toBe('');
        }
      }
    });

    it('renders as a table in the read chapter, so an element is findable by its label', () => {
      const w = mountGuide();
      const pane = paneFor(w, 'read');
      expect(pane.findAll('.table-stub__row')).toHaveLength(OUTPUT_ELEMENTS.length);
      const text = pane.text();
      expect(text).toContain('The fraction (55/100)');
      expect(text).toContain('The invalid-run banner');
      expect(text).toContain('Re-score');
    });

    // The three misreadings this table exists to prevent.
    it('says the fraction is not the score, the banner is a floor, and a running run is still moving', () => {
      const w = mountGuide();
      const text = paneFor(w, 'read').text();
      // the fraction: the mean covers only the rows the judge scored
      expect(text).toMatch(/never counted as zero/i);
      // the banner: one weak metric does not raise it
      expect(text).toMatch(/21\/100/);
      expect(text).toMatch(/floor, not a summary/i);
      // the status: a running run's numbers are still moving
      expect(text).toMatch(/still moving/i);
    });

    // The table must not name a metric: the metric list is the product's
    // (ALL_METRICS), and a guide that hardcoded them would go stale.
    it('does not hardcode a metric name — the metric list is the product’s', () => {
      const w = mountGuide();
      const text = paneFor(w, 'read').text();
      for (const m of ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy']) {
        expect(text).not.toContain(m);
      }
    });
  });
});
