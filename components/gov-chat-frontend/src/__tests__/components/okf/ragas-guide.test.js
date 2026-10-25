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
          props: ['columns', 'rows'],
          template: `
            <div class="table-stub">
              <div v-for="c in columns" :key="'col-' + c.key" class="table-stub__head">{{ c.label }}</div>
              <div v-for="r in rows" :key="'row-' + r.state" class="table-stub__row">
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
      expect(w.findAll('.table-stub__row')).toHaveLength(ERROR_STATES.length);
      // the labels an operator will actually see
      expect(text).toContain('error');
      expect(text).toContain('not measured');
      expect(text).toContain('out of scope');
    });

    it('says the two things that are easy to get wrong: abstention is not a failure, and an unmeasured metric is not a zero', () => {
      const w = mountGuide();
      const text = w.text();
      expect(text).toMatch(/never a metric failure/i);
      expect(text).toMatch(/never a zero/i);
    });
  });
});
