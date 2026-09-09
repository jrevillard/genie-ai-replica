'use strict';

// Story 5.9 — degradation test: 5xx / ECONNREFUSED / ENOTFOUND handling +
// rate-limit persistence.
//
// Four CAP-5 properties pinned by phases.md:73 + AD-11:
//   1. Rate-limit 1/min — error log fires AT MOST once per minute.
//   2. Rate-limit state persists across restart — /tmp/vl-fail-open-ts
//      stores Unix milliseconds; re-read on subsequent call and the
//      suppression window is honoured.
//   3. 5 s latency — with VL_FAIL_OPEN=true, getLogsInRange returns the
//      degraded envelope without waiting for the underlying VL request.
//   4. VL_FAIL_OPEN=false (default) surfaces the error to the admin route
//      (NOT the degraded envelope) so the route returns 500.

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

const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  open: jest.fn(),
  unlink: jest.fn(),
  constants: { R_OK: 4 }
};

const mockFsSync = {
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  openSync: jest.fn(),
  closeSync: jest.fn(),
  writeSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn()
};

jest.mock('fs', () => ({
  readFileSync: mockFsSync.readFileSync,
  writeFileSync: mockFsSync.writeFileSync,
  openSync: mockFsSync.openSync,
  closeSync: mockFsSync.closeSync,
  writeSync: mockFsSync.writeSync,
  existsSync: mockFsSync.existsSync,
  unlinkSync: mockFsSync.unlinkSync,
  promises: mockFs,
  constants: { R_OK: 4 }
}));

jest.mock('zlib', () => ({
  gunzip: jest.fn()
}));

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

let mockVlClient;
let realDateNow;

function mountService() {
  let service;
  let sharedLogger;
  jest.isolateModules(() => {
    sharedLogger = require('../../shared-lib').logger;
    service = require('../../services/logs-service');
    service.initialized = false;
    service.setVictoriaLogsClient(mockVlClient);
  });
  return { service, sharedLogger };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  delete process.env.ADMIN_LOGS_SOURCE;
  delete process.env.LOG_TO_FILE;
  delete process.env.VL_FAIL_OPEN;
  delete process.env.VL_QUERY_TIMEOUT_MS;

  mockVlClient = {
    query: jest.fn(),
    hits: jest.fn().mockResolvedValue({})
  };

  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);

  // Default fs mocks — ENOENT for readFile, success for writeFile.
  // Each test overrides what it needs.
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  mockFs.readFile.mockRejectedValue(enoent);
  mockFs.writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  if (realDateNow) {
    Date.now = realDateNow;
    realDateNow = null;
  }
});

describe('Story 5.9 — VL degradation (CAP-5 / AD-11)', () => {
  // ====================================================================
  // CAP-5 Property 1: rate-limit 1/min via clock-mocked Date.now()
  // ====================================================================
  describe('Property 1 — rate-limit 1/min (clock-mocked Date.now)', () => {
    it('emits logger.warn ONCE within the 60s window, suppresses subsequent incidents, then re-arms after the cooldown elapses', async () => {
      let now = 1_700_000_000_000;
      realDateNow = Date.now;
      Date.now = jest.fn(() => now);

      // Mount service + logger from a single isolateModules scope so
      // the warn mock observed below is the same instance bound to the
      // service (a require outside the isolation would hand us a fresh
      // mock from the post-reset registry — see existing test pattern
      // in logs-service-vl.test.js:870).
      const { service, sharedLogger } = mountService();

      // First incident at t=0 — fresh state, must log + write.
      mockFs.readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await service._logVlUnavailableOnce('q1', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      expect(sharedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);

      // 30s later — within cooldown — second incident must NOT log.
      now += 30_000;
      mockFs.readFile.mockResolvedValueOnce(String(now - 30_000));
      await service._logVlUnavailableOnce('q2', Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      expect(sharedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1); // unchanged

      // 59s later — still within the 60s window — third incident suppressed.
      now += 29_000;
      mockFs.readFile.mockResolvedValueOnce(String(now - 59_000));
      await service._logVlUnavailableOnce('q3', Object.assign(new Error('503'), { response: { status: 503 } }));
      expect(sharedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);

      // 120s after the first incident (file timestamp is from the
      // +30s mark, so the cooldown window has elapsed) — must log again.
      now += 61_000;
      mockFs.readFile.mockResolvedValueOnce(String(now - 90_000));
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await service._logVlUnavailableOnce('q4', Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }));
      expect(sharedLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);

      // The first warn call MUST carry the structured {code, status}
      // fields from the originating error (AD-11 operator-facing log
      // contract).
      const firstWarnArgs = sharedLogger.warn.mock.calls[0];
      expect(String(firstWarnArgs[0])).toMatch(/q1.*VictoriaLogs unreachable/);
      expect(firstWarnArgs[1]).toEqual(expect.objectContaining({ code: 'ECONNREFUSED' }));
    });
  });

  // ====================================================================
  // CAP-5 Property 2: rate-limit state persists across restart
  // ====================================================================
  describe('Property 2 — rate-limit state persists across restart', () => {
    it('writes /tmp/vl-fail-open-ts as Unix ms; the next service instance re-reads it and respects the suppression window', async () => {
      // Phase A: simulate the running service writing the timestamp.
      const t0 = 1_700_000_000_000;
      realDateNow = Date.now;
      Date.now = jest.fn(() => t0);

      const { service: serviceA, sharedLogger: loggerA } = mountService();

      mockFs.readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      const err1 = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
      await serviceA._logVlUnavailableOnce('first-process', err1);

      // Capture what was written — Unix milliseconds as a string.
      const writeCall = mockFs.writeFile.mock.calls.find((c) => c[0].endsWith('vl-fail-open-ts'));
      expect(writeCall).toBeDefined();
      expect(writeCall[0]).toMatch(/vl-fail-open-ts$/);
      const writtenValue = Number(writeCall[1]);
      expect(Number.isFinite(writtenValue)).toBe(true);
      expect(writtenValue).toBe(t0);
      expect(loggerA.warn).toHaveBeenCalledTimes(1);

      // Phase B: simulate a restart — fresh mount via isolateModules.
      // Date.now was jest.fn'd BEFORE the first service mount; reassign
      // here so the second mount sees the +5s offset.
      Date.now = jest.fn(() => t0 + 5_000);

      const { service: serviceB, sharedLogger: loggerB } = mountService();

      // Service B reads the file the previous process wrote — gets t0,
      // computes (now - lastTs) = 5000 < 60_000 → suppresses.
      mockFs.readFile.mockResolvedValueOnce(String(t0));
      await serviceB._logVlUnavailableOnce(
        'second-process',
        Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
      );
      // Suppressed: no new warn, no writeFile attempt.
      expect(loggerB.warn).not.toHaveBeenCalled();

      // Phase C: advance past the cooldown window — second process
      // re-arms with its own timestamp.
      Date.now = jest.fn(() => t0 + 120_000); // 120s after t0
      mockFs.readFile.mockResolvedValueOnce(String(t0));
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await serviceB._logVlUnavailableOnce(
        'second-process',
        Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' })
      );
      expect(loggerB.warn).toHaveBeenCalledTimes(1);
      const writeCall2 = mockFs.writeFile.mock.calls[mockFs.writeFile.mock.calls.length - 1];
      expect(writeCall2[0]).toMatch(/vl-fail-open-ts$/);
      expect(Number(writeCall2[1])).toBe(t0 + 120_000);
    });

    it.each([
      ['non-numeric word', 'not-a-number'],
      ['empty string', ''],
      ['whitespace-only', '   '],
      ['BOM-only', '\uFEFF']
    ])('tolerates a corrupt /tmp/vl-fail-open-ts (%s) and treats it as 0', async (_label, corruptValue) => {
      const { service, sharedLogger } = mountService();

      // Service reads garbage from the file — parseInt yields NaN,
      // then `lastTs = NaN || 0` → 0 → now - 0 > 60_000 → logs + writes.
      mockFs.readFile.mockResolvedValueOnce(corruptValue);
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await service._logVlUnavailableOnce(
        `corrupt-ts-${_label}`,
        Object.assign(new Error('EHOSTUNREACH'), { code: 'EHOSTUNREACH' })
      );
      expect(sharedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // CAP-5 Property 3: 5s latency with VL_FAIL_OPEN=true
  // ====================================================================
  describe('Property 3 — VL_FAIL_OPEN=true returns the degraded envelope within 5s', () => {
    it('getLogsInRange resolves the degraded envelope on VL outage AND fires the operator-facing warn (AD-11 wiring)', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const { service, sharedLogger } = mountService();

      // The VL client rejects synchronously-as-Promise — no delay, no hang.
      // CAP-5: VL_FAIL_OPEN bypasses waiting for VL; on outage the
      // envelope must be returned promptly. The < 200ms wall-clock
      // assertion is a defensive regression-catcher for an accidental
      // `await` on the success path (which would push the rejection
      // into the microtask queue — still fast, but not the synchronous-
      // bail behavior CAP-5 expects). The CAP-5 5s SLO stated in the AC
      // is not separately asserted at the HTTP boundary in this repo
      // (routes/admin.test.js mocks the logs-service layer and does not
      // exercise the VL outage path), so the < 200ms guard is the only
      // numeric budget pinned here. The service-layer test also pins
      // the integration: the catch-branch in `_withVlFailOpen` MUST
      // invoke `_logVlUnavailableOnce` so the AD-11 operator-facing
      // warn fires on every outage — without that wiring, the
      // rate-limit cooldown file is never written and the
      // warn-once-per-minute contract is silently broken.
      const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9428'), { code: 'ECONNREFUSED' });
      mockVlClient.query.mockRejectedValueOnce(err);

      const startedAt = Date.now();
      const result = await service.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: 100,
        offset: 0
      });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(200);
      expect(result).toEqual(
        expect.objectContaining({
          logs: [],
          total: 0,
          limit: 100,
          offset: 0,
          degraded: true
        })
      );

      // AD-11 wiring: the fail-open catch branch must invoke
      // `_logVlUnavailableOnce`, which fires the operator-facing warn
      // and writes the cooldown timestamp. A regression that drops
      // that call (silently eats the signal) would still pass every
      // other assertion in this file.
      expect(sharedLogger.warn).toHaveBeenCalledTimes(1);
      const warnArgs = sharedLogger.warn.mock.calls[0];
      expect(String(warnArgs[0])).toMatch(/getLogsInRange.*VictoriaLogs unreachable/);
      expect(warnArgs[1]).toEqual(expect.objectContaining({ code: 'ECONNREFUSED' }));

      // AD-11 wiring (file side): the integration call MUST also write
      // the rate-limit cooldown timestamp — without the write, the
      // warn-once-per-minute contract is silently broken (the warn
      // would re-fire on every subsequent outage). Mirrors Property 2's
      // endsWith + Number() pattern to pin the file side of the wiring
      // independently of the warn side.
      const cooldownWrite = mockFs.writeFile.mock.calls.find((c) => c[0].endsWith('vl-fail-open-ts'));
      expect(cooldownWrite).toBeDefined();
      expect(Number.isFinite(Number(cooldownWrite[1]))).toBe(true);
    });
  });

  // ====================================================================
  // CAP-5 Property 4: VL_FAIL_OPEN=false (default) surfaces error to admin
  // ====================================================================
  describe('Property 4 — VL_FAIL_OPEN=false surfaces the error (NOT the degraded envelope)', () => {
    it('re-throws ECONNREFUSED from getLogsInRange when VL_FAIL_OPEN is unset', async () => {
      // VL_FAIL_OPEN explicitly NOT set — default is false.
      delete process.env.VL_FAIL_OPEN;
      const { service } = mountService();

      const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9428'), { code: 'ECONNREFUSED' });
      mockVlClient.query.mockRejectedValueOnce(err);

      await expect(
        service.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z',
          limit: 100,
          offset: 0
        })
      ).rejects.toBe(err);
    });

    it('re-throws 5xx errors when VL_FAIL_OPEN=false — caller (route handler) renders 500', async () => {
      delete process.env.VL_FAIL_OPEN;
      const { service } = mountService();

      const err = Object.assign(new Error('VL returned 503 Service Unavailable'), { response: { status: 503 } });
      mockVlClient.query.mockRejectedValueOnce(err);

      // The route layer does `try { ... } catch { next(error); }` which
      // surfaces 500 via Express's default error handler. The contract
      // is that getLogsInRange re-throws — verified here.
      await expect(
        service.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z',
          limit: 100,
          offset: 0
        })
      ).rejects.toBe(err);
    });

    it('re-throws ENOTFOUND when VL_FAIL_OPEN=false — never returns the degraded envelope', async () => {
      delete process.env.VL_FAIL_OPEN;
      const { service } = mountService();

      const err = Object.assign(new Error('getaddrinfo ENOTFOUND victorialogs'), { code: 'ENOTFOUND' });
      mockVlClient.query.mockRejectedValueOnce(err);

      let thrown;
      try {
        await service.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z',
          limit: 100,
          offset: 0
        });
        throw new Error('expected getLogsInRange to throw');
      } catch (e) {
        thrown = e;
      }

      // The Error object IS the original VL error — same instance,
      // NOT a degraded envelope.
      expect(thrown).toBe(err);
      expect(thrown.code).toBe('ENOTFOUND');
      // Critical: the rejected path must NOT carry `degraded: true`.
      expect(thrown.degraded).toBeUndefined();
    });

    it('VL_FAIL_OPEN=true does NOT swallow non-VL errors (TypeError etc.) — still re-throws', async () => {
      // The implementation gates VL_FAIL_OPEN on `_isVlUnavailable(err)`.
      // A `TypeError` (no `code` matching the VL outage set, no 5xx
      // status) is a programmer/contract error, not a VL outage —
      // VL_FAIL_OPEN=true must NOT mask it with the degraded envelope.
      process.env.VL_FAIL_OPEN = 'true';
      const { service } = mountService();

      const typeErr = new TypeError('Cannot read properties of undefined (reading "stream")');
      mockVlClient.query.mockRejectedValueOnce(typeErr);

      await expect(
        service.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z',
          limit: 100,
          offset: 0
        })
      ).rejects.toBe(typeErr);
    });
  });
});
