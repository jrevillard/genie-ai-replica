'use strict';

/**
 * repoOkfService — the PII RE-SCAN wire contract (2026-10-12).
 *
 * These are wire contracts, not behaviour: the exact path, method and body
 * matter because the server handler is coded against them. They live in their
 * own file so no component-level jest.mock of repoOkfService shadows the real
 * module.
 *
 * The arm call is load-bearing in one specific way: it MUST send
 * `{scope:'concepts'}`. The sibling modes of the same route
 * ({file_ids}/{discover:true}) scan the `files` documents and write pii_state
 * keyed by file_id — a different subject from the okf_concepts_meta rows the
 * publish gate reads. A perfect file scan leaves every concept row untouched,
 * which is the bug this change exists to end.
 */

describe('repoOkfService — PII re-scan routes', () => {
  const withHttp = ({ post, get }) => {
    jest.resetModules();
    jest.doMock('@/services/httpService', () => ({
      __esModule: true,
      default: {
        post: post || jest.fn(),
        get: get || jest.fn(),
        delete: jest.fn()
      }
    }));
    return require('@/services/repoOkfService').default;
  };

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@/services/httpService');
  });

  describe('startRepoPiiScan — arm the repo-wide concept rescan', () => {
    it('POSTs to /pii-scan with scope:concepts', async () => {
      const post = jest.fn().mockResolvedValue({ data: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } });
      const svc = withHttp({ post });
      const out = await svc.startRepoPiiScan('r1');

      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/okf/repos/r1/pii-scan');
      // The subject is the CONCEPT ROWS, not the uploaded files.
      expect(body).toEqual({ scope: 'concepts' });
      expect(out.scan_key).toBe('sk1');
    });

    it('percent-encodes the repo id', async () => {
      const post = jest.fn().mockResolvedValue({ data: { scan_key: 'sk1' } });
      const svc = withHttp({ post });
      await svc.startRepoPiiScan('r 1');

      expect(post.mock.calls[0][0]).toBe('/okf/repos/r%201/pii-scan');
    });

    it('is SILENT — the panel owns the outcome message', async () => {
      const post = jest.fn().mockResolvedValue({ data: { scan_key: 'sk1' } });
      const svc = withHttp({ post });
      await svc.startRepoPiiScan('r1');

      // A global toast would duplicate the panel's own error line, and the
      // panel must be able to tell a 404 apart from any other failure.
      expect(post.mock.calls[0][2]).toMatchObject({ silent: true });
    });

    it('returns null (not a fake success) when the response has no body', async () => {
      const post = jest.fn().mockResolvedValue({ data: null });
      const svc = withHttp({ post });

      // A `{ok:true}` default here would make an empty 202 look like a run
      // that started — the caller must be able to notice and say so.
      expect(await svc.startRepoPiiScan('r1')).toBeNull();
    });
  });

  describe('getRepoPiiScan — poll the run', () => {
    it('GETs /pii-scan/:scan_key with both segments encoded', async () => {
      const get = jest.fn().mockResolvedValue({ data: { status: 'done', scanned: 2 } });
      const svc = withHttp({ get });
      await svc.getRepoPiiScan('r1', 'sk 1');

      const [url, , opts] = get.mock.calls[0];
      expect(url).toBe('/okf/repos/r1/pii-scan/sk%201');
      expect(opts).toMatchObject({ silent: true });
    });

    it('returns the run document verbatim so status is never invented', async () => {
      const run = { repo_id: 'r1', scan_key: 'sk1', status: 'running', progress: { done: 1, total: 3 } };
      const get = jest.fn().mockResolvedValue({ data: run });
      const svc = withHttp({ get });

      expect(await svc.getRepoPiiScan('r1', 'sk1')).toEqual(run);
    });

    it('returns null when the poll response has no body', async () => {
      const get = jest.fn().mockResolvedValue({ data: undefined });
      const svc = withHttp({ get });

      expect(await svc.getRepoPiiScan('r1', 'sk1')).toBeNull();
    });
  });

  describe('scanConceptPii — the per-concept persisting scan', () => {
    it('POSTs to /pii-scan with a concepts[] payload carrying the content', async () => {
      const post = jest.fn().mockResolvedValue({ data: { repo_id: 'r1', scanned: 1, results: [] } });
      const svc = withHttp({ post });
      await svc.scanConceptPii('r1', 'c1', { frontmatter: { type: 'topic' }, body: '# Solar' });

      const [url, body, opts] = post.mock.calls[0];
      expect(url).toBe('/okf/repos/r1/pii-scan');
      // The server scans the content it is HANDED — an omitted body would scan
      // nothing and write a verdict that means nothing.
      expect(body).toEqual({
        concepts: [{ concept_id: 'c1', frontmatter: { type: 'topic' }, body: '# Solar' }]
      });
      expect(opts).toMatchObject({ silent: true });
    });

    it('never sends an absent or non-string body as undefined', async () => {
      const post = jest.fn().mockResolvedValue({ data: { scanned: 1, results: [] } });
      const svc = withHttp({ post });
      await svc.scanConceptPii('r1', 'c1');

      const payload = post.mock.calls[0][1].concepts[0];
      expect(payload.frontmatter).toEqual({});
      expect(payload.body).toBe('');
    });

    it('returns the scan result envelope, or null when there is no body', async () => {
      const post = jest.fn().mockResolvedValue({ data: { repo_id: 'r1', scanned: 1, results: [] } });
      const svc = withHttp({ post });
      expect((await svc.scanConceptPii('r1', 'c1', { body: 'x' })).scanned).toBe(1);

      jest.resetModules();
      jest.doMock('@/services/httpService', () => ({
        __esModule: true,
        default: { post: jest.fn().mockResolvedValue({ data: null }), get: jest.fn(), delete: jest.fn() }
      }));
      const svc2 = require('@/services/repoOkfService').default;
      // A fake success here would make an empty answer look like a clean scan.
      expect(await svc2.scanConceptPii('r1', 'c1', { body: 'x' })).toBeNull();
    });
  });
});
