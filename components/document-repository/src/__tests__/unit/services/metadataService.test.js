const fs = require('fs').promises;
const metadataService = require('../../../services/metadataService');

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn()
  }
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234')
}));

// Mock fileUtils
jest.mock('../../../utils/fileUtils', () => ({
  getFileHash: jest.fn().mockResolvedValue('abc123hash')
}));

// Mock mime-types
jest.mock('mime-types', () => ({
  lookup: jest.fn().mockReturnValue('application/pdf')
}));

describe('metadataService', () => {
  describe('extractMetadata', () => {
    // extractMetadata is not exported directly on the singleton,
    // so we test it indirectly via addMetadata with mocked fs/db
    // Instead, we require the module source to access the standalone function.
    it('should add metadata via addMetadata with mocked fs and db', async () => {
      const mockStats = { size: 1024, birthtime: new Date('2025-01-01') };
      fs.stat.mockResolvedValue(mockStats);

      const savedDoc = {};
      const mockCollection = {
        save: jest.fn().mockResolvedValue(savedDoc)
      };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

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
  });

  describe('searchMetadata', () => {
    it('should query with no filters', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await metadataService.searchMetadata();
      expect(result).toEqual([]);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('FOR file IN files');
      expect(query).toContain('SORT file.uploaded_date DESC');
    });

    it('should add FILTER for file_name', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata('report');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('CONTAINS(LOWER(file.file_name)');
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.file_name).toBe('report');
    });

    it('should add FILTER for file_type', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, 'application/pdf');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.file_type == @file_type');
    });

    it('should add FILTER for date ranges', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, '2025-01-01', '2025-12-31', '2024-01-01', '2024-12-31');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.uploaded_date >= @uploaded_date_from');
      expect(query).toContain('file.uploaded_date <= @uploaded_date_to');
      expect(query).toContain('file.create_date >= @create_date_from');
      expect(query).toContain('file.create_date <= @create_date_to');
    });

    it('should add FILTER for labels using INTERSECTION', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, ['label1', 'label2']);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('INTERSECTION(file.labels, @labels)');
    });

    it('should add FILTER for author', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, null, 'John');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.author == @author');
    });

    it('should add FILTER for status', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, null, null, 'Ingested');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.dataprep.status == @status');
    });

    it('should add FILTER for language', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, null, null, null, 'en');
      const query = mockDb.query.mock.calls[0][0];
      expect(query).toContain('file.language == @language');
    });

    it('should combine multiple filters with AND', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      // 3 filters: file_name, file_type, author
      await metadataService.searchMetadata('doc', 'text/plain', null, null, null, null, null, 'Alice');
      const query = mockDb.query.mock.calls[0][0];
      const filterCount = (query.match(/ AND /g) || []).length;
      expect(filterCount).toBe(2); // 3 filters = 2 ANDs
    });

    it('should ignore empty labels array', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.searchMetadata(null, null, null, null, null, null, []);
      const query = mockDb.query.mock.calls[0][0];
      expect(query).not.toContain('INTERSECTION');
    });
  });

  describe('getMetadataById', () => {
    it('should return metadata when found', async () => {
      const metadata = { file_id: '123', file_name: 'test.pdf' };
      const mockCursor = { next: jest.fn().mockResolvedValue(metadata) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await metadataService.getMetadataById('123');
      expect(result).toEqual(metadata);
    });

    it('should return null when not found', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await metadataService.getMetadataById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('deleteMetadata', () => {
    it('should throw when metadata not found', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

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

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await metadataService.deleteMetadata('123');
      expect(result).toBe(true);
      expect(mockCollection.remove).toHaveBeenCalledWith('abc123');
    });
  });

  describe('updateMetadata', () => {
    it('should throw when metadata not found', async () => {
      const mockCursor = { next: jest.fn().mockResolvedValue(null) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

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

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.updateMetadata('123', {
        dataprep: { status: 'Ingested', ingest_date: '2025-01-01T00:00:00Z' },
        chunk_count: 5,
        file_name: 'should-be-ignored.pdf' // not in allowed fields
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

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

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

      metadataService.getDb = jest.fn().mockResolvedValue(mockDb);

      await metadataService.updateMetadata('123', {
        dataprep: { status: 'Retracted', retract_date: '2025-06-01' }
      });

      const updateArg = mockCollection.update.mock.calls[0][1];
      // Should preserve ingest_date from existing metadata
      expect(updateArg.dataprep.ingest_date).toBe('2025-01-01');
      expect(updateArg.dataprep.status).toBe('Retracted');
      expect(updateArg.dataprep.retract_date).toBe('2025-06-01');
    });
  });
});
