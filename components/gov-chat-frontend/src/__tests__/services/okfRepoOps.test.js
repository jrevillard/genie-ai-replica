'use strict';

/**
 * Story #978 - okfRepoOps (the shared wizard/editor operations library).
 * Services mocked at module level; gray-matter is real (pure function tests
 * cover the frontmatter normalization contract).
 */

const mockCreate = jest.fn();
const mockIngest = jest.fn();
const mockPatchConcept = jest.fn();
const mockDeleteConcept = jest.fn();
const mockConceptGet = jest.fn();
const mockConceptUpdate = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    create: (...a) => mockCreate(...a),
    ingest: (...a) => mockIngest(...a),
    patchConcept: (...a) => mockPatchConcept(...a),
    deleteConcept: (...a) => mockDeleteConcept(...a)
  }
}));

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockConceptGet(...a),
    update: (...a) => mockConceptUpdate(...a)
  }
}));

const ops = require('@/services/okfRepoOps');

describe('okfRepoOps.createRepo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a draft repo with domain ACL and ingests an index.md skeleton', async () => {
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
    expect(mockIngest).toHaveBeenCalledWith('r-1', [
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

  it('ingests the payload and appends the TOC line to the index', async () => {
    mockConceptGet.mockResolvedValue({
      concept_id: 'index',
      frontmatter: { type: 'index', title: 'Idx' },
      body: '# Idx\n\n## Contents\n\n'
    });
    mockPatchConcept.mockResolvedValue({ ok: true });

    const res = await ops.addConcept({
      repoId: 'r-1',
      title: 'Wildlife',
      type: 'topic',
      body: '# Wildlife',
      existingIds: [],
      indexRow: { concept_id: 'index', title: 'Idx' }
    });

    expect(res.concept_id).toBe('wildlife');
    expect(mockIngest).toHaveBeenCalledWith('r-1', [
      expect.objectContaining({ path: 'wildlife.md', frontmatter: expect.objectContaining({ title: 'Wildlife' }) })
    ]);
    expect(mockPatchConcept).toHaveBeenCalledWith(
      'r-1',
      'index',
      expect.stringContaining('[Wildlife](concepts/wildlife.md)')
    );
    expect(res.index_updated).toBe(true);
  });

  it('skips the index update when there is no index row; tolerates index fetch failure', async () => {
    const res = await ops.addConcept({ repoId: 'r-1', title: 'A', body: '', existingIds: [], indexRow: null });
    expect(res.index_updated).toBe(false);
    expect(mockPatchConcept).not.toHaveBeenCalled();

    mockConceptGet.mockRejectedValue(new Error('gone'));
    const res2 = await ops.addConcept({
      repoId: 'r-1',
      title: 'B',
      body: '',
      existingIds: [],
      indexRow: { concept_id: 'index', title: 'x' }
    });
    expect(res2.index_updated).toBe(false); // best-effort, never fails the create
    expect(mockIngest).toHaveBeenCalledTimes(2);
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
