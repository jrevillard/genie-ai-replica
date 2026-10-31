/**
 * Coverage suite for the OKF service clients (David's standing rule,
 * 2026-10-30: coverage must INCREASE with every feature MR). These four
 * services shipped with MR2's Testing Lab / RAGAS panel work and had
 * near-zero direct coverage (headTestService 1.5%, ragasService 10%,
 * frontmatterService 11%, modelConfigService 13%) — every method is driven
 * here against a mocked httpService, asserting verb + URL + payload and
 * the response-mapping branches (null-safety, array guards, poll paths).
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
import headTestService from '../../services/headTestService';
import ragasService from '../../services/ragasService';
import modelConfigService from '../../services/modelConfigService';
import {
  getFrontmatter,
  suggestFrontmatter,
  patchFrontmatter,
  isFrontmatterPublishReady
} from '../../services/frontmatterService';

const ok = (data) => ({ data });
beforeEach(() => {
  jest.clearAllMocks();
});

// ─── headTestService ────────────────────────────────────────────────────────
describe('headTestService — the Testing Lab client', () => {
  it('rebuildHead POSTs and unwraps data', async () => {
    httpService.post.mockResolvedValue(ok({ head: {} }));
    const out = await headTestService.rebuildHead('r1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/head/rebuild');
    expect(out).toEqual({ head: {} });
  });

  it('routingTest / explainRouting POST the query body', async () => {
    httpService.post.mockResolvedValue(ok({ verdict: {} }));
    await headTestService.routingTest('r1', { query: 'q' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-test', { query: 'q' });
    await headTestService.explainRouting('r1', 'why');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-explain', { query: 'why' });
  });

  it('suite CRUD: generate / addQueries / get / rename / delete / rows / probe / run', async () => {
    httpService.post.mockResolvedValue(ok({ suite_key: 's1' }));
    httpService.get.mockResolvedValue(ok({}));
    httpService.delete.mockResolvedValue(ok({ ok: true }));
    await headTestService.generateSuite('r1', { n: 5 });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite', { n: 5 });
    await headTestService.addSuiteQueries('r1', 's1', [{ query: 'q', kind: 'positive' }]);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/queries', {
      queries: [{ query: 'q', kind: 'positive' }]
    });
    await headTestService.getSuite('r1', 's1');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1');
    await headTestService.renameSuite('r1', 's1', 'better');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/rename', { name: 'better' });
    await headTestService.deleteSuite('r1', 's1');
    expect(httpService.delete).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1');
    await headTestService.updateSuiteRows('r1', 's1', { removes: [] });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/rows', { removes: [] });
    await headTestService.probeSuiteQuery('r1', 's1', 'q');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/probe', { query: 'q' });
    await headTestService.runSuite('r1', 's1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/run');
  });

  it('run + explain polls GET the keyed endpoints', async () => {
    httpService.get.mockResolvedValue(ok({ status: 'done' }));
    await headTestService.getRun('r1', 's1', 'run-9');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/runs/run-9');
    await headTestService.getExplainFailures('r1', 's1', 'run-9');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/explain/run-9');
    await headTestService.explainSuiteFailures('r1', 's1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/s1/explain');
    await headTestService.getRecommendJob('r1', 'job-2');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/routing-advisor/jobs/job-2');
  });

  it('listRuns maps body.runs and degrades to [] on a non-array body', async () => {
    httpService.get.mockResolvedValueOnce(ok({ runs: [{}, {}] }));
    expect(await headTestService.listRuns('r1', { limit: 5, kind: 'run' })).toHaveLength(2);
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/routing-testsuite/runs?limit=5&kind=run');
    httpService.get.mockResolvedValueOnce(ok({ runs: null }));
    expect(await headTestService.listRuns('r1')).toEqual([]);
    expect(httpService.get).toHaveBeenLastCalledWith('/okf/repos/r1/routing-testsuite/runs');
  });

  it('frontmatterHistory maps entries; revertFrontmatter POSTs saved_at', async () => {
    httpService.get.mockResolvedValueOnce(ok({ entries: [{}] }));
    expect(await headTestService.frontmatterHistory('r1')).toHaveLength(1);
    httpService.get.mockResolvedValueOnce(ok(null));
    expect(await headTestService.frontmatterHistory('r1')).toEqual([]);
    httpService.post.mockResolvedValue(ok({ reverted_to: 'x' }));
    await headTestService.revertFrontmatter('r1', 'T1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/frontmatter/revert', { saved_at: 'T1' });
  });

  describe('recommendTags — the async advisor poll', () => {
    afterEach(() => jest.useRealTimers());

    it('a synchronous server answer (no job_key) returns as-is', async () => {
      httpService.post.mockResolvedValueOnce(ok({ changes: { add: [] } }));
      const out = await headTestService.recommendTags('r1', {});
      expect(out).toEqual({ changes: { add: [] } });
    });

    it('polls until done and returns the payload', async () => {
      jest.useFakeTimers();
      httpService.post.mockResolvedValueOnce(ok({ job_key: 'j1' }));
      httpService.get
        .mockResolvedValueOnce(ok({ status: 'running' }))
        .mockResolvedValueOnce(ok({ status: 'done', payload: { note: 'advice' } }));
      const p = headTestService.recommendTags('r1');
      await jest.advanceTimersByTimeAsync(2000); // first poll: running
      await jest.advanceTimersByTimeAsync(2000); // second poll: done
      await expect(p).resolves.toEqual({ note: 'advice' });
    });

    it('a failed job throws with the server code', async () => {
      jest.useFakeTimers();
      httpService.post.mockResolvedValueOnce(ok({ job_key: 'j1' }));
      httpService.get.mockResolvedValueOnce(ok({ status: 'failed', error: { message: 'LLM down', code: 'E_LLM' } }));
      const p = headTestService.recommendTags('r1');
      // Attach the rejection handler BEFORE advancing so the poll's throw is
      // never an unhandled rejection for a tick.
      const assertion = expect(p).rejects.toThrow('LLM down');
      await jest.advanceTimersByTimeAsync(2000).then(
        () => {},
        () => {}
      );
      await assertion;
    });

    // Round 18, #80482: ONE failed GET mid-wait (a 502 during a 12-minute
    // advisor run — the 2026-10-18 gateway-restart class) must not reject
    // the whole wait while the server-side job completes fine. The poll
    // tolerates transient misses (same 60-miss cap as the store's pollJob)
    // instead of surfacing a bogus 'advisor failed'.
    it('a single transient GET failure is tolerated and the poll continues', async () => {
      jest.useFakeTimers();
      httpService.post.mockResolvedValueOnce(ok({ job_key: 'j1' }));
      httpService.get
        .mockRejectedValueOnce(new Error('502 Bad Gateway'))
        .mockResolvedValueOnce(ok({ status: 'running' }))
        .mockResolvedValueOnce(ok({ status: 'done', payload: { note: 'recovered' } }));
      const p = headTestService.recommendTags('r1');
      await jest.advanceTimersByTimeAsync(2000); // poll 1: 502 — tolerated
      await jest.advanceTimersByTimeAsync(2000); // poll 2: running
      await jest.advanceTimersByTimeAsync(2000); // poll 3: done
      await expect(p).resolves.toEqual({ note: 'recovered' });
    });

    // Round 21 (#80916): the SERVICE hop of the ADVISOR_TIMEOUT chain — the
    // code is what the Lab's error arm keys off, and until now nothing owned
    // it (dropping the e.code assignment left the whole suite green).
    it('a job still running past the 15-minute deadline throws ADVISOR_TIMEOUT', async () => {
      jest.useFakeTimers();
      httpService.post.mockResolvedValueOnce(ok({ job_key: 'j1' }));
      httpService.get.mockResolvedValue(ok({ status: 'running' }));
      const p = headTestService.recommendTags('r1');
      const assertion = expect(p).rejects.toMatchObject({ code: 'ADVISOR_TIMEOUT' });
      await jest.advanceTimersByTimeAsync(2000); // poll 1: running
      jest.setSystemTime(jest.now() + 15 * 60 * 1000 + 2000); // past the deadline
      await jest.advanceTimersByTimeAsync(2000);
      await assertion;
    });
  });
});

// ─── ragasService ───────────────────────────────────────────────────────────
describe('ragasService — the benchmark client', () => {
  it('generate / get / cancels / rows / queries / rename / delete / run / rescore', async () => {
    httpService.post.mockResolvedValue(ok({ suite_key: 'k' }));
    httpService.get.mockResolvedValue(ok({}));
    httpService.delete.mockResolvedValue(ok({ ok: true }));
    await ragasService.generateSuite('r1', { testset_size: 10 });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite', { testset_size: 10 });
    await ragasService.getSuite('r1', 'k');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k');
    await ragasService.cancelSuiteGeneration('r1', 'k');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/cancel');
    await ragasService.cancelRun('r1', 'k', 'run-1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/runs/run-1/cancel');
    await ragasService.updateSuiteRows('r1', 'k', { modifications: [] });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/rows', { modifications: [] });
    await ragasService.addQueries('r1', 'k', [{ query: 'q' }]);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/queries', {
      queries: [{ query: 'q' }]
    });
    await ragasService.renameSuite('r1', 'k', 'n');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/rename', { name: 'n' });
    await ragasService.deleteSuite('r1', 'k');
    expect(httpService.delete).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k');
    await ragasService.runSuite('r1', 'k', { metrics: ['faithfulness'] });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/run', { metrics: ['faithfulness'] });
    await ragasService.getRun('r1', 'k', 'run-1');
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/runs/run-1');
    await ragasService.deleteRun('r1', 'k', 'run-1');
    expect(httpService.delete).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/runs/run-1');
    await ragasService.rescoreRun('r1', 'k', 'run-1', { judge_model: 'm' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/runs/run-1/rescore', {
      judge_model: 'm'
    });
    await ragasService.probeEntry('r1', 'k', 'e1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/probe', { id: 'e1' });
    await ragasService.explainFailures('r1', 'k', { run_key: 'run-1' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/explain', { run_key: 'run-1' });
  });

  it('listRuns builds the query string and guards the body shape', async () => {
    httpService.get.mockResolvedValueOnce(ok({ runs: [{}] }));
    expect(await ragasService.listRuns('r1', { kind: 'ragas_run' })).toHaveLength(1);
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/runs?kind=ragas_run');
    httpService.get.mockResolvedValueOnce(ok({}));
    expect(await ragasService.listRuns('r1')).toEqual([]);
  });

  it('getExplain: the silent flag is an axios OPTION, never a query param', async () => {
    httpService.get.mockResolvedValue(ok({}));
    await ragasService.getExplain('r1', 'k', 'run-1', { silent: true });
    expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/k/explain/run-1', {}, { silent: true });
    await ragasService.getExplain('r1', 'k', 'run-1');
    expect(httpService.get).toHaveBeenLastCalledWith('/okf/repos/r1/ragas-testsuite/k/explain/run-1', {}, undefined);
  });

  it('xlsx import/export ride the right options', async () => {
    httpService.get.mockResolvedValue(ok(new ArrayBuffer(8)));
    httpService.post.mockResolvedValue(ok({ suite: {} }));
    await ragasService.exportSuite('r1', 'k');
    expect(httpService.get).toHaveBeenCalledWith(
      '/okf/repos/r1/ragas-testsuite/k/export',
      {},
      { responseType: 'arraybuffer' }
    );
    const buf = new ArrayBuffer(4);
    await ragasService.importSuite('r1', buf);
    expect(httpService.post).toHaveBeenCalledWith('/okf/repos/r1/ragas-testsuite/import', buf, {
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    await ragasService.exportResults('r1', { suite_key: 'k', run_keys: ['run-1'] });
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/repos/r1/ragas-testsuite/k/results-export',
      { suite_key: 'k', run_keys: ['run-1'] },
      { responseType: 'arraybuffer' }
    );
  });
});

// ─── frontmatterService ─────────────────────────────────────────────────────
describe('frontmatterService — the publish-gate data source', () => {
  it('getFrontmatter expands the doc field into rows with approval stamps', async () => {
    httpService.get.mockResolvedValue(
      ok({
        data: {
          frontmatter: {
            topic: ['a', 'b'],
            forbidden: ['x'],
            scope: 'cardio',
            summary: 's',
            _approved: [{ field: 'topic', value: 'a', approved_at: 'T1', approved_by: 'u1' }]
          }
        }
      })
    );
    const { frontmatter } = await getFrontmatter('r1');
    const approved = frontmatter.find((r) => r.value === 'a');
    expect(approved.approved_at).toBe('T1');
    expect(approved.approved_by).toBe('u1');
    expect(frontmatter.find((r) => r.value === 'b').approved_at).toBeNull();
    expect(frontmatter.find((r) => r.field === 'scope')).toMatchObject({ value: 'cardio' });
    expect(frontmatter.find((r) => r.field === 'summary')).toMatchObject({ value: 's' });
  });

  it('getFrontmatter without a frontmatter field degrades to empty rows', async () => {
    httpService.get.mockResolvedValue(ok({ data: {} }));
    expect(await getFrontmatter('r1')).toEqual({ repo_id: 'r1', frontmatter: [] });
  });

  it('patchFrontmatter PATCHes the doc field', async () => {
    httpService.patch.mockResolvedValue(ok({ ok: true }));
    expect(await patchFrontmatter('r1', { topic: ['a'] })).toEqual({ ok: true });
    expect(httpService.patch).toHaveBeenCalledWith('/okf/repos/r1', { frontmatter: { topic: ['a'] } });
  });

  it('isFrontmatterPublishReady: ≥3 topics AND ≥1 forbidden', () => {
    expect(isFrontmatterPublishReady()).toBe(false);
    expect(isFrontmatterPublishReady([])).toBe(false);
    const rows = (f) => [{ field: f, value: 'v' }];
    expect(isFrontmatterPublishReady([...rows('topic'), ...rows('topic'), ...rows('topic')])).toBe(false); // no forbidden
    expect(isFrontmatterPublishReady([...rows('topic'), ...rows('forbidden')])).toBe(false); // <3 topics
    expect(
      isFrontmatterPublishReady([...rows('topic'), ...rows('topic'), ...rows('topic'), ...rows('forbidden')])
    ).toBe(true);
  });

  describe('suggestFrontmatter — the async job', () => {
    afterEach(() => jest.useRealTimers());

    it('a synchronous server answer returns directly', async () => {
      httpService.post.mockResolvedValueOnce(ok({ suggested: { topic: [] } }));
      expect(await suggestFrontmatter('r1')).toEqual({ suggested: { topic: [] } });
    });

    it('polls the job until done', async () => {
      jest.useFakeTimers();
      httpService.post.mockResolvedValueOnce(ok({ job_id: 'j9' }));
      httpService.get
        .mockResolvedValueOnce(ok({ status: 'running' }))
        .mockResolvedValueOnce(ok({ status: 'done', suggested: {} }));
      const p = suggestFrontmatter('r1');
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toMatchObject({ status: 'done' });
      expect(httpService.get).toHaveBeenCalledWith('/okf/repos/r1/frontmatter/suggest/jobs/j9');
    });

    it('a failed job throws the server message', async () => {
      jest.useFakeTimers();
      httpService.post.mockResolvedValueOnce(ok({ job_id: 'j9' }));
      httpService.get.mockResolvedValueOnce(ok({ status: 'failed', error: 'no frontmatter' }));
      const p = suggestFrontmatter('r1');
      const assertion = expect(p).rejects.toThrow('no frontmatter');
      await jest.advanceTimersByTimeAsync(2000).then(
        () => {},
        () => {}
      );
      await assertion;
    });
  });
});

// ─── modelConfigService ─────────────────────────────────────────────────────
describe('modelConfigService — the 8-7 judge configuration client', () => {
  it('list normalizes the envelope (arrays stay arrays, junk degrades)', async () => {
    httpService.get.mockResolvedValueOnce(
      ok({ configs: [{ key: 'a' }], env_judge: { model: 'g' }, env_pick: { config_key: 'a' } })
    );
    expect(await modelConfigService.list()).toEqual({
      configs: [{ key: 'a' }],
      env_judge: { model: 'g' },
      env_pick: { config_key: 'a' }
    });
    httpService.get.mockResolvedValueOnce(ok({ configs: 'garbage' }));
    expect(await modelConfigService.list()).toEqual({ configs: [], env_judge: null, env_pick: null });
  });

  it('CRUD verbs hit the keyed endpoints', async () => {
    httpService.post.mockResolvedValue(ok({}));
    httpService.patch.mockResolvedValue(ok({}));
    httpService.delete.mockResolvedValue(ok({}));
    await modelConfigService.create({ provider: 'z' });
    expect(httpService.post).toHaveBeenCalledWith('/okf/model-configs', { provider: 'z' });
    await modelConfigService.update('k1', { api_key: 'x' });
    expect(httpService.patch).toHaveBeenCalledWith('/okf/model-configs/k1', { api_key: 'x' });
    await modelConfigService.copy('k1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/model-configs/k1/copy');
    await modelConfigService.activate('k1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/model-configs/k1/activate');
    await modelConfigService.deactivate('k1');
    expect(httpService.post).toHaveBeenCalledWith('/okf/model-configs/k1/deactivate');
    await modelConfigService.remove('k1');
    expect(httpService.delete).toHaveBeenCalledWith('/okf/model-configs/k1');
  });

  it('model listings and the connection test ride silent options', async () => {
    httpService.get.mockResolvedValueOnce(ok({ models: ['m1'] }));
    expect(await modelConfigService.models('k1')).toEqual(['m1']);
    expect(httpService.get).toHaveBeenCalledWith('/okf/model-configs/k1/models', {}, { silent: true });
    httpService.get.mockResolvedValueOnce(ok({ models: null }));
    expect(await modelConfigService.models('k1')).toEqual([]);
    httpService.post.mockResolvedValue(ok({ models: ['m2'] }));
    expect(await modelConfigService.modelsPreview({ base_url: 'u' })).toEqual(['m2']);
    expect(httpService.post).toHaveBeenCalledWith(
      '/okf/model-configs/models-preview',
      { base_url: 'u' },
      { silent: true }
    );
    httpService.post.mockResolvedValueOnce(ok({ ok: false, error: 'auth' }));
    expect(await modelConfigService.test({ provider: 'z' })).toMatchObject({ ok: false });
    expect(httpService.post).toHaveBeenCalledWith('/okf/model-configs/test', { provider: 'z' }, { silent: true });
  });
});
