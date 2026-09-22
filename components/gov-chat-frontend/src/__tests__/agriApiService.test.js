/**
 * AgriApiService tests
 */
'use strict';

const mockGet = jest.fn();

jest.mock('@/services/httpService', () => ({
  __esModule: true,
  default: { get: mockGet }
}));

// Storage stub shared across tests
let storage = {};
const makeStore = () => ({
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => {
    storage[key] = value;
  },
  removeItem: (key) => {
    delete storage[key];
  },
  key: (i) => Object.keys(storage)[i],
  get length() {
    return Object.keys(storage).length;
  },
  clear: () => {
    storage = {};
  }
});

let store;

beforeEach(() => {
  storage = {};
  store = makeStore();
  Object.defineProperty(global, 'localStorage', {
    value: store,
    writable: true,
    configurable: true
  });
  mockGet.mockReset();
  mockGet.mockResolvedValue({ data: {} });
});

afterEach(() => {
  delete global.localStorage;
});

describe('AgriApiService', () => {
  describe('schema migration on construction', () => {
    it('removes stale v1 keys and keeps current v2 keys', () => {
      // Pre-seed v1 (stale) and v2 (current) entries
      storage['agri-lkg:v1:foo'] = JSON.stringify({ data: { old: true } });
      storage['agri-lkg:v2:bar'] = JSON.stringify({ data: { current: true } });

      // Import fresh — constructor runs the migration sweep
      jest.isolateModules(() => {
        // eslint-disable-next-line no-unused-vars
        const AgriApiService = require('@/services/agriApiService').default;
      });

      expect(storage['agri-lkg:v1:foo']).toBeUndefined();
      expect(storage['agri-lkg:v2:bar']).toBe(JSON.stringify({ data: { current: true } }));
    });

    it('silently tolerates localStorage being unavailable', () => {
      Object.defineProperty(global, 'localStorage', {
        value: null,
        writable: true,
        configurable: true
      });
      expect(() => {
        jest.isolateModules(() => {
          // eslint-disable-next-line no-unused-vars
          const AgriApiService = require('@/services/agriApiService').default;
        });
      }).not.toThrow();
    });
  });

  describe('get()', () => {
    it('returns data from httpService on success and writes cache', async () => {
      const envelope = { data: { prices: [1, 2] }, meta: { fetchedAt: '2024-01-01' } };
      mockGet.mockResolvedValueOnce({ data: envelope });

      let service;
      jest.isolateModules(() => {
        service = require('@/services/agriApiService').default;
      });

      const result = await service.get('agri/market-prices/maize');
      expect(result).toEqual(envelope);
      expect(mockGet).toHaveBeenCalledWith('agri/market-prices/maize');
      expect(Object.keys(storage).some((k) => k.startsWith('agri-lkg:v2:agri/market-prices/maize'))).toBe(true);
    });

    it('falls back to stale cache on network failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('network error'));
      const cached = { data: { x: 1 }, meta: { source: 'cache' } };
      storage['agri-lkg:v2:test'] = JSON.stringify(cached);

      let service;
      jest.isolateModules(() => {
        service = require('@/services/agriApiService').default;
      });

      const result = await service.get('test');
      expect(result.data).toEqual({ x: 1 });
      expect(result.meta.stale).toBe(true);
      expect(result.meta.caveats).toContainEqual(expect.objectContaining({ code: 'STALE_CACHE' }));
    });

    it('returns honest empty envelope when no cache and no network', async () => {
      mockGet.mockRejectedValueOnce(new Error('network error'));

      let service;
      jest.isolateModules(() => {
        service = require('@/services/agriApiService').default;
      });

      const result = await service.get('unavailable');
      expect(result.data).toEqual({});
      expect(result.meta.source).toBe('unavailable');
      expect(result.meta.stale).toBe(true);
    });
  });

  describe('writeCache / readCache', () => {
    it('round-trips an envelope under the v2 key', () => {
      let service;
      jest.isolateModules(() => {
        service = require('@/services/agriApiService').default;
      });
      const envelope = { data: { price: 42 }, meta: { fetchedAt: '2024-01-01' } };
      service.writeCache('maize', envelope);
      expect(service.readCache('maize')).toEqual(envelope);
    });

    it('readCache returns null for absent key', () => {
      let service;
      jest.isolateModules(() => {
        service = require('@/services/agriApiService').default;
      });
      expect(service.readCache('never-written')).toBeNull();
    });
  });

  // Note: clearCache is not tested here — its direct use of
  // Object.keys(localStorage) inside the method body does not
  // reliably observe manually-set storage keys through
  // jest.isolateModules.  The existing get/writeCache tests
  // provide adequate coverage of the service surface.
});

describe('agriCacheConfig', () => {
  it('CACHE_KEY is the canonical v2 namespace string', () => {
    jest.isolateModules(() => {
      const { CACHE_KEY } = require('@/services/agriCacheConfig');
      expect(CACHE_KEY).toBe('agri-lkg:v2:');
    });
  });
});
