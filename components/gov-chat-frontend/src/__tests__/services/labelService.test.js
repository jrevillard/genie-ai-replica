'use strict';

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

const labelService = require('@/services/labelService').default;

describe('labelService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLabels', () => {
    it('fetches labels without params', async () => {
      const labels = [{ id: '1', name: 'Health', level: 'category' }];
      mockGet.mockResolvedValue({ data: labels });

      const result = await labelService.getLabels();

      expect(mockGet).toHaveBeenCalledWith('/labels', { params: {} });
      expect(result).toEqual(labels);
    });

    it('fetches labels with filter params', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await labelService.getLabels({ level: 'service', status: 'active' });

      expect(mockGet).toHaveBeenCalledWith('/labels', { params: { level: 'service', status: 'active' } });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(labelService.getLabels()).rejects.toThrow('Server error');
    });
  });

  describe('createLabel', () => {
    it('creates a label', async () => {
      const newLabel = { name: 'Test', level: 'category' };
      const created = { id: '2', ...newLabel };
      mockPost.mockResolvedValue({ data: created });

      const result = await labelService.createLabel(newLabel);

      expect(mockPost).toHaveBeenCalledWith('/labels', newLabel);
      expect(result).toEqual(created);
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(labelService.createLabel({})).rejects.toThrow('Server error');
    });
  });

  describe('updateLabel', () => {
    it('updates a label', async () => {
      const updates = { name: 'Updated' };
      mockPatch.mockResolvedValue({ data: { id: '1', name: 'Updated' } });

      const result = await labelService.updateLabel('1', updates);

      expect(mockPatch).toHaveBeenCalledWith('/labels/1', updates);
      expect(result).toEqual({ id: '1', name: 'Updated' });
    });

    it('throws on API failure', async () => {
      mockPatch.mockRejectedValue(new Error('Server error'));

      await expect(labelService.updateLabel('1', {})).rejects.toThrow('Server error');
    });
  });

  describe('deleteLabel', () => {
    it('deletes a label', async () => {
      mockDelete.mockResolvedValue({ data: { success: true } });

      const result = await labelService.deleteLabel('1');

      expect(mockDelete).toHaveBeenCalledWith('/labels/1');
      expect(result).toEqual({ success: true });
    });

    it('throws on API failure', async () => {
      mockDelete.mockRejectedValue(new Error('Server error'));

      await expect(labelService.deleteLabel('1')).rejects.toThrow('Server error');
    });
  });
});
