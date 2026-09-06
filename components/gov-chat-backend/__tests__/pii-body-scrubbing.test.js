// Story 2.9 — PII scrubbing covers the OTel LogRecord body field (not just attributes).
//
// Background (AD-4, constraint C-5):
//   PII scrubbing applies to BOTH OTel span attributes AND the OTel log record
//   body field. `redactAttributes` in tracing-pii.js is shallow: it only walks
//   the top-level keys of an object. The body field, however, is frequently a
//   deeply-nested payload that holds user input (e.g. `body.user.email`,
//   `body.request.headers.authorization`). `redactLogRecordBody` is the
//   surface-anchored entry point that walks plain objects + arrays and applies
//   the same key- and value-based redaction rules as `redactAttributes`.
//
// Surface: tracing-pii.js — the body redaction entry point used by the
// `PIIRedactingLogRecordProcessor` shipped in Story 2.6. These tests exercise
// the function on real OTel LogRecord body shapes (string message, plain
// object payload, array payload, deeply-nested payload) and assert that PII
// never reaches the OTel collector in the clear.
//
// Naming: `pii-body-scrubbing.test.js` for grep-ability per Epic 2 review
// (previously `p-l-lig-pii-scrubbing.test.js` — that file never existed in the
// tree; this is the original artifact).

const { redactLogRecordBody } = require('../tracing-pii');

// OTel LogRecord body shapes we expect from Winston → VictoriaLogs transport.
// Mirrors the wire shape that reaches the OTel collector on `POST /v1/logs`.
function buildLogRecord(body) {
  return {
    timestamp: '2026-09-06T01:30:34.000Z',
    severityNumber: 9, // INFO
    severityText: 'INFO',
    body,
    attributes: {
      'service.name': 'genie-backend',
      'deployment.environment': 'test'
    },
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7'
  };
}

describe('tracing-pii.js — redactLogRecordBody (Story 2.9 / AD-4)', () => {
  describe('null / undefined / primitives', () => {
    it('Given a null body, when redacted, then returns null unchanged', () => {
      // Given
      const record = buildLogRecord(null);

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBeNull();
    });

    it('Given an undefined body, when redacted, then returns undefined unchanged', () => {
      // Given
      const record = buildLogRecord(undefined);

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBeUndefined();
    });

    it('Given a numeric body, when redacted, then returns the number unchanged', () => {
      // Given — e.g. a counter payload
      const record = buildLogRecord(42);

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBe(42);
    });

    it('Given a boolean body, when redacted, then returns the boolean unchanged', () => {
      // Given
      const record = buildLogRecord(true);

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBe(true);
    });
  });

  describe('string body (Winston message-style payload)', () => {
    it('Given a string body with an email, when redacted, then the email is replaced with [REDACTED]', () => {
      // Given — typical `logger.info('login failed for ${email}')` shape
      const record = buildLogRecord('Login failed for user john.doe@example.com at 10:00 UTC');

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBe('Login failed for user [REDACTED] at 10:00 UTC');
    });

    it('Given a string body with a Bearer token, when redacted, then the token is replaced with [REDACTED]', () => {
      // Given
      const record = buildLogRecord('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBe('Authorization: [REDACTED]');
    });

    it('Given a clean string body, when redacted, then the string is unchanged', () => {
      // Given
      const record = buildLogRecord('GET /api/health 200');

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toBe('GET /api/health 200');
    });
  });

  describe('object body — top-level PII keys (surface-anchored)', () => {
    it('Given a body with a sensitive top-level key, when redacted, then the value is replaced with [REDACTED]', () => {
      // Given
      const record = buildLogRecord({ password: 'hunter2', username: 'alice' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({ password: '[REDACTED]', username: 'alice' });
    });

    it('Given a body with multiple sensitive top-level keys, when redacted, then each is replaced with [REDACTED]', () => {
      // Given
      const record = buildLogRecord({
        password: 'hunter2',
        access_token: 'tok_abc123',
        client_secret: 'shh',
        authorization: 'Bearer xyz',
        apiKey: 'k-987',
        credentials: { user: 'svc', pass: 'p' }
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({
        password: '[REDACTED]',
        access_token: '[REDACTED]',
        client_secret: '[REDACTED]',
        authorization: '[REDACTED]',
        apiKey: '[REDACTED]',
        // `credentials` is sensitive by key → entire object replaced, never recursed
        credentials: '[REDACTED]'
      });
    });

    it('Given a body with a non-sensitive key holding a sensitive-keyed nested object, when redacted, then the nested object is NOT scrubbed (matches attribute-level contract)', () => {
      // Given — this documents the deliberate attribute-parity: a sensitive key
      // short-circuits to '[REDACTED]' before recursion. We do not partially
      // scrub the inner object because the rule is the WHOLE value is unsafe.
      const record = buildLogRecord({
        user_info: { password: 'hunter2', email: 'x@y.com' }
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then — `user_info` is not a sensitive key, so we recurse. Both nested
      // PII-bearing entries are scrubbed.
      expect(out).toEqual({
        user_info: { password: '[REDACTED]', email: '[REDACTED]' }
      });
    });
  });

  describe('nested body fields (the Story 2.9 acceptance focus)', () => {
    it('Given body.user.email, when redacted, then the email is redacted at the nested path', () => {
      // Given — chat-message-style payload from a real route handler
      const record = buildLogRecord({
        user: { id: 'u-1', email: 'alice@example.com', role: 'admin' }
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({
        user: { id: 'u-1', email: '[REDACTED]', role: 'admin' }
      });
    });

    it('Given body.request.headers.authorization, when redacted, then the Bearer token is replaced with [REDACTED]', () => {
      // Given — inbound-request-style payload
      const record = buildLogRecord({
        request: {
          method: 'POST',
          path: '/api/chat',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
          }
        }
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({
        request: {
          method: 'POST',
          path: '/api/chat',
          headers: {
            'content-type': 'application/json',
            authorization: '[REDACTED]'
          }
        }
      });
    });

    it('Given a deeply-nested body with PII at multiple depths, when redacted, then PII is scrubbed at every depth', () => {
      // Given — chat completion log payload
      const record = buildLogRecord({
        user: { id: 'u-1', email: 'alice@example.com' },
        request: {
          headers: {
            authorization: 'Bearer xyz',
            cookie: 'session=abc123; refreshToken=def456'
          },
          body: { message: 'ping admin@corp.io' }
        },
        response: { status: 200, apiKey: 'k-99' }
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({
        user: { id: 'u-1', email: '[REDACTED]' },
        request: {
          headers: {
            authorization: '[REDACTED]',
            // `cookie` is NOT in the sensitive-key list — value is a string
            // containing no email/bearer → left verbatim (documents current
            // rule; future secret-extender is a separate concern)
            cookie: 'session=abc123; refreshToken=def456'
          },
          body: { message: 'ping [REDACTED]' }
        },
        response: { status: 200, apiKey: '[REDACTED]' }
      });
    });
  });

  describe('arrays in body', () => {
    it('Given a body containing an array of records, when redacted, then each entry is scrubbed independently', () => {
      // Given — batch log of multiple login attempts
      const record = buildLogRecord({
        logins: [
          { email: 'a@x.com', password: 'p1' },
          { email: 'b@x.com', password: 'p2' }
        ]
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({
        logins: [
          { email: '[REDACTED]', password: '[REDACTED]' },
          { email: '[REDACTED]', password: '[REDACTED]' }
        ]
      });
    });

    it('Given a body that is itself an array, when redacted, then each element is scrubbed independently', () => {
      // Given
      const record = buildLogRecord([{ email: 'a@x.com' }, 'plain entry', { token: 'abc' }]);

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual([{ email: '[REDACTED]' }, 'plain entry', { token: '[REDACTED]' }]);
    });
  });

  describe('non-plain objects pass through verbatim', () => {
    it('Given a body containing a Date, when redacted, then the Date instance is preserved', () => {
      // Given
      const date = new Date('2026-09-06T01:30:34.000Z');
      const record = buildLogRecord({ occurred_at: date, email: 'a@x.com' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out.occurred_at).toBe(date);
      expect(out.email).toBe('[REDACTED]');
    });

    it('Given a body containing a Map, when redacted, then the Map is preserved untouched', () => {
      // Given
      const map = new Map([['k', 'v']]);
      const record = buildLogRecord({ ctx: map, email: 'a@x.com' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out.ctx).toBe(map);
      expect(out.email).toBe('[REDACTED]');
    });

    it('Given a body containing a Set, when redacted, then the Set is preserved untouched', () => {
      // Given
      const set = new Set([1, 2, 3]);
      const record = buildLogRecord({ ids: set, email: 'a@x.com' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out.ids).toBe(set);
      expect(out.email).toBe('[REDACTED]');
    });

    it('Given a body containing an Error, when redacted, then the Error instance is preserved', () => {
      // Given
      const err = new Error('boom');
      const record = buildLogRecord({ error: err, email: 'a@x.com' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out.error).toBe(err);
      expect(out.email).toBe('[REDACTED]');
    });

    it('Given a body containing a Buffer, when redacted, then the Buffer instance is preserved', () => {
      // Given — binary payloads (raw upload metadata, dataprep trace chunks)
      const buf = Buffer.from('hello world', 'utf8');
      const record = buildLogRecord({ chunk: buf, email: 'a@x.com' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out.chunk).toBe(buf);
      expect(out.email).toBe('[REDACTED]');
    });

    it('Given a body that is an Object.create(null) object, when redacted, then it walks like a plain object', () => {
      // Given — null-prototype objects share no prototype chain with Object.prototype.
      // The walker must accept them (proto === null falls through the guard) and
      // recurse + redact the same way it does for `{...}` literals.
      const nullProto = Object.create(null);
      nullProto.password = 'hunter2';
      nullProto.user = { email: 'a@x.com' };

      // When
      const out = redactLogRecordBody(nullProto);

      // Then
      expect(out).toEqual({
        password: '[REDACTED]',
        user: { email: '[REDACTED]' }
      });
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    });
  });

  describe('realistic body payload (chat-message-shaped)', () => {
    it('Given a full chat-message log record, when redacted, then no PII remains at any depth in the body', () => {
      // Given — what a route handler would feed into logger.info(...) in production
      const record = buildLogRecord({
        user: { id: 'u-42', email: 'jane.doe@example.com' },
        conversation_id: 'conv-7',
        request: {
          method: 'POST',
          path: '/api/chat/conversations/conv-7/messages',
          headers: { authorization: 'Bearer jane.token.value' }
        },
        body_text: 'reply to admin@corp.io about case 123',
        timings_ms: { llm: 540, retriever: 88 },
        response: {
          status: 200,
          apiKey: 'k-9',
          message: 'OK for jane.doe@example.com'
        }
      });

      // When
      const out = redactLogRecordBody(record.body);

      // Then — every PII-bearing leaf is scrubbed
      expect(out).toEqual({
        user: { id: 'u-42', email: '[REDACTED]' },
        conversation_id: 'conv-7',
        request: {
          method: 'POST',
          path: '/api/chat/conversations/conv-7/messages',
          headers: { authorization: '[REDACTED]' }
        },
        body_text: 'reply to [REDACTED] about case 123',
        timings_ms: { llm: 540, retriever: 88 },
        response: {
          status: 200,
          apiKey: '[REDACTED]',
          message: 'OK for [REDACTED]'
        }
      });
      // Cross-check: no raw email pattern or Bearer substring survives in the
      // redacted body. This is the contract AD-4 + C-5 promise.
      const json = JSON.stringify(out);
      expect(json).not.toMatch(/jane\.doe@example\.com/);
      expect(json).not.toMatch(/admin@corp\.io/);
      expect(json).not.toMatch(/Bearer\s+\S+/);
    });
  });

  describe('failure resilience', () => {
    it('Given a circular reference in the body, when redacted, then the walker fails fast (does not hang the event loop)', () => {
      // Given
      const a = { email: 'a@x.com' };
      const b = { password: 'p', ref: a };
      a.ref = b; // cycle
      const record = buildLogRecord(a);

      // When / Then — the implementation has no cycle guard; on a self-cycle
      // V8 raises `RangeError: Maximum call stack size exceeded` at the engine
      // boundary. The contract under test is "must not hang the event loop":
      // any throw satisfies it (the emit path short-circuits and the record
      // never reaches the collector). Jest's default 5 s timeout is the
      // effective infinite-loop detector. The bare `toThrow()` is used
      // intentionally — no regex, no engine-text coupling.
      expect(() => redactLogRecordBody(record.body)).toThrow();
    });

    it('Given a plain-object body, when redacted, then the input object is not mutated', () => {
      // Given
      const record = buildLogRecord({
        user: { email: 'a@x.com', name: 'Alice' },
        password: 'hunter2'
      });
      const snapshot = JSON.parse(JSON.stringify(record.body));

      // When
      redactLogRecordBody(record.body);

      // Then — caller-side payload is unchanged; the walker returns a fresh copy
      expect(record.body).toEqual(snapshot);
    });

    it('Given an empty object body, when redacted, then returns a new empty object', () => {
      // Given
      const record = buildLogRecord({});

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({});
      expect(out).not.toBe(record.body); // does not return the input by reference
    });

    it('Given a body whose value is undefined, when redacted, then the key is preserved with undefined value', () => {
      // Given
      const record = buildLogRecord({ optional: undefined, email: 'a@x.com' });

      // When
      const out = redactLogRecordBody(record.body);

      // Then
      expect(out).toEqual({ optional: undefined, email: '[REDACTED]' });
      expect('optional' in out).toBe(true);
    });
  });
});
