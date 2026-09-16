const { redactValue, isSensitiveKey, redactAttributes, SENSITIVE_KEY_PATTERNS } = require('../tracing-pii');

describe('tracing-pii.js', () => {
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

    it('matches secret', () => {
      expect(isSensitiveKey('client_secret')).toBe(true);
      expect(isSensitiveKey('SecretKey')).toBe(true);
    });

    it('matches authorization', () => {
      expect(isSensitiveKey('authorization')).toBe(true);
      expect(isSensitiveKey('Authorization')).toBe(true);
    });

    it('matches credential', () => {
      expect(isSensitiveKey('credentials')).toBe(true);
      expect(isSensitiveKey('AWSCredential')).toBe(true);
    });

    it('matches api_key and apiKey', () => {
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('X-API-KEY')).toBe(true);
    });

    it('does not match non-sensitive keys', () => {
      expect(isSensitiveKey('http.method')).toBe(false);
      expect(isSensitiveKey('db.system')).toBe(false);
      expect(isSensitiveKey('service.name')).toBe(false);
      expect(isSensitiveKey('content-type')).toBe(false);
      expect(isSensitiveKey('url')).toBe(false);
    });
  });

  describe('redactValue', () => {
    it('redacts email addresses', () => {
      expect(redactValue('user: john@example.com')).toBe('user: [REDACTED]');
      expect(redactValue('contact admin@corp.co.uk please')).toBe('contact [REDACTED] please');
    });

    it('redacts Bearer tokens', () => {
      expect(redactValue('Bearer abc123def456')).toBe('[REDACTED]');
      expect(redactValue('bearer xyz789')).toBe('[REDACTED]');
    });

    it('redacts multiple emails in same string', () => {
      expect(redactValue('from:a@b.com to:c@d.com')).toBe('from:[REDACTED] to:[REDACTED]');
    });

    it('returns non-string values unchanged', () => {
      expect(redactValue(42)).toBe(42);
      expect(redactValue(true)).toBe(true);
      expect(redactValue(null)).toBe(null);
      expect(redactValue(undefined)).toBe(undefined);
    });

    it('leaves clean strings untouched', () => {
      expect(redactValue('GET /api/health 200')).toBe('GET /api/health 200');
    });
  });

  describe('redactAttributes', () => {
    it('returns null for null input', () => {
      expect(redactAttributes(null)).toBeNull();
    });

    it('returns undefined for undefined input', () => {
      expect(redactAttributes(undefined)).toBeUndefined();
    });

    it('returns empty object for empty input', () => {
      expect(redactAttributes({})).toEqual({});
    });

    it('redacts sensitive keys with [REDACTED]', () => {
      expect(redactAttributes({ password: 'secret', token: 'abc' })).toEqual({
        password: '[REDACTED]',
        token: '[REDACTED]'
      });
    });

    it('redacts emails in non-sensitive string values', () => {
      expect(redactAttributes({ user_info: 'john@example.com' })).toEqual({
        user_info: '[REDACTED]'
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
        'http.method': 'GET',
        'http.status_code': 200,
        'db.system': 'arangodb',
        'db.name': 'genie_db',
        'db.operation': 'FOR',
        'db.collection': 'users',
        'service.name': 'backend',
        'service.version': '1.0.0'
      };
      expect(redactAttributes(safe)).toEqual(safe);
    });

    it('handles mixed sensitive and safe attributes', () => {
      const result = redactAttributes({
        'http.method': 'POST',
        password: 'hunter2',
        'db.collection': 'users',
        authorization: 'Bearer xyz',
        'http.status_code': 201
      });
      expect(result).toEqual({
        'http.method': 'POST',
        password: '[REDACTED]',
        'db.collection': 'users',
        authorization: '[REDACTED]',
        'http.status_code': 201
      });
    });

    it('handles string containing both email and Bearer token', () => {
      const result = redactAttributes({
        raw_header: 'Authorization: Bearer tok123 for admin@example.com'
      });
      expect(result.raw_header).toBe('Authorization: [REDACTED] for [REDACTED]');
    });

    it('recurses into nested plain-object values (admin-routes Authorization leak fix)', () => {
      // Pre-fix: redactAttributes was shallow — a top-level key that did
      // NOT match the SENSITIVE_KEY_PATTERNS (e.g. `headers`) would pass
      // its nested object value through verbatim, smuggling
      // `headers.authorization: 'Bearer ...'` into VictoriaLogs. The
      // admin-routes request-entry logger wrote
      // `logger.info('[ADMIN-ROUTES] ...', { headers: req.headers, ... })`
      // — that landed in the OTel attributes with the raw header map,
      // and `headers` doesn't match any sensitive key pattern. Post-fix:
      // the walker recurses into plain-object values via
      // `redactLogRecordBody`, so nested `authorization` keys are caught.
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

  describe('redactLogRecordBody (circular-reference guard, P8)', () => {
    const { redactLogRecordBody } = require('../tracing-pii');

    it('walks deeply-nested plain objects without recursing forever', () => {
      // 20 levels of nesting — without the WeakSet guard the walker would
      // exhaust the stack on large payloads (the previous code crashed at
      // ~10k frames with RangeError).
      const deep = { level: 0 };
      let cursor = deep;
      for (let i = 1; i < 20; i++) {
        cursor.next = { level: i };
        cursor = cursor.next;
      }
      expect(() => redactLogRecordBody(deep)).not.toThrow();
      expect(redactLogRecordBody(deep).level).toBe(0);
    });

    it('returns "[CIRCULAR]" for self-referential objects instead of stack overflow', () => {
      // Express middleware commonly logs `req` which has `req.req = req` or
      // `req.socket.parser.incoming.req` cycles. The old walker crashed
      // the entire log pipeline with RangeError on these.
      const obj = { headers: { authorization: 'Bearer abc' }, data: null };
      obj.data = obj; // self-reference
      const out = redactLogRecordBody(obj);
      expect(out.data).toBe('[CIRCULAR]');
      // Sensitive keys still redacted in non-cycled branches
      expect(out.headers.authorization).toBe('[REDACTED]');
    });

    it('handles indirect cycles (a -> b -> a)', () => {
      const a = {};
      const b = { a };
      a.b = b;
      const out = redactLogRecordBody(a);
      expect(out.b.a).toBe('[CIRCULAR]');
    });

    it('walks arrays containing cycles', () => {
      const arr = [];
      arr.push(arr); // self-referential array
      const out = redactLogRecordBody({ items: arr });
      expect(out.items[0]).toBe('[CIRCULAR]');
    });

    it('preserves independent WeakSet state across top-level calls (no leak between calls)', () => {
      // After a cycle was detected, the next top-level call must NOT see
      // the previous call's seen set (WeakSet is scoped per-call by
      // default param). Otherwise unrelated objects sharing id() across
      // calls would be falsely flagged as circular.
      const cycle = {};
      cycle.self = cycle;
      redactLogRecordBody(cycle); // first call

      const plain = { a: 1, b: 2 };
      const out = redactLogRecordBody(plain);
      expect(out).toEqual({ a: 1, b: 2 });
    });
  });
});
