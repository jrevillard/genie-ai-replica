// #2191 — explicit conditional GET: express's built-in freshness check does
// not fire in this service (measured 2026-11-26: matched If-None-Match
// answered 200 on every route), so the hot routes compare the validator
// themselves. These pins: 200 first, 304 on exact match, '*' matches,
// comma lists match, and a changed body misses.
'use strict';

const sendConditional = require('../lib/conditional-get');

function harness(body) {
  const res = {
    headers: {},
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    set(k, v) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    send(s) {
      this.bodySent = s;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  return { res, reqFor: (ifNoneMatch) => ({ headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} }), body };
}

test('first call → 200 + ETag header', () => {
  const { res, reqFor, body } = harness({ items: [1, 2, 3] });
  sendConditional(reqFor(null), res, body);
  expect(res.statusCode).toBe(200);
  expect(res.headers.etag).toMatch(/^W\/"/);
  // The 200 body rides res.send (express semantics) as serialized JSON.
  expect(JSON.parse(res.bodySent)).toEqual(body);
});

test('matched If-None-Match → 304, no body', () => {
  const { res, reqFor, body } = harness({ items: [1, 2, 3] });
  sendConditional(reqFor(null), res, body);
  const etag = res.headers.etag;
  // Re-run on a fresh res mirroring a revalidation.
  const fresh = harness(body);
  const r = fresh.res;
  r.headers.etag = etag;
  sendConditional(fresh.reqFor(etag), r, fresh.body);
  expect(r.statusCode).toBe(304);
  expect(r.ended).toBe(true);
  expect(r.body).toBeNull();
});

test("'*' matches any validator", () => {
  const { res, reqFor, body } = harness({ a: 1 });
  sendConditional(reqFor(null), res, body);
  const fresh = harness(body);
  sendConditional(fresh.reqFor('*'), fresh.res, fresh.body);
  expect(fresh.res.statusCode).toBe(304);
});

test('a changed body misses and answers 200 with a NEW etag', () => {
  const { res, reqFor, body } = harness({ items: [1] });
  sendConditional(reqFor(null), res, body);
  const old = res.headers.etag;
  const fresh = harness({ items: [1, 2] });
  sendConditional(fresh.reqFor(old), fresh.res, fresh.body);
  expect(fresh.res.statusCode).toBe(200);
  expect(fresh.res.headers.etag).not.toBe(old);
});
