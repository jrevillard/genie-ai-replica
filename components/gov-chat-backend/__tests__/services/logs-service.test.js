'use strict';

// Smoke tests for `LogsService` after the T8 dead-code cleanup.
//
// All VL behaviour (happy paths, outage wrapping, search/summary
// envelopes, LogSQL injection defence) lives in
// `logs-service-vl.test.js` and `logs-vl-degradation.test.js`. This
// file pins the structural invariants that survived T8 — the service
// can be required, instantiated, and `init()` is a no-op.

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }
  }),
  { virtual: true }
);

let logsService;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    logsService.initialized = false;
  });
});

describe('LogsService (smoke — post-T8 single-channel contract)', () => {
  describe('init', () => {
    it('is a no-op (file-source branches removed)', async () => {
      await logsService.init();
      expect(logsService.initialized).toBe(true);
    });

    it('skips initialization when already initialized', async () => {
      logsService.initialized = true;
      await logsService.init();
      // No fs.mkdir / fs.access — no-op when already initialized
    });
  });

  describe('VlUnavailableError class export', () => {
    // The typed error is the only public class surface that survived
    // T8 (VlFilesDisabledError + the file-source helpers were all
    // dropped). Routes + the global error middleware reach for it via
    // `require('./logs-service').VlUnavailableError`.
    it('is exported and carries the standard 503 envelope', () => {
      const { VlUnavailableError } = require('../../services/logs-service');
      const err = new VlUnavailableError();
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('VlUnavailableError');
      expect(err.statusCode).toBe(503);
      expect(err.body.error).toBe('vl_unreachable');
      expect(typeof err.body.message).toBe('string');
      expect(err.body.message.length).toBeGreaterThan(0);
    });

    it('accepts a custom message and propagates it through `body.message`', () => {
      const { VlUnavailableError } = require('../../services/logs-service');
      const err = new VlUnavailableError('connection refused to victorialogs:9428');
      expect(err.message).toBe('connection refused to victorialogs:9428');
      expect(err.body.message).toBe('connection refused to victorialogs:9428');
    });
  });
});
