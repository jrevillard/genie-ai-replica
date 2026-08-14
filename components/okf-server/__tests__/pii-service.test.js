// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.8 — PII client (fail-closed), precheck (advisory), service
// (scanConcept states, gate matrix, version record, doc refs), route.

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));

// Mock axios BEFORE requiring modules that use it.
const mockSidecarPost = jest.fn();
jest.mock('axios', () => ({
  default: { get: jest.fn() },
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => ({ post: mockSidecarPost }))
}));

const piiClient = require('../services/pii/pii-client');
const { precheck } = require('../services/pii/pii-precheck');

// ─── pii-precheck (advisory) ────────────────────────────────────────────────

describe('pii-precheck (advisory, pure)', () => {
  it('detects email + counts by type', () => {
    const r = precheck('Contact a.b@x.org please');
    expect(r.counts_by_type.EMAIL_ADDRESS).toBe(1);
    expect(r.hits[0].type).toBe('EMAIL_ADDRESS');
  });

  it('Luhn-rejects non-credit-card digit runs', () => {
    const r = precheck('ref 1234567812345678 end'); // not Luhn-valid
    expect(r.counts_by_type.CREDIT_CARD).toBeUndefined();
  });

  it('detects a Luhn-valid card', () => {
    const r = precheck('card 4111 1111 1111 1111 ok');
    expect(r.counts_by_type.CREDIT_CARD).toBe(1);
  });

  it('clean text → no hits', () => {
    expect(precheck('policy guidance text').hits).toEqual([]);
  });
});

// ─── pii-client (fail-closed) ───────────────────────────────────────────────

describe('pii-client (fail-closed)', () => {
  it('maps a sidecar transport failure to state=error (NEVER clean)', async () => {
    mockSidecarPost.mockRejectedValue({ code: 'ECONNREFUSED' });
    const out = await piiClient.scanOne('c1', 'text');
    expect(out.state).toBe('error');
    expect(out.error).toBe('ECONNREFUSED');
  });

  it('maps an HTTP 500 to state=error', async () => {
    mockSidecarPost.mockRejectedValue({ response: { status: 500 } });
    const out = await piiClient.scan([{ id: 'c', text: 't' }]);
    expect(out.state).toBe('error');
    expect(out.error).toBe('HTTP_500');
  });

  it('passes results through on success', async () => {
    mockSidecarPost.mockResolvedValue({
      data: { results: [{ id: 'c1', hits: [], counts_by_type: {}, redacted_text: 't' }] }
    });
    const out = await piiClient.scanOne('c1', 'text');
    expect(out.state).toBe('ok');
    expect(out.results).toBeUndefined();
    expect(out.redacted_text).toBe('t');
  });
});

// ─── pii-service (with the mocked DB) ────────────────────────────────────────

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const piiService = require('../services/pii-service');

describe('pii-service', () => {
  beforeEach(() => {
    mockDb._reset();
    jest.clearAllMocks();
  });

  it('scanConcept(clean) → creates meta doc with pii_state=clean', async () => {
    mockSidecarPost.mockResolvedValue({
      data: { results: [{ id: 'c1', hits: [], counts_by_type: {}, redacted_text: 'body' }] }
    });
    const r = await piiService.scanConcept('repoA', 'c1', { title: 'T' }, 'body text');
    expect(r.pii_state).toBe('clean');
    const doc = mockDb._stores.okf_concepts_meta && Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.pii_state).toBe('clean');
    expect(doc.repo_id).toBe('repoA');
  });

  it('scanConcept(hit) → persists counts only (NFR-P2) + returns redacted_text', async () => {
    mockSidecarPost.mockResolvedValue({
      data: {
        results: [
          {
            id: 'c1',
            hits: [{ type: 'EMAIL_ADDRESS', start: 0, end: 15, score: 0.9 }],
            counts_by_type: { EMAIL_ADDRESS: 1 },
            redacted_text: '[PII:EMAIL_ADDRESS] hi'
          }
        ]
      }
    });
    const r = await piiService.scanConcept('repoA', 'c1', {}, 'john@x.org hi');
    expect(r.pii_state).toBe('hit');
    expect(r.pii_hits_summary).toEqual({ EMAIL_ADDRESS: 1 });
    expect(r.redacted_text).toBe('[PII:EMAIL_ADDRESS] hi');
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.pii_hits_summary).toEqual({ EMAIL_ADDRESS: 1 });
    expect(JSON.stringify(doc)).not.toContain('john@x.org'); // raw PII never persisted
  });

  it('scanConcept(sidecar down) → pii_state=error (fail-closed)', async () => {
    mockSidecarPost.mockRejectedValue({ code: 'ETIMEDOUT' });
    const r = await piiService.scanConcept('repoA', 'cE', {}, 'body');
    expect(r.pii_state).toBe('error');
  });

  it('upsert is idempotent — second scan updates, not duplicates', async () => {
    mockSidecarPost.mockResolvedValue({
      data: { results: [{ id: 'c1', hits: [], counts_by_type: {}, redacted_text: 'x' }] }
    });
    await piiService.scanConcept('repoA', 'c1', {}, 'x');
    mockSidecarPost.mockResolvedValue({
      data: {
        results: [
          {
            id: 'c1',
            hits: [{ type: 'PERSON', start: 0, end: 4, score: 0.8 }],
            counts_by_type: { PERSON: 1 },
            redacted_text: 'y'
          }
        ]
      }
    });
    await piiService.scanConcept('repoA', 'c1', {}, 'y');
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    expect(docs.length).toBe(1);
    expect(docs[0].pii_state).toBe('hit');
  });

  describe('assertPiiClean gate matrix (marker + per-concept, code-review #3)', () => {
    const programGate = (states, marker = 'complete') => {
      mockDb.query.mockResolvedValue({ all: async () => states });
      mockDb._stores.okf_repositories = { r: { repo_id: 'r', _key: 'r', pii_scan_status: marker } };
    };
    it('blocks on hit even when the repo is marked scanned', async () => {
      programGate([{ state: 'hit', n: 2 }]);
      const g = await piiService.assertPiiClean('r');
      expect(g.blocked).toBe(true);
      expect(g.reasons.some((x) => x.includes('PII hits'))).toBe(true);
    });
    it('blocks on error', async () => {
      programGate([{ state: 'error', n: 1 }]);
      expect((await piiService.assertPiiClean('r')).blocked).toBe(true);
    });
    it('blocks when the repo has NOT completed a scan (unscanned content)', async () => {
      programGate([], 'pending');
      const g = await piiService.assertPiiClean('r');
      expect(g.blocked).toBe(true);
      expect(g.reasons[0]).toContain('has not completed a PII scan');
    });
    it('open when scanned + all clean', async () => {
      programGate([{ state: 'clean', n: 5 }]);
      expect((await piiService.assertPiiClean('r')).blocked).toBe(false);
    });
    it('open when scanned + ZERO concept docs (nothing to leak)', async () => {
      programGate([], 'complete');
      expect((await piiService.assertPiiClean('r')).blocked).toBe(false);
    });
  });

  it('recordIngestVersion derives version_id from the files doc hash', async () => {
    mockDb._stores.files = {
      f1: { file_id: 'f1', file_hash: 'abcdef1234567890abcdef', uploaded_date: '2026-08-14T00:00:00Z' }
    };
    mockDb._stores.okf_repositories = { r1: { repo_id: 'r1', _key: 'r1', name: 'R' } };
    const v = await piiService.recordIngestVersion('r1', { file_id: 'f1', curator: { sub: 'u1' } });
    expect(v.version_id).toBe('sha256:abcdef1234567890');
    expect(v.uploaded_at).toBe('2026-08-14T00:00:00Z');
    expect(mockDb._stores.okf_repositories.r1.last_ingest.curator.sub).toBe('u1');
  });

  it('getDocumentReference reuses the doc-repo endpoints', () => {
    const ref = piiService.getDocumentReference('f1');
    expect(ref.view_url).toBe('/api/files/f1/view');
    expect(ref.download_url).toBe('/api/files/f1/download');
    expect(piiService.getDocumentReference(null)).toBeNull();
  });
});

// ─── code-review additions: fetch/discovery (fail-closed), untested paths, retry ─

describe('fetchFileBytes + discovery (code-review #1/#8)', () => {
  it('reads base64 from res.data.data.base64 (doc-repo viewFile shape) + decodes', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({
      data: { success: true, data: { base64: Buffer.from('hello').toString('base64') } }
    });
    const bytes = await piiService.fetchFileBytes('f1');
    expect(bytes.toString('utf-8')).toBe('hello');
  });

  it('FAIL-CLOSED: a doc-repo fetch failure THROWS (never empty→clean)', async () => {
    const axios = require('axios');
    axios.get.mockRejectedValue({ response: { status: 503 } });
    await expect(piiService.fetchFileBytes('f1')).rejects.toThrow(/doc-repo view fetch failed/);
  });

  it('FAIL-CLOSED: missing base64 throws (never empty→clean)', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({ data: { success: true, data: {} } });
    await expect(piiService.fetchFileBytes('f1')).rejects.toThrow(/no base64/);
  });

  it('discoverRepoFiles keeps only scannable text files + sorts newest-first', async () => {
    mockDb._stores.files = {
      a: { file_id: 'a', okf_repo_id: 'r1', file_type: 'text/markdown', uploaded_date: '2026-08-01T00:00:00Z' },
      b: { file_id: 'b', okf_repo_id: 'r1', file_type: 'application/zip', uploaded_date: '2026-08-02T00:00:00Z' },
      c: { file_id: 'c', okf_repo_id: 'r1', file_type: 'text/plain', uploaded_date: '2026-08-03T00:00:00Z' }
    };
    // The service uses db.query (aql) for discovery — program the mock.
    mockDb.query.mockResolvedValue({
      all: async () => [
        { file_id: 'c', file_name: 'c', file_type: 'text/plain' },
        { file_id: 'a', file_name: 'a', file_type: 'text/markdown' }
      ]
    });
    const axios = require('axios');
    axios.get.mockResolvedValue({ data: { success: true, data: { base64: Buffer.from('x').toString('base64') } } });
    const out = await piiService.discoverRepoFiles('r1');
    expect(out.map((c) => c.file_id)).toEqual(['c', 'a']); // zip 'b' skipped, DESC order
  });
});

describe('recordIngestVersion + doc refs (code-review #10/#16)', () => {
  it('handles a file doc with no hash → version_id null (no crash)', async () => {
    mockDb._stores.files = { f1: { file_id: 'f1', uploaded_date: '2026-08-14T00:00:00Z' } }; // no file_hash
    mockDb._stores.okf_repositories = { r1: { repo_id: 'r1', _key: 'r1' } };
    const v = await piiService.recordIngestVersion('r1', {
      file_id: 'f1',
      curator: { sub: 'u', source_ip: '1.2.3.4' }
    });
    expect(v.version_id).toBeNull();
    expect(v.curator.source_ip).toBeUndefined(); // source_ip never persisted (#10)
  });

  it('getRepoDocumentReferences returns view/download URLs for the repo files', async () => {
    mockDb.query.mockResolvedValue({ all: async () => ['f1', 'f2'] });
    const refs = await piiService.getRepoDocumentReferences('r1');
    expect(refs).toEqual([
      { file_id: 'f1', view_url: '/api/files/f1/view', download_url: '/api/files/f1/download' },
      { file_id: 'f2', view_url: '/api/files/f2/view', download_url: '/api/files/f2/download' }
    ]);
  });

  it('flattenFrontmatter recurses into nested objects/arrays (#4)', () => {
    const flat = piiService.flattenFrontmatter({
      title: 'T',
      meta: { author: { name: 'john.smith@x.org' } },
      tags: ['a', 'b']
    });
    expect(flat).toContain('john.smith@x.org');
    expect(flat).toContain('T');
  });
});

describe('pii-client retry + payload validation (code-review #2/#17)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('recovers on a transient failure then succeeds', async () => {
    mockSidecarPost
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValueOnce({ data: { results: [{ id: 'c1', hits: [], counts_by_type: {}, redacted_text: 't' }] } });
    const p = piiClient.scan([{ id: 'c1', text: 't' }]);
    // Fast-forward past the 250ms backoff
    await jest.runAllTimersAsync();
    const out = await p;
    expect(out.state).toBe('ok');
    expect(out.results[0].id).toBe('c1');
  });

  it('treats a 200 with malformed body as FAIL-CLOSED error (never clean)', async () => {
    mockSidecarPost.mockResolvedValue({ data: { results: null } }); // malformed
    const p = piiClient.scan([{ id: 'c1', text: 't' }]);
    await jest.runAllTimersAsync(); // advance the backoff
    const out = await p;
    expect(out.state).toBe('error');
    expect(out.error).toBe('UNKNOWN');
  });
});
