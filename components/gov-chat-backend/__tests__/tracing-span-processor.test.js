const { redactAttributes } = require('../tracing-pii');

// Recreate PIIRedactionProcessor with a mock delegate (mirrors tracing.js logic)
// We mock BatchSpanProcessor to isolate the redaction logic from OTel SDK internals
jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: jest.fn().mockImplementation(() => ({
    onStart: jest.fn(),
    onEnd: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(),
    forceFlush: jest.fn().mockResolvedValue()
  }))
}));

const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

class PIIRedactionProcessor {
  constructor(exporter) {
    this._delegate = new BatchSpanProcessor(exporter);
  }

  onStart(span, parentContext) {
    this._delegate.onStart(span, parentContext);
  }

  onEnd(span) {
      try {
        const attrs = span.attributes;
        if (attrs) {
          const redacted = redactAttributes(attrs);
          for (const [key, value] of Object.entries(redacted)) {
            span.setAttribute(key, value);
          }
        }
      } catch {
        // Redaction failure must not block span export
      }
      this._delegate.onEnd(span);
    }

  async shutdown() {
    return this._delegate.shutdown();
  }

  async forceFlush() {
    return this._delegate.forceFlush();
  }
}

function createMockSpan(attributes = {}) {
  return {
    attributes: { ...attributes },
    setAttribute: jest.fn(function (key, value) {
      this.attributes[key] = value;
    })
  };
}

describe('PIIRedactionProcessor', () => {
  let processor;
  let mockExporter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExporter = {
      export: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(),
      forceFlush: jest.fn().mockResolvedValue()
    };
    processor = new PIIRedactionProcessor(mockExporter);
  });

  describe('constructor', () => {
    it('creates a BatchSpanProcessor delegate', () => {
      expect(BatchSpanProcessor).toHaveBeenCalledWith(mockExporter);
    });
  });

  describe('onStart', () => {
    it('delegates to BatchSpanProcessor.onStart', () => {
      const span = createMockSpan();
      const context = { traceId: 'abc' };
      processor.onStart(span, context);
      expect(processor._delegate.onStart).toHaveBeenCalledWith(span, context);
    });
  });

  describe('onEnd', () => {
    it('redacts password attributes before delegating', () => {
      const span = createMockSpan({ password: 'secret123', 'http.method': 'POST' });
      processor.onEnd(span);

      expect(span.setAttribute).toHaveBeenCalledWith('password', '[REDACTED]');
      expect(span.setAttribute).toHaveBeenCalledWith('http.method', 'POST');
      expect(processor._delegate.onEnd).toHaveBeenCalledWith(span);
    });

    it('redacts token attributes', () => {
      const span = createMockSpan({ access_token: 'abc123' });
      processor.onEnd(span);
      expect(span.setAttribute).toHaveBeenCalledWith('access_token', '[REDACTED]');
    });

    it('redacts emails in string values', () => {
      const span = createMockSpan({ user_info: 'john@example.com logged in' });
      processor.onEnd(span);
      expect(span.setAttribute).toHaveBeenCalledWith('user_info', '[REDACTED] logged in');
    });

    it('redacts Bearer tokens in string values', () => {
      const span = createMockSpan({ header: 'Bearer tok_abc123xyz' });
      processor.onEnd(span);
      expect(span.setAttribute).toHaveBeenCalledWith('header', '[REDACTED]');
    });

    it('handles span with no attributes (null)', () => {
      const span = createMockSpan();
      span.attributes = null;
      processor.onEnd(span);
      expect(span.setAttribute).not.toHaveBeenCalled();
      expect(processor._delegate.onEnd).toHaveBeenCalledWith(span);
    });

    it('handles span with empty attributes', () => {
      const span = createMockSpan({});
      processor.onEnd(span);
      expect(span.setAttribute).not.toHaveBeenCalled();
      expect(processor._delegate.onEnd).toHaveBeenCalledWith(span);
    });

    it('preserves numeric and boolean attributes', () => {
      const span = createMockSpan({ status: 200, active: true, ratio: 3.14 });
      processor.onEnd(span);
      expect(span.setAttribute).toHaveBeenCalledWith('status', 200);
      expect(span.setAttribute).toHaveBeenCalledWith('active', true);
      expect(span.setAttribute).toHaveBeenCalledWith('ratio', 3.14);
    });

    it('handles mixed sensitive and safe attributes', () => {
      const span = createMockSpan({
        'http.method': 'GET',
        password: 'hunter2',
        'db.system': 'arangodb',
        authorization: 'Bearer xyz'
      });
      processor.onEnd(span);

      expect(span.setAttribute).toHaveBeenCalledWith('http.method', 'GET');
      expect(span.setAttribute).toHaveBeenCalledWith('password', '[REDACTED]');
      expect(span.setAttribute).toHaveBeenCalledWith('db.system', 'arangodb');
      expect(span.setAttribute).toHaveBeenCalledWith('authorization', '[REDACTED]');
    });

    it('always delegates onEnd to BatchSpanProcessor', () => {
      const span = createMockSpan({ key: 'value' });
      processor.onEnd(span);
      expect(processor._delegate.onEnd).toHaveBeenCalledTimes(1);
    });

    it('delegates onEnd even when redactAttributes throws', () => {
      const span = {
        attributes: { password: 'secret' },
        setAttribute: jest.fn().mockImplementation(() => {
          throw new Error('setAttribute exploded');
        })
      };
      processor.onEnd(span);
      expect(processor._delegate.onEnd).toHaveBeenCalledWith(span);
    });
  });

  describe('shutdown', () => {
    it('delegates to BatchSpanProcessor shutdown', async () => {
      await processor.shutdown();
      expect(processor._delegate.shutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe('forceFlush', () => {
    it('delegates to BatchSpanProcessor forceFlush', async () => {
      await processor.forceFlush();
      expect(processor._delegate.forceFlush).toHaveBeenCalledTimes(1);
    });
  });
});
