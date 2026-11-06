// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// W6 / EPIC-6 / CAP-5 — the ADMIN DASHBOARD seams of the artifacts wave.
//
// The dashboard is a 200K monolith; the house pattern for testing it is to
// call its methods/computeds with a hand-made context (the shape
// wizard-handoff.test.js uses for StudioTab). These are the four seams the
// wave touches:
//
//   1. the default document list asks for is_bundle: false — the bundles
//      LEAVE the list (they get the artifacts view);
//   2. a bundle in the selection is never deletable (the WS2 guard refuses
//      every non-okf-service delete → the "deletable but 403s" lie);
//   3. the refusal strip names the OKF lifecycle, not "retract it first"
//      (advice that cannot be followed on a bundle);
//   4. `?tab=studio&repo=` opens the Studio at a repository (the artifact →
//      repository direction).

import AdminDashboard from '@/components/AdminDashboard.vue';
import documentFileService from '@/services/documentFileService';

jest.mock('@/services/documentFileService', () => ({
  __esModule: true,
  default: { getFiles: jest.fn().mockResolvedValue({ data: [], pagination: {} }) }
}));

/** A dashboard context carrying only what the seam under test reads. */
function ctx(overrides = {}) {
  const c = {
    isDocumentsLoading: false,
    documents: [],
    selectedDocuments: [],
    documentPagination: { page: 1, limit: 15, total: 0 },
    documentSearchTerm: '',
    documentView: 'documents',
    activeTab: 'documents',
    adminTabs: [
      { value: 'documents', label: 'Document Management' },
      { value: 'studio', label: 'OKF Studio' }
    ],
    showNotification: jest.fn(),
    translate: (k, fallback = '', named) => {
      let out = fallback;
      if (named && typeof named === 'object') {
        out = out.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (m, key) =>
          named[key] !== undefined ? String(named[key]) : m
        );
      }
      return out;
    },
    ...overrides
  };
  // The computeds that READ other computeds get their values wired here —
  // a hand-made context has no getters, so the component's own computed
  // functions are called with it (the house seam pattern).
  c.blockedSelection = AdminDashboard.computed.blockedSelection.call(c);
  c.bundleSelection = AdminDashboard.computed.bundleSelection.call(c);
  return c;
}

const DOC = (overrides = {}) => ({
  file_id: 'doc-1',
  file_name: 'memo.pdf',
  is_bundle: false,
  dataprep: { status: 'Pending' },
  ...overrides
});
const BUNDLE = (overrides = {}) => ({
  file_id: 'bundle-1',
  file_name: 'kenya-v18.zip',
  is_bundle: true,
  repo_id: 'repo-1',
  bundle_version: 18,
  dataprep: { status: 'Pending' },
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  documentFileService.getFiles.mockResolvedValue({ data: [], pagination: { totalFiles: 0 } });
});

describe('the default document list — the bundles LEAVE it', () => {
  test('the request carries is_bundle: false', async () => {
    const c = ctx();
    await AdminDashboard.methods.loadDocuments.call(c);
    expect(documentFileService.getFiles).toHaveBeenCalledWith(expect.objectContaining({ is_bundle: false }));
  });

  test('the search term still rides along (the filter is additive)', async () => {
    const c = ctx({ documentSearchTerm: '  kenya  ' });
    await AdminDashboard.methods.loadDocuments.call(c);
    expect(documentFileService.getFiles).toHaveBeenCalledWith(
      expect.objectContaining({ is_bundle: false, search: 'kenya' })
    );
  });
});

describe('a bundle in the selection is NEVER deletable', () => {
  test('bundleSelection finds the bundle rows', () => {
    const c = ctx({ documents: [DOC(), BUNDLE()], selectedDocuments: ['bundle-1'] });
    expect(AdminDashboard.computed.bundleSelection.call(c).map((d) => d.file_id)).toEqual(['bundle-1']);
  });

  test('deletableSelection excludes the bundle', () => {
    const c = ctx({ documents: [DOC(), BUNDLE()], selectedDocuments: ['doc-1', 'bundle-1'] });
    expect(AdminDashboard.computed.deletableSelection.call(c)).toEqual(['doc-1']);
  });

  test('a Pending bundle — the exact "deletable but 403s" case — is excluded', () => {
    // A Pending bundle is NOT status-blocked (only ingested/ingesting are),
    // so before this wave it counted as deletable and the server refused it
    // with 403 BUNDLE_PROTECTED.
    const c = ctx({ documents: [BUNDLE({ dataprep: { status: 'Pending' } })], selectedDocuments: ['bundle-1'] });
    expect(AdminDashboard.computed.blockedSelection.call(c)).toEqual([]);
    expect(AdminDashboard.computed.deletableSelection.call(c)).toEqual([]);
  });

  test('the refusal strip names the OKF lifecycle, not "retract it first"', () => {
    const c = ctx({ documents: [BUNDLE()], selectedDocuments: ['bundle-1'] });
    const reason = AdminDashboard.computed.deleteRefuseReason.call(c);
    expect(reason).toContain('OKF artifact');
    expect(reason).toContain('repository lifecycle');
    expect(reason).not.toContain('retract');
  });

  test('a mixed selection names BOTH reasons', () => {
    const c = ctx({
      documents: [BUNDLE(), DOC({ dataprep: { status: 'Ingested' } })],
      selectedDocuments: ['bundle-1', 'doc-1']
    });
    const reason = AdminDashboard.computed.deleteRefuseReason.call(c);
    expect(reason).toContain('still ingested');
    expect(reason).toContain('OKF artifact');
  });

  test('a plain document selection still refuses as before (no behaviour change)', () => {
    const c = ctx({
      documents: [DOC({ dataprep: { status: 'Ingested' } })],
      selectedDocuments: ['doc-1']
    });
    const reason = AdminDashboard.computed.deleteRefuseReason.call(c);
    expect(reason).toContain('still ingested');
    expect(reason).not.toContain('OKF artifact');
  });
});

describe('the repository → artifact deep link', () => {
  test('?tab=documents&view=artifacts selects the artifacts view', () => {
    const c = ctx();
    AdminDashboard.methods.applyRouteQuery.call(c, { tab: 'documents', view: 'artifacts' });
    expect(c.documentView).toBe('artifacts');
  });

  test('a `view` on ANOTHER tab does NOT switch the document view', () => {
    // The `view` parameter is the sibling of `file` — it only speaks for the
    // documents tab. A studio link that happens to carry it must not turn
    // the document list into the artifacts view.
    const c = ctx();
    AdminDashboard.methods.applyRouteQuery.call(c, { tab: 'studio', view: 'artifacts' });
    expect(c.documentView).toBe('documents');
  });
});

describe('the artifact → repository deep link', () => {
  test('?tab=studio&repo= opens the Studio at that repository', () => {
    const onResume = jest.fn();
    const c = ctx({
      $refs: { okfStudioTab: { onResume } },
      dispatchWhenStudioReady: (fire) => fire()
    });
    AdminDashboard.methods.applyRouteQuery.call(c, { tab: 'studio', repo: 'repo-1' });
    expect(c.activeTab).toBe('studio');
    expect(onResume).toHaveBeenCalledWith('repo-1');
  });

  test('the resume is DEFERRED through the ready handshake when the Studio is not mounted yet', () => {
    // The Studio pane is an async component behind v-if: on the first
    // activation the ref does not exist, so the resume must be queued and
    // never dropped.
    let queued = null;
    const c = ctx({
      $refs: {},
      dispatchWhenStudioReady: (fire) => {
        queued = fire;
      }
    });
    AdminDashboard.methods.applyRouteQuery.call(c, { tab: 'studio', repo: 'repo-1' });
    expect(queued).toBeInstanceOf(Function);
    // …and the queued call is harmless until the studio is ready.
    expect(() => queued()).not.toThrow();
  });

  test('a parked OKF deployment does NOT open the Studio from the query', () => {
    const onResume = jest.fn();
    const c = ctx({
      activeTab: 'documents',
      adminTabs: [{ value: 'documents', label: 'Document Management' }],
      $refs: { okfStudioTab: { onResume } },
      dispatchWhenStudioReady: (fire) => fire()
    });
    AdminDashboard.methods.applyRouteQuery.call(c, { tab: 'studio', repo: 'repo-1' });
    expect(c.activeTab).toBe('documents');
    expect(onResume).not.toHaveBeenCalled();
  });
});
