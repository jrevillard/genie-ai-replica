/**
 * documentFileService coverage (David's standing rule, 2026-10-30: coverage
 * must INCREASE with every feature MR). The service sat at 61% — every method
 * is driven here against a mocked httpService: verb + URL + payload/options
 * (the silent flags and responseType/text contract included) and the
 * rethrow-on-error behavior the dialogs rely on.
 */
jest.mock('../../services/httpService', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() }
}));
jest.spyOn(console, 'error').mockImplementation(() => {});

import httpService from '../../services/httpService';
import documentFileService from '../../services/documentFileService';

const ok = (data) => ({ data });

beforeEach(() => jest.clearAllMocks());

describe('documentFileService — files', () => {
  it('getFiles passes the params through', async () => {
    httpService.get.mockResolvedValueOnce(ok({ files: [] }));
    expect(await documentFileService.getFiles({ page: 2, search: 'x' })).toEqual({ files: [] });
    expect(httpService.get).toHaveBeenCalledWith('/files', { params: { page: 2, search: 'x' } });
  });

  it('getFileMetadata unwraps response.data.data', async () => {
    httpService.get.mockResolvedValueOnce(ok({ data: { file_id: 'f1' } }));
    expect(await documentFileService.getFileMetadata('f1')).toEqual({ file_id: 'f1' });
    expect(httpService.get).toHaveBeenCalledWith('/files/f1');
  });

  // downloadFile was deleted (round 18, #80485): its only consumer — the
  // browser-side crawler→OKF markdown read — moved server-side
  // (crawlerToOkfService posts convert-from-crawl), and the retired
  // browser-memory failure mode is documented on the server path.

  it('uploadFile posts multipart; uploadLink posts the url', async () => {
    httpService.post.mockResolvedValue(ok({ file_id: 'f2' }));
    const fd = new FormData();
    await documentFileService.uploadFile(fd);
    expect(httpService.post).toHaveBeenCalledWith('/files/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    await documentFileService.uploadLink('https://x');
    expect(httpService.post).toHaveBeenLastCalledWith('/files/upload-link', { url: 'https://x' });
  });

  it('updateFile PATCHes; deleteFile DELETEs', async () => {
    httpService.patch.mockResolvedValueOnce(ok({ ok: true }));
    await documentFileService.updateFile('f1', { title: 'T' });
    expect(httpService.patch).toHaveBeenCalledWith('/files/f1', { title: 'T' });
    httpService.delete.mockResolvedValueOnce(ok({ ok: true }));
    await documentFileService.deleteFile('f1');
    expect(httpService.delete).toHaveBeenCalledWith('/files/f1');
  });
});

describe('documentFileService — batch + logs', () => {
  it('ingest / retract / delete-multiple hit the batch routes', async () => {
    httpService.post.mockResolvedValue(ok({}));
    await documentFileService.ingestFile('f1');
    expect(httpService.post).toHaveBeenCalledWith('/files/f1/ingest');
    await documentFileService.ingestMultipleFiles(['f1', 'f2']);
    expect(httpService.post).toHaveBeenLastCalledWith('/files/ingest', { fileIds: ['f1', 'f2'] });
    await documentFileService.retractMultipleFiles(['f1']);
    expect(httpService.post).toHaveBeenLastCalledWith('/files/retract', { fileIds: ['f1'] });
    httpService.delete.mockResolvedValueOnce(ok({ results: [] }));
    await documentFileService.deleteMultipleFiles(['f1']);
    expect(httpService.delete).toHaveBeenCalledWith('/files', { data: { fileIds: ['f1'] } });
  });

  it('getIngestionLogs reads the log route', async () => {
    httpService.get.mockResolvedValueOnce(ok({ data: [] }));
    expect(await documentFileService.getIngestionLogs('f1')).toEqual({ data: [] });
    expect(httpService.get).toHaveBeenCalledWith('/files/f1/ingestion-log');
  });
});

describe('documentFileService — crawler surface', () => {
  it('scheduleSiteCrawl posts the options', async () => {
    httpService.post.mockResolvedValueOnce(ok({ file_id: 'f9' }));
    expect(await documentFileService.scheduleSiteCrawl({ url: 'https://x', depth: 3 })).toEqual({ file_id: 'f9' });
    expect(httpService.post).toHaveBeenCalledWith('/files/crawl/schedule', { url: 'https://x', depth: 3 });
  });

  it('the silent reads: crawl-job, crawl-metrics, crawl-log', async () => {
    httpService.get.mockResolvedValue(ok({ data: {} }));
    await documentFileService.getCrawlJob('f1');
    expect(httpService.get).toHaveBeenCalledWith('/files/f1/crawl-job', {}, { silent: true });
    await documentFileService.getCrawlMetrics('f1');
    expect(httpService.get).toHaveBeenLastCalledWith('/files/f1/crawl-metrics', {}, { silent: true });
    await documentFileService.getCrawlLogs('f1');
    expect(httpService.get).toHaveBeenLastCalledWith('/files/f1/crawl-log', {}, { silent: true });
  });

  it('killCrawl / killIngestion post the stop signals', async () => {
    httpService.post.mockResolvedValue(ok({ ok: true }));
    await documentFileService.killCrawl('f1');
    expect(httpService.post).toHaveBeenCalledWith('/files/f1/kill-crawl');
    await documentFileService.killIngestion('f1');
    expect(httpService.post).toHaveBeenLastCalledWith('/files/f1/kill-ingest');
  });

  it('every method RETHROWS (the dialogs own the failure display)', async () => {
    const boom = new Error('net');
    httpService.get.mockRejectedValue(boom);
    httpService.post.mockRejectedValue(boom);
    httpService.patch.mockRejectedValue(boom);
    httpService.delete.mockRejectedValue(boom);
    await expect(documentFileService.getFiles({})).rejects.toThrow('net');
    await expect(documentFileService.getFileMetadata('f1')).rejects.toThrow('net');
    await expect(documentFileService.uploadLink('u')).rejects.toThrow('net');
    await expect(documentFileService.updateFile('f1', {})).rejects.toThrow('net');
    await expect(documentFileService.deleteFile('f1')).rejects.toThrow('net');
    await expect(documentFileService.getIngestionLogs('f1')).rejects.toThrow('net');
    await expect(documentFileService.scheduleSiteCrawl({})).rejects.toThrow('net');
    await expect(documentFileService.getCrawlJob('f1')).rejects.toThrow('net');
    await expect(documentFileService.getCrawlMetrics('f1')).rejects.toThrow('net');
    await expect(documentFileService.getCrawlLogs('f1')).rejects.toThrow('net');
    await expect(documentFileService.killCrawl('f1')).rejects.toThrow('net');
    await expect(documentFileService.killIngestion('f1')).rejects.toThrow('net');
  });
});
