// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const https = require('https');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const auth = require('./auth');

/**
 * The OWNER test of the real transport's response contract (#1804).
 *
 * `auth.request` decides what a response BODY is, at its own boundary:
 *
 *   - an empty body resolves with `data: null` (a 204-style success with
 *     no payload is not malformed);
 *   - `options.raw` resolves with the body AS TEXT (the runtime config is
 *     JavaScript, not JSON);
 *   - otherwise the body is parsed as JSON, and a body that is NOT JSON
 *     REJECTS with `error.nonJsonBody = true` and `error.status` set —
 *     the endpoint answered, it just did not answer with JSON.
 *
 * Nobody else tests this at the boundary: the venue-profile unit spec's
 * fake mirrors the contract so a probe that forgets `raw: true` fails the
 * way the venue would, and a mirror goes stale silently when the real
 * helper moves. This spec drives the REAL `request` — no fake — so the
 * contract cannot drift without a red test here.
 *
 * The transport speaks HTTPS (`https.request`, `rejectUnauthorized:
 * false`), so the fixture is a local TLS server carrying a self-signed
 * certificate — the committed throwaway keypair beside this spec
 * (`test-tls-key.pem` / `test-tls-cert.pem`, CN=e2e-transport-test,
 * generated once with openssl; it guards nothing and is never a
 * credential). The test reaches it by passing the ABSOLUTE URL as the
 * path argument: `new URL(path, BASE_URL)` ignores the base for an
 * absolute URL, so no module state is touched and no other spec in this
 * worker sees a moved venue edge.
 */

const TLS_OPTIONS = {
  key: fs.readFileSync(path.join(__dirname, 'test-tls-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'test-tls-cert.pem')),
};

/** Start a one-shot TLS server whose single response `responder` builds. */
function startServer(responder) {
  return new Promise((resolve) => {
    const server = https.createServer(TLS_OPTIONS, (req, res) => responder(res));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const urlOf = (server) => `https://127.0.0.1:${server.address().port}/probe`;

test.describe('the transport response contract (auth.request at its own boundary)', () => {
  let server;

  test.afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  test('a JSON body resolves parsed, with the status and headers', async () => {
    server = await startServer((res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-test-marker': 'present' });
      res.end(JSON.stringify({ realm: 'genie', enabled: true }));
    });
    const res = await auth.request('GET', urlOf(server));
    expect(res.data).toEqual({ realm: 'genie', enabled: true });
    expect(res.status).toBe(200);
    expect(res.headers['x-test-marker']).toBe('present');
  });

  test('an empty body resolves data: null — a 204-style success', async () => {
    server = await startServer((res) => {
      res.writeHead(204);
      res.end();
    });
    const res = await auth.request('DELETE', urlOf(server));
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
  });

  test('an empty body wins over raw — still null, not an empty string', async () => {
    // The empty-body check precedes the raw check: a caller asking for
    // the body as text still gets `null` for no body, because "no
    // payload" and "an empty payload" are the same answer on the wire.
    server = await startServer((res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end();
    });
    const res = await auth.request('GET', urlOf(server), { raw: true });
    expect(res.data).toBeNull();
  });

  test('raw: true resolves the body AS TEXT', async () => {
    const config = 'window.APP_CONFIG = {\n  okfEnabled: "0",\n};\n';
    server = await startServer((res) => {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(config);
    });
    const res = await auth.request('GET', urlOf(server), { raw: true });
    expect(res.status).toBe(200);
    // The body is the TEXT — parsed JSON would have thrown on this
    // JavaScript, and coerced JSON would have lost the trailing newline.
    expect(res.data).toBe(config);
  });

  test('a non-JSON body rejects with nonJsonBody and the status', async () => {
    server = await startServer((res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>Bad gateway</html>');
    });
    const error = await auth.request('GET', urlOf(server)).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.nonJsonBody).toBe(true);
    // The status travels with the error: the retry verdict follows the
    // SERVER's state (a 5xx is an outage a retry may survive), not the
    // content type.
    expect(error.status).toBe(502);
    expect(error.message).toContain('HTTP 502');
    expect(error.message).toContain('<html>Bad gateway</html>');
  });
});
