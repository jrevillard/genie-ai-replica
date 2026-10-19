'use strict';

// Tests the real PIIRedactionProcessor. Its predecessor in the backend suite
// re-implemented a simplified copy inside the test file — one that redacted in
// `onEnd` while production redacts in `onStart`, and that carried none of the
// drop logic. It asserted an algorithm the code does not have and covered
// nothing that actually ships.

const { PIIRedactionProcessor, IGNORED_PATHS } = require('../pii-span-processor');

function createDelegate() {
  return {
    onStart: jest.fn(),
    onEnd: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    forceFlush: jest.fn().mockResolvedValue(undefined)
  };
}

function createSpan(attributes) {
  return {
    attributes: { ...attributes },
    setAttribute: jest.fn(function setAttribute(key, value) {
      this.attributes[key] = value;
    })
  };
}

describe('PIIRedactionProcessor', () => {
  let delegate;
  let processor;

  beforeEach(() => {
    delegate = createDelegate();
    processor = new PIIRedactionProcessor(delegate);
  });

  describe('onStart redaction', () => {
    it('redacts sensitive keys in place before the span is handed on', () => {
      const span = createSpan({ password: 'hunter2', 'db.system': 'arangodb' });

      processor.onStart(span, 'ctx');

      expect(span.attributes.password).toBe('[REDACTED]');
      expect(span.attributes['db.system']).toBe('arangodb');
      expect(delegate.onStart).toHaveBeenCalledWith(span, 'ctx');
    });

    it('redacts PII embedded in string attribute values', () => {
      const span = createSpan({ 'http.request.header': 'Bearer tok_abc123' });

      processor.onStart(span, 'ctx');

      expect(span.attributes['http.request.header']).toBe('[REDACTED]');
    });

    it('only calls setAttribute for values redaction actually changed', () => {
      const span = createSpan({ 'db.system': 'arangodb', status: 200 });

      processor.onStart(span, 'ctx');

      expect(span.setAttribute).not.toHaveBeenCalled();
    });

    it('leaves numeric and boolean values untouched', () => {
      const span = createSpan({ status: 200, active: true, ratio: 3.14 });

      processor.onStart(span, 'ctx');

      expect(span.attributes).toEqual({ status: 200, active: true, ratio: 3.14 });
    });

    it('handles a span with null attributes', () => {
      const span = createSpan({});
      span.attributes = null;

      expect(() => processor.onStart(span, 'ctx')).not.toThrow();
      expect(delegate.onStart).toHaveBeenCalledWith(span, 'ctx');
    });
  });

  describe('dropping noise spans', () => {
    // K8s probes hit /health every 5s. If they reach the export queue the SDK's
    // internal maps grow for the lifetime of the process.
    it.each(IGNORED_PATHS)('drops spans whose target contains %s', (path) => {
      const span = createSpan({ 'http.target': `${path}?verbose=1` });

      processor.onStart(span, 'ctx');

      expect(span.attributes['genie.pii.dropped']).toBe(true);
      expect(delegate.onStart).not.toHaveBeenCalled();
    });

    it('drops on the http.route attribute too', () => {
      const span = createSpan({ 'http.route': '/health' });

      processor.onStart(span, 'ctx');

      expect(delegate.onStart).not.toHaveBeenCalled();
    });

    it('never forwards a dropped span to the delegate on end', () => {
      // The SDK dispatches onEnd to every registered processor whether or not
      // onStart ran to completion, so dropping only in onStart is not enough.
      const span = createSpan({ 'http.target': '/health' });

      processor.onStart(span, 'ctx');
      processor.onEnd(span);

      expect(delegate.onEnd).not.toHaveBeenCalled();
    });

    it('forwards a kept span to the delegate on end', () => {
      const span = createSpan({ 'http.target': '/api/files' });

      processor.onStart(span, 'ctx');
      processor.onEnd(span);

      expect(delegate.onEnd).toHaveBeenCalledWith(span);
    });

    it('does not leak the drop marker across spans', () => {
      const dropped = createSpan({ 'http.target': '/health' });
      const kept = createSpan({ 'http.target': '/api/files' });

      processor.onStart(dropped, 'ctx');
      processor.onStart(kept, 'ctx');
      processor.onEnd(dropped);
      processor.onEnd(kept);

      expect(delegate.onEnd).toHaveBeenCalledTimes(1);
      expect(delegate.onEnd).toHaveBeenCalledWith(kept);
    });
  });

  describe('when redaction throws', () => {
    it('still hands the span to the delegate', () => {
      jest.isolateModules(() => {
        jest.doMock('../tracing-pii', () => ({
          redactAttributes: () => {
            throw new Error('redactor exploded');
          }
        }));
        const { PIIRedactionProcessor: Isolated } = require('../pii-span-processor');
        const span = createSpan({ password: 'secret' });

        new Isolated(delegate).onStart(span, 'ctx');

        expect(delegate.onStart).toHaveBeenCalledWith(span, 'ctx');
      });
      jest.dontMock('../tracing-pii');
    });
  });

  describe('lifecycle', () => {
    it('delegates shutdown', async () => {
      await processor.shutdown();
      expect(delegate.shutdown).toHaveBeenCalledTimes(1);
    });

    it('delegates forceFlush', async () => {
      await processor.forceFlush();
      expect(delegate.forceFlush).toHaveBeenCalledTimes(1);
    });
  });
});
