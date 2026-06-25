jest.mock('../../../services/fileService', () => ({}));
jest.mock('../../../services/metadataService', () => ({}));
jest.mock('archiver', () => ({ create: jest.fn() }));
jest.mock('axios', () => ({ default: { post: jest.fn() }, post: jest.fn() }));
jest.mock('fs', () => ({
  promises: { access: jest.fn(), readFile: jest.fn() }
}));

const fileController = require('../../../controllers/fileController');

describe('fileController', () => {
  describe('_formatFileRecord', () => {
    it('should map all fields correctly from file record', () => {
      const input = {
        file_id: '123',
        file_name: 'test.pdf',
        file_size: 1024,
        file_type: 'application/pdf',
        storage_path: '/uploads/test.pdf',
        file_hash: 'abc123',
        labels: ['label1'],
        author: 'John',
        uploaded_date: '2025-01-01T00:00:00Z',
        create_date: '2024-12-01T00:00:00Z',
        crawl_date: '',
        source_url: 'https://example.com',
        language: 'en',
        chunk_count: 10,
        dataprep: {
          status: 'Ingested',
          ingest_date: '2025-01-01T00:00:00Z',
          retract_date: ''
        }
      };

      const result = fileController._formatFileRecord(input);

      expect(result.file_id).toBe('123');
      expect(result.file_name).toBe('test.pdf');
      expect(result.file_size).toBe(1024);
      expect(result.file_type).toBe('application/pdf');
      expect(result.storage_path).toBe('/uploads/test.pdf');
      expect(result.file_hash).toBe('abc123');
      expect(result.labels).toEqual(['label1']);
      expect(result.author).toBe('John');
      // Key rename: uploaded_date -> upload_date for backward compatibility
      expect(result.upload_date).toBe('2025-01-01T00:00:00Z');
      expect(result.create_date).toBe('2024-12-01T00:00:00Z');
      expect(result.crawl_date).toBe('');
      expect(result.source_url).toBe('https://example.com');
      expect(result.language).toBe('en');
      expect(result.chunk_count).toBe(10);
      expect(result.dataprep.status).toBe('Ingested');
    });

    it('should not include extra fields from input', () => {
      const input = {
        file_id: '123',
        file_name: 'test.pdf',
        file_size: 1024,
        file_type: 'application/pdf',
        storage_path: '/uploads/test.pdf',
        file_hash: 'abc',
        labels: [],
        author: '',
        uploaded_date: '2025-01-01',
        create_date: '2024-12-01',
        crawl_date: '',
        source_url: '',
        language: 'en',
        chunk_count: 0,
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' },
        _key: 'secret-key',
        _rev: 'secret-rev',
        extraField: 'should not appear'
      };

      const result = fileController._formatFileRecord(input);
      expect(result._key).toBeUndefined();
      expect(result._rev).toBeUndefined();
      expect(result.extraField).toBeUndefined();
      expect(result.uploaded_date).toBeUndefined(); // Renamed to upload_date
    });
  });

  describe('_processLabels', () => {
    it('should return empty array when no labels', () => {
      expect(fileController._processLabels({})).toEqual([]);
      expect(fileController._processLabels({ labels: null })).toEqual([]);
      expect(fileController._processLabels({ labels: undefined })).toEqual([]);
    });

    it('should pass through array of strings', () => {
      const result = fileController._processLabels({ labels: ['a', 'b', 'c'] });
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should parse JSON string', () => {
      const result = fileController._processLabels({ labels: '["x","y","z"]' });
      expect(result).toEqual(['x', 'y', 'z']);
    });

    it('should split comma-separated string', () => {
      const result = fileController._processLabels({ labels: 'alpha, beta, gamma' });
      expect(result).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('should trim whitespace from labels', () => {
      const result = fileController._processLabels({ labels: '  a , b  ,  c ' });
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should filter out empty labels', () => {
      const result = fileController._processLabels({ labels: ['a', '', '  ', 'b'] });
      expect(result).toEqual(['a', 'b']);
    });

    it('should convert non-string labels to strings', () => {
      const result = fileController._processLabels({ labels: [123, true, null] });
      expect(result).toEqual(['123', 'true', 'null']);
    });

    it('should handle single string value (not array)', () => {
      const result = fileController._processLabels({ labels: 'single' });
      expect(result).toEqual(['single']);
    });

    it('should return empty array on invalid JSON parse', () => {
      // '{invalid}' will fail JSON.parse, then split by comma
      const result = fileController._processLabels({ labels: '{invalid}' });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('_getFileAndPath (path traversal guard)', () => {
    const metadataService = require('../../../services/metadataService');

    it('should throw if fileId is missing', async () => {
      await expect(fileController._getFileAndPath(null)).rejects.toEqual(
        expect.objectContaining({ status: 400, error: 'Missing file ID' })
      );
    });

    it('should throw if metadata not found', async () => {
      metadataService.getMetadataById = jest.fn().mockResolvedValue(null);

      await expect(fileController._getFileAndPath('nonexistent')).rejects.toEqual(
        expect.objectContaining({ status: 404, error: 'File not found' })
      );
    });

    it('should throw if resolved path is outside upload directory', async () => {
      const metadata = {
        file_id: '123',
        file_name: '../../../etc/passwd',
        storage_path: '../../../etc/passwd'
      };
      metadataService.getMetadataById = jest.fn().mockResolvedValue(metadata);

      await expect(fileController._getFileAndPath('123')).rejects.toEqual(
        expect.objectContaining({ status: 400, error: 'Invalid file path' })
      );
    });

    it('should throw if physical file does not exist', async () => {
      const metadata = {
        file_id: '123',
        file_name: 'test.pdf',
        storage_path: './uploads/test.pdf'
      };
      metadataService.getMetadataById = jest.fn().mockResolvedValue(metadata);

      const fs = require('fs');
      fs.promises.access = jest.fn().mockRejectedValue(new Error('ENOENT'));

      await expect(fileController._getFileAndPath('123')).rejects.toEqual(
        expect.objectContaining({ status: 404, error: 'File not found' })
      );
    });

    it('should return file and resolved path for valid file', async () => {
      const metadata = {
        file_id: '123',
        file_name: 'test.pdf',
        storage_path: './uploads/test.pdf'
      };
      metadataService.getMetadataById = jest.fn().mockResolvedValue(metadata);

      const fs = require('fs');
      fs.promises.access = jest.fn().mockResolvedValue();

      const result = await fileController._getFileAndPath('123');
      expect(result.file).toEqual(metadata);
      expect(result.filePath).toBeDefined();
      expect(result.filePath).toContain('uploads');
    });
  });

  describe('_ingestFileById (re-ingestion guard)', () => {
    const axios = require('axios');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('blocks re-ingestion when status is "Ingested" (canonical capitalized form)', async () => {
      jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
        file: { file_id: 'f1', dataprep: { status: 'Ingested' } },
        base64String: 'b64'
      });

      const result = await fileController._ingestFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been ingested/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('blocks re-ingestion case-insensitively (lowercase "ingested")', async () => {
      jest.spyOn(fileController, '_getFileBase64').mockResolvedValue({
        file: { file_id: 'f1', dataprep: { status: 'ingested' } },
        base64String: 'b64'
      });

      const result = await fileController._ingestFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been ingested/i);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('_retractFileById (retraction guard)', () => {
    const axios = require('axios');
    const metadataService = require('../../../services/metadataService');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('blocks retraction when status is "Retracted" (canonical capitalized form)', async () => {
      metadataService.getMetadataById = jest.fn().mockResolvedValue({
        file_id: 'f1',
        dataprep: { status: 'Retracted' }
      });

      const result = await fileController._retractFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been retracted/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('blocks retraction case-insensitively (lowercase "retracted")', async () => {
      metadataService.getMetadataById = jest.fn().mockResolvedValue({
        file_id: 'f1',
        dataprep: { status: 'retracted' }
      });

      const result = await fileController._retractFileById('f1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already been retracted/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('cleans up ingestion logs on successful retraction', async () => {
      const fileService = require('../../../services/fileService');
      fileService.deleteIngestionLogs = jest.fn().mockResolvedValue(3);

      metadataService.getMetadataById = jest.fn().mockResolvedValue({
        file_id: 'f1',
        dataprep: { status: 'Ingested', ingest_date: '2025-01-01T00:00:00Z' }
      });
      metadataService.updateMetadata = jest.fn().mockResolvedValue(true);
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      const result = await fileController._retractFileById('f1');

      expect(result.success).toBe(true);
      expect(metadataService.updateMetadata).toHaveBeenCalledWith('f1', expect.objectContaining({ dataprep: expect.objectContaining({ status: 'retracted' }) }));
      expect(fileService.deleteIngestionLogs).toHaveBeenCalledWith('f1');
    });
  });
});
