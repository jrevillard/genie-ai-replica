const labelService = require('../../../services/labelService');

describe('labelService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    it('should return label when found', async () => {
      const label = { _key: '1', name: 'Test Label', level: 'Category' };
      const mockCollection = { document: jest.fn().mockResolvedValue(label) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.getLabelById('1');
      expect(result).toEqual(label);
      expect(mockCollection.document).toHaveBeenCalledWith('1');
    });

    it('should throw when label not found (errorNum 1202)', async () => {
      const mockCollection = { document: jest.fn().mockRejectedValue({ errorNum: 1202 }) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.getLabelById('nonexistent')).rejects.toThrow('not found');
    });

    it('should re-throw non-1202 errors unchanged', async () => {
      const mockCollection = { document: jest.fn().mockRejectedValue(new Error('connection refused')) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.getLabelById('1')).rejects.toThrow('connection refused');
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
        { name: 'Label B', level: 'category' }
      ];
      const mockCursor = { all: jest.fn().mockResolvedValue(labels) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.getLabels({ name: 'A' });
      expect(result).toHaveLength(2);
    });

    it('should pass level filter to query', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.getLabels({ level: 'Category' });
      const query = mockDb.query.mock.calls[0][0];
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(query).toContain('label.level == @level');
      expect(bindVars.level).toBe('Category');
    });

    it('should pass status filter to query', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.getLabels({ status: 'Active' });
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.status).toBe('Active');
    });

    it('should pass parentId filter to query', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.getLabels({ parentId: 'parent1' });
      const query = mockDb.query.mock.calls[0][0];
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(query).toContain('label.parentId == @parentId');
      expect(bindVars.parentId).toBe('parent1');
    });

    it('should convert string publish filter to boolean', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.getLabels({ publish: 'true' });
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.publish).toBe(true);
    });

    it('should pass boolean publish filter directly', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.getLabels({ publish: false });
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(bindVars.publish).toBe(false);
    });

    it('should combine multiple filters with AND', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockDb = { query: jest.fn().mockResolvedValue(mockCursor) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.getLabels({ level: 'Category', status: 'Active', name: 'test' });
      const query = mockDb.query.mock.calls[0][0];
      const filterCount = (query.match(/ AND /g) || []).length;
      expect(filterCount).toBe(2); // 3 filters = 2 ANDs
    });
  });

  describe('createLabel', () => {
    it('should create a label without parentId successfully', async () => {
      const newLabel = { name: 'Top Level', level: 'category', status: 'active' };
      const savedLabel = { ...newLabel, _key: 'new1' };
      const mockCollection = {
        save: jest.fn().mockResolvedValue({ new: savedLabel })
      };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.createLabel(newLabel);
      expect(result).toEqual(savedLabel);
      expect(mockCollection.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Top Level',
          level: 'category',
          status: 'active',
          parentId: null,
          publish: false
        }),
        { returnNew: true }
      );
    });

    it('should create label with valid category parentId', async () => {
      const parentLabel = { _key: 'cat1', level: 'category' };
      const mockCollection = {
        document: jest.fn().mockResolvedValue(parentLabel),
        save: jest.fn().mockResolvedValue({ new: { _key: 'child1', name: 'Child' } })
      };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.createLabel({
        name: 'Child',
        level: 'service',
        parentId: 'cat1',
        status: 'active'
      });
      expect(result._key).toBe('child1');
    });

    it('should throw if parent label is not a category', async () => {
      const parentLabel = { level: 'service', _key: 'service1' };
      const mockCollection = { document: jest.fn().mockResolvedValue(parentLabel) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.createLabel({ name: 'Child', level: 'service', parentId: 'service1' })).rejects.toThrow(
        'Parent must be a category'
      );
    });

    it('should throw if parentId not found (errorNum 1202)', async () => {
      const mockCollection = { document: jest.fn().mockRejectedValue({ errorNum: 1202 }) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(
        labelService.createLabel({ name: 'Child', level: 'service', parentId: 'missing', status: 'active' })
      ).rejects.toThrow('not found');
    });

    it('should throw for invalid level during creation', async () => {
      await expect(labelService.createLabel({ name: 'Bad', level: 'InvalidLevel', status: 'active' })).rejects.toThrow(
        'Invalid level'
      );
    });

    it('should set publish to false by default', async () => {
      const mockCollection = {
        save: jest.fn().mockResolvedValue({ new: { _key: '1' } })
      };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await labelService.createLabel({ name: 'Test', level: 'category', status: 'active' });
      const savedArg = mockCollection.save.mock.calls[0][0];
      expect(savedArg.publish).toBe(false);
    });
  });

  describe('updateLabel', () => {
    it('should update label successfully', async () => {
      const currentLabel = { _key: '1', name: 'Old Name', level: 'Category' };
      const updatedLabel = { ...currentLabel, name: 'New Name' };
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockCollection = {
        update: jest.fn().mockResolvedValue({ new: updatedLabel })
      };

      // getLabelById uses collection().document()
      mockCollection.document = jest.fn().mockResolvedValue(currentLabel);
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.updateLabel('1', { name: 'New Name' });
      expect(result.name).toBe('New Name');
      expect(mockCollection.update).toHaveBeenCalledWith('1', { name: 'New Name' }, { returnNew: true });
    });

    it('should throw when updating non-existent label', async () => {
      const mockCollection = { document: jest.fn().mockRejectedValue({ errorNum: 1202 }) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.updateLabel('missing', { name: 'Test' })).rejects.toThrow('not found');
    });

    it('should reject downgrading category to service when children exist', async () => {
      const currentLabel = { _key: '1', level: 'category' };
      const childLabels = [{ _key: '2', parentId: '1' }];
      const mockCursor = { all: jest.fn().mockResolvedValue(childLabels) };
      const mockCollection = { document: jest.fn().mockResolvedValue(currentLabel) };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.updateLabel('1', { level: 'service' })).rejects.toThrow('has child labels');
    });

    it('should allow downgrading category to service when no children', async () => {
      const currentLabel = { _key: '1', level: 'category' };
      const updatedLabel = { _key: '1', level: 'service' };
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockCollection = {
        document: jest.fn().mockResolvedValue(currentLabel),
        update: jest.fn().mockResolvedValue({ new: updatedLabel })
      };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.updateLabel('1', { level: 'service' });
      expect(result.level).toBe('service');
    });

    it('should validate new parentId is a category', async () => {
      const currentLabel = { _key: '1', level: 'Subcategory' };
      const parentLabel = { _key: '2', level: 'service' }; // not category
      const mockCollection = {
        document: jest
          .fn()
          .mockResolvedValueOnce(currentLabel) // getLabelById
          .mockResolvedValueOnce(parentLabel), // parentId check
        update: jest.fn()
      };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.updateLabel('1', { parentId: '2' })).rejects.toThrow('Parent must be a category');
    });

    it('should throw for invalid level in updates', async () => {
      const currentLabel = { _key: '1', level: 'Category' };
      const mockCollection = { document: jest.fn().mockResolvedValue(currentLabel) };
      const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.updateLabel('1', { level: 'InvalidLevel' })).rejects.toThrow('Invalid level');
    });
  });

  describe('deleteLabel', () => {
    it('should delete label when it has no children', async () => {
      const mockCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockCollection = { remove: jest.fn().mockResolvedValue({}) };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.deleteLabel('1');
      expect(result).toBe(true);
      expect(mockCollection.remove).toHaveBeenCalledWith('1');
    });

    it('should throw if label has child labels', async () => {
      const childLabel = { parentId: 'parent1' };
      const mockCursor = { all: jest.fn().mockResolvedValue([childLabel]) };
      const mockCollection = { remove: jest.fn() };
      const mockDb = {
        query: jest.fn().mockResolvedValue(mockCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      await expect(labelService.deleteLabel('parent1')).rejects.toThrow('has child labels');
    });
  });

  describe('deleteCategoryWithChildren', () => {
    it('should delete category and all child labels', async () => {
      const mockCollection = { remove: jest.fn().mockResolvedValue({}) };
      const mockDb = {
        query: jest.fn().mockResolvedValue({}),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.deleteCategoryWithChildren('cat1');
      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const query = mockDb.query.mock.calls[0][0];
      const bindVars = mockDb.query.mock.calls[0][1];
      expect(query).toContain('REMOVE');
      expect(bindVars.labelKey).toBe('cat1');
      expect(mockCollection.remove).toHaveBeenCalledWith('cat1');
    });
  });

  describe('getRelatedLabels', () => {
    it('should return label, parent, and children', async () => {
      const label = { _key: '1', name: 'Child', parentId: 'parent1' };
      const parent = { _key: 'parent1', name: 'Parent Category', level: 'Category' };
      const children = [{ _key: '2', name: 'Grandchild', parentId: '1' }];

      const childCursor = { all: jest.fn().mockResolvedValue(children) };
      const mockCollection = {
        document: jest
          .fn()
          .mockResolvedValueOnce(label) // the label itself
          .mockResolvedValueOnce(parent) // parent lookup
      };
      const mockDb = {
        query: jest.fn().mockResolvedValue(childCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.getRelatedLabels('1');
      expect(result.label).toEqual(label);
      expect(result.parent).toEqual(parent);
      expect(result.children).toEqual(children);
    });

    it('should return null parent when label has no parentId', async () => {
      const label = { _key: '1', name: 'Root', parentId: null };
      const childCursor = { all: jest.fn().mockResolvedValue([]) };
      const mockCollection = { document: jest.fn().mockResolvedValue(label) };
      const mockDb = {
        query: jest.fn().mockResolvedValue(childCursor),
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      labelService.getDb = jest.fn().mockResolvedValue(mockDb);

      const result = await labelService.getRelatedLabels('1');
      expect(result.parent).toBeNull();
      expect(result.children).toEqual([]);
    });
  });
});
