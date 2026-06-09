'use strict';

// Mock shared-lib before requiring anything
jest.mock('../../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

// Mock fs
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
    access: jest.fn()
  }
}));

// Mock langdetect
jest.mock('langdetect', () => ({
  detectOne: jest.fn()
}));

// Mock pdf-parse
jest.mock('pdf-parse', () => jest.fn());

// Mock mammoth
jest.mock('mammoth', () => ({
  extractRawText: jest.fn()
}));

// Mock mime-types
jest.mock('mime-types', () => ({
  lookup: jest.fn()
}));

// Mock fileUtils
jest.mock('../../../utils/fileUtils', () => ({
  generateUniqueFileId: jest.fn(),
  ensureDirectoryExists: jest.fn(),
  getFileHash: jest.fn()
}));

// Mock securityService
jest.mock('../../../services/securityService', () => ({
  scanBuffer: jest.fn()
}));

// Mock metadataService
jest.mock('../../../services/metadataService', () => ({
  addMetadata: jest.fn(),
  getMetadataById: jest.fn(),
  deleteMetadata: jest.fn(),
  updateMetadata: jest.fn()
}));

// Mock appConfig
jest.mock('../../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: [
      'application/pdf',
      'text/plain',
      'text/html',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    allowedExtensions: ['.pdf', '.txt', '.html', '.md', '.docx'],
    maxFileSize: 52428800
  },
  virusScanning: false,
  crawler: { maxPages: 100 },
  clamscan: {}
}));

const fs = require('fs').promises;
const langdetect = require('langdetect');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const mime = require('mime-types');
const fileUtils = require('../../../utils/fileUtils');
const securityService = require('../../../services/securityService');
const metadataService = require('../../../services/metadataService');
const fileService = require('../../../services/fileService');

describe('fileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: fs.access returns rejected promise (file doesn't exist)
    // Prevents "Cannot read properties of undefined (reading 'then')" in error cleanup
    fs.access.mockRejectedValue(new Error('not found'));
  });

  describe('uploadFile', () => {
    const mockFileData = {
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('fake pdf content')
    };

    it('should upload a PDF file successfully', async () => {
      mime.lookup.mockReturnValue('application/pdf');
      fileUtils.generateUniqueFileId.mockReturnValue('file-test123');
      fileUtils.ensureDirectoryExists.mockResolvedValue();
      fileUtils.getFileHash.mockResolvedValue('hash123');
      fs.writeFile.mockResolvedValue();
      fs.stat.mockResolvedValue({ birthtime: new Date('2025-01-01') });
      pdf.mockResolvedValue({ text: 'This is an English document for testing language detection' });
      langdetect.detectOne.mockReturnValue('en');
      metadataService.addMetadata.mockResolvedValue({});

      const result = await fileService.uploadFile(mockFileData, { labels: [], author: 'Test' });

      expect(result.file_name).toBe('test.pdf');
      expect(result.file_type).toBe('application/pdf');
      expect(result.file_size).toBe(1024);
      expect(result.dataprep.status).toBe('Pending');
      expect(fs.writeFile).toHaveBeenCalled();
      expect(metadataService.addMetadata).toHaveBeenCalled();
    });

    it('should reject files with wrong language', async () => {
      mime.lookup.mockReturnValue('application/pdf');
      pdf.mockResolvedValue({ text: 'Este es un documento en espanol para probar' });
      langdetect.detectOne.mockReturnValue('es');

      await expect(fileService.uploadFile(mockFileData)).rejects.toThrow('documents are supported for ingestion');
    });

    it('should reject disallowed file types', async () => {
      mime.lookup.mockReturnValue('application/exe');
      fileUtils.generateUniqueFileId.mockReturnValue('file-test123');

      await expect(
        fileService.uploadFile({
          originalname: 'malware.exe',
          mimetype: 'application/exe',
          size: 100,
          buffer: Buffer.from('exe')
        })
      ).rejects.toThrow('not allowed');
    });

    it('should reject files exceeding size limit', async () => {
      mime.lookup.mockReturnValue('application/pdf');
      pdf.mockResolvedValue({ text: 'This is an English text that is long enough for language detection' });
      langdetect.detectOne.mockReturnValue('en');
      fileUtils.generateUniqueFileId.mockReturnValue('file-test123');

      await expect(
        fileService.uploadFile({
          originalname: 'huge.pdf',
          mimetype: 'application/pdf',
          size: 99999999999,
          buffer: Buffer.from('x')
        })
      ).rejects.toThrow('exceeds maximum');
    });

    it('should detect virus and reject file', async () => {
      const appConfig = require('../../../config/appConfig');
      const origVirusScanning = appConfig.virusScanning;
      appConfig.virusScanning = true;
      try {
        mime.lookup.mockReturnValue('application/pdf');
        pdf.mockResolvedValue({ text: 'This is an English text that is long enough for language detection' });
        langdetect.detectOne.mockReturnValue('en');
        fileUtils.generateUniqueFileId.mockReturnValue('file-test123');
        fileUtils.ensureDirectoryExists.mockResolvedValue();
        securityService.scanBuffer.mockResolvedValue({ isInfected: true, viruses: ['EICAR'] });

        await expect(fileService.uploadFile(mockFileData, { labels: [] })).rejects.toThrow('virus');

        expect(fs.writeFile).not.toHaveBeenCalled();
      } finally {
        appConfig.virusScanning = origVirusScanning;
      }
    });

    it('should clean up file on metadata add failure', async () => {
      mime.lookup.mockReturnValue('application/pdf');
      pdf.mockResolvedValue({ text: 'English text for detection test' });
      langdetect.detectOne.mockReturnValue('en');
      fileUtils.generateUniqueFileId.mockReturnValue('file-test123');
      fileUtils.ensureDirectoryExists.mockResolvedValue();
      fileUtils.getFileHash.mockResolvedValue('hash');
      fs.writeFile.mockResolvedValue();
      fs.stat.mockResolvedValue({ birthtime: new Date() });
      metadataService.addMetadata.mockRejectedValue(new Error('DB error'));
      fs.unlink.mockResolvedValue();

      const result = await fileService.uploadFile(mockFileData, { labels: [] });
      // Code catches the metadata error, cleans up, and returns the record
      expect(fs.unlink).toHaveBeenCalled();
      expect(result.file_id).toBe('file-test123');
    });

    it('should upload file successfully when virus scanning is enabled and file is clean', async () => {
      const appConfig = require('../../../config/appConfig');
      const origVirusScanning = appConfig.virusScanning;
      appConfig.virusScanning = true;
      try {
        mime.lookup.mockReturnValue('application/pdf');
        fileUtils.generateUniqueFileId.mockReturnValue('file-clean123');
        fileUtils.ensureDirectoryExists.mockResolvedValue();
        fileUtils.getFileHash.mockResolvedValue('hash456');
        fs.writeFile.mockResolvedValue();
        fs.stat.mockResolvedValue({ birthtime: new Date('2025-01-01') });
        pdf.mockResolvedValue({ text: 'This is an English document for testing language detection' });
        langdetect.detectOne.mockReturnValue('en');
        securityService.scanBuffer.mockResolvedValue({ isInfected: false, viruses: [] });
        metadataService.addMetadata.mockResolvedValue({});

        const result = await fileService.uploadFile(mockFileData, { labels: [], author: 'Test' });

        expect(securityService.scanBuffer).toHaveBeenCalled();
        expect(result.file_name).toBe('test.pdf');
        expect(result.dataprep.status).toBe('Pending');
      } finally {
        appConfig.virusScanning = origVirusScanning;
      }
    });

    it('should skip language detection for non-ingestion types', async () => {
      const appConfig = require('../../../config/appConfig');
      appConfig.upload.allowedMimeTypes.push('application/zip');
      appConfig.upload.allowedExtensions.push('.zip');
      try {
        mime.lookup.mockReturnValue('application/zip');
        fileUtils.generateUniqueFileId.mockReturnValue('file-test123');
        fileUtils.ensureDirectoryExists.mockResolvedValue();
        fileUtils.getFileHash.mockResolvedValue('hash');
        fs.writeFile.mockResolvedValue();
        fs.stat.mockResolvedValue({ birthtime: new Date() });
        metadataService.addMetadata.mockResolvedValue({});

        await fileService.uploadFile(
          {
            originalname: 'archive.zip',
            mimetype: 'application/zip',
            size: 500,
            buffer: Buffer.from('zip')
          },
          { labels: [] }
        );

        expect(langdetect.detectOne).not.toHaveBeenCalled();
      } finally {
        appConfig.upload.allowedMimeTypes.pop();
        appConfig.upload.allowedExtensions.pop();
      }
    });
  });

  describe('getFiles', () => {
    it('should return paginated file list', async () => {
      const mockFiles = [{ file_id: '1', file_name: 'a.pdf' }];
      const mockCursor = { all: jest.fn().mockResolvedValue(mockFiles) };
      const mockCountCursor = { next: jest.fn().mockResolvedValue(1) };
      const mockDb = {
        query: jest.fn().mockResolvedValueOnce(mockCursor).mockResolvedValueOnce(mockCountCursor)
      };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getFiles({ page: 1, limit: 10 });

      expect(result.files).toEqual(mockFiles);
      expect(result.pagination.totalFiles).toBe(1);
      expect(result.pagination.currentPage).toBe(1);
    });

    it('should apply filters when provided', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockCountCursor = { next: jest.fn().mockResolvedValue(0) };
      const mockDb = {
        query: jest.fn().mockResolvedValueOnce(mockCursor).mockResolvedValueOnce(mockCountCursor)
      };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.getFiles({ page: 1, limit: 10, language: 'en', search: 'test' });

      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.language == @language');
      expect(query).toContain('CONTAINS(LOWER(file.file_name)');
    });
  });

  describe('deleteFile', () => {
    it('should delete file and metadata successfully', async () => {
      const file = {
        file_id: 'file-123',
        file_name: 'test.pdf',
        storage_path: './uploads/file-123.pdf'
      };
      metadataService.getMetadataById.mockResolvedValue(file);
      metadataService.deleteMetadata.mockResolvedValue(true);
      fs.access.mockResolvedValue();

      const mockCursor = { next: jest.fn() };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };
      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      fs.unlink.mockResolvedValue();

      const result = await fileService.deleteFile('file-123');
      expect(result).toBe(true);
      expect(metadataService.deleteMetadata).toHaveBeenCalledWith('file-123');
      expect(fs.unlink).toHaveBeenCalledWith('./uploads/file-123.pdf');
    });

    it('should throw when file record not found', async () => {
      metadataService.getMetadataById.mockResolvedValue(null);

      await expect(fileService.deleteFile('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('searchFiles', () => {
    it('should search files by query', async () => {
      const results = [{ file_id: '1', file_name: 'report.pdf' }];
      const mockCursor = { all: jest.fn().mockResolvedValue(results) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const found = await fileService.searchFiles('report');
      expect(found).toEqual(results);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('CONTAINS(LOWER(file.file_name)');
    });

    it('should filter by mimeType when provided', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.searchFiles('test', { mimeType: 'application/pdf' });
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.mimeType).toBe('application/pdf');
    });
  });

  describe('getFileStats', () => {
    it('should return file statistics', async () => {
      const stats = { totalFiles: 10, totalSize: 5000, filesByType: [] };
      const mockCursor = { next: jest.fn().mockResolvedValue(stats) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getFileStats();
      expect(result).toEqual(stats);
    });
  });

  describe('scheduleSiteCrawl', () => {
    it('should create file stub and crawl job', async () => {
      const mockSave = jest.fn().mockResolvedValue({});
      const mockDb = { collection: jest.fn().mockReturnValue({ save: mockSave }) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);
      fileUtils.generateUniqueFileId.mockReturnValue('file-crawl1');

      const result = await fileService.scheduleSiteCrawl('https://example.com', 3, { followExternalLinks: true });

      expect(result.file_id).toBe('file-crawl1');
      expect(result.file_type).toBe('text/markdown');
      expect(mockSave).toHaveBeenCalledTimes(2); // file record + crawl job
    });
  });

  describe('getCrawlJobByFileId', () => {
    it('should return crawl job for given file ID', async () => {
      const job = { file_id: 'file-1', status: 'Succeeded' };
      const mockCursor = { next: jest.fn().mockResolvedValue(job) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getCrawlJobByFileId('file-1');
      expect(result).toEqual(job);
    });
  });

  describe('addIngestionLog / getIngestionLogs', () => {
    it('should add an ingestion log entry', async () => {
      const mockResult = { new: { file_id: 'f1', level: 'INFO', message: 'test' } };
      const mockSave = jest.fn().mockResolvedValue(mockResult);
      const mockDb = { collection: jest.fn().mockReturnValue({ save: mockSave }) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.addIngestionLog('f1', { level: 'INFO', stage: 'test', message: 'test' });
      expect(result).toEqual(mockResult.new);
    });

    it('should get ingestion logs for a file', async () => {
      const logs = [{ file_id: 'f1', message: 'log1' }];
      const mockCursor = { all: jest.fn().mockResolvedValue(logs) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getIngestionLogs('f1');
      expect(result).toEqual(logs);
    });
  });

  describe('_extractText', () => {
    it('should extract text from PDF', async () => {
      pdf.mockResolvedValue({ text: 'PDF content here' });
      const result = await fileService._extractText(Buffer.from('pdf'), 'application/pdf');
      expect(result).toBe('PDF content here');
    });

    it('should extract text from DOCX via mammoth', async () => {
      mammoth.extractRawText.mockResolvedValue({ value: 'DOCX content' });
      const result = await fileService._extractText(
        Buffer.from('docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      expect(result).toBe('DOCX content');
    });

    it('should extract plain text', async () => {
      const result = await fileService._extractText(Buffer.from('plain text content'), 'text/plain');
      expect(result).toBe('plain text content');
    });

    it('should strip HTML tags from text/html', async () => {
      const html = '<html><body><style>.x{}</style><script>alert(1)</script><p>Hello world</p></body></html>';
      const result = await fileService._extractText(Buffer.from(html), 'text/html');
      expect(result).not.toContain('<style>');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('<p>');
      expect(result).toContain('Hello world');
    });

    it('should return empty string for unsupported types', async () => {
      const result = await fileService._extractText(Buffer.from('data'), 'image/png');
      expect(result).toBe('');
    });

    it('should return empty string on extraction error', async () => {
      pdf.mockRejectedValue(new Error('corrupt PDF'));
      const result = await fileService._extractText(Buffer.from('bad'), 'application/pdf');
      expect(result).toBe('');
    });
  });

  describe('_detectLanguage', () => {
    it('should detect language from text', () => {
      langdetect.detectOne.mockReturnValue('en');
      const result = fileService._detectLanguage('This is a longer English text that should be detected properly');
      expect(result).toBe('en');
    });

    it('should return null for short text', () => {
      const result = fileService._detectLanguage('Hi');
      expect(result).toBeNull();
    });

    it('should return null for empty text', () => {
      const result = fileService._detectLanguage('');
      expect(result).toBeNull();
    });

    it('should return null when detection fails', () => {
      langdetect.detectOne.mockImplementation(() => {
        throw new Error('no features');
      });
      const result = fileService._detectLanguage('Some random text that is long enough but has no features');
      expect(result).toBeNull();
    });
  });

  describe('getCrawlMetrics', () => {
    it('should return metrics for a file ID', async () => {
      const metrics = { file_id: 'file-1', total_pages: 10, succeeded: 8, failed: 2 };
      const mockCursor = { next: jest.fn().mockResolvedValue(metrics) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getCrawlMetrics('file-1');
      expect(result).toEqual(metrics);
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('FOR m IN crawl_metrics'), {
        fileId: 'file-1'
      });
    });

    it('should return null when no metrics exist', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getCrawlMetrics('file-1');
      expect(result).toBeNull();
    });
  });

  describe('updateCrawlMetrics', () => {
    it('should upsert crawl metrics', async () => {
      const mockCursor = {};
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const metrics = { total_pages: 20, succeeded: 18, failed: 2 };
      await fileService.updateCrawlMetrics('file-1', metrics);

      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('UPSERT { file_id: @fileId }'), {
        fileId: 'file-1',
        metrics
      });
    });

    it('should include timestamp in query', async () => {
      const mockCursor = {};
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.updateCrawlMetrics('file-1', { total_pages: 5 });

      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('DATE_ISO8601(DATE_NOW())');
    });
  });

  describe('addCrawlLog', () => {
    it('should save a log entry', async () => {
      const mockSave = jest.fn().mockResolvedValue({});
      const mockDb = { collection: jest.fn().mockReturnValue({ save: mockSave }) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.addCrawlLog('file-1', 'INFO', 'crawling', 'Page 1 crawled');

      expect(mockDb.collection).toHaveBeenCalledWith('crawl_log');
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-1',
          level: 'INFO',
          stage: 'crawling',
          message: 'Page 1 crawled',
          timestamp: expect.any(String)
        })
      );
    });

    it('should include ISO timestamp', async () => {
      const mockSave = jest.fn().mockResolvedValue({});
      const mockDb = { collection: jest.fn().mockReturnValue({ save: mockSave }) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.addCrawlLog('file-1', 'ERROR', 'extraction', 'Failed to extract');

      const savedLog = mockSave.mock.calls[0][0];
      expect(savedLog.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('getCrawlLogs', () => {
    it('should return logs sorted by timestamp', async () => {
      const logs = [
        { file_id: 'file-1', timestamp: '2025-01-01T10:00:00Z', level: 'INFO', message: 'Started' },
        { file_id: 'file-1', timestamp: '2025-01-01T10:01:00Z', level: 'INFO', message: 'Finished' }
      ];
      const mockCursor = { all: jest.fn().mockResolvedValue(logs) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getCrawlLogs('file-1');
      expect(result).toEqual(logs);
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('SORT log.timestamp ASC'), {
        fileId: 'file-1'
      });
    });

    it('should return empty array when no logs exist', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await fileService.getCrawlLogs('file-1');
      expect(result).toEqual([]);
    });
  });

  describe('killCrawlTask', () => {
    it('should set kill_requested flag', async () => {
      const mockCursor = {};
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.killCrawlTask('file-1');

      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE job WITH { kill_requested: true }'), {
        fileId: 'file-1'
      });
    });

    it('should filter by fileId', async () => {
      const mockCursor = {};
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      fileService.getDb = jest.fn().mockResolvedValue(mockDb);

      await fileService.killCrawlTask('file-123');

      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.fileId).toBe('file-123');
    });
  });
});
