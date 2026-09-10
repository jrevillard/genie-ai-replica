// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story #978 lifecycle — bundle-zip EXPORT: the zip layout (index.md +
// concepts/<id>.md), the repo+version file name, the supersede policy (older
// bundle docs deleted, same-version idempotent), and the doc-repo store
// contract (is_bundle + bundle_version + repo_id).

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/service-token', () => {
  const get = jest.fn().mockResolvedValue({ data: { data: [] } });
  const post = jest.fn().mockResolvedValue({ data: { file_id: 'file-new-1' } });
  const patch = jest.fn().mockResolvedValue({});
  const _delete = jest.fn().mockResolvedValue({});
  return { __esModule: true, authedAxios: { get, post, patch, delete: _delete }, getServiceToken: jest.fn() };
});

const AdmZip = require('adm-zip');
const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const { authedAxios } = require('../services/service-token');
const bundleExportService = require('../services/bundle-export-service');

const REPO = 'aaaa2222-bbbb-4ccc-8ddd-eeeeeeee0002';

function seedMeta(concept_id, extra = {}) {
  return mockDb.collection('okf_concepts_meta').save({
    _key: `${REPO}_${concept_id}`,
    repo_id: REPO,
    concept_id,
    title: `T ${concept_id}`,
    frontmatter: { type: 'topic', title: `T ${concept_id}`, sources: [] },
    body: `# ${concept_id}\n\nbody`,
    ...extra
  });
}

/** The mock DB does not feed collection rows into AQL cursors — program them. */
function programMeta(rows) {
  mockDb.query.mockResolvedValueOnce({ all: async () => rows });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('buildBundleZip — the zip layout', () => {
  test('index.md at the root + concepts/<id>.md for the rest, round-trips', async () => {
    seedMeta('zeta', { is_index: true });
    seedMeta('alpha');
    programMeta([
      { concept_id: 'alpha', title: 'T alpha', frontmatter: { type: 'topic' }, body: '# alpha' },
      { concept_id: 'zeta', title: 'T zeta', frontmatter: { type: 'topic' }, body: '# zeta', is_index: true }
    ]);
    const { buffer, concept_count } = await bundleExportService.buildBundleZip(REPO);
    expect(concept_count).toBe(2);
    const zip = new AdmZip(buffer);
    const names = zip
      .getEntries()
      .map((e) => e.entryName)
      .sort();
    expect(names).toEqual(['concepts/alpha.md', 'index.md']);
    const index = zip.readAsText('index.md');
    expect(index).toContain('# zeta'); // the is_index row IS the root entry
  });

  test('a repo with NO concepts throws EXPORT_EMPTY (409)', async () => {
    await expect(bundleExportService.buildBundleZip(REPO)).rejects.toMatchObject({
      code: 'EXPORT_EMPTY',
      status: 409
    });
  });
});

describe('bundleFileName — the visible repo+version link', () => {
  test('slug + version in the file name', () => {
    expect(bundleExportService.bundleFileName({ name: 'My Test Repo' }, 3)).toBe('my-test-repo-v3.zip');
  });
});

describe('exportBundle — store + supersede contract', () => {
  test('stores the zip (is_bundle + bundle_version), patches Ingested, returns the link', async () => {
    seedMeta('index', { is_index: true, frontmatter: { type: 'index', title: 'Index' } });
    seedMeta('alpha');
    programMeta([
      { concept_id: 'alpha', title: 'T alpha', frontmatter: { type: 'topic' }, body: '# alpha' },
      {
        concept_id: 'index',
        title: 'Index',
        frontmatter: { type: 'index', title: 'Index' },
        body: '# index',
        is_index: true
      }
    ]);
    const repo = { repo_id: REPO, name: 'Demo Repo', version: 1, graph_name: `OKF_${REPO}` };
    const result = await bundleExportService.exportBundle(repo, { sub: 'steward-1' });

    expect(result).toMatchObject({
      file_id: 'file-new-1',
      file_name: 'demo-repo-v1.zip',
      bundle_version: 1,
      concept_count: 2
    });
    expect(authedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/ingest-bundle'),
      expect.objectContaining({
        repo_id: REPO,
        bundle_version: 1,
        is_bundle: true,
        originalFileName: 'demo-repo-v1.zip',
        bundle: expect.any(String)
      }),
      expect.anything()
    );
    // The zip is born Ingested: the mint gate already guaranteed indexed content.
    expect(authedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/file-new-1/status'),
      { dataprep: { status: 'Ingested' } },
      expect.anything()
    );
  });

  test('supersedes OLDER bundle docs, keeps the current version', async () => {
    authedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { file_id: 'file-old-1', bundle_version: 1 },
          { file_id: 'file-old-2', bundle_version: 2 },
          { file_id: 'file-cur', bundle_version: 3 }
        ]
      }
    });
    seedMeta('index', { is_index: true });
    programMeta([
      { concept_id: 'index', title: 'Index', frontmatter: { type: 'index' }, body: '# index', is_index: true }
    ]);
    const repo = { repo_id: REPO, name: 'Demo Repo', version: 3, graph_name: `OKF_${REPO}` };
    const result = await bundleExportService.exportBundle(repo, {});
    expect(authedAxios.delete).toHaveBeenCalledTimes(2);
    expect(authedAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/files/file-old-1'));
    expect(authedAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/files/file-old-2'));
    expect(authedAxios.delete).not.toHaveBeenCalledWith(expect.stringContaining('/api/files/file-cur'));
    expect(result.superseded_file_ids.sort()).toEqual(['file-old-1', 'file-old-2']);
  });
});
