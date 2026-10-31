/**
 * okfRepoOps coverage (David's standing rule, 2026-10-30: coverage must
 * INCREASE with every feature MR). The create/addConcept happy paths are
 * covered elsewhere; this file drives the remaining surface — the building
 * gate matrix, friendlyLifecycleError (the whole function), the zip-import
 * guards, and the TOC-append edge branches.
 */
jest.mock('../../services/repoOkfService', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    importConcepts: jest.fn(),
    patchConceptBody: jest.fn(),
    deleteConcept: jest.fn(),
    deleteRepo: jest.fn(),
    listVersions: jest.fn(),
    lifecycle: jest.fn(),
    acknowledgePii: jest.fn()
  }
}));
jest.mock('../../services/conceptService', () => ({
  __esModule: true,
  default: { get: jest.fn(), update: jest.fn() }
}));

import repoOkfService from '../../services/repoOkfService';
import conceptService from '../../services/conceptService';
import {
  slugifyConcept,
  isBuilding,
  isRedraining,
  appendToIndexToc,
  friendlyLifecycleError,
  importRepoZip,
  importZipIntoRepo,
  exportRepoZip,
  acknowledgePii,
  createRepo,
  loadSubjectAreaOptions
} from '../../services/okfRepoOps';

beforeEach(() => jest.clearAllMocks());

describe('slugifyConcept edges', () => {
  it('empty input falls back to "concept"', () => {
    expect(slugifyConcept('')).toBe('concept');
    expect(slugifyConcept(null)).toBe('concept');
    expect(slugifyConcept('Hello, World! Ünïcode')).toBe('hello-world-n-code');
  });
});

describe('isBuilding / isRedraining — the building gate matrix', () => {
  it('isBuilding: null, serving, converting, draining, settled', () => {
    expect(isBuilding(null)).toBe(false);
    expect(isBuilding({ lifecycle_state: 'publish' })).toBe(false); // serving truth wins
    expect(isBuilding({ lifecycle_state: 'draft' })).toBe(false); // parsed-but-undrained is NOT building
    expect(isBuilding({ lifecycle_state: 'draft', conversion: { status: 'running' } })).toBe(true);
    expect(isBuilding({ lifecycle_state: 'draft', conversion: { status: 'done' } })).toBe(false);
    expect(isBuilding({ lifecycle_state: 'draft', rag_ingestion: { status: 'draining' } })).toBe(true);
  });

  it('isRedraining: only publish-state repos with a live drain', () => {
    expect(isRedraining(null)).toBe(false);
    expect(isRedraining({ lifecycle_state: 'draft', rag_drain_active: true })).toBe(false);
    expect(isRedraining({ lifecycle_state: 'publish' })).toBe(false);
    expect(isRedraining({ lifecycle_state: 'publish', rag_drain_active: true })).toBe(true);
    expect(isRedraining({ lifecycle_state: 'publish', rag_ingestion: { status: 'draining' } })).toBe(true);
  });
});

describe('appendToIndexToc edge branches', () => {
  it('a missing index row is a silent no-op', async () => {
    conceptService.get.mockResolvedValueOnce(null);
    expect(await appendToIndexToc('r1', { concept_id: 'index' }, 'T', 't')).toBe(false);
    expect(repoOkfService.patchConceptBody).not.toHaveBeenCalled();
  });

  it('a body with NO Contents heading gets one created with the line under it', async () => {
    conceptService.get.mockResolvedValueOnce({ concept_id: 'index', body: '# My Repo\n\nReal body text.' });
    await appendToIndexToc('r1', { concept_id: 'index' }, 'New Concept', 'new-concept');
    const written = repoOkfService.patchConceptBody.mock.calls[0][2];
    expect(written).toContain('## Contents');
    expect(written).toContain('- [New Concept](concepts/new-concept.md)');
    expect(written).toContain('Real body text.');
  });

  it('a service failure is best-effort false, never a throw', async () => {
    conceptService.get.mockRejectedValueOnce(new Error('net'));
    expect(await appendToIndexToc('r1', { concept_id: 'index' }, 'T', 't')).toBe(false);
  });
});

describe('friendlyLifecycleError — every gate code has a user-facing sentence', () => {
  it('maps each known code', () => {
    expect(friendlyLifecycleError('DRAIN_IN_PROGRESS')).toContain('still being processed');
    expect(friendlyLifecycleError('PUBLISH_GATE_BLOCKED', 'custom')).toBe('custom');
    expect(friendlyLifecycleError('PUBLISH_GATE_BLOCKED')).toContain('not ready to publish');
    expect(friendlyLifecycleError('PUBLISH_EMPTY')).toContain('no content yet');
    expect(friendlyLifecycleError('INVALID_TRANSITION', 'nope')).toBe('nope');
    expect(friendlyLifecycleError('INVALID_TRANSITION')).toContain('not allowed');
    expect(friendlyLifecycleError('REPO_READ_ONLY')).toContain('READ ONLY');
    expect(friendlyLifecycleError('GRAPH_NAME_CONFLICT')).toContain('serving graph name');
  });

  it('unknown codes fall back message → fallback → generic', () => {
    expect(friendlyLifecycleError('OTHER', 'msg')).toBe('msg');
    expect(friendlyLifecycleError('OTHER', null, 'fb')).toBe('fb');
    expect(friendlyLifecycleError('OTHER')).toBe('Action failed');
  });
});

describe('zip import guards', () => {
  it('importZipIntoRepo requires repoId and file', async () => {
    await expect(importZipIntoRepo({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(importZipIntoRepo({ repoId: 'r1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('importRepoZip requires both file and name; a failed zip import still exposes the created repo', async () => {
    const file = new File(['zip-bytes'], 'bundle.zip', { type: 'application/zip' });
    await expect(importRepoZip({ name: 'N' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(importRepoZip({ file })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    repoOkfService.create.mockResolvedValueOnce({ repo_id: 'r9', name: 'N' });
    repoOkfService.importConcepts
      .mockResolvedValueOnce({}) // createRepo's index.md skeleton import
      .mockRejectedValueOnce(new Error('bad zip')); // the zip import itself
    const err = await importRepoZip({ file, name: 'N' }).catch((e) => e);
    expect(err.message).toBe('bad zip');
    expect(err.repo).toMatchObject({ repo_id: 'r9' }); // the caller can still open it
  });

  it('a happy zip import returns the created repo', async () => {
    const file = new File(['zip-bytes'], 'bundle.zip', { type: 'application/zip' });
    repoOkfService.create.mockResolvedValueOnce({ repo_id: 'r1', name: 'N' });
    repoOkfService.importConcepts.mockResolvedValueOnce({ imported: 3 });
    const repo = await importRepoZip({ file, name: 'N', classification: 'llm' });
    expect(repo).toMatchObject({ repo_id: 'r1' });
    expect(repoOkfService.importConcepts).toHaveBeenCalledWith('r1', [], null, {
      zip: expect.any(String),
      bundle_name: 'bundle.zip',
      classification: 'llm'
    });
  });

  it('exportRepoZip requires a repo with an id', async () => {
    await expect(exportRepoZip(null)).rejects.toThrow('repo is required');
    await expect(exportRepoZip({})).rejects.toThrow('repo is required');
  });
});

describe('acknowledgePii passes through', () => {
  it('forwards repoId, acknowledge flag and actor', async () => {
    repoOkfService.acknowledgePii.mockResolvedValueOnce({ ok: true });
    const actor = { name: 'n' };
    const res = await acknowledgePii('r1', false, actor);
    expect(res).toMatchObject({ ok: true });
    expect(repoOkfService.acknowledgePii).toHaveBeenCalledWith('r1', false, actor);
  });
});

// ─── Round 16 review fixes ─────────────────────────────────────────────────

describe('createRepo — the index import failure still exposes the created repo (#80123)', () => {
  it('attaches err.repo so the wizard can offer "open it" instead of a blind retry', async () => {
    repoOkfService.create.mockResolvedValueOnce({ repo_id: 'r-created', name: 'Orphan Risk' });
    repoOkfService.importConcepts.mockRejectedValueOnce(new Error('index import exploded'));
    const err = await createRepo({ name: 'Orphan Risk', domain: 'health' }).catch((e) => e);
    expect(err.message).toBe('index import exploded');
    // Without this, the user retries and the first repo lingers as an orphan
    // draft card with no index concept.
    expect(err.repo).toMatchObject({ repo_id: 'r-created' });
  });
});

jest.mock('../../services/serviceTreeService', () => ({
  __esModule: true,
  default: { getAdminCategories: jest.fn() }
}));

describe('loadSubjectAreaOptions — legacy domains survive an unreachable hierarchy (#80129)', () => {
  const serviceTreeService = require('../../services/serviceTreeService').default;

  it('appends live-repo domains missing from the hierarchy as "(legacy)" — even when the hierarchy read FAILS', async () => {
    // The exact case the fix targets: an unreachable hierarchy used to hit
    // the empty-list early return and force every repo to 'general'.
    serviceTreeService.getAdminCategories.mockRejectedValueOnce(new Error('503'));
    const opts = await loadSubjectAreaOptions(['water-supply', 'health']);
    const values = opts.map((o) => o.value);
    expect(values).toContain('water-supply');
    expect(values).toContain('health');
    expect(opts.find((o) => o.value === 'water-supply').label).toBe('water-supply (legacy)');
  });

  it('does not duplicate a domain the hierarchy already lists', async () => {
    serviceTreeService.getAdminCategories.mockResolvedValueOnce([{ nameEN: 'Health' }]);
    const opts = await loadSubjectAreaOptions(['health', 'energy']);
    expect(opts.filter((o) => o.value === 'health')).toHaveLength(1);
    expect(opts.find((o) => o.value === 'energy').label).toBe('energy (legacy)');
  });

  it('an unreachable hierarchy with NO live domains still falls back to General', async () => {
    serviceTreeService.getAdminCategories.mockRejectedValueOnce(new Error('503'));
    const opts = await loadSubjectAreaOptions([]);
    expect(opts).toEqual([{ value: 'general', label: 'General' }]);
  });
});
