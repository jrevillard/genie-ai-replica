const { traceQuery } = require('../tracing-db');

describe('tracing-db.js', () => {
  it('calls the query function and returns the result', async () => {
    const mockResult = { all: () => Promise.resolve([{ _key: '1' }]) };
    const queryFn = jest.fn().mockResolvedValue(mockResult);

    const result = await traceQuery(queryFn, { collection: 'users', operation: 'FOR' });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockResult);
  });

  it('propagates query errors', async () => {
    const error = new Error('query failed');
    const queryFn = jest.fn().mockRejectedValue(error);

    await expect(traceQuery(queryFn, { collection: 'users', operation: 'INSERT' })).rejects.toThrow('query failed');
  });

  it('works with no-op tracer in test mode (no errors)', async () => {
    const queryFn = jest.fn().mockResolvedValue('ok');
    const result = await traceQuery(queryFn, { collection: 'messages', operation: 'FOR' });
    expect(result).toBe('ok');
  });

  it('handles multiple sequential traceQuery calls', async () => {
    const fn1 = jest.fn().mockResolvedValue('result1');
    const fn2 = jest.fn().mockResolvedValue('result2');

    const r1 = await traceQuery(fn1, { collection: 'users', operation: 'FOR' });
    const r2 = await traceQuery(fn2, { collection: 'conversations', operation: 'INSERT' });

    expect(r1).toBe('result1');
    expect(r2).toBe('result2');
  });
});
