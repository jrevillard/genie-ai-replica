'use strict';

const { isExternalUrl, fileTypeBadge, openRepositoryDocument } = require('@/utils/document-opener');

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
