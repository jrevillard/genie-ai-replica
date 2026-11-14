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
 * fake used to mirror the contract, but mirrors go stale silently when
 * the real helper moves — since #1804 the fake is a plain stub and THIS
 * spec owns the contract, driving the REAL `request` so it cannot drift
 * without a red test here.
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

// The edge's own upstream-reset reply (#1847): the k8s venue's Envoy
// occasionally answers a keep-alive race with its LOCAL 503 — a plain-text
// body ("upstream connect error or disconnect/reset before headers. reset
// reason: connection termination"), not a product answer. The request
// helper retries THAT exact signature on idempotent methods, without a
// pause (the reset path is instantaneous; the next attempt targets a fresh
// socket), within a hard bound, rethrowing the last observed error when
// the bound runs out. A product 503 carries a JSON body — it resolves like
// every other response and no caller's status guard sees a retry behind
// it. This spec drives the REAL transport over the TLS fixture, so the
// retry verdict cannot drift from the response contract above.
test.describe('the edge upstream-reset retry (auth.request)', () => {
  const ENVOY_RESET_BODY =
    'upstream connect error or disconnect/reset before headers. reset reason: connection termination';
  let server;
  let hits;

  const answerWith = (statusCode, contentType, body) => {
    hits = 0;
    return startServer((res) => {
      hits += 1;
      res.writeHead(statusCode, { 'content-type': contentType });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  };

  test.afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  test('a GET on the edge reset is retried and recovers on the first healthy answer', async () => {
    let scriptedHits = 0;
    server = await startServer((res) => {
      scriptedHits += 1;
      if (scriptedHits <= 2) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end(ENVOY_RESET_BODY);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'Test User', role: 'user', emailVerified: true }));
    });

    const res = await auth.request('GET', urlOf(server));
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('name', 'Test User');
    // Two resets consumed before the healthy answer: exactly the bound's
    // first two retries.
    expect(scriptedHits).toBe(3);
  });

  test('the bound holds and the LAST observed reset is rethrown verbatim', async () => {
    server = await answerWith(503, 'text/plain', ENVOY_RESET_BODY);
    const error = await auth.request('GET', urlOf(server)).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(503);
    expect(error.nonJsonBody).toBe(true);
    expect(error.message).toContain('upstream connect error or disconnect/reset before headers');
    // One original attempt plus the bound's retries — no unbounded loop.
    expect(hits).toBe(3);
  });

  test('a product 503 — a JSON body — resolves once and is never retried', async () => {
    server = await answerWith(503, 'application/json', {
      error: 'VL_UNREACHABLE',
      message: 'the product answers 503 with a body'
    });
    const res = await auth.request('GET', urlOf(server));
    // The response contract is untouched: a JSON body resolves, whatever
    // its status — the caller's status guard is the verdict.
    expect(res.status).toBe(503);
    expect(res.data).toHaveProperty('error', 'VL_UNREACHABLE');
    expect(hits).toBe(1);
  });

  test('a POST on the edge reset is never retried — only idempotent methods are', async () => {
    server = await answerWith(503, 'text/plain', ENVOY_RESET_BODY);
    const error = await auth.request('POST', urlOf(server), {
      body: { grant_type: 'password' }
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(503);
    // A POST whose outcome is ambiguous must not be re-sent: one attempt,
    // the caller sees the failure.
    expect(hits).toBe(1);
  });

  test('a plain-text 503 without the reset signature is answered once', async () => {
    // The signature IS the trigger: another plain-text 503 (a proxy's own
    // "Service Unavailable", say) is an endpoint state a retry verdict has
    // no business deciding — one attempt, the caller sees it.
    server = await answerWith(503, 'text/plain', 'Service Unavailable');
    const error = await auth.request('GET', urlOf(server)).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.nonJsonBody).toBe(true);
    expect(error.status).toBe(503);
    expect(hits).toBe(1);
  });

  test('a 502 carrying the reset text is answered once — the status gate is exact', async () => {
    // The reset signature at another status is a different verdict (a
    // 502 Bad Gateway is not the keep-alive race): the gate matches BOTH
    // the signature and the status, so a loosening of either turns red.
    server = await answerWith(502, 'text/plain', ENVOY_RESET_BODY);
    const error = await auth.request('GET', urlOf(server)).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.nonJsonBody).toBe(true);
    expect(error.status).toBe(502);
    expect(hits).toBe(1);
  });

  test('a raw:true GET on the reset reply is retried and recovers — the resolution arm', async () => {
    // With raw:true the body IS the wanted text, so the edge's reset
    // reply RESOLVES (status 503, data = the text) instead of rejecting:
    // without the resolution arm the venue-profile probe would still see
    // the once-per-run flake this retry exists to absorb.
    let scriptedHits = 0;
    server = await startServer((res) => {
      scriptedHits += 1;
      if (scriptedHits <= 2) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end(ENVOY_RESET_BODY);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end('window.APP_CONFIG = { okfEnabled: "0" };');
    });

    const res = await auth.request('GET', urlOf(server), { raw: true });
    expect(res.status).toBe(200);
    expect(res.data).toBe('window.APP_CONFIG = { okfEnabled: "0" };');
    expect(scriptedHits).toBe(3);
  });

  test('a raw:true 503 without the reset signature is answered once', async () => {
    // The resolution arm keys on the same signature as the rejection arm:
    // another plain-text 503 is the endpoint's own state, answered once.
    server = await answerWith(503, 'text/plain', 'Service Unavailable');
    const res = await auth.request('GET', urlOf(server), { raw: true });
    expect(res.status).toBe(503);
    expect(res.data).toBe('Service Unavailable');
    expect(hits).toBe(1);
  });

  test('a DELETE on the edge reset is retried — RFC 7231 idempotent', async () => {
    // The cleanup sweeps' verb: deleting is idempotent, so the same
    // once-per-run reset must not fail a sweep wave and file a leftover
    // the sweep actually deleted.
    let scriptedHits = 0;
    server = await startServer((res) => {
      scriptedHits += 1;
      if (scriptedHits === 1) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end(ENVOY_RESET_BODY);
        return;
      }
      res.writeHead(204);
      res.end();
    });

    const res = await auth.request('DELETE', urlOf(server));
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
    expect(scriptedHits).toBe(2);
  });

  test('a connection killed before any headers (ECONNRESET) is retried', async () => {
    // The same keep-alive race's pre-headers shape: the edge terminates
    // the connection without answering — the client sees a plain
    // transport error with no status and no body. An idempotent GET is
    // safe to re-issue; the error travels verbatim when the bound runs
    // out.
    let scriptedHits = 0;
    server = await startServer((res) => {
      scriptedHits += 1;
      if (scriptedHits === 1) {
        res.socket.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ recovered: true }));
    });

    const res = await auth.request('GET', urlOf(server));
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ recovered: true });
    expect(scriptedHits).toBe(2);
  });

  test('the resolution arm honours the same bound — exhaustion returns the 503 verbatim', async () => {
    // The bound's arm for raw:true exhaustion: a probe whose venue keeps
    // answering the reset gets the LAST observed 503 back — resolved, not
    // swallowed — after exactly the bound's attempts. The decrement in
    // the resolution arm is what keeps this finite; a regression that
    // drops it turns this test's fixture into an unbounded loop, and no
    // other test would notice (the recovery test still lands on attempt
    // 3's success; the rejection-arm bound test never enters this arm).
    server = await answerWith(503, 'text/plain', ENVOY_RESET_BODY);
    const res = await auth.request('GET', urlOf(server), { raw: true });
    expect(res.status).toBe(503);
    expect(res.data).toContain('upstream connect error or disconnect/reset before headers');
    expect(hits).toBe(3);
  });
});
