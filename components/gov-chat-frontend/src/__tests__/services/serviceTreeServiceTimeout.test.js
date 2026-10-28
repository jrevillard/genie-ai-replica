'use strict';

// The hierarchy fetch must be BOUNDED — and the bound must reach the HTTP
// client, not merely the call site.
//
// A request that never answers left the hierarchy 'loading' forever: the
// Quick Help grid stayed hidden with no error, the restore's await never
// resolved, and the chat was unusable until the request finally failed.
//
// The serviceTreeService unit test mocks httpService, so it can only see
// the SHAPE of the call — a shape that can carry a `timeout` that the real
// client silently drops (it lands in the `params` argument, not in the
// `options` one). That is exactly what happened: the call site passed
// `{ params, timeout }`, httpService.get reads only `params` from its
// second argument, and axios never received a timeout.
//
// This test goes the whole way — the real service, the real httpService,
// a mocked axios — and asserts on the config axios actually receives.
//
// MUTATION CHECK:
//   - move `timeout` back into the params bag in serviceTreeService
//     -> this test fails (axios receives no timeout)
//   - drop `...options` from the config httpService builds
//     -> this test fails
//   - change 15000 to any other value -> this test fails

jest.mock('axios', () => ({
  defaults: { headers: { common: {} } },
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() }
  },
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn()
}));

jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    getAccessToken: () => null,
    signinSilent: jest.fn(),
    login: jest.fn()
  }
}));

jest.mock('@/services/notificationService', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

const axios = require('axios');
const serviceTreeService = require('@/services/serviceTreeService').default;

describe('the hierarchy fetch is bounded at the HTTP client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: [] });
  });

  it('hands axios a timeout for the hierarchy fetch', async () => {
    await serviceTreeService.getAllCategories('en');

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, config] = axios.get.mock.calls[0];
    expect(url).toContain('services/categories');
    // The BOUND — the whole point of the call. Without it axios waits
    // forever and the grid never renders.
    expect(config.timeout).toBe(15000);
    // The query itself must survive the move of the timeout out of the
    // params bag: the locale still reaches the server.
    expect(config.params).toEqual({ locale: 'en' });
  });

  it('bounds the default-locale fetch too', async () => {
    await serviceTreeService.getAllCategories();

    const [, config] = axios.get.mock.calls[0];
    expect(config.timeout).toBe(15000);
    expect(config.params).toEqual({ locale: 'en' });
  });
});
