'use strict';

// The ONE client-credentials minter (#1168, DW-438). The three historical
// minters duplicated the cache (two of them expiry-BLIND), the single-flight
// and the endpoint failover; this suite pins the consolidated core so the
// next consumer gets the behavior the reference implementation (okf-server
// service-token.js) already proved live — and so a future edit cannot
// quietly re-split the behavior three ways.

const { createClientCredentialsMinter } = require('../client-credentials');

function mintResponse(expiresIn) {
  return { access_token: 'tok-' + Math.random().toString(36).slice(2), expires_in: expiresIn };
}

describe('client-credentials minter (#1168)', () => {
  let nowMs;
  const clock = () => nowMs;

  beforeEach(() => {
    nowMs = 1_000_000;
  });

  it('mints once and caches within the expiry minus the buffer', async () => {
    const mintAt = jest.fn().mockResolvedValue(mintResponse(300));
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    const t1 = await m.getToken();
    const t2 = await m.getToken();
    expect(t1).toBe(t2);
    expect(mintAt).toHaveBeenCalledTimes(1);
    expect(mintAt).toHaveBeenCalledWith('http://kc/token');
  });

  it('forceRefresh bypasses the cache and re-mints', async () => {
    const mintAt = jest.fn().mockResolvedValue(mintResponse(300));
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    await m.getToken();
    await m.getToken(true);
    expect(mintAt).toHaveBeenCalledTimes(2);
  });

  it('refreshes when now reaches expiry minus the buffer (strict less-than, the reference behavior)', async () => {
    const mintAt = jest.fn().mockImplementation(async () => mintResponse(300));
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    await m.getToken(); // expiry = now + 300s = 1_300_000
    nowMs = 1_300_000 - 30_000 - 1; // one ms INSIDE the buffer — still cached
    await m.getToken();
    expect(mintAt).toHaveBeenCalledTimes(1);
    nowMs = 1_300_000 - 30_000; // at the buffer edge — the strict `<` refreshes
    await m.getToken();
    expect(mintAt).toHaveBeenCalledTimes(2);
  });

  it('single-flights a concurrent refresh: N callers share ONE mint', async () => {
    let resolveMint;
    const mintAt = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveMint = resolve;
      })
    );
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    const p1 = m.getToken();
    const p2 = m.getToken();
    const p3 = m.getToken(true); // even a forceRefresh racing the in-flight mint shares it
    resolveMint(mintResponse(300));
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(mintAt).toHaveBeenCalledTimes(1);
  });

  it('fails over to the next endpoint and remembers the winner', async () => {
    const mintAt = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED first'))
      .mockImplementation(async () => mintResponse(300)); // every later mint succeeds
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc-first/token', 'http://kc-second/token'],
      mintAt,
      now: clock
    });
    const t = await m.getToken();
    expect(mintAt).toHaveBeenNthCalledWith(1, 'http://kc-first/token');
    expect(mintAt).toHaveBeenNthCalledWith(2, 'http://kc-second/token');

    // Second mint (after invalidate): the WINNER is tried first.
    m.invalidate();
    await m.getToken(true);
    expect(mintAt).toHaveBeenNthCalledWith(3, 'http://kc-second/token');
    expect(t).toBeTruthy();
  });

  it('names every endpoint it tried when all fail (the diagnosis must be self-describing)', async () => {
    const mintAt = jest.fn().mockRejectedValue(new Error('down'));
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://a/token', 'http://b/token'],
      mintAt,
      now: clock
    });
    await expect(m.getToken()).rejects.toThrow(/2 endpoint\(s\).*http:\/\/a\/token.*http:\/\/b\/token/s);
    expect(mintAt).toHaveBeenCalledTimes(2);
  });

  it('defaults expires_in to 300 when the endpoint omits it, and ignores a non-numeric one', async () => {
    const mintAt = jest.fn().mockImplementation(async () => ({ access_token: 'tok' })); // no expires_in
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    await m.getToken();
    nowMs = 1_000_000 + (300 - 30) * 1000 - 1; // the default window minus buffer, inside it: still cached
    await m.getToken();
    expect(mintAt).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces the next getToken to mint fresh (the 401-retry path)', async () => {
    const mintAt = jest.fn().mockImplementation(async () => mintResponse(3600)); // FRESH token per mint
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    const t1 = await m.getToken();
    m.invalidate();
    const t2 = await m.getToken();
    expect(t2).not.toBe(t1);
    expect(mintAt).toHaveBeenCalledTimes(2);
  });

  it("isConfigured reflects the secret, and getToken mints REGARDLESS (configuration policy is the caller's)", async () => {
    const mintAt = jest.fn().mockResolvedValue(mintResponse(300));
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: '',
      tokenEndpoints: ['http://kc/token'],
      mintAt,
      now: clock
    });
    expect(m.isConfigured()).toBe(false);
    await expect(m.getToken()).resolves.toBeTruthy();
    expect(mintAt).toHaveBeenCalledTimes(1);
  });

  it('throws at use time — not at construction — when no endpoint was derived', async () => {
    const m = createClientCredentialsMinter({
      clientId: 'c',
      clientSecret: 's',
      tokenEndpoints: [],
      mintAt: jest.fn(),
      now: clock
    });
    await expect(m.getToken()).rejects.toThrow(/no token endpoint configured/);
  });

  it('rejects a minter without a clientId', () => {
    expect(() => createClientCredentialsMinter({ clientSecret: 's', tokenEndpoints: ['http://kc/token'] })).toThrow(
      /clientId/
    );
  });
});
