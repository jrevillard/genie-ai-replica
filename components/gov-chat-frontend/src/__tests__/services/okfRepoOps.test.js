'use strict';

/**
 * Story #978 - okfRepoOps (the shared wizard/editor operations library).
 * Services mocked at module level; gray-matter is real (pure function tests
 * cover the frontmatter normalization contract).
 */

const mockCreate = jest.fn();
const mockImport = jest.fn();
const mockPatchConcept = jest.fn();
const mockPatchBody = jest.fn();
const mockDeleteConcept = jest.fn();
const mockConceptGet = jest.fn();
const mockConceptUpdate = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    create: (...a) => mockCreate(...a),
    importConcepts: (...a) => mockImport(...a),
    patchConcept: (...a) => mockPatchConcept(...a),
    patchConceptBody: (...a) => mockPatchBody(...a),
    deleteConcept: (...a) => mockDeleteConcept(...a),
    lifecycle: (...a) => mockLifecycle(...a),
    deleteRepo: (...a) => mockDeleteRepo(...a),
    listVersions: (...a) => mockListVersions(...a),
    mintVersion: (...a) => mockMintVersion(...a)
  }
}));

const mockLifecycle = jest.fn();
const mockDeleteRepo = jest.fn();
const mockListVersions = jest.fn();
const mockMintVersion = jest.fn();
const mockHttpGet = jest.fn();

jest.mock('@/services/httpService', () => ({
  __esModule: true,
  default: { get: (...a) => mockHttpGet(...a) }
}));

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockConceptGet(...a),
    update: (...a) => mockConceptUpdate(...a)
  }
}));

const ops = require('@/services/okfRepoOps');

describe('okfRepoOps default-export completeness (the f771e169d class)', () => {
  it('registers EVERY named export on the default object — a consumer calling ops.x can never hit undefined', () => {
    const missing = Object.keys(ops)
      .filter((k) => k !== 'default' && typeof ops[k] === 'function')
      .filter((k) => typeof ops.default[k] !== 'function');
    expect(missing).toEqual([]);
  });
});

describe('okfRepoOps.createRepo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a draft repo with domain ACL and imports an index.md skeleton', async () => {
    mockCreate.mockResolvedValue({ repo_id: 'r-1', name: 'My Repo', domain: 'health' });
    const repo = await ops.createRepo({ name: 'My Repo', domain: 'health' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Repo',
        domain: 'health',
        acl: { required_scopes: ['okf:t:health:admin'] },
        lifecycle_state: 'draft'
      })
    );
    expect(mockImport).toHaveBeenCalledWith('r-1', [
      expect.objectContaining({
        path: 'index.md',
        frontmatter: expect.objectContaining({ type: 'index', title: 'My Repo' }),
        body: expect.stringContaining('## Contents')
      })
    ]);
    expect(repo.repo_id).toBe('r-1');
  });

  it('defaults the domain to general', async () => {
    mockCreate.mockResolvedValue({ repo_id: 'r-2' });
    await ops.createRepo({ name: 'X' });
    expect(mockCreate.mock.calls[0][0].acl.required_scopes[0]).toBe('okf:t:general:admin');
  });

  it('slugs KH display-name domains in the ACL scope (scope parser shreds on whitespace)', async () => {
    mockCreate.mockResolvedValue({ repo_id: 'r-3' });
    await ops.createRepo({ name: 'WS', domain: 'Water Supply' });
    expect(mockCreate.mock.calls[0][0].acl.required_scopes[0]).toBe('okf:t:water-supply:admin');
  });

  it('throws VALIDATION_ERROR without a name and CREATE_FAILED without repo_id', async () => {
    await expect(ops.createRepo({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    mockCreate.mockResolvedValue({ nope: true });
    await expect(ops.createRepo({ name: 'x' })).rejects.toMatchObject({ code: 'CREATE_FAILED' });
  });
});

describe('okfRepoOps.buildConceptPayload (paste normalization)', () => {
  it('slugs the title and uniquifies against existing ids', () => {
    const p = ops.buildConceptPayload({ title: 'Wildlife in the Mara!', existingIds: ['wildlife-in-the-mara'] });
    expect(p.concept_id).toBe('wildlife-in-the-mara-2');
    expect(p.path).toBe('wildlife-in-the-mara-2.md');
  });

  it('adds conformant frontmatter to raw pasted markdown', () => {
    const p = ops.buildConceptPayload({ title: 'Customers', type: 'entity', body: '# Customers\n\nRows.' });
    expect(p.frontmatter).toEqual({ type: 'entity', title: 'Customers', sources: [] });
    expect(p.body).toBe('# Customers\n\nRows.');
  });

  it('a pasted frontmatter WINS per-field, defaults fill the gaps', () => {
    const pasted = '---\ntype: process\ndescription: Kept\ntags: [a, b]\n---\nBody line.';
    const p = ops.buildConceptPayload({ title: 'T', type: 'topic', body: pasted });
    expect(p.frontmatter.type).toBe('process'); // paste wins
    expect(p.frontmatter.title).toBe('T'); // default fills (paste had none)
    expect(p.frontmatter.description).toBe('Kept');
    expect(p.frontmatter.tags).toEqual(['a', 'b']);
    expect(p.body).toBe('Body line.'); // frontmatter stripped from body
  });
});

describe('okfRepoOps.addConcept + appendToIndexToc', () => {
  beforeEach(() => jest.clearAllMocks());

  it('imports the payload and appends the TOC line to the index (BODY-ONLY patch)', async () => {
    mockConceptGet.mockResolvedValue({
      concept_id: 'index',
      frontmatter: { type: 'index', title: 'Idx', labels: ['Health Services'] },
      body: '# Idx\n\n## Contents\n\n'
    });
    mockPatchBody.mockResolvedValue({ ok: true });

    const res = await ops.addConcept({
      repoId: 'r-1',
      title: 'Wildlife',
      type: 'topic',
      body: '# Wildlife',
      existingIds: [],
      indexRow: { concept_id: 'index', title: 'Idx' }
    });

    expect(res.concept_id).toBe('wildlife');
    expect(mockImport).toHaveBeenCalledWith('r-1', [
      expect.objectContaining({ path: 'wildlife.md', frontmatter: expect.objectContaining({ title: 'Wildlife' }) })
    ]);
    // BODY-ONLY (labels write-through): the TOC append never round-trips the
    // index frontmatter, so it can't clobber a just-written label.
    expect(mockPatchBody).toHaveBeenCalledWith(
      'r-1',
      'index',
      expect.stringContaining('[Wildlife](concepts/wildlife.md)')
    );
    expect(mockPatchConcept).not.toHaveBeenCalled();
    expect(res.index_updated).toBe(true);
  });

  it('skips the index update when there is no index row; tolerates index fetch failure', async () => {
    const res = await ops.addConcept({ repoId: 'r-1', title: 'A', body: '', existingIds: [], indexRow: null });
    expect(res.index_updated).toBe(false);
    expect(mockPatchBody).not.toHaveBeenCalled();

    mockConceptGet.mockRejectedValue(new Error('gone'));
    const res2 = await ops.addConcept({
      repoId: 'r-1',
      title: 'B',
      body: '',
      existingIds: [],
      indexRow: { concept_id: 'index', title: 'x' }
    });
    expect(res2.index_updated).toBe(false); // best-effort, never fails the create
    expect(mockImport).toHaveBeenCalledTimes(2);
  });
});

describe('okfRepoOps.applyLabel / deleteConcept', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applyLabel routes through conceptService.update with a labels array', async () => {
    mockConceptUpdate.mockResolvedValue({ ok: true });
    await ops.applyLabel('r-1', 'c-1', ['Health']);
    expect(mockConceptUpdate).toHaveBeenCalledWith('r-1', 'c-1', { labels: ['Health'] });
  });

  it('applyLabel can clear a label with an empty array', async () => {
    await ops.applyLabel('r-1', 'c-1', []);
    expect(mockConceptUpdate).toHaveBeenCalledWith('r-1', 'c-1', { labels: [] });
  });

  it('deleteConcept delegates to repoOkfService.deleteConcept', async () => {
    mockDeleteConcept.mockResolvedValue({ ok: true, chunks: 3 });
    const res = await ops.deleteConcept('r-1', 'c-9');
    expect(mockDeleteConcept).toHaveBeenCalledWith('r-1', 'c-9');
    expect(res.chunks).toBe(3);
  });
});

describe('okfRepoOps.createRepo — DUPLICATE_REPO mapping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps a 409 from the service to code DUPLICATE_REPO (handled, user-facing)', async () => {
    mockCreate.mockRejectedValue({ status: 409, data: { error: 'DUPLICATE_REPO' } });
    await expect(ops.createRepo({ name: 'Exists' })).rejects.toMatchObject({ code: 'DUPLICATE_REPO' });
  });

  it('leaves other failures as-is', async () => {
    mockCreate.mockRejectedValue({ status: 500, message: 'boom' });
    await expect(ops.createRepo({ name: 'X' })).rejects.toMatchObject({ status: 500 });
  });
});

// ─── Lifecycle + zip export/import (David, 2026-08-28) ──────────────────────
describe('okfRepoOps lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lifecycle dispatches the action to the service', async () => {
    mockLifecycle.mockResolvedValue({ ok: true, lifecycle_state: 'review' });
    const res = await ops.lifecycle('r-1', 'submit', { sub: 'u1' });
    expect(mockLifecycle).toHaveBeenCalledWith('r-1', 'submit', { sub: 'u1' });
    expect(res.lifecycle_state).toBe('review');
  });

  it('publish / ingest / retract route the right action strings', async () => {
    mockLifecycle.mockResolvedValue({ ok: true });
    await ops.publish('r-1');
    await ops.ingest('r-1');
    await ops.retract('r-1');
    expect(mockLifecycle).toHaveBeenNthCalledWith(1, 'r-1', 'publish', {});
    expect(mockLifecycle).toHaveBeenNthCalledWith(2, 'r-1', 'ingest', {});
    expect(mockLifecycle).toHaveBeenNthCalledWith(3, 'r-1', 'retract', {});
  });

  it('deleteRepo and listVersions pass through', async () => {
    mockDeleteRepo.mockResolvedValue({ status: 'deleted' });
    mockListVersions.mockResolvedValue([{ bundle_version: 1 }]);
    await ops.deleteRepo('r-1');
    const versions = await ops.listVersions('r-1');
    expect(mockDeleteRepo).toHaveBeenCalledWith('r-1');
    expect(versions).toHaveLength(1);
  });

  it('createVersion mints with the manual trigger', async () => {
    mockMintVersion.mockResolvedValue({ bundle_version: 2 });
    await ops.createVersion('r-1', { sub: 'u' });
    expect(mockMintVersion).toHaveBeenCalledWith('r-1', { trigger: 'manual' }, { sub: 'u' });
  });
});

describe('okfRepoOps zip export / import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jsdom does not implement the blob URL API — stub it for the download flow.
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();
  });

  it('exportRepoZip downloads the blob and names it repo+version', async () => {
    const blob = new Blob(['zip-bytes']);
    mockHttpGet.mockResolvedValue({
      data: blob,
      headers: { 'content-disposition': 'attachment; filename="demo-v3.zip"' }
    });
    const name = await ops.exportRepoZip({ repo_id: 'r-1', name: 'Demo', version: 3 });
    expect(mockHttpGet).toHaveBeenCalledWith(
      '/okf/repos/r-1/export',
      {},
      expect.objectContaining({ responseType: 'blob' })
    );
    expect(name).toBe('demo-v3.zip');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('exportRepoZip falls back to a name-derived file name without the header', async () => {
    mockHttpGet.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    const name = await ops.exportRepoZip({ repo_id: 'r-9', name: 'My Test Repo', version: 1 });
    expect(name).toBe('my-test-repo-v1.zip');
  });

  it('importRepoZip creates a draft repo + imports the zip as base64', async () => {
    mockCreate.mockResolvedValue({ repo_id: 'r-new', name: 'Imported', domain: 'general' });
    mockImport.mockResolvedValue({ ok: true });
    const file = new File(['fake-zip'], 'my-bundle.zip', { type: 'application/zip' });
    const repo = await ops.importRepoZip({ file, name: 'Imported', domain: 'general' });
    expect(repo.repo_id).toBe('r-new');
    expect(mockImport).toHaveBeenCalledWith(
      'r-new',
      [],
      null,
      expect.objectContaining({ bundle_name: 'my-bundle.zip', zip: expect.any(String) })
    );
  });

  it('importRepoZip carries the classification strategy (default heuristics, David 2026-09-05)', async () => {
    mockCreate.mockResolvedValue({ repo_id: 'r-new' });
    mockImport.mockResolvedValue({ ok: true });
    const file = new File(['z'], 'b.zip', { type: 'application/zip' });
    await ops.importRepoZip({ file, name: 'B', classification: 'llm' });
    expect(mockImport).toHaveBeenCalledWith('r-new', [], null, expect.objectContaining({ classification: 'llm' }));
    await ops.importRepoZip({ file, name: 'B2' });
    expect(mockImport).toHaveBeenLastCalledWith(
      'r-new',
      [],
      null,
      expect.objectContaining({ classification: 'heuristics' })
    );
  });

  it('importRepoZip refuses a missing file or name', async () => {
    await expect(ops.importRepoZip({ file: null, name: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ops.importRepoZip({ file: new File(['z'], 'z.zip'), name: '' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('okfRepoOps.labelOptionsForDomain (labels bounded to Subject Area, David 2026-09-05)', () => {
  const TREE = [
    {
      name: 'Water Supply',
      children: [
        { name: 'Pipes' },
        { nameEN: 'Treatment Plants' },
        { serviceKey: 'quality' } // nameless at display level — key fallback
      ]
    },
    { name: 'Health Services', children: [{ name: 'Clinics' }] },
    { nameEN: 'Empty Category', children: [] }
  ];

  it('offers ONLY the services under the matching category (bounded)', () => {
    const { options, bounded } = ops.labelOptionsForDomain(TREE, 'Water Supply');
    expect(bounded).toBe(true);
    expect(options).toEqual([
      { value: 'Pipes', label: 'Pipes' },
      { value: 'Treatment Plants', label: 'Treatment Plants' },
      { value: 'quality', label: 'quality' }
    ]);
  });

  it('a legacy domain with no KH match falls back to the FULL tree (never blocks curation)', () => {
    const { options, bounded } = ops.labelOptionsForDomain(TREE, 'transport');
    expect(bounded).toBe(false);
    expect(options.map((o) => o.value)).toEqual(['Pipes', 'Treatment Plants', 'quality', 'Clinics']);
  });

  it('a category that exists but has no children also falls back (unbounded)', () => {
    const { options, bounded } = ops.labelOptionsForDomain(TREE, 'Empty Category');
    expect(bounded).toBe(false);
    expect(options.length).toBe(4);
  });

  it('an empty domain and a missing tree both fall back unbounded', () => {
    expect(ops.labelOptionsForDomain(TREE, '')).toMatchObject({ bounded: false });
    expect(ops.labelOptionsForDomain([], 'Water Supply')).toEqual({ options: [], bounded: false });
    expect(ops.labelOptionsForDomain(null, 'x')).toEqual({ options: [], bounded: false });
  });
});
