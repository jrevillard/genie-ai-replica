'use strict';

// Closure-based references for jest.mock hoisting compatibility
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: (...args) => mockPut(...args),
  delete: (...args) => mockDelete(...args),
  patch: (...args) => mockPatch(...args)
}));

const documentFileService = require('@/services/documentFileService').default;

describe('documentFileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getFiles
  // =========================================================================
  describe('getFiles', () => {
    it('fetches paginated file list', async () => {
      mockGet.mockResolvedValue({
        data: { files: [{ _key: 'file-1', originalName: 'doc.pdf' }], pagination: { total: 1 } }
      });

      const result = await documentFileService.getFiles({ page: 1, limit: 10 });

      expect(mockGet).toHaveBeenCalledWith('/files', { params: { page: 1, limit: 10 } });
      expect(result.files).toHaveLength(1);
    });

    it('passes search and category filters', async () => {
      mockGet.mockResolvedValue({ data: { files: [], pagination: { total: 0 } } });

      await documentFileService.getFiles({ category: 'reports', search: 'annual' });

      expect(mockGet).toHaveBeenCalledWith('/files', {
        params: { category: 'reports', search: 'annual' }
      });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(documentFileService.getFiles({})).rejects.toThrow('Server error');
    });
  });

  // =========================================================================
  // getFileMetadata
  // =========================================================================
  describe('getFileMetadata', () => {
    it('fetches file metadata and unwraps double data', async () => {
      mockGet.mockResolvedValue({
        data: { data: { _key: 'file-1', filename: 'test.pdf' } }
      });

      const result = await documentFileService.getFileMetadata('file-1');

      expect(mockGet).toHaveBeenCalledWith('/files/file-1');
      expect(result).toEqual({ _key: 'file-1', filename: 'test.pdf' });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));

      await expect(documentFileService.getFileMetadata('nonexistent')).rejects.toThrow('Not found');
    });
  });

  // =========================================================================
  // uploadFile
  // =========================================================================
  describe('uploadFile', () => {
    it('uploads file with multipart/form-data headers', async () => {
      const formData = new FormData();
      mockPost.mockResolvedValue({ data: { _key: 'file-new', originalName: 'upload.pdf' } });

      const result = await documentFileService.uploadFile(formData);

      expect(mockPost).toHaveBeenCalledWith('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      expect(result._key).toBe('file-new');
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Upload failed'));

      await expect(documentFileService.uploadFile(new FormData())).rejects.toThrow('Upload failed');
    });
  });

  // =========================================================================
  // uploadLink
  // =========================================================================
  describe('uploadLink', () => {
    it('uploads a file from a URL', async () => {
      mockPost.mockResolvedValue({ data: { _key: 'file-link', originalName: 'page.html' } });

      const result = await documentFileService.uploadLink('https://example.com');

      expect(mockPost).toHaveBeenCalledWith('/files/upload-link', { url: 'https://example.com' });
      expect(result._key).toBe('file-link');
    });
  });

  // =========================================================================
  // updateFile
  // =========================================================================
  describe('updateFile', () => {
    it('updates file metadata', async () => {
      mockPatch.mockResolvedValue({ data: { _key: 'file-1', originalName: 'updated.pdf' } });

      const result = await documentFileService.updateFile('file-1', { originalName: 'updated.pdf' });

      expect(mockPatch).toHaveBeenCalledWith('/files/file-1', { originalName: 'updated.pdf' });
      expect(result.originalName).toBe('updated.pdf');
    });
  });

  // =========================================================================
  // deleteFile
  // =========================================================================
  describe('deleteFile', () => {
    it('deletes a file', async () => {
      mockDelete.mockResolvedValue({ data: { success: true } });

      const result = await documentFileService.deleteFile('file-1');

      expect(mockDelete).toHaveBeenCalledWith('/files/file-1');
      expect(result).toEqual({ success: true });
    });
  });

  // =========================================================================
  // ingestFile
  // =========================================================================
  describe('ingestFile', () => {
    it('triggers ingestion for a single file', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });

      const result = await documentFileService.ingestFile('file-1');

      expect(mockPost).toHaveBeenCalledWith('/files/file-1/ingest');
      expect(result).toEqual({ success: true });
    });
  });

  // =========================================================================
  // ingestMultipleFiles
  // =========================================================================
  describe('ingestMultipleFiles', () => {
    it('triggers ingestion for multiple files', async () => {
      mockPost.mockResolvedValue({ data: { success: true, processed: 3 } });

      const result = await documentFileService.ingestMultipleFiles(['file-1', 'file-2', 'file-3']);

      expect(mockPost).toHaveBeenCalledWith('/files/ingest', { fileIds: ['file-1', 'file-2', 'file-3'] });
      expect(result.processed).toBe(3);
    });
  });

  // =========================================================================
  // retractMultipleFiles
  // =========================================================================
  describe('retractMultipleFiles', () => {
    it('retracts multiple files', async () => {
      mockPost.mockResolvedValue({ data: { success: true, retracted: 2 } });

      const result = await documentFileService.retractMultipleFiles(['file-1', 'file-2']);

      expect(mockPost).toHaveBeenCalledWith('/files/retract', { fileIds: ['file-1', 'file-2'] });
      expect(result.retracted).toBe(2);
    });
  });

  // =========================================================================
  // getIngestionLogs
  // =========================================================================
  describe('getIngestionLogs', () => {
    it('fetches ingestion logs for a file', async () => {
      mockGet.mockResolvedValue({
        data: { success: true, data: [{ timestamp: '2026-05-19', status: 'completed' }] }
      });

      const result = await documentFileService.getIngestionLogs('file-1');

      expect(mockGet).toHaveBeenCalledWith('/files/file-1/ingestion-log');
      expect(result.data).toHaveLength(1);
    });
  });

  // =========================================================================
  // Crawler methods
  // =========================================================================
  describe('Crawler methods', () => {
    describe('scheduleSiteCrawl', () => {
      it('schedules a site crawl', async () => {
        mockPost.mockResolvedValue({ data: { _key: 'file-crawl', status: 'scheduled' } });

        const result = await documentFileService.scheduleSiteCrawl({
          url: 'https://example.com',
          depth: 3
        });

        expect(mockPost).toHaveBeenCalledWith('/files/crawl/schedule', {
          url: 'https://example.com',
          depth: 3
        });
        expect(result.status).toBe('scheduled');
      });
    });

    describe('getCrawlJob', () => {
      it('fetches crawl job status', async () => {
        mockGet.mockResolvedValue({ data: { status: 'running', progress: 45 } });

        const result = await documentFileService.getCrawlJob('file-1');

        expect(mockGet).toHaveBeenCalledWith('/files/file-1/crawl-job');
        expect(result.status).toBe('running');
      });
    });

    describe('getCrawlMetrics', () => {
      it('fetches crawl metrics', async () => {
        mockGet.mockResolvedValue({
          data: { success: true, data: { pagesCrawled: 100, pagesQueued: 50 } }
        });

        const result = await documentFileService.getCrawlMetrics('file-1');

        expect(mockGet).toHaveBeenCalledWith('/files/file-1/crawl-metrics');
        expect(result.data.pagesCrawled).toBe(100);
      });
    });

    describe('getCrawlLogs', () => {
      it('fetches crawl logs', async () => {
        mockGet.mockResolvedValue({ data: { logs: [{ message: 'Started', timestamp: '2026-05-19T00:00:00Z' }] } });

        const result = await documentFileService.getCrawlLogs('file-1');

        expect(mockGet).toHaveBeenCalledWith('/files/file-1/crawl-log');
        expect(result.logs).toHaveLength(1);
      });
    });

    describe('killCrawl', () => {
      it('sends kill signal to crawl job', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await documentFileService.killCrawl('file-1');

        expect(mockPost).toHaveBeenCalledWith('/files/file-1/kill-crawl');
        expect(result).toEqual({ success: true });
      });
    });

    describe('killIngestion', () => {
      it('sends kill signal to ingestion job', async () => {
        mockPost.mockResolvedValue({ data: { success: true } });

        const result = await documentFileService.killIngestion('file-1');

        expect(mockPost).toHaveBeenCalledWith('/files/file-1/kill-ingest');
        expect(result).toEqual({ success: true });
      });
    });
  });
});
