'use strict';

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { get: jest.fn() }
}));

const {
  isExternalUrl,
  fileTypeBadge,
  openRepositoryDocument,
  openOkfConcept,
  downloadOkfConcept,
  fetchOkfConceptTitle
} = require('@/utils/document-opener');
const conceptService = require('@/services/conceptService').default;

describe('isExternalUrl', () => {
  it('treats only absolute http(s) links as external', () => {
    expect(isExternalUrl('https://example.com/a.pdf')).toBe(true);
    expect(isExternalUrl('http://example.com')).toBe(true);
    expect(isExternalUrl('/api/files/1/download')).toBe(false);
    expect(isExternalUrl('')).toBe(false);
    expect(isExternalUrl(undefined)).toBe(false);
  });

  it('never treats placeholder templates as external', () => {
    expect(isExternalUrl('https://<HOST>/api/files/1')).toBe(false);
    expect(isExternalUrl('http://<PORT>/file')).toBe(false);
  });
});

describe('fileTypeBadge', () => {
  it('gives each supported family its own mark and tone', () => {
    expect(fileTypeBadge('eval.pdf')).toEqual({ label: 'PDF', tone: 'danger' });
    expect(fileTypeBadge('contract.docx')).toEqual({ label: 'DOC', tone: 'info' });
    expect(fileTypeBadge('budget.xlsx')).toEqual({ label: 'XLS', tone: 'success' });
    expect(fileTypeBadge('notes.md')).toEqual({ label: 'MD', tone: 'warning' });
    expect(fileTypeBadge('readme.txt')).toEqual({ label: 'TXT', tone: 'muted' });
  });

  it('falls back to the raw extension, upper-cased', () => {
    expect(fileTypeBadge('weird.qfx').label).toBe('QFX');
    expect(fileTypeBadge('').label).toBe('FILE');
  });
});

describe('openRepositoryDocument', () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('fetches with the session token and opens the blob', async () => {
    const blob = {};
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    global.fetch = fetchMock;
    const createObjectURL = jest.fn(() => 'blob:mock');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = jest.fn();
    window.open = jest.fn();

    await openRepositoryDocument('doc-9', 'token-1');

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/api/files/doc-9/viewbrowser`, {
      headers: { Authorization: 'Bearer token-1' }
    });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.open).toHaveBeenCalledWith('blob:mock', '_blank');
  });

  it('refuses to fetch without a token', async () => {
    await expect(openRepositoryDocument('doc-9', null)).rejects.toThrow('Authentication token');
  });

  it('surfaces a failed fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' });
    await expect(openRepositoryDocument('doc-9', 'token-1')).rejects.toThrow('Not Found');
  });
});

// ---------------------------------------------------------------------------
// CAP-3 (chat-source resolution): the OKF concept open/download/title flows.
// A concept resolves through conceptService (the okf-server route under the
// caller's own scope) — NEVER through the /api/files family, which cannot
// resolve a concept on any creation origin.
// ---------------------------------------------------------------------------
describe('OKF concept flows (document-opener)', () => {
  const originalOpen = window.open;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    window.open = originalOpen;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    jest.clearAllMocks();
  });

  it('openOkfConcept renders the markdown and opens the blob in a new tab', async () => {
    conceptService.get.mockResolvedValueOnce({ frontmatter: { title: 'Alpha Concept' }, body: '# Body\n\nText.' });
    const createObjectURL = jest.fn(() => 'blob:concept');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = jest.fn();
    window.open = jest.fn();
    // jsdom's Blob lacks .text() — carry the constructor parts on the instance.
    const RealBlob = global.Blob;
    global.Blob = class extends RealBlob {
      constructor(parts, opts) {
        super(parts, opts);
        this._parts = parts;
      }
    };

    try {
      await openOkfConcept('repo-1', 'alpha_concept');
    } finally {
      global.Blob = RealBlob;
    }

    expect(conceptService.get).toHaveBeenCalledWith('repo-1', 'alpha_concept');
    expect(createObjectURL).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/html');
    const html = blob._parts.join('');
    expect(html).toContain('<h1>Alpha Concept</h1>');
    expect(html).toContain('<h1>Body</h1>');
    expect(window.open).toHaveBeenCalledWith('blob:concept', '_blank');
  });

  it('openOkfConcept refuses identity-less citations with the unavailable code', async () => {
    await expect(openOkfConcept(null, 'alpha_concept')).rejects.toMatchObject({ code: 'OKF_CONCEPT_UNAVAILABLE' });
    expect(conceptService.get).not.toHaveBeenCalled();
  });

  it('openOkfConcept maps an unavailable concept (404 null) to the unavailable code', async () => {
    conceptService.get.mockResolvedValueOnce(null); // 404/501 → null: fenced or gone
    await expect(openOkfConcept('repo-1', 'ghost')).rejects.toMatchObject({ code: 'OKF_CONCEPT_UNAVAILABLE' });
  });

  it('downloadOkfConcept saves the markdown body as <title>.md', async () => {
    conceptService.get.mockResolvedValueOnce({ frontmatter: { title: 'Alpha Concept' }, body: '# Body' });
    URL.createObjectURL = jest.fn(() => 'blob:dl');
    URL.revokeObjectURL = jest.fn();
    const click = jest.fn();
    const remove = jest.fn();
    const anchor = {
      click,
      remove,
      set href(v) {
        this._href = v;
      },
      get href() {
        return this._href;
      }
    };
    const appendChild = jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    const createElement = jest.spyOn(document, 'createElement').mockReturnValue(anchor);

    await downloadOkfConcept('repo-1', 'alpha_concept');

    expect(createElement).toHaveBeenCalledWith('a');
    expect(anchor.download).toBe('Alpha Concept.md');
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(appendChild).toHaveBeenCalled();
    appendChild.mockRestore();
    createElement.mockRestore();
  });

  it('fetchOkfConceptTitle resolves the frontmatter title; null when unavailable', async () => {
    conceptService.get.mockResolvedValueOnce({ frontmatter: { title: 'Alpha Concept' }, body: '' });
    await expect(fetchOkfConceptTitle('repo-1', 'alpha_concept')).resolves.toBe('Alpha Concept');
    conceptService.get.mockResolvedValueOnce(null);
    await expect(fetchOkfConceptTitle('repo-1', 'ghost')).resolves.toBeNull();
  });

  it('fetchOkfConceptTitle falls back to the humanized id when frontmatter lacks a title', async () => {
    conceptService.get.mockResolvedValueOnce({ frontmatter: {}, body: '' });
    await expect(fetchOkfConceptTitle('repo-1', 'alpha_two')).resolves.toBe('alpha two');
  });
});
