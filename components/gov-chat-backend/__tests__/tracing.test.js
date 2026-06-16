describe('tracing.js', () => {
  describe('observability disabled guard', () => {
    it('exports no-op when ENABLE_OBSERVABILITY is not "1"', () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_OBSERVABILITY = '0';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector:4318';

      jest.isolateModules(() => {
        const { sdk, getTracer } = require('../tracing');
        expect(sdk).toBeNull();
        const tracer = getTracer();
        const span = tracer.startSpan('test');
        expect(() => span.end()).not.toThrow();
      });

      delete process.env.ENABLE_OBSERVABILITY;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    });
  });

  describe('test environment guard', () => {
    it('exports null sdk when NODE_ENV=test', () => {
      const { sdk, getTracer } = require('../tracing');
      expect(sdk).toBeNull();
      expect(typeof getTracer).toBe('function');
    });

    it('returns a no-op tracer with startSpan', () => {
      const { getTracer } = require('../tracing');
      const tracer = getTracer();
      const span = tracer.startSpan('test');
      expect(typeof span.end).toBe('function');
      expect(typeof span.setAttribute).toBe('function');
      expect(typeof span.addEvent).toBe('function');
      expect(typeof span.setStatus).toBe('function');
      expect(typeof span.recordException).toBe('function');
      expect(typeof span.updateName).toBe('function');
    });

    it('no-op span methods are callable without error', () => {
      const { getTracer } = require('../tracing');
      const tracer = getTracer();
      const span = tracer.startSpan('test');
      expect(() => {
        span.setAttribute('key', 'value');
        span.addEvent('event');
        span.setStatus({ code: 0 });
        span.recordException(new Error('test'));
        span.updateName('new-name');
        span.end();
      }).not.toThrow();
    });

    it('no-op tracer startActiveSpan works with options argument', () => {
      const { getTracer } = require('../tracing');
      const tracer = getTracer();
      let capturedSpan;
      tracer.startActiveSpan('test', {}, (span) => {
        capturedSpan = span;
        span.end();
      });
      expect(typeof capturedSpan.end).toBe('function');
    });

    it('no-op tracer startActiveSpan works without options', () => {
      const { getTracer } = require('../tracing');
      const tracer = getTracer();
      let capturedSpan;
      tracer.startActiveSpan('test', (span) => {
        capturedSpan = span;
        span.end();
      });
      expect(typeof capturedSpan.end).toBe('function');
    });

    it('getTracer always returns the same tracer interface', () => {
      const { getTracer } = require('../tracing');
      const t1 = getTracer();
      const t2 = getTracer();
      expect(typeof t1.startSpan).toBe('function');
      expect(typeof t2.startSpan).toBe('function');
    });
  });
});
