const labelService = require('../../../services/labelService');

describe('labelService', () => {
  describe('validateLevelAndStatus', () => {
    it('should not throw for valid level and status', () => {
      expect(() => labelService.validateLevelAndStatus('category', 'active')).not.toThrow();
      expect(() => labelService.validateLevelAndStatus('service', 'pending')).not.toThrow();
    });

    it('should throw for invalid level', () => {
      expect(() => labelService.validateLevelAndStatus('invalid', 'active')).toThrow('Invalid level');
    });

    it('should throw for invalid status', () => {
      expect(() => labelService.validateLevelAndStatus('category', 'invalid')).toThrow('Invalid status');
    });

    it('should not throw when no level or status provided', () => {
      expect(() => labelService.validateLevelAndStatus()).not.toThrow();
      expect(() => labelService.validateLevelAndStatus('category')).not.toThrow();
      expect(() => labelService.validateLevelAndStatus(null, 'active')).not.toThrow();
    });
  });

  describe('getLabelById', () => {
    it('should throw when label not found (errorNum 1202)', async () => {
      // Mock db to throw ArangoDB document not found error
      const mockCollection = { document: jest.fn().mockRejectedValue({ errorNum: 1202 }) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.getLabelById('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('getLabels', () => {
    it('should return labels for empty filters', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.getLabels({});
      expect(result).toEqual([]);
    });

    it('should return labels matching name filter', async () => {
      const labels = [
        { name: 'Label A', level: 'service' },
        { name: 'Label B', level: 'category' },
      ];
      const mockCursor = { all: jest.fn().mockResolvedValue(labels) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.getLabels({ name: 'A' });
      expect(result).toHaveLength(2);
    });
  });

  describe('createLabel', () => {
    it('should throw if parent label is not a category', async () => {
      const parentLabel = { level: 'service', _key: 'service1' };
      const mockCollection = { document: jest.fn().mockResolvedValue(parentLabel) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(
        labelService.createLabel({ name: 'Child', level: 'service', parentId: 'service1' })
      ).rejects.toThrow('Parent must be a category');
    });
  });

  describe('deleteLabel', () => {
    it('should throw if label has child labels', async () => {
      const childLabel = { parentId: 'parent1' };
      const mockCursor = { all: jest.fn().mockResolvedValue([childLabel]) };
      const mockCollection = { remove: jest.fn() };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor), collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.deleteLabel('parent1')).rejects.toThrow('has child labels');
    });
  });
});
