const {
  redactValue,
  isSensitiveKey,
  redactAttributes,
  redactLogRecordBody,
  SENSITIVE_KEY_PATTERNS
} = require('../tracing-pii');

describe('tracing-pii.js (document-repository parallel copy)', () => {
  describe('isSensitiveKey', () => {
    it('matches password (case-insensitive)', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('PASSWORD')).toBe(true);
      expect(isSensitiveKey('UserPassword')).toBe(true);
    });

    it('matches token', () => {
      expect(isSensitiveKey('access_token')).toBe(true);
      expect(isSensitiveKey('refreshToken')).toBe(true);
      expect(isSensitiveKey('TOKEN')).toBe(true);
    });

    it('matches authorization', () => {
      expect(isSensitiveKey('authorization')).toBe(true);
      expect(isSensitiveKey('Authorization')).toBe(true);
    });

    it('matches api_key and apiKey', () => {
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('X-API-KEY')).toBe(true);
    });

    it('does not match non-sensitive keys', () => {
      expect(isSensitiveKey('http.method')).toBe(false);
      expect(isSensitiveKey('service.name')).toBe(false);
      expect(isSensitiveKey('content-type')).toBe(false);
      expect(isSensitiveKey('headers')).toBe(false);
      expect(isSensitiveKey('query')).toBe(false);
      expect(isSensitiveKey('body')).toBe(false);
    });
  });

  describe('redactValue', () => {
    it('redacts email addresses', () => {
      expect(redactValue('user: john@example.com')).toBe('user: [REDACTED]');
    });

    it('redacts Bearer tokens', () => {
      expect(redactValue('Bearer abc123def456')).toBe('[REDACTED]');
    });

    it('returns non-string values unchanged', () => {
      expect(redactValue(42)).toBe(42);
      expect(redactValue(null)).toBe(null);
      expect(redactValue(undefined)).toBe(undefined);
    });
  });

  describe('redactAttributes', () => {
    it('returns null for null input', () => {
      expect(redactAttributes(null)).toBeNull();
    });

    it('returns undefined for undefined input', () => {
      expect(redactAttributes(undefined)).toBeUndefined();
    });

    it('redacts sensitive top-level keys with [REDACTED]', () => {
      expect(redactAttributes({ password: 'secret', token: 'abc' })).toEqual({
        password: '[REDACTED]',
        token: '[REDACTED]'
      });
    });

    it('redacts Bearer tokens in non-sensitive string values', () => {
      expect(redactAttributes({ header: 'Bearer abc123' })).toEqual({
        header: '[REDACTED]'
      });
    });

    it('preserves numeric and boolean values', () => {
      expect(redactAttributes({ status: 200, active: true, count: 0 })).toEqual({
        status: 200,
        active: true,
        count: 0
      });
    });

    it('preserves safe attribute keys', () => {
      const safe = {
        'http.method': 'POST',
        'http.status_code': 201,
        'db.collection': 'files',
        'service.name': 'document-repository'
      };
      expect(redactAttributes(safe)).toEqual(safe);
    });
  });

  // REGRESSION: pre-fix, redactAttributes was SHALLOW and let nested
  // sensitive values slip through under a non-matching top-level key.
  // doc-repo's admin-routes / fileController update route previously
  // logged `{ headers: req.headers, query: req.query, body: req.body }`
  // verbatim — `headers` does not match SENSITIVE_KEY_PATTERNS, so the
  // raw `headers.authorization` Bearer token landed in the OTel
  // attributes (and via the Winston formatter, into VictoriaLogs). The
  // fix mirrors backend (see commit 6851023b5): redactAttributes now
  // recurses into nested plain-object / array values via
  // `redactLogRecordBody`. These tests are the canary that catches any
  // future regression where someone "simplifies" redactAttributes back
  // to a shallow walker.
  describe('redactAttributes — nested redaction regression', () => {
    it('recurses into nested plain-object values (admin-routes Authorization leak fix)', () => {
      const result = redactAttributes({
        headers: {
          accept: 'application/json',
          authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig',
          'x-forwarded-for': '127.0.0.1'
        },
        query: { page: '1' },
        body: { username: 'alice', password: 'hunter2' }
      });
      expect(result.headers.authorization).toBe('[REDACTED]');
      expect(result.headers.accept).toBe('application/json');
      expect(result.headers['x-forwarded-for']).toBe('127.0.0.1');
      expect(result.query).toEqual({ page: '1' });
      expect(result.body).toEqual({ username: 'alice', password: '[REDACTED]' });
    });

    it('recurses into arrays of plain-object values', () => {
      const result = redactAttributes({
        logins: [
          { user: 'alice', token: 'tok-alice' },
          { user: 'bob', token: 'tok-bob' }
        ]
      });
      expect(result.logins).toEqual([
        { user: 'alice', token: '[REDACTED]' },
        { user: 'bob', token: '[REDACTED]' }
      ]);
    });

    it('recurses into deeply nested plain-object values', () => {
      // The exact smuggled-Bearer shape: a non-matching top-level key
      // (`cookies`) wrapping an object whose `authorization` field
      // would otherwise pass through. Even at depth ≥ 2 the redactor
      // must scrub it.
      const result = redactAttributes({
        req: {
          headers: {
            cookies: {
              session: 'session=abc',
              authorization: 'Bearer xyz'
            }
          }
        }
      });
      expect(result.req.headers.cookies.authorization).toBe('[REDACTED]');
      expect(result.req.headers.cookies.session).toBe('session=abc');
    });

    it('preserves non-plain object values (Date, Buffer, Error, class instances)', () => {
      // The walker must not attempt to introspect Date / Buffer / Error /
      // class-instance internals — redacting those would be lossy and
      // unsafe. Same contract as redactLogRecordBody.
      const dt = new Date('2026-09-16T10:00:00.000Z');
      const buf = Buffer.from('hello');
      const err = new Error('boom');
      class CustomThing {
        constructor() {
          this.password = 'leaked';
        }
      }
      const inst = new CustomThing();
      const result = redactAttributes({
        ts: dt,
        blob: buf,
        failure: err,
        custom: inst
      });
      expect(result.ts).toBe(dt);
      expect(result.blob).toBe(buf);
      expect(result.failure).toBe(err);
      expect(result.custom).toBe(inst);
    });
  });

  describe('redactLogRecordBody', () => {
    it('recurses into deeply nested request payloads and redacts authorization inside req.headers.cookies', () => {
      // Doc-repo tracing emits Winston JSON envelopes whose `body` is
      // the structured log body. A naive structured log like
      //   logger.info('file update', {
      //     req: { headers: { cookies: { authorization: 'Bearer xyz' } } }
      //   })
      // would otherwise write the Bearer through to VL because
      // `cookies` does not match any sensitive-key pattern.
      const result = redactLogRecordBody({
        req: {
          headers: {
            cookies: {
              session: 'session=abc',
              authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig'
            }
          }
        }
      });
      expect(result.req.headers.cookies.authorization).toBe('[REDACTED]');
      expect(result.req.headers.cookies.session).toBe('session=abc');
    });

    it('redacts primitive strings (emails and Bearer tokens)', () => {
      expect(redactLogRecordBody('contact admin@example.com')).toBe('contact [REDACTED]');
      expect(redactLogRecordBody('Bearer abc123')).toBe('[REDACTED]');
    });

    it('returns null / undefined unchanged', () => {
      expect(redactLogRecordBody(null)).toBeNull();
      expect(redactLogRecordBody(undefined)).toBeUndefined();
    });
  });

  describe('SENSITIVE_KEY_PATTERNS', () => {
    it('contains exactly 6 patterns', () => {
      expect(SENSITIVE_KEY_PATTERNS).toHaveLength(6);
    });

    it('each pattern is a RegExp', () => {
      SENSITIVE_KEY_PATTERNS.forEach((p) => {
        expect(p).toBeInstanceOf(RegExp);
      });
    });
  });
});
