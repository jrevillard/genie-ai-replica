'use strict';

// AD-20 ClamAV observability contract test (Story 3.4).
//
// Asserts the producer-side contract that downstream VictoriaLogs queries
// rely on (`service:genie-document-repository AND _msg:clamav.scan.*`):
//   - each scan emits exactly one `start` event (info) and exactly one
//     terminal event (`complete` info / `failed` error / `timeout` warn),
//   - `clamav_duration_ms` and `file_size_bytes` are integer-valued,
//   - `clamav_result` is one of the AD-20 enum values
//     (`OK` / `FOUND` / `ERROR` / `TIMEOUT`),
//   - `clamav_signature_version` is the cached `clamdscan --version` output.
//
// The `clamav_signature_version` cache is populated once at module load via
// an IIFE that reads `clamdscan --version`. We stub `child_process` so the
// cached value is deterministic across the test file. The IIFE fallback
// ("unknown" when `clamdscan` is absent) is intentionally not covered here
// because it requires reloading the module under a different `child_process`
// stub — covered manually via runtime smoke (see `tests/melt-correlation/`).

// AD-20 signature cache — stub `child_process` BEFORE securityService.js
// is required so the IIFE picks up the deterministic return value rather
// than the host's (missing) `clamdscan` binary.
jest.mock('child_process', () => ({
  execFileSync: jest.fn()
}));

// clamscan constructor — never instantiated in these tests (we inject a
// scanner object directly via `securityService.clamscan = ...`), but the
// module is required at securityService.js load.
jest.mock('clamscan', () =>
  jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue({ scanStream: jest.fn().mockResolvedValue({ isInfected: false }) })
  }))
);

// Shared lib — the moduleNameMapper in jest.config.js already routes any
// `shared-lib` import to src/__tests__/__mocks__/shared-lib.js, but the
// explicit virtual mock keeps this file self-describing.
jest.mock(
  '../../shared-lib',
  () => {
    return {
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      dbService: { getConnection: jest.fn() }
    };
  },
  { virtual: true }
);

const { execFileSync } = require('child_process');
const { logger } = require('../../shared-lib');

// IMPORTANT: set the deterministic `clamdscan --version` stub BEFORE
// requiring securityService — the module-load IIFE freezes the cached
// signature version from the first `execFileSync(...)` call. Subsequent
// changes to `execFileSync.mockReturnValue` will not refresh the cache.
const STUBBED_SIGNATURE = 'ClamAV 1.5.0/27500/Mon Sep  1 12:00:00 2026';
execFileSync.mockReturnValue(Buffer.from(`${STUBBED_SIGNATURE}\n`));

const securityService = require('../../services/securityService');
const { cleanClamAV, infectedClamAV } = require('../mocks/clamav');

function findInfoCall(predicate) {
  return logger.info.mock.calls.find((args) => predicate(args));
}

function findWarnCall(predicate) {
  return logger.warn.mock.calls.find((args) => predicate(args));
}

function findErrorCall(predicate) {
  return logger.error.mock.calls.find((args) => predicate(args));
}

function metaOf(callArgs) {
  // logger.{info,warn,error} is invoked as (message, metaObject). The
  // metaObject can land at args[1] OR args[2] depending on winston's
  // splat handling — accept the first non-string object arg.
  for (let i = 1; i < callArgs.length; i++) {
    const candidate = callArgs[i];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

describe('securityService.scanFile — AD-20 ClamAV observability events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module-level scan state so scanBuffer's ensureInitialized
    // branch does not carry over between tests.
    securityService.isInitialized = false;
    securityService.clamscan = null;
  });

  it('emits clamav.scan.start and clamav.scan.complete (info) with clamav_result=OK on a clean scan', async () => {
    securityService.clamscan = cleanClamAV;
    securityService.isInitialized = true;

    const buffer = Buffer.from('safe document body');
    const result = await securityService.scanFile('file-clean-001', buffer);

    expect(result.isInfected).toBe(false);

    const startCall = findInfoCall((args) => args[0] === 'clamav.scan.start');
    const completeCall = findInfoCall((args) => args[0] === 'clamav.scan.complete');

    expect(startCall).toBeDefined();
    expect(completeCall).toBeDefined();

    const startMeta = metaOf(startCall);
    const completeMeta = metaOf(completeCall);

    // Start event is a latency marker only — no outcome, no duration.
    // Stamping these at start would double-count clean scans and skew
    // VL aggregations.
    expect(startMeta).toEqual(
      expect.objectContaining({
        file_id: 'file-clean-001',
        file_size_bytes: buffer.length,
        clamav_signature_version: STUBBED_SIGNATURE
      })
    );
    expect(startMeta.clamav_result).toBeUndefined();
    expect(startMeta.clamav_duration_ms).toBeUndefined();

    expect(completeMeta).toEqual(
      expect.objectContaining({
        file_id: 'file-clean-001',
        file_size_bytes: buffer.length,
        clamav_signature_version: STUBBED_SIGNATURE,
        clamav_result: 'OK'
      })
    );

    // Duration and size are integer ms / bytes, non-negative.
    expect(typeof completeMeta.clamav_duration_ms).toBe('number');
    expect(Number.isInteger(completeMeta.clamav_duration_ms)).toBe(true);
    expect(completeMeta.clamav_duration_ms).toBeGreaterThanOrEqual(0);

    expect(typeof completeMeta.file_size_bytes).toBe('number');
    expect(Number.isInteger(completeMeta.file_size_bytes)).toBe(true);
    expect(completeMeta.file_size_bytes).toBe(buffer.length);

    // No failure / timeout events on the happy path.
    expect(findInfoCall((args) => args[0] === 'clamav.scan.failed')).toBeUndefined();
    expect(findWarnCall((args) => args[0] === 'clamav.scan.timeout')).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('emits clamav.scan.complete (info) with clamav_result=FOUND on an infected scan', async () => {
    securityService.clamscan = infectedClamAV;
    securityService.isInitialized = true;

    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const result = await securityService.scanFile('file-infected-002', eicar);

    expect(result.isInfected).toBe(true);

    const startCall = findInfoCall((args) => args[0] === 'clamav.scan.start');
    const completeCall = findInfoCall((args) => args[0] === 'clamav.scan.complete');

    expect(startCall).toBeDefined();
    expect(completeCall).toBeDefined();

    const startMeta = metaOf(startCall);
    const completeMeta = metaOf(completeCall);

    expect(completeMeta).toEqual(
      expect.objectContaining({
        file_id: 'file-infected-002',
        file_size_bytes: eicar.length,
        clamav_signature_version: STUBBED_SIGNATURE,
        clamav_result: 'FOUND'
      })
    );

    expect(Number.isInteger(completeMeta.clamav_duration_ms)).toBe(true);
    expect(Number.isInteger(completeMeta.file_size_bytes)).toBe(true);
    expect(completeMeta.file_size_bytes).toBe(eicar.length);

    // Start event carries file context but no outcome.
    expect(startMeta.file_id).toBe('file-infected-002');
    expect(startMeta.file_size_bytes).toBe(eicar.length);
    expect(startMeta.clamav_result).toBeUndefined();

    // No error / warn output on the success path.
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('emits clamav.scan.timeout (warn) with clamav_result=TIMEOUT when scanner rejects with ETIMEDOUT code', async () => {
    const timeoutError = Object.assign(new Error('clamd socket read timed out'), { code: 'ETIMEDOUT' });
    securityService.clamscan = {
      scanStream: jest.fn().mockRejectedValue(timeoutError)
    };
    securityService.isInitialized = true;

    const buffer = Buffer.from('payload that triggers timeout');
    await expect(securityService.scanFile('file-timeout-003', buffer)).rejects.toThrow(/Buffer scan failed/);

    const startCall = findInfoCall((args) => args[0] === 'clamav.scan.start');
    const timeoutCall = findWarnCall((args) => args[0] === 'clamav.scan.timeout');

    expect(startCall).toBeDefined();
    expect(timeoutCall).toBeDefined();

    const startMeta = metaOf(startCall);
    const timeoutMeta = metaOf(timeoutCall);

    expect(timeoutMeta).toEqual(
      expect.objectContaining({
        file_id: 'file-timeout-003',
        file_size_bytes: buffer.length,
        clamav_signature_version: STUBBED_SIGNATURE,
        clamav_result: 'TIMEOUT'
      })
    );

    expect(Number.isInteger(timeoutMeta.clamav_duration_ms)).toBe(true);
    expect(timeoutMeta.clamav_duration_ms).toBeGreaterThanOrEqual(0);

    // Start event still carries the same file context.
    expect(startMeta.file_id).toBe('file-timeout-003');
    expect(startMeta.file_size_bytes).toBe(buffer.length);
    expect(startMeta.clamav_signature_version).toBe(STUBBED_SIGNATURE);

    // No complete / failed / info-level timeout — error/warn separation
    // keeps Grafana alert rules firing on real failures only.
    expect(findInfoCall((args) => args[0] === 'clamav.scan.complete')).toBeUndefined();
    expect(findInfoCall((args) => args[0] === 'clamav.scan.failed')).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('emits clamav.scan.failed (error) with clamav_result=ERROR on a generic scan failure, preserving error.cause', async () => {
    const cause = new Error('original clamd failure');
    securityService.clamscan = {
      scanStream: jest.fn().mockRejectedValue(cause)
    };
    securityService.isInitialized = true;

    const buffer = Buffer.from('payload that triggers generic failure');

    // scanBuffer wraps the inner rejection with `cause` preserved;
    // scanFile rethrows so fileService.js sees the same error shape.
    await expect(securityService.scanFile('file-failed-004', buffer)).rejects.toMatchObject({
      message: expect.stringMatching(/Buffer scan failed/),
      cause
    });

    const startCall = findInfoCall((args) => args[0] === 'clamav.scan.start');
    const failedCall = findErrorCall((args) => args[0] === 'clamav.scan.failed');

    expect(startCall).toBeDefined();
    expect(failedCall).toBeDefined();

    const startMeta = metaOf(startCall);
    const failedMeta = metaOf(failedCall);

    expect(failedMeta).toEqual(
      expect.objectContaining({
        file_id: 'file-failed-004',
        file_size_bytes: buffer.length,
        clamav_signature_version: STUBBED_SIGNATURE,
        clamav_result: 'ERROR'
      })
    );

    expect(Number.isInteger(failedMeta.clamav_duration_ms)).toBe(true);
    expect(Number.isInteger(failedMeta.file_size_bytes)).toBe(true);
    expect(failedMeta.file_size_bytes).toBe(buffer.length);

    // Start event still carries the same file context.
    expect(startMeta.file_id).toBe('file-failed-004');
    expect(startMeta.file_size_bytes).toBe(buffer.length);

    // No complete / timeout / warn on the failure path.
    expect(findInfoCall((args) => args[0] === 'clamav.scan.complete')).toBeUndefined();
    expect(findWarnCall((args) => args[0] === 'clamav.scan.timeout')).toBeUndefined();
  });
});
