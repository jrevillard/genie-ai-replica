// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// W6 / EPIC-6 / CAP-5 — the SHARED status vocabulary.
//
// THE CLAIM THIS SUITE PINS: the admin document list and the OKF artifacts
// view are two surfaces of the SAME data, so they must never disagree about
// what a dataprep status means. A bundle that reads "Ingested" in one and
// "Pending" in the other is the same class of lie this wave exists to
// remove.
//
// The test is an INVARIANT, not a snapshot: it drives both surfaces over
// the whole status vocabulary, in two locales, and asserts they produce the
// same label and the same status-tag variant. If one surface is ever
// rewired to a different key (or the shared util is bypassed), the two
// columns diverge and this fails.

import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import AdminDashboard from '@/components/AdminDashboard.vue';
import ArtifactsView from '@/components/okf/ArtifactsView.vue';
import enCatalogue from '@/i18n/locales/en';
import frCatalogue from '@/i18n/locales/fr';

jest.mock('@/services/documentFileService', () => ({
  __esModule: true,
  default: { getFiles: jest.fn().mockResolvedValue({ data: [], pagination: {} }) }
}));

/** Every status doc-repo can store, plus the two the catalogue does not
 *  know ('killed') and the absent one. */
const KNOWN = ['Pending', 'Ingesting', 'Ingested', 'Ingested with Warnings', 'Ingestion Error', 'Retracted'];
const UNKNOWN = ['killed'];
const ALL = [...KNOWN, ...UNKNOWN];

const LABELS = {
  en: { Pending: 'Pending', Ingesting: 'Ingesting', Ingested: 'Ingested' },
  fr: { Pending: 'En attente', Ingesting: 'Ingestion en cours', Ingested: 'Ingéré' }
};

function deepGet(obj, path) {
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/** An $i18n stand-in with vue-i18n's semantics: `t` returns the KEY when
 *  the catalogue has no message, so the callers' own fallback path runs. */
function makeI18n(locale, catalogue) {
  return {
    locale,
    messages: { en: enCatalogue, [locale]: catalogue },
    t: (key) => {
      const v = deepGet(catalogue, key);
      return typeof v === 'string' ? v : key;
    }
  };
}

function mountArtifacts(locale, catalogue) {
  return mount(ArtifactsView, {
    global: {
      plugins: [createStore({ modules: {} })],
      mocks: {
        $i18n: makeI18n(locale, catalogue),
        $route: { query: {} },
        $router: { push: jest.fn().mockResolvedValue() }
      }
    }
  });
}

/** The dashboard's context: its REAL translate method over the same
 *  catalogue the artifacts view reads. */
function dashboardCtx(locale, catalogue) {
  const i18n = makeI18n(locale, catalogue);
  return {
    $i18n: i18n,
    currentLocale: locale,
    translate: (key, fallback, named) =>
      AdminDashboard.methods.translate.call({ $i18n: i18n, currentLocale: locale }, key, fallback, named)
  };
}

const doc = (status) => (status === undefined ? {} : { dataprep: { status } });
const row = (status) => (status === undefined ? {} : { dataprep: { status } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the two surfaces share one status vocabulary', () => {
  test.each(ALL)('"%s" — the same LABEL in both surfaces (en)', async (status) => {
    const ctx = dashboardCtx('en', enCatalogue);
    const w = mountArtifacts('en', enCatalogue);
    expect(AdminDashboard.methods.getDisplayStatus.call(ctx, doc(status))).toBe(w.vm.stateLabel(row(status)));
  });

  test.each(ALL)('"%s" — the same VARIANT in both surfaces (en)', async (status) => {
    const ctx = dashboardCtx('en', enCatalogue);
    const w = mountArtifacts('en', enCatalogue);
    expect(AdminDashboard.methods.getStatusVariant.call(ctx, doc(status))).toBe(w.vm.stateVariant(row(status)));
  });

  test.each(ALL)('"%s" — the same LABEL in both surfaces (fr)', async (status) => {
    const ctx = dashboardCtx('fr', frCatalogue);
    const w = mountArtifacts('fr', frCatalogue);
    expect(AdminDashboard.methods.getDisplayStatus.call(ctx, doc(status))).toBe(w.vm.stateLabel(row(status)));
  });

  test('a known status is TRANSLATED (the fr label differs from the en one)', () => {
    const ctx = dashboardCtx('fr', frCatalogue);
    const w = mountArtifacts('fr', frCatalogue);
    const label = AdminDashboard.methods.getDisplayStatus.call(ctx, doc('Ingested'));
    expect(label).toBe(LABELS.fr.Ingested);
    expect(label).not.toBe(LABELS.en.Ingested);
    // …and the artifacts view shows exactly that label.
    expect(w.vm.stateLabel(row('Ingested'))).toBe(LABELS.fr.Ingested);
  });

  test('an UNKNOWN status renders its own raw value in both surfaces (honest, not blank)', () => {
    const ctx = dashboardCtx('en', enCatalogue);
    const w = mountArtifacts('en', enCatalogue);
    expect(AdminDashboard.methods.getDisplayStatus.call(ctx, doc('killed'))).toBe('killed');
    expect(w.vm.stateLabel(row('killed'))).toBe('killed');
  });

  test('a document with NO status reads "Unknown" in both surfaces (never a blank)', () => {
    const ctx = dashboardCtx('en', enCatalogue);
    const w = mountArtifacts('en', enCatalogue);
    expect(AdminDashboard.methods.getDisplayStatus.call(ctx, doc(undefined))).toBe('Unknown');
    expect(w.vm.stateLabel(row(undefined))).toBe('Unknown');
  });
});

describe('the document list keeps its crawl arms (a different vocabulary)', () => {
  test('a crawling document reads "Crawling" — the crawl status still wins', () => {
    const ctx = dashboardCtx('en', enCatalogue);
    const crawling = { crawl_job: { status: 'crawling' }, dataprep: { status: 'Pending' } };
    expect(AdminDashboard.methods.getDisplayStatus.call(ctx, crawling)).toBe('Crawling');
    expect(AdminDashboard.methods.getStatusVariant.call(ctx, crawling)).toBe('info');
  });

  test('a failed crawl reads "Crawl Failed" and the error variant', () => {
    const ctx = dashboardCtx('en', enCatalogue);
    const failed = { crawl_job: { status: 'failed' }, dataprep: { status: 'Pending' } };
    expect(AdminDashboard.methods.getDisplayStatus.call(ctx, failed)).toBe('Crawl Failed');
    expect(AdminDashboard.methods.getStatusVariant.call(ctx, failed)).toBe('error');
  });

  test('the artifacts view has no crawl job — it always speaks the dataprep vocabulary', () => {
    // An artifact IS the dataprep row; the crawl arms are the document
    // list's own vocabulary and never leak into the artifacts view.
    const w = mountArtifacts('en', enCatalogue);
    expect(w.vm.stateLabel({ crawl_job: { status: 'crawling' }, dataprep: { status: 'Ingested' } })).toBe('Ingested');
  });
});
