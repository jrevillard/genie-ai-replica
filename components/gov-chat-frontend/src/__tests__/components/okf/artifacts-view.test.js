// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// W6 / EPIC-6 / CAP-5 (#995's sibling wave) — the OKF artifacts view.
//
// WHAT THIS SUITE PINS (the three claims the view makes):
//   1. The view asks for the ARTIFACTS (is_bundle: true) and labels every
//      row with its provenance — the repository name and the version.
//   2. It NEVER offers an action the server would refuse: no delete, for
//      any state (the WS2 guard refuses every non-okf-service delete with
//      403 BUNDLE_PROTECTED — the "deletable in the UI but 403s" lie).
//   3. It never INVENTS a fact: an artifact with no bundle_version says
//      the version is unknown (it is NOT parsed out of the graph name),
//      and an artifact whose repository does not resolve renders no
//      repository link (a dead link is worse than no link).

import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import ArtifactsView from '@/components/okf/ArtifactsView.vue';
import documentFileService from '@/services/documentFileService';
import { eventBus } from '@/eventBus';

jest.mock('@/services/documentFileService', () => ({
  __esModule: true,
  default: { getFiles: jest.fn(), downloadFile: jest.fn() }
}));

// The blob→file hand-off touches URL.createObjectURL, which jsdom does not
// implement — the unit under test is the SERVICE call, not the browser's
// download machinery.
jest.mock('@/utils/fileDownload', () => ({
  __esModule: true,
  saveBlob: jest.fn()
}));

jest.mock('@/eventBus', () => ({
  __esModule: true,
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() }
}));

const mockEventBusEmit = eventBus.$emit;

const REPO_A = 'repo-kenya';
const REPO_B = 'repo-bali';

function artifact(overrides = {}) {
  return {
    file_id: 'file-1',
    file_name: 'kenya-v18.zip',
    repo_id: REPO_A,
    bundle_version: 18,
    is_bundle: true,
    dataprep: { status: 'Ingested' },
    ...overrides
  };
}

/** The okf store, shaped like the real one (namespaced, `state.okf.reposById`). */
function buildStore(reposById = {}) {
  return createStore({
    modules: {
      okf: {
        namespaced: true,
        state: () => ({ reposById }),
        actions: { fetchRepos: jest.fn().mockResolvedValue({ ok: true }) }
      }
    }
  });
}

function mountView({ rows = [], reposById = {}, response, store } = {}) {
  documentFileService.getFiles.mockResolvedValue(
    response === undefined ? { data: rows, pagination: { totalFiles: rows.length, currentPage: 1 } } : response
  );
  const w = mount(ArtifactsView, {
    global: {
      plugins: [store || buildStore(reposById)],
      mocks: {
        $i18n: { t: (k) => k, locale: 'en', messages: { en: {}, fr: {} } },
        $route: { query: {} },
        $router: { push: jest.fn().mockResolvedValue() }
      }
    }
  });
  return w;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  documentFileService.downloadFile.mockResolvedValue({ blob: { size: 1 }, fileName: 'kenya-v18.zip' });
});

describe('ArtifactsView — it asks for the artifacts, and only the artifacts', () => {
  test('the request carries is_bundle: true', async () => {
    mountView({ rows: [artifact()] });
    await flush();
    expect(documentFileService.getFiles).toHaveBeenCalledWith(expect.objectContaining({ is_bundle: true }));
  });

  test('a row renders the artifact name and its provenance', async () => {
    const w = mountView({
      rows: [artifact()],
      reposById: { [REPO_A]: { repo_id: REPO_A, name: 'Kenya Government Services' } }
    });
    await flush();
    expect(w.text()).toContain('kenya-v18.zip');
    expect(w.text()).toContain('Kenya Government Services@v18');
  });

  test('a failed read renders the error and drops the previous rows', async () => {
    const w = mountView({ rows: [artifact()] });
    await flush();
    documentFileService.getFiles.mockRejectedValue({
      status: 500,
      data: { message: 'cluster down' },
      message: 'cluster down'
    });
    await w.vm.load();
    await flush();
    expect(w.find('[data-test-id="okf-artifacts-error"]').exists()).toBe(true);
    expect(w.text()).not.toContain('kenya-v18.zip');
  });
});

describe('ArtifactsView — it never offers an action the server refuses', () => {
  test('NO row carries a delete control, for ANY state', async () => {
    const states = ['Pending', 'Ingesting', 'Ingested', 'Ingested with Warnings', 'Ingestion Error', 'Retracted'];
    const w = mountView({
      rows: states.map((s, i) => artifact({ file_id: `f-${i}`, dataprep: { status: s } }))
    });
    await flush();
    const text = w.text().toLowerCase();
    expect(text).not.toContain('delete');
    expect(text).not.toContain('remove');
    // And there is no delete button anywhere in the view.
    const buttons = w.findAll('button').map((b) => b.text().toLowerCase());
    expect(buttons.filter((t) => t.includes('delete') || t.includes('remove'))).toEqual([]);
  });

  test('the download goes through the AUTHENTICATED client (a bare link 401s)', async () => {
    // doc-repo's download route sits behind `authenticateToken` and is not on
    // the public-path list: a browser navigation carries no Authorization
    // header and answers 401 TOKEN_INVALID (verified live). The content
    // therefore comes through the service (which adds the header) and the
    // blob is handed to the browser as a file.
    const w = mountView({ rows: [artifact({ file_id: 'abc 123' })] });
    await flush();
    // No anchor to the protected route anywhere in the view.
    expect(w.find('a[href*="/download"]').exists()).toBe(false);
    const button = w.find('[data-test-id="okf-artifact-download-abc 123"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    await flush();
    expect(documentFileService.downloadFile).toHaveBeenCalledWith('abc 123');
  });

  test('a failed download is REPORTED, never silent', async () => {
    documentFileService.downloadFile.mockRejectedValue({ status: 500, data: { message: 'boom' } });
    const w = mountView({ rows: [artifact()] });
    await flush();
    await w.find('[data-test-id="okf-artifact-download-file-1"]').trigger('click');
    await flush();
    expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
    // …and the button is re-enabled (the row is not stuck in "downloading").
    expect(w.vm.downloading).toBe(null);
  });

  test('the repository link renders ONLY when the repository resolves', async () => {
    const w = mountView({
      rows: [artifact()],
      reposById: { [REPO_A]: { repo_id: REPO_A, name: 'Kenya Government Services' } }
    });
    await flush();
    expect(w.find('[data-test-id="okf-artifacts-open-file-1"]').exists()).toBe(true);
  });

  test('an UNRESOLVED repository renders no repository link (no dead link)', async () => {
    const w = mountView({ rows: [artifact()], reposById: {} });
    await flush();
    expect(w.find('[data-test-id="okf-artifacts-open-file-1"]').exists()).toBe(false);
    // The provenance still names the artifact's repository — by its raw id.
    expect(w.text()).toContain(`${REPO_A}@v18`);
  });

  test('the repository link deep-links into the Studio with the repo id', async () => {
    const push = jest.fn().mockResolvedValue();
    const w = mountView({
      rows: [artifact()],
      reposById: { [REPO_A]: { repo_id: REPO_A, name: 'Kenya' } }
    });
    await flush();
    w.vm.$router.push = push;
    w.vm.openRepository(artifact());
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ tab: 'studio', repo: REPO_A })
      })
    );
  });
});

describe('ArtifactsView — it never invents a fact', () => {
  test('an artifact with NO bundle_version says the version is unknown', async () => {
    const w = mountView({
      rows: [artifact({ bundle_version: null })],
      reposById: { [REPO_A]: { repo_id: REPO_A, name: 'Kenya' } }
    });
    await flush();
    expect(w.text()).toContain('Kenya@unknown version');
    // …and it does NOT fall back to parsing the graph name.
    expect(w.text()).not.toContain('Kenya@v1');
  });

  test('the version is read from the artifact, never from the graph name', async () => {
    const w = mountView({
      rows: [artifact({ bundle_version: 18, graph_name: 'OKF_kenya_v7' })],
      reposById: { [REPO_A]: { repo_id: REPO_A, name: 'Kenya' } }
    });
    await flush();
    expect(w.text()).toContain('Kenya@v18');
    expect(w.text()).not.toContain('@v7');
  });

  test('a repository that does not resolve falls back to its raw id', async () => {
    const w = mountView({ rows: [artifact({ repo_id: REPO_B })] });
    await flush();
    expect(w.text()).toContain(`${REPO_B}@v18`);
  });
});

describe('ArtifactsView — the state vocabulary is shared with the document list', () => {
  test('the stored CAPITALISED status renders (the map is keyed lower-case)', async () => {
    const w = mountView({ rows: [artifact({ dataprep: { status: 'Pending' } })] });
    await flush();
    expect(w.text()).toContain('Pending');
  });

  test('an unmapped status renders its own raw value (honest, not blank)', async () => {
    const w = mountView({ rows: [artifact({ dataprep: { status: 'Killed' } })] });
    await flush();
    expect(w.text()).toContain('Killed');
  });

  test('an artifact with no dataprep status at all renders a state, not a blank', async () => {
    const w = mountView({ rows: [artifact({ dataprep: undefined })] });
    await flush();
    expect(w.text()).toContain('Unknown');
  });
});

describe('ArtifactsView — the edges', () => {
  test('the repository link is a NO-OP when the repository does not resolve', async () => {
    const push = jest.fn();
    const w = mountView({ rows: [artifact()] });
    await flush();
    w.vm.$router.push = push;
    w.vm.openRepository(artifact());
    expect(push).not.toHaveBeenCalled();
  });

  test('the pager clamps an out-of-range page', async () => {
    const w = mountView({ rows: [artifact()] });
    await flush();
    w.vm.total = 100;
    w.vm.page = 3;
    w.vm.goToPage(99);
    expect(w.vm.page).toBe(4);
    // The same page is a no-op (no refetch).
    const calls = documentFileService.getFiles.mock.calls.length;
    w.vm.goToPage(4);
    expect(documentFileService.getFiles.mock.calls.length).toBe(calls);
  });

  test('a deployment with no okf store module does not break the view', async () => {
    // The okf module is only registered when the OKF pillar is on; the view
    // must still render (the repository names are a nicety, not a
    // precondition).
    const store = createStore({ modules: {} });
    const w = mountView({ rows: [artifact()], store });
    await flush();
    expect(w.find('[data-test-id="okf-artifacts-view"]').exists()).toBe(true);
    expect(w.text()).toContain(`${REPO_A}@v18`);
  });
});
