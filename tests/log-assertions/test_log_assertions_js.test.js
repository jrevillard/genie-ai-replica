// Tests for JS log assertion helpers
const {
  expectLogContains,
  expectLogSchema,
  expectNonZeroedTraceId,
  LOG_SCHEMA_FIELDS,
} = require('./log-assertions');

describe('JS log-assertions helpers', () => {
  const validEntry = {
    timestamp: '2026-05-28T14:30:00.123Z',
    level: 'info',
    service: 'genie-backend',
    trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    span_id: '00f067aa0ba902b7',
    message: 'test message',
  };

  describe('expectLogContains', () => {
    it('passes when all expected fields match', () => {
      expect(() =>
        expectLogContains(validEntry, {
          trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
          level: 'info',
        })
      ).not.toThrow();
    });

    it('passes with regex values', () => {
      expect(() =>
        expectLogContains(validEntry, {
          trace_id: /^[0-9a-f]{32}$/,
          message: /test/,
        })
      ).not.toThrow();
    });

    it('passes with exact string match', () => {
      expect(() =>
        expectLogContains(validEntry, { level: 'info' })
      ).not.toThrow();
    });

    it('passes with substring match for message', () => {
      expect(() =>
        expectLogContains(validEntry, { message: 'test' })
      ).not.toThrow();
    });

    it('throws when field is missing', () => {
      expect(() =>
        expectLogContains(validEntry, { nonexistent: 'value' })
      ).toThrow('Missing field "nonexistent"');
    });

    it('throws when value does not match', () => {
      expect(() =>
        expectLogContains(validEntry, { level: 'error' })
      ).toThrow('does not contain');
    });

    it('throws when regex does not match', () => {
      expect(() =>
        expectLogContains(validEntry, { trace_id: /^abc$/ })
      ).toThrow('does not match pattern');
    });

    it('throws for null log entry', () => {
      expect(() => expectLogContains(null, { level: 'info' })).toThrow('must be a non-null object');
    });

    it('throws for non-object log entry', () => {
      expect(() => expectLogContains('not an object', { level: 'info' })).toThrow('must be a non-null object');
    });
  });

  describe('expectLogSchema', () => {
    it('passes for valid log entry', () => {
      expect(() => expectLogSchema(validEntry)).not.toThrow();
    });

    it('passes for error level', () => {
      expect(() => expectLogSchema({ ...validEntry, level: 'error' })).not.toThrow();
    });

    it('passes for debug level', () => {
      expect(() => expectLogSchema({ ...validEntry, level: 'debug' })).not.toThrow();
    });

    LOG_SCHEMA_FIELDS.forEach((field) => {
      it(`throws when ${field} is missing`, () => {
        const entry = { ...validEntry };
        delete entry[field];
        expect(() => expectLogSchema(entry)).toThrow(`Missing required schema field "${field}"`);
      });
    });

    it('throws for invalid trace_id format', () => {
      expect(() =>
        expectLogSchema({ ...validEntry, trace_id: 'not-hex' })
      ).toThrow('trace_id must be a 32-char hex string');
    });

    it('throws for invalid span_id format', () => {
      expect(() =>
        expectLogSchema({ ...validEntry, span_id: 'short' })
      ).toThrow('span_id must be a 16-char hex string');
    });

    it('throws for invalid level', () => {
      expect(() =>
        expectLogSchema({ ...validEntry, level: 'verbose' })
      ).toThrow('level must be one of');
    });
  });

  describe('expectNonZeroedTraceId', () => {
    it('passes for valid non-zeroed trace ID', () => {
      expect(() =>
        expectNonZeroedTraceId('4bf92f3577b34da6a3ce929d0e0e4736')
      ).not.toThrow();
    });

    it('throws for zeroed trace ID', () => {
      expect(() =>
        expectNonZeroedTraceId('0'.repeat(32))
      ).toThrow('must not be zeroed');
    });

    it('throws for invalid format', () => {
      expect(() =>
        expectNonZeroedTraceId('abc')
      ).toThrow('must be a 32-char hex string');
    });
  });

  describe('LOG_SCHEMA_FIELDS', () => {
    it('contains all required fields', () => {
      expect(LOG_SCHEMA_FIELDS).toEqual([
        'timestamp', 'level', 'service', 'trace_id', 'span_id', 'message',
      ]);
    });
  });
});
