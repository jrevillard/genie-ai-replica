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

      // The fetch is BOUNDED: a request that never answers left the
      // hierarchy 'loading' forever (the grid hidden, the restore's await
      // unresolved, the chat unusable).
      //
      // The bound lives in the THIRD argument — httpService.get's axios
      // options. Its second argument is the QUERY: it reads `params` from
      // it and sends the rest as query parameters, so a timeout placed
      // there is dropped and axios waits forever. This assertion pins the
      // SHAPE of the call; whether the bound REACHES axios is proved by
      // serviceTreeServiceTimeout.test.js, which drives the real client.
      expect(mockGet).toHaveBeenCalledWith('services/categories', { params: { locale: 'en' } }, { timeout: 15000 });
      expect(result).toEqual([{ catKey: 'health', name: 'Health' }]);
    });

    it('defaults to en locale', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await serviceTreeService.getAllCategories();

      expect(mockGet).toHaveBeenCalledWith('services/categories', { params: { locale: 'en' } }, { timeout: 15000 });
    });

    it('rejects a body that is not a list of categories', async () => {
      // A broken answer (a proxy error page, an object) is not a
      // hierarchy: a client that walks it throws mid-render and the chat
      // panel goes blank. The load must FAIL, so the caller can say the
      // scope cannot be verified.
      mockGet.mockResolvedValue({ data: { error: 'boom' } });

      await expect(serviceTreeService.getAllCategories('en')).rejects.toThrow(/not a list/i);
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

      // The fetch is BOUNDED, like its public sibling: a request that
      // never answers left the admin panel's hierarchy spinner turning
      // forever, with no error to show. The bound lives in the THIRD
      // argument — the second one is the query, and a timeout placed
      // there is dropped on the floor.
      expect(mockGet).toHaveBeenCalledWith(
        'service-categories/categories/detailed',
        { params: { locale: 'fr' } },
        { timeout: 15000 }
      );
      expect(result).toHaveLength(1);
    });

    it('rejects a body that is not a list of categories', async () => {
      // A broken answer (a proxy error page, an object) is not a
      // hierarchy: a client that walks it throws mid-render. The load
      // must FAIL so the panel shows the failed state.
      mockGet.mockResolvedValue({ data: { error: 'boom' } });

      await expect(serviceTreeService.getAdminCategories('en')).rejects.toThrow(/not a list/i);
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
});
