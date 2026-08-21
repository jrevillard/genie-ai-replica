jest.mock('fs', () => ({
  promises: {
    stat: jest.fn()
  }
}));

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234')
}));

jest.mock('../../../utils/fileUtils', () => ({
  getFileHash: jest.fn().mockResolvedValue('abc123hash')
}));

jest.mock('mime-types', () => ({
  lookup: jest.fn().mockReturnValue('application/pdf')
}));

jest.mock(
  '../../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

const fs = require('fs').promises;
const metadataService = require('../../../services/metadataService');

describe('metadataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addMetadata', () => {
    it('should add metadata via addMetadata with mocked fs and db', async () => {
      const mockStats = { size: 1024, birthtime: new Date('2025-01-01') };
      fs.stat.mockResolvedValue(mockStats);

      const savedDoc = {};
      const mockCollection = {
        save: jest.fn().mockResolvedValue(savedDoc)
      };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/fake/path.pdf', {
        file_name: 'test.pdf',
        author: 'Test Author'
      });

      expect(mockCollection.save).toHaveBeenCalledTimes(1);
      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.file_name).toBe('test.pdf');
      expect(savedArg.author).toBe('Test Author');
      expect(savedArg.file_type).toBe('application/pdf');
      expect(savedArg.file_size).toBe(1024);
      expect(savedArg.file_hash).toBe('abc123hash');
      expect(savedArg.uploaded_date).toBeDefined();
      expect(savedArg.create_date).toBeDefined();
      expect(savedArg.dataprep.status).toBe('Pending');
      expect(savedArg.chunk_count).toBe(0);
    });

    it('should use fileInfo overrides when provided', async () => {
      const mockStats = { size: 2048, birthtime: new Date('2025-02-01') };
      fs.stat.mockResolvedValue(mockStats);

      const mockCollection = { save: jest.fn().mockResolvedValue({}) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/path.pdf', {
        file_id: 'custom-id',
        file_name: 'custom.pdf',
        file_size: 9999,
        file_type: 'text/plain',
        file_hash: 'custom-hash',
        labels: ['label-a'],
        author: 'Custom Author',
        language: 'fr',
        source_url: 'https://example.com',
        crawl_date: '2025-06-01T12:00:00.000Z'
      });

      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.file_id).toBe('custom-id');
      expect(savedArg.file_size).toBe(9999);
      expect(savedArg.file_type).toBe('text/plain');
      expect(savedArg.file_hash).toBe('custom-hash');
      expect(savedArg.labels).toEqual(['label-a']);
      expect(savedArg.language).toBe('fr');
      expect(savedArg.source_url).toBe('https://example.com');
      expect(savedArg.crawl_date).toBe('2025-06-01T12:00:00.000Z');
    });

    it('should default language to unknown when not provided', async () => {
      const mockStats = { size: 100, birthtime: new Date() };
      fs.stat.mockResolvedValue(mockStats);

      const mockCollection = { save: jest.fn().mockResolvedValue({}) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/path.pdf', { file_name: 'test.pdf' });

      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.language).toBe('unknown');
    });

    it('should preserve file_size of 0 (not fall back to stats.size)', async () => {
      const mockStats = { size: 2048, birthtime: new Date() };
      fs.stat.mockResolvedValue(mockStats);

      const mockCollection = { save: jest.fn().mockResolvedValue({}) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/path.pdf', { file_size: 0 });

      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.file_size).toBe(0);
    });

    it('should compute file_hash when file_hash is empty string', async () => {
      const mockStats = { size: 100, birthtime: new Date() };
      fs.stat.mockResolvedValue(mockStats);

      const mockCollection = { save: jest.fn().mockResolvedValue({}) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/path.pdf', { file_hash: '' });

      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.file_hash).toBe('abc123hash');
    });

    it('should preserve empty array labels (not fall back to [])', async () => {
      const mockStats = { size: 100, birthtime: new Date() };
      fs.stat.mockResolvedValue(mockStats);

      const mockCollection = { save: jest.fn().mockResolvedValue({}) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/path.pdf', { labels: [] });

      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.labels).toEqual([]);
    });

    it('should preserve empty string author (not fall back to default)', async () => {
      const mockStats = { size: 100, birthtime: new Date() };
      fs.stat.mockResolvedValue(mockStats);

      const mockCollection = { save: jest.fn().mockResolvedValue({}) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.addMetadata('/path.pdf', { author: '' });

      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.author).toBe('');
    });

    it('should propagate errors from addMetadata', async () => {
      fs.stat.mockRejectedValue(new Error('file not found'));

      await expect(metadataService.addMetadata('/missing.pdf', {})).rejects.toThrow('file not found');
    });
  });

  describe('searchMetadata', () => {
    it('should query with no filters', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      const result = await metadataService.searchMetadata();
      expect(result).toEqual([]);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('FOR file IN files');
      expect(query).toContain('SORT file.uploaded_date DESC');
    });

    it('should add FILTER for file_name', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata('report');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('CONTAINS(LOWER(file.file_name)');
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.file_name).toBe('report');
    });

    it('should add FILTER for file_type', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, 'application/pdf');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.file_type == @file_type');
    });

    it('should add FILTER for date ranges', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, '2025-01-01', '2025-12-31', '2024-01-01', '2024-12-31');
      const query = mockDb.query.mock.calls[0][0];
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(query).toContain('file.uploaded_date >= @uploaded_date_from');
      expect(query).toContain('file.uploaded_date <= @uploaded_date_to');
      expect(query).toContain('file.create_date >= @create_date_from');
      expect(query).toContain('file.create_date <= @create_date_to');
      expect(bindVars.uploaded_date_from).toBe('2025-01-01');
      expect(bindVars.uploaded_date_to).toBe('2025-12-31');
      expect(bindVars.create_date_from).toBe('2024-01-01');
      expect(bindVars.create_date_to).toBe('2024-12-31');
    });

    it('should add FILTER for labels using INTERSECTION', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, ['label1', 'label2']);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('INTERSECTION(file.labels, @labels)');
    });

    it('should add FILTER for author', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, null, 'John');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.author == @author');
    });

    it('should add FILTER for status', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, null, null, 'Ingested');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.dataprep.status == @status');
    });

    it('should add FILTER for language', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, null, null, null, 'en');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.language == @language');
    });

    it('should combine multiple filters with AND', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata('doc', 'text/plain', null, null, null, null, null, 'Alice');
      const query = mockDb.query.mock.calls[0][0];
      const filterCount = (query.match(/ AND /g) || []).length;
      expect(filterCount).toBe(2); // 3 filters = 2 ANDs
    });

    it('should ignore empty labels array', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, []);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).not.toContain('INTERSECTION');
    });

    it('should return search results from cursor', async () => {
      const results = [{ file_id: '1', file_name: 'report.pdf' }];
      const mockCursor = { all: jest.fn().mockResolvedValue(results) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      const result = await metadataService.searchMetadata('report');
      expect(result).toEqual(results);
    });

    it('should propagate database errors', async () => {
      const mockDb = { query: jest.fn().mockRejectedValue(new Error('DB connection lost')) };
      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await expect(metadataService.searchMetadata('test')).rejects.toThrow('DB connection lost');
    });
  });

  describe('getMetadataById', () => {
    it('should return metadata when found', async () => {
      const metadata = { file_id: '123', file_name: 'test.pdf' };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      const result = await metadataService.getMetadataById('123');
      expect(result).toEqual(metadata);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('FILTER file.file_id == @file_id');
    });

    it('should return null when not found', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      const result = await metadataService.getMetadataById('nonexistent');
      expect(result).toBeNull();
    });

    it('should query with correct file_id bindVar', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.getMetadataById('file-abc123');
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.file_id).toBe('file-abc123');
    });
  });

  describe('deleteMetadata', () => {
    it('should throw when metadata not found', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await expect(metadataService.deleteMetadata('nonexistent')).rejects.toThrow('Metadata not found');
    });

    it('should remove metadata when found', async () => {
      const metadata = { _key: 'abc123', file_id: '123' };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockCollection = { remove: jest.fn().mockResolvedValue(true) };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      const result = await metadataService.deleteMetadata('123');
      expect(result).toBe(true);
      expect(mockCollection.remove).toHaveBeenCalledWith('abc123');
    });

    it('should propagate database errors during delete', async () => {
      const metadata = { _key: 'abc123', file_id: '123' };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockCollection = { remove: jest.fn().mockRejectedValue(new Error('remove failed')) };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await expect(metadataService.deleteMetadata('123')).rejects.toThrow('remove failed');
    });
  });

  describe('updateMetadata', () => {
    it('should throw when metadata not found', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await expect(metadataService.updateMetadata('nonexistent', { dataprep: { status: 'Ingested' } })).rejects.toThrow(
        'Metadata not found'
      );
    });

    it('should update only allowed fields (dataprep, chunk_count)', async () => {
      const metadata = {
        _key: 'abc123',
        file_id: '123',
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' }
      };
      const updatedDoc = {
        ...metadata,
        dataprep: { status: 'Ingested', ingest_date: '', retract_date: '' },
        chunk_count: 5
      };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockCollection = {
        update: jest.fn().mockResolvedValue(updatedDoc),
        document: jest.fn().mockResolvedValue(updatedDoc)
      };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.updateMetadata('123', {
        dataprep: { status: 'Ingested', ingest_date: '2025-01-01T00:00:00Z' },
        chunk_count: 5,
        file_name: 'should-be-ignored.pdf'
      });

      expect(mockCollection.update).toHaveBeenCalledTimes(1);
      const updateArg = mockCollection.update.mock.calls[0][1];
      expect(updateArg.chunk_count).toBe(5);
      expect(updateArg.dataprep.status).toBe('Ingested');
      expect(updateArg.file_name).toBeUndefined();
    });

    it('should throw when no valid fields provided', async () => {
      const metadata = {
        _key: 'abc123',
        file_id: '123',
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' }
      };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await expect(metadataService.updateMetadata('123', { file_name: 'hack.pdf' })).rejects.toThrow(
        'No valid fields to update'
      );
    });

    it('should merge dataprep fields with existing metadata', async () => {
      const metadata = {
        _key: 'abc123',
        file_id: '123',
        dataprep: { status: 'Ingested', ingest_date: '2025-01-01', retract_date: '' }
      };
      const updatedDoc = {
        ...metadata,
        dataprep: { status: 'Retracted', ingest_date: '2025-01-01', retract_date: '2025-06-01' }
      };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockCollection = {
        update: jest.fn().mockResolvedValue(updatedDoc),
        document: jest.fn().mockResolvedValue(updatedDoc)
      };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      await metadataService.updateMetadata('123', {
        dataprep: { status: 'Retracted', retract_date: '2025-06-01' }
      });

      const updateArg = mockCollection.update.mock.calls[0][1];
      expect(updateArg.dataprep.ingest_date).toBe('2025-01-01');
      expect(updateArg.dataprep.status).toBe('Retracted');
      expect(updateArg.dataprep.retract_date).toBe('2025-06-01');
    });

    it('should return the updated document after update', async () => {
      const metadata = {
        _key: 'abc123',
        file_id: '123',
        dataprep: { status: 'Pending' }
      };
      const updatedDoc = { ...metadata, chunk_count: 10 };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockCollection = {
        update: jest.fn().mockResolvedValue({}),
        document: jest.fn().mockResolvedValue(updatedDoc)
      };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      jest.spyOn(metadataService, 'getDb').mockResolvedValue(mockDb);

      const result = await metadataService.updateMetadata('123', { chunk_count: 10 });
      expect(result).toEqual(updatedDoc);
      expect(mockCollection.document).toHaveBeenCalledWith('abc123');
    });
  });
});
