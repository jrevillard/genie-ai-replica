/**
 * repoOkfService coverage suite (David's standing rule, 2026-10-30: coverage
 * must INCREASE with every feature MR). The service shipped at 35% — this
 * drives every method against a mocked httpService, asserting verb + URL +
 * payload, the actor-header rule (no `x-actor-sub: undefined`) and every
 * response-mapping branch (array unwraps, null-guards, NOT_READY mapping).
 */
jest.mock('../../services/httpService', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn()
  }
}));

import httpService from '../../services/httpService';
import repoOkfService, {
  remediatePii,
  acceptPii,
  fileActionPii,
  getValidation,
  wireCitations,
  suggestLinks,
  acceptLink,
  startTopicLinks,
  getTopicLinkRun
} from '../../services/repoOkfService';

const ok = (data) => ({ data });
const ACTOR = { sub: 'user-1' };
const HDR = { 'x-actor-sub': 'user-1' };

beforeEach(() => jest.clearAllMocks());

describe('repoOkfService — reads', () => {
  it('list unwraps {items}, the legacy array, and degrades to []', async () => {
    httpService.get.mockResolvedValueOnce(ok({ items: [{ id: 1 }], next_cursor: null }));
    expect(await repoOkfService.list({ stage: 'draft' })).toEqual([{ id: 1 }]);
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos?lifecycle=draft');
    httpService.get.mockResolvedValueOnce(ok([{ id: 2 }]));
    expect(await repoOkfService.list()).toEqual([{ id: 2 }]);
    httpService.get.mockResolvedValueOnce(ok({ unrelated: true }));
    expect(await repoOkfService.list()).toEqual([]);
  });

  it('get returns data or null', async () => {
    httpService.get.mockResolvedValueOnce(ok({ repo_id: 'r1' }));
    expect(await repoOkfService.get('r1')).toEqual({ repo_id: 'r1' });
    httpService.get.mockResolvedValueOnce(null);
    expect(await repoOkfService.get('r1')).toBeNull();
  });

  it('listConcepts: array body, {concepts} body, permissive [] on failure, strict rethrow', async () => {
    httpService.get.mockResolvedValueOnce(ok([{ concept_id: 'c1' }]));
    expect(await repoOkfService.listConcepts('r1')).toEqual([{ concept_id: 'c1' }]);
    httpService.get.mockResolvedValueOnce(ok({ concepts: [{ concept_id: 'c2' }] }));
    expect(await repoOkfService.listConcepts('r1')).toEqual([{ concept_id: 'c2' }]);
    httpService.get.mockResolvedValueOnce(ok({}));
    expect(await repoOkfService.listConcepts('r1')).toEqual([]);
    const boom = new Error('TEI 503');
    httpService.get.mockRejectedValueOnce(boom);
    await expect(repoOkfService.listConcepts('r1')).resolves.toEqual([]);
    httpService.get.mockRejectedValueOnce(boom);
    await expect(repoOkfService.listConcepts('r1', { strict: true })).rejects.toThrow('TEI 503');
  });

  it('getConcept hits the keyed endpoint silently', async () => {
    httpService.get.mockResolvedValueOnce(ok({ concept_id: 'c1' }));
    expect(await repoOkfService.getConcept('r1', 'c1')).toEqual({ concept_id: 'c1' });
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/concepts/c1', {}, { silent: true });
  });

  it('getManifest maps 404/501 to NOT_READY and rethrows the rest', async () => {
    const notFound = new Error('nf');
    notFound.status = 404;
    httpService.get.mockRejectedValueOnce(notFound);
    await expect(repoOkfService.getManifest('r1')).rejects.toMatchObject({ code: 'NOT_READY' });
    const serverErr = new Error('boom');
    serverErr.status = 500;
    httpService.get.mockRejectedValueOnce(serverErr);
    await expect(repoOkfService.getManifest('r1')).rejects.toThrow('boom');
    httpService.get.mockResolvedValueOnce(ok({ nodes: [] }));
    expect(await repoOkfService.getManifest('r1')).toEqual({ nodes: [] });
  });

  it('getMetrics returns null on 404/501 instead of throwing', async () => {
    const notFound = new Error('nf');
    notFound.status = 404;
    httpService.get.mockRejectedValueOnce(notFound);
    await expect(repoOkfService.getMetrics('r1')).resolves.toBeNull();
    httpService.get.mockResolvedValueOnce(ok({ indexing: {} }));
    expect(await repoOkfService.getMetrics('r1')).toEqual({ indexing: {} });
  });

  it('getRepoLinks returns null on legacy-404, data otherwise', async () => {
    const notFound = new Error('nf');
    notFound.status = 501;
    httpService.get.mockRejectedValueOnce(notFound);
    await expect(repoOkfService.getRepoLinks('r1')).resolves.toBeNull();
    httpService.get.mockResolvedValueOnce(ok({ links: [] }));
    expect(await repoOkfService.getRepoLinks('r1')).toEqual({ links: [] });
  });

  it('listVersions / getRepoLogs unwrap their arrays and degrade to []', async () => {
    httpService.get.mockResolvedValueOnce(ok({ versions: [{}] }));
    expect(await repoOkfService.listVersions('r1')).toHaveLength(1);
    httpService.get.mockResolvedValueOnce(ok({}));
    expect(await repoOkfService.listVersions('r1')).toEqual([]);
    httpService.get.mockResolvedValueOnce(ok({ logs: [{}] }));
    expect(await repoOkfService.getRepoLogs('r1')).toHaveLength(1);
    httpService.get.mockResolvedValueOnce(ok(null));
    expect(await repoOkfService.getRepoLogs('r1')).toEqual([]);
  });
});

describe('repoOkfService — access control (Story 6-1c)', () => {
  it('getAccess normalizes the envelope', async () => {
    httpService.get.mockResolvedValueOnce(
      ok({ restricted: true, required_scopes: ['s'], user_holders: [{}], group_holders: [{}], configured: true })
    );
    expect(await repoOkfService.getAccess('r1')).toMatchObject({ restricted: true, configured: true });
    httpService.get.mockResolvedValueOnce(ok(null));
    expect(await repoOkfService.getAccess('r1')).toEqual({
      restricted: false,
      required_scopes: [],
      user_holders: [],
      group_holders: [],
      configured: false
    });
  });

  it('putAccess PUTs the toggle', async () => {
    httpService.put.mockResolvedValueOnce(ok({ ok: true }));
    await repoOkfService.putAccess('r1', true);
    expect(httpService.put).toHaveBeenCalledWith('/okf/repos/r1/access', { restricted: true });
  });

  it('user/group searches encode the query', async () => {
    httpService.get.mockResolvedValue(ok({ users: [] }));
    await repoOkfService.getAccessUsers('r1', 'mar');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/access/users?q=mar');
    await repoOkfService.getAccessGroups('r1', 'adm');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/access/groups?q=adm');
    await repoOkfService.getAccessUsers('r1');
    expect(httpService.get).toHaveBeenLastCalledWith('/okf/repos/r1/access/users?q=');
  });

  it('grantAccess picks the body shape: query > usernames > username', async () => {
    httpService.post.mockResolvedValue(ok({}));
    await repoOkfService.grantAccess('r1', { query: 'mar*' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/access/grant', { query: 'mar*' });
    await repoOkfService.grantAccess('r1', { usernames: ['a', 'b'] });
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/access/grant', { usernames: ['a', 'b'] });
    await repoOkfService.grantAccess('r1', { username: 'a' });
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/access/grant', { username: 'a' });
  });

  it('revokeAccess picks usernames[] or username', async () => {
    httpService.post.mockResolvedValue(ok({}));
    await repoOkfService.revokeAccess('r1', { usernames: ['a'] });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/access/revoke', { usernames: ['a'] });
    await repoOkfService.revokeAccess('r1', { username: 'b' });
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/access/revoke', { username: 'b' });
  });

  it('group grant/revoke carry the level (revoke omits it when absent)', async () => {
    httpService.post.mockResolvedValue(ok({}));
    await repoOkfService.grantGroupAccess('r1', { group: 'g', level: 'read' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/access/grant-group', { group: 'g', level: 'read' });
    await repoOkfService.revokeGroupAccess('r1', { group: 'g', level: 'read' });
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/access/revoke-group', {
      group: 'g',
      level: 'read'
    });
    await repoOkfService.revokeGroupAccess('r1', { group: 'g' });
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/access/revoke-group', { group: 'g' });
  });
});

describe('repoOkfService — writes', () => {
  it('create / importDocuments / convertFromCrawlInto are silent (the dialog owns the outcome)', async () => {
    httpService.post.mockResolvedValue(ok({ repo_id: 'r1' }));
    await repoOkfService.create({ name: 'n' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos', { name: 'n' }, { silent: true });
    await repoOkfService.importDocuments({
      file_ids: ['f1'],
      name: 'n',
      domain: 'd',
      classification: 'auto',
      repo_id: 'r1'
    });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/convert-from-documents',
      { file_ids: ['f1'], name: 'n', domain: 'd', classification: 'auto', repo_id: 'r1' },
      { silent: true }
    );
    await repoOkfService.convertFromCrawlInto({ repo_id: 'r1', file_id: 'f1', split_mode: 'A' });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/convert-from-crawl',
      {
        repo_id: 'r1',
        file_id: 'f1',
        url: undefined,
        crawl_job_id: undefined,
        classification: undefined,
        split_mode: 'A'
      },
      { silent: true }
    );
  });

  it('update PATCHes; saveStudioStep never throws (true/false outcomes)', async () => {
    httpService.patch.mockResolvedValueOnce(ok({ ok: 1 }));
    expect(await repoOkfService.update('r1', { name: 'x' })).toEqual({ ok: 1 });
    httpService.patch.mockResolvedValueOnce(null);
    expect(await repoOkfService.update('r1', {})).toEqual({ ok: true });
    httpService.patch.mockResolvedValueOnce(ok({}));
    expect(await repoOkfService.saveStudioStep('r1', 4)).toBe(true);
    expect(httpService.patch).toHaveBeenCalledWith('/okf/repos/r1', { studio_step: 4 }, { silent: true });
    httpService.patch.mockRejectedValueOnce(new Error('gone'));
    expect(await repoOkfService.saveStudioStep('r1', 5)).toBe(false);
  });

  it('mintVersion / clone / lifecycle / deleteRepo / acknowledgePii', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    httpService.delete.mockResolvedValue(ok({ ok: true }));
    await repoOkfService.mintVersion('r1', { trigger: 'publish' }, ACTOR);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/versions', { trigger: 'publish' }, { headers: HDR });
    await repoOkfService.mintVersion('r1'); // no actor → empty headers, never undefined
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/versions', {}, { headers: {} });
    await repoOkfService.clone('r1', { name: 'copy' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/clone', { name: 'copy' });
    await repoOkfService.lifecycle('r1', 'publish', ACTOR);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/lifecycle', { action: 'publish' }, { headers: HDR });
    await repoOkfService.deleteRepo('r1');
    expect(httpService.delete).toHaveBeenCalledWith('/okf/repos/r1');
    // W8 (#925): a reason rides a JSON body; no reason keeps the bare shape.
    await repoOkfService.deleteRepo('r1', 'gdpr erasure request');
    expect(httpService.delete).toHaveBeenLastCalledWith('/okf/repos/r1', { data: { reason: 'gdpr erasure request' } });
    await repoOkfService.acknowledgePii('r1', false, ACTOR);
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/pii-acknowledge',
      { acknowledge: false },
      { headers: HDR }
    );
  });

  it('concept writes: patchConcept / patchConceptBody / importConcepts / deleteConcept', async () => {
    httpService.patch.mockResolvedValue(ok({ ok: true }));
    httpService.post.mockResolvedValue(ok({ created: 1 }));
    httpService.delete.mockResolvedValue(ok({ ok: true }));
    await repoOkfService.patchConcept('r1', 'c1', '# md', ACTOR);
    expect(httpService.patch).toHaveBeenCalledWith(
      '/okf/repos/r1/concepts/c1',
      { markdown: '# md' },
      { headers: HDR, timeout: 180000 }
    );
    await repoOkfService.patchConceptBody('r1', 'c1', 'body text', ACTOR);
    expect(httpService.patch).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1',
      { body: 'body text' },
      { headers: HDR, timeout: 180000 }
    );
    await repoOkfService.importConcepts('r1', [{ path: 'a.md' }], ACTOR, { source: 'wizard' });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/import',
      { concepts: [{ path: 'a.md' }], source: 'wizard' },
      { headers: HDR }
    );
    await repoOkfService.deleteConcept('r1', 'c1', ACTOR);
    expect(httpService.delete).toHaveBeenCalledWith('/okf/repos/r1/concepts/c1', { headers: HDR });
  });

  it('resplit includes file_id only when given; autocorrect composes its body', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    await repoOkfService.resplit('r1', 'B', 'file-1', ACTOR);
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/resplit',
      { mode: 'B', file_id: 'file-1' },
      { headers: HDR }
    );
    await repoOkfService.resplit('r1', 'A', null, ACTOR);
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/resplit', { mode: 'A' }, { headers: HDR });
    await repoOkfService.autocorrect('r1', { dryRun: false, mode: 'llm', conceptId: 'c1' }, ACTOR);
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/autocorrect',
      { dry_run: false, mode: 'llm', concept_id: 'c1' },
      { headers: HDR }
    );
    await repoOkfService.autocorrect('r1');
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/autocorrect', { dry_run: true }, { headers: {} });
  });

  it('reingestFailed: whole-repo and single-concept paths', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    await repoOkfService.reingestFailed('r1', {}, ACTOR);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/reingest-failed', {}, { headers: HDR });
    await repoOkfService.reingestFailed('r1', { conceptId: 'c1' }, ACTOR);
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/concepts/c1/reingest', {}, { headers: HDR });
  });
});

describe('repoOkfService — PII surface', () => {
  it('inspectPii carries rescan and the long timeout', async () => {
    httpService.post.mockResolvedValue(ok({ occurrences: [] }));
    await repoOkfService.inspectPii('r1', 'c1', { rescan: true });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/concepts/c1/pii-inspect',
      { rescan: true },
      { timeout: 120000 }
    );
  });

  it('remediate / accept / fileAction / redactWholeFile / bulk hit their endpoints', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    await repoOkfService.remediatePii('r1', 'c1', { action: 'redact' });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/concepts/c1/pii-remediate',
      { action: 'redact' },
      { timeout: 120000 }
    );
    await repoOkfService.acceptPii('r1', 'c1', { start: 3 });
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1/pii-accept',
      { start: 3 },
      { timeout: 120000 }
    );
    await repoOkfService.fileActionPii('r1', 'c1', { action: 'remove' });
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1/pii-file-action',
      { action: 'remove' },
      { timeout: 120000 }
    );
    await repoOkfService.redactWholeFilePii('r1', 'c1');
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1/pii-redact-file',
      {},
      { timeout: 120000 }
    );
  });

  it('bulkPiiActionDetached arms the job, polls to done, and reports progress (#1514)', async () => {
    const updates = [];
    httpService.post.mockResolvedValueOnce(ok({ repo_id: 'r1', job_id: 'bp1', status: 'running', total: 4 }));
    httpService.get
      .mockResolvedValueOnce(ok({ repo_id: 'r1', job_id: 'bp1', status: 'running', total: 4, processed: 2 }))
      .mockResolvedValueOnce(
        ok({
          repo_id: 'r1',
          job_id: 'bp1',
          status: 'done',
          total: 4,
          processed: 4,
          result: { ok: true, action: 'accept', concepts_affected: 4 }
        })
      );
    const out = await repoOkfService.bulkPiiActionDetached('r1', 'accept', {
      onProgress: (p) => updates.push(p),
      pollMs: 1
    });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/pii-bulk/jobs', { action: 'accept' });
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/pii-bulk/jobs/bp1');
    expect(out).toEqual({ ok: true, action: 'accept', concepts_affected: 4 });
    // progress flows to the caller: the arm total, the mid-run snapshot, the final
    expect(updates).toEqual([
      { total: 4, processed: 0 },
      { total: 4, processed: 2 },
      { total: 4, processed: 4 }
    ]);
  });

  it('bulkPiiActionDetached throws when the job fails', async () => {
    httpService.post.mockResolvedValueOnce(ok({ repo_id: 'r1', job_id: 'bp2', status: 'running', total: 1 }));
    httpService.get.mockResolvedValueOnce(
      ok({ repo_id: 'r1', job_id: 'bp2', status: 'failed', total: 1, processed: 0, error: 'boom' })
    );
    await expect(repoOkfService.bulkPiiActionDetached('r1', 'redact', { pollMs: 1 })).rejects.toThrow('boom');
  });

  it('scanConceptPii builds the one-concept scan body; startRepoPiiScan arms; getRepoPiiScan polls', async () => {
    httpService.post.mockResolvedValue(ok({ scanned: 1 }));
    await repoOkfService.scanConceptPii('r1', 'c1', { frontmatter: { topic: ['a'] }, body: 'text' });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/pii-scan',
      { concepts: [{ concept_id: 'c1', frontmatter: { topic: ['a'] }, body: 'text' }] },
      { timeout: 120000, silent: true }
    );
    await repoOkfService.scanConceptPii('r1', 'c1');
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/pii-scan',
      { concepts: [{ concept_id: 'c1', frontmatter: {}, body: '' }] },
      { timeout: 120000, silent: true }
    );
    await repoOkfService.startRepoPiiScan('r1');
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/pii-scan',
      { scope: 'concepts' },
      { timeout: 120000, silent: true }
    );
    httpService.get.mockResolvedValueOnce(ok({ status: 'running' }));
    await repoOkfService.getRepoPiiScan('r1', 'scan-1');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/pii-scan/scan-1', {}, { silent: true });
  });

  it('the named PII exports delegate to the same endpoints', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    // Round 20, #80806: the drifted inspectPii named twin and the uncalled
    // redactWholeFilePii twin were deleted — the OBJECT methods carry those
    // endpoints (asserted above with their full option sets).
    await remediatePii('r1', 'c1', {});
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1/pii-remediate',
      {},
      { timeout: 120000 }
    );
    await acceptPii('r1', 'c1', {});
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/concepts/c1/pii-accept', {}, { timeout: 120000 });
    await fileActionPii('r1', 'c1', {});
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1/pii-file-action',
      {},
      { timeout: 120000 }
    );
  });
});

describe('repoOkfService — Step-7 validation + citations + topic links', () => {
  it('getValidation reads silently', async () => {
    httpService.get.mockResolvedValueOnce(ok({ issues: [] }));
    expect(await getValidation('r1')).toEqual({ issues: [] });
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/validation', {}, { silent: true });
  });

  it('wireCitations sends the hub only when given', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    await wireCitations('r1', 'hub-1');
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/citations/wire',
      { hub_concept_id: 'hub-1' },
      { silent: true }
    );
    await wireCitations('r1');
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/citations/wire', {}, { silent: true });
  });

  it('suggestLinks + acceptLink hit the concept-scoped routes', async () => {
    httpService.post.mockResolvedValue(ok({ suggestions: [] }));
    await suggestLinks('r1', 'c1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/concepts/c1/link-suggestions', {}, { silent: true });
    await acceptLink('r1', 'c1', 'c2', 'refers to');
    expect(httpService.post).toHaveBeenLastCalledWith(
      '/okf/repos/r1/concepts/c1/links',
      { to_concept_id: 'c2', label: 'refers to' },
      { silent: true }
    );
  });

  it('startTopicLinks carries dry_run; getTopicLinkRun unwraps .run', async () => {
    httpService.post.mockResolvedValue(ok({ run_key: 'k' }));
    await startTopicLinks('r1', true);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/topic-links', { dry_run: true }, { silent: true });
    await startTopicLinks('r1', false);
    expect(httpService.post).toHaveBeenLastCalledWith('/okf/repos/r1/topic-links', {}, { silent: true });
    httpService.get.mockResolvedValueOnce(ok({ run: { status: 'done' } }));
    expect(await getTopicLinkRun('r1')).toEqual({ status: 'done' });
    httpService.get.mockResolvedValueOnce(ok({}));
    expect(await getTopicLinkRun('r1')).toBeNull();
  });

  it('the default object carries the lazy-required surface (the store reads .default)', () => {
    expect(repoOkfService.getValidation).toBe(getValidation);
    expect(repoOkfService.wireCitations).toBe(wireCitations);
    expect(repoOkfService.suggestLinks).toBe(suggestLinks);
    expect(repoOkfService.acceptLink).toBe(acceptLink);
    expect(repoOkfService.startTopicLinks).toBe(startTopicLinks);
    expect(repoOkfService.getTopicLinkRun).toBe(getTopicLinkRun);
  });
});

// Story 10.7 (#995) — the retrieval governance posture (ADR-okf-039). GLOBAL,
// not per-repo: the read-model is per-caller (the serving view follows the
// caller's scopes) while the config posture stays global.
describe('repoOkfService — the retrieval posture (Story 10.7)', () => {
  it('getRetrievalConfig GETs /okf/retrieval-config (no /api prefix) and unwraps the body', async () => {
    const body = { config: { mode: 'hybrid' }, source: 'database', engaged: true };
    httpService.get.mockResolvedValueOnce(ok(body));
    expect(await repoOkfService.getRetrievalConfig()).toEqual(body);
    expect(httpService.get.mock.calls[0][0]).toBe('/okf/retrieval-config');
    expect(httpService.get.mock.calls[0][0].startsWith('/api/')).toBe(false);
  });

  it('getRetrievalConfig degrades to null on an empty body (no crash in the card)', async () => {
    httpService.get.mockResolvedValueOnce({});
    expect(await repoOkfService.getRetrievalConfig()).toBeNull();
  });

  it('putRetrievalConfig PUTs the patch to /okf/retrieval-config', async () => {
    httpService.put.mockResolvedValueOnce(ok({ ok: true, config: { revision: 4 } }));
    const out = await repoOkfService.putRetrievalConfig({ mode: 'hybrid' });
    expect(httpService.put).toHaveBeenCalledWith('/okf/retrieval-config', { mode: 'hybrid' });
    expect(out).toEqual({ ok: true, config: { revision: 4 } });
  });

  it('putRetrievalConfig returns null on an empty body', async () => {
    httpService.put.mockResolvedValueOnce({});
    expect(await repoOkfService.putRetrievalConfig({ mode: 'legacy' })).toBeNull();
  });

  it('getRetrievalConfigAudit GETs the audit route with the limit and unwraps {rows}', async () => {
    httpService.get.mockResolvedValueOnce(ok({ rows: [{ ts: '2026-11-05T09:00:00Z' }] }));
    const rows = await repoOkfService.getRetrievalConfigAudit(25);
    expect(httpService.get.mock.calls[0][0]).toBe('/okf/retrieval-config/audit?limit=25');
    expect(rows).toEqual([{ ts: '2026-11-05T09:00:00Z' }]);
  });

  it('getRetrievalConfigAudit degrades to [] when the server sends no rows (never undefined)', async () => {
    httpService.get.mockResolvedValueOnce(ok({}));
    expect(await repoOkfService.getRetrievalConfigAudit()).toEqual([]);
    httpService.get.mockResolvedValueOnce(ok({ rows: 'not-an-array' }));
    expect(await repoOkfService.getRetrievalConfigAudit()).toEqual([]);
  });
});
