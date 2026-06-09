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

const serviceTreeService = require('@/services/serviceTreeService').default;

describe('serviceTreeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getAllCategories
  // =========================================================================
  describe('getAllCategories', () => {
    it('fetches all categories with locale param', async () => {
      mockGet.mockResolvedValue({ data: [{ catKey: 'health', name: 'Health' }] });

      const result = await serviceTreeService.getAllCategories('en');

      expect(mockGet).toHaveBeenCalledWith('services/categories', { params: { locale: 'en' } });
      expect(result).toEqual([{ catKey: 'health', name: 'Health' }]);
    });

    it('defaults to en locale', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await serviceTreeService.getAllCategories();

      expect(mockGet).toHaveBeenCalledWith('services/categories', { params: { locale: 'en' } });
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(serviceTreeService.getAllCategories()).rejects.toThrow('Server error');
    });
  });

  // =========================================================================
  // getAdminCategories
  // =========================================================================
  describe('getAdminCategories', () => {
    it('fetches detailed admin categories', async () => {
      mockGet.mockResolvedValue({
        data: [{ catKey: 'health', name: 'Health', children: [{ serviceKey: 'med', serviceName: 'Medical' }] }]
      });

      const result = await serviceTreeService.getAdminCategories('fr');

      expect(mockGet).toHaveBeenCalledWith('service-categories/categories/detailed', { params: { locale: 'fr' } });
      expect(result).toHaveLength(1);
    });
  });

  // =========================================================================
  // getCategoryServices
  // =========================================================================
  describe('getCategoryServices', () => {
    it('fetches services for a category', async () => {
      mockGet.mockResolvedValue({
        data: { children: [{ serviceKey: 'passport', serviceName: 'Passport' }] }
      });

      const result = await serviceTreeService.getCategoryServices('citizenship');

      expect(mockGet).toHaveBeenCalledWith('services/categories/citizenship', { params: { locale: 'en' } });
      expect(result).toEqual([{ serviceKey: 'passport', serviceName: 'Passport' }]);
    });
  });

  // =========================================================================
  // searchServices
  // =========================================================================
  describe('searchServices', () => {
    it('searches services by query', async () => {
      mockGet.mockResolvedValue({
        data: { categories: [{ catKey: 'health' }], services: [{ name: 'Medical' }] }
      });

      const result = await serviceTreeService.searchServices('medi', 'en');

      expect(mockGet).toHaveBeenCalledWith('services/search', { params: { query: 'medi', locale: 'en' } });
      expect(result.categories).toHaveLength(1);
      expect(result.services).toHaveLength(1);
    });

    it('returns fallback on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await serviceTreeService.searchServices('test');

      expect(result).toEqual({ categories: [], services: [] });
    });
  });

  // =========================================================================
  // getCategoryTranslations
  // =========================================================================
  describe('getCategoryTranslations', () => {
    it('fetches translations for a category', async () => {
      mockGet.mockResolvedValue({
        data: [{ lang: 'FR', text: 'Citoyenneté' }]
      });

      const result = await serviceTreeService.getCategoryTranslations('cat-1');

      expect(mockGet).toHaveBeenCalledWith('service-categories/cat-1/translations');
      expect(result).toEqual([{ lang: 'FR', text: 'Citoyenneté' }]);
    });

    it('returns [] on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await serviceTreeService.getCategoryTranslations('cat-1');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getServiceTranslations
  // =========================================================================
  describe('getServiceTranslations', () => {
    it('fetches translations for a service', async () => {
      mockGet.mockResolvedValue({
        data: [{ lang: 'FR', text: 'Passeport' }]
      });

      const result = await serviceTreeService.getServiceTranslations('svc-1');

      expect(mockGet).toHaveBeenCalledWith('service-categories/services/svc-1/translations');
      expect(result).toEqual([{ lang: 'FR', text: 'Passeport' }]);
    });

    it('returns [] on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await serviceTreeService.getServiceTranslations('svc-1');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // createCategory
  // =========================================================================
  describe('createCategory', () => {
    it('creates a new category', async () => {
      mockPost.mockResolvedValue({ data: { _key: 'cat-new', nameEN: 'New Category' } });

      const result = await serviceTreeService.createCategory({ nameEN: 'New Category' });

      expect(mockPost).toHaveBeenCalledWith('service-categories', { nameEN: 'New Category' });
      expect(result._key).toBe('cat-new');
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      await expect(serviceTreeService.createCategory({ nameEN: 'Test' })).rejects.toThrow('Server error');
    });
  });

  // =========================================================================
  // updateCategory
  // =========================================================================
  describe('updateCategory', () => {
    it('updates an existing category', async () => {
      mockPut.mockResolvedValue({ data: { _key: 'cat-1', nameEN: 'Updated' } });

      const result = await serviceTreeService.updateCategory('cat-1', { nameEN: 'Updated' });

      expect(mockPut).toHaveBeenCalledWith('service-categories/cat-1', { nameEN: 'Updated' });
      expect(result.nameEN).toBe('Updated');
    });
  });

  // =========================================================================
  // createService
  // =========================================================================
  describe('createService', () => {
    it('creates a service under a category', async () => {
      mockPost.mockResolvedValue({ data: { _key: 'svc-new', nameEN: 'New Service' } });

      const result = await serviceTreeService.createService('cat-1', { nameEN: 'New Service' });

      expect(mockPost).toHaveBeenCalledWith('service-categories/cat-1/services', { nameEN: 'New Service' });
      expect(result._key).toBe('svc-new');
    });
  });

  // =========================================================================
  // updateService
  // =========================================================================
  describe('updateService', () => {
    it('updates an existing service', async () => {
      mockPut.mockResolvedValue({ data: { _key: 'svc-1', nameEN: 'Updated' } });

      const result = await serviceTreeService.updateService('svc-1', { nameEN: 'Updated' });

      expect(mockPut).toHaveBeenCalledWith('service-categories/services/svc-1', { nameEN: 'Updated' });
      expect(result.nameEN).toBe('Updated');
    });
  });

  // =========================================================================
  // deleteCategory
  // =========================================================================
  describe('deleteCategory', () => {
    it('deletes a category', async () => {
      mockDelete.mockResolvedValue({ data: { success: true } });

      const result = await serviceTreeService.deleteCategory('cat-1');

      expect(mockDelete).toHaveBeenCalledWith('service-categories/cat-1');
      expect(result).toEqual({ success: true });
    });

    it('throws on API failure', async () => {
      mockDelete.mockRejectedValue(new Error('Server error'));

      await expect(serviceTreeService.deleteCategory('cat-1')).rejects.toThrow('Server error');
    });
  });

  // =========================================================================
  // deleteService
  // =========================================================================
  describe('deleteService', () => {
    it('deletes a service', async () => {
      mockDelete.mockResolvedValue({ data: { success: true } });

      const result = await serviceTreeService.deleteService('svc-1');

      expect(mockDelete).toHaveBeenCalledWith('service-categories/services/svc-1');
      expect(result).toEqual({ success: true });
    });
  });

  // =========================================================================
  // transformCategoriesToTreeNodes
  // =========================================================================
  describe('transformCategoriesToTreeNodes', () => {
    it('transforms categories to tree node format', () => {
      const categories = [
        { catKey: 'health', name: 'Health', children: ['svc-1'] },
        { catKey: 'education', name: 'Education', children: [] }
      ];

      const result = serviceTreeService.transformCategoriesToTreeNodes(categories);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        catKey: 'health',
        name: 'Health',
        expanded: false,
        children: ['svc-1']
      });
      expect(result[1].name).toBe('Education');
    });

    it('returns empty array for empty input', () => {
      const result = serviceTreeService.transformCategoriesToTreeNodes([]);

      expect(result).toEqual([]);
    });

    it('throws on null input', () => {
      expect(() => serviceTreeService.transformCategoriesToTreeNodes(null)).toThrow();
    });

    it('replaces null children with empty array', () => {
      const categories = [{ catKey: 'health', name: 'Health', children: null }];

      const result = serviceTreeService.transformCategoriesToTreeNodes(categories);

      expect(result[0].children).toEqual([]);
      expect(result[0].expanded).toBe(false);
    });

    it('handles categories with missing name property', () => {
      const categories = [{ catKey: 'health' }];

      const result = serviceTreeService.transformCategoriesToTreeNodes(categories);

      expect(result[0].catKey).toBe('health');
      expect(result[0].name).toBeUndefined();
      expect(result[0].expanded).toBe(false);
    });
  });
});
