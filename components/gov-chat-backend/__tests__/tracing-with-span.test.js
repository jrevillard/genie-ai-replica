describe('tracing.js withSpan', () => {
  const { withSpan } = require('../tracing');

  it('exports withSpan as a function', () => {
    expect(typeof withSpan).toBe('function');
  });

  it('returns result from sync function', () => {
    const result = withSpan('test.op', (span) => {
      span.setAttribute('key', 'value');
      return 42;
    });
    expect(result).toBe(42);
  });

  it('returns result from async function', async () => {
    const result = await withSpan('test.async', async (span) => {
      span.setAttribute('async', true);
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('propagates sync exceptions', () => {
    expect(() =>
      withSpan('test.error', () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
  });

  it('propagates async exceptions', async () => {
    await expect(
      withSpan('test.async-error', async () => {
        throw new Error('async-boom');
      })
    ).rejects.toThrow('async-boom');
  });

  it('calls span.setAttribute without crashing', () => {
    withSpan('test.attrs', (span) => {
      span.setAttribute('count', 5);
      span.setAttribute('name', 'test');
    });
    // No assertion needed — verifies no-op span accepts calls
  });
});
