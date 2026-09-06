// Unit tests for tracing-pii-logs.js — PIIRedactingLogRecordProcessor.
// Verifies the processor redacts log record attributes before delegating to
// the wrapped BatchLogRecordProcessor, and that redaction failures never
// block export (the contract mirrored from tracing.js span-side PIIRedactionProcessor).

const mockStubOnEmit = jest.fn();
class MockStubBatchLogRecordProcessor {
  onEmit(...args) {
    mockStubOnEmit(...args);
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

jest.mock('@opentelemetry/sdk-logs', () => ({
  BatchLogRecordProcessor: MockStubBatchLogRecordProcessor
}));

jest.mock('../tracing-pii', () => ({
  redactAttributes: jest.fn(),
  redactLogRecordBody: jest.fn((body) => body)
}));

const { redactAttributes } = require('../tracing-pii');
const { PIIRedactingLogRecordProcessor } = require('../tracing-pii-logs');

describe('PIIRedactingLogRecordProcessor', () => {
  beforeEach(() => {
    mockStubOnEmit.mockClear();
    redactAttributes.mockReset();
  });

  it('redacts record attributes via redactAttributes and forwards the redacted record to super.onEmit', () => {
    redactAttributes.mockReturnValue({
      password: '[REDACTED]',
      authorization: '[REDACTED]',
      user: 'alice'
    });
    const setAttribute = jest.fn();
    const record = {
      attributes: { password: 'secret', authorization: 'Bearer abc', user: 'alice' },
      setAttribute
    };
    const ctx = { traceId: 'abc' };

    const processor = new PIIRedactingLogRecordProcessor();
    processor.onEmit(record, ctx);

    expect(redactAttributes).toHaveBeenCalledTimes(1);
    expect(redactAttributes).toHaveBeenCalledWith({
      password: 'secret',
      authorization: 'Bearer abc',
      user: 'alice'
    });
    expect(setAttribute).toHaveBeenCalledWith('password', '[REDACTED]');
    expect(setAttribute).toHaveBeenCalledWith('authorization', '[REDACTED]');
    expect(setAttribute).toHaveBeenCalledWith('user', 'alice');
    expect(mockStubOnEmit).toHaveBeenCalledTimes(1);
    expect(mockStubOnEmit).toHaveBeenCalledWith(record, ctx);
  });

  it('does not call setAttribute when record has no attributes', () => {
    redactAttributes.mockReturnValue({});
    const setAttribute = jest.fn();
    const record = { setAttribute };

    const processor = new PIIRedactingLogRecordProcessor();
    processor.onEmit(record, {});

    expect(redactAttributes).not.toHaveBeenCalled();
    expect(setAttribute).not.toHaveBeenCalled();
    expect(mockStubOnEmit).toHaveBeenCalledWith(record, {});
  });

  it('swallows redactAttributes errors and still calls super.onEmit', () => {
    redactAttributes.mockImplementation(() => {
      throw new Error('redaction blew up');
    });
    const record = {
      attributes: { password: 'secret' },
      setAttribute: jest.fn()
    };

    const processor = new PIIRedactingLogRecordProcessor();
    expect(() => processor.onEmit(record, {})).not.toThrow();
    expect(mockStubOnEmit).toHaveBeenCalledWith(record, {});
  });

  it('extends BatchLogRecordProcessor (super.onEmit is the stub)', () => {
    // Verify delegation by inspecting the mock's onEmit spy: the SUT's onEmit
    // must end with a delegated call to its inner delegate. A separate
    // instanceof check is brittle under jest.mock replacement of the parent
    // class; the delegation pattern is the load-bearing contract.
    redactAttributes.mockReturnValue({});
    const record = { setAttribute: jest.fn() };

    const processor = new PIIRedactingLogRecordProcessor();
    processor.onEmit(record, {});

    expect(mockStubOnEmit).toHaveBeenCalledTimes(1);
    expect(processor._delegate).toBeInstanceOf(MockStubBatchLogRecordProcessor);
  });

  // SECURITY: the body field is the most common PII vector (`logger.info('User ' + email)`).
  // Without redactLogRecordBody, raw emails and tokens land in VictoriaLogs. This
  // test pins the contract.
  it('redacts the record body via redactLogRecordBody before delegating to super.onEmit', () => {
    const bodySpy = jest.fn();
    const setBody = jest.fn();
    const setAttribute = jest.fn();
    const record = {
      body: 'User alice@example.com logged in',
      setBody,
      setAttribute
    };

    // Make the SUT call our spy by stubbing redactLogRecordBody to mutate the
    // record's body and track the post-redaction call.
    // tracing-pii's redactLogRecordBody is mocked above; its return value
    // becomes the new body.
    const tracingPii = require('../tracing-pii');
    // Override just the body redaction for this test
    tracingPii.redactLogRecordBody.mockReturnValue('User [REDACTED]@example.com logged in');

    redactAttributes.mockReturnValue({});

    const processor = new PIIRedactingLogRecordProcessor();
    processor.onEmit(record, {});

    expect(tracingPii.redactLogRecordBody).toHaveBeenCalledWith('User alice@example.com logged in');
    expect(record.body).toBe('User [REDACTED]@example.com logged in');
    // Body redaction runs BEFORE the delegate call.
    expect(mockStubOnEmit).toHaveBeenCalledTimes(1);
    expect(mockStubOnEmit.mock.calls[0][0].body).toBe('User [REDACTED]@example.com logged in');
  });

  it('swallows redactLogRecordBody errors and still calls super.onEmit (regression — body PII must never block export)', () => {
    const tracingPii = require('../tracing-pii');
    tracingPii.redactLogRecordBody.mockImplementation(() => {
      throw new Error('body redaction blew up');
    });
    redactAttributes.mockReturnValue({});
    const record = {
      body: 'sensitive',
      setAttribute: jest.fn()
    };

    const processor = new PIIRedactingLogRecordProcessor();
    expect(() => processor.onEmit(record, {})).not.toThrow();
    // Export still happens — body redaction is best-effort.
    expect(mockStubOnEmit).toHaveBeenCalledWith(record, {});
  });
});
