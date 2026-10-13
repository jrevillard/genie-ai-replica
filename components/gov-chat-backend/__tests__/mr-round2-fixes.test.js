'use strict';

/**
 * MR !343 round-2 — consolidation regression test.
 *
 * Asserts that the 15 review findings have been addressed in the source
 * files. Pinned via source-file inspection (read + regex) instead of
 * runtime mocks so the test:
 *   - does not require axios / arangojs to resolve;
 *   - does not depend on the shared/lib barrel cycle;
 *   - fails LOUDLY on current code (RED), passes on the fixed code
 *     (GREEN).
 *
 * For each finding the test reads the source file with `fs.readFileSync`
 * + `path.resolve(__dirname, ...)` and asserts EITHER the absence of a
 * known-bad pattern (most fixes) OR the presence of a required post-fix
 * pattern (proxy methods, bindVars, AQL `$VAR` syntax, etc).
 *
 * Style: 2-space indent, single quotes, mandatory semicolons, no
 * trailing commas (matches root `.prettierrc`).
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const COMPONENTS_SHARED = path.resolve(__dirname, '../../shared');

function readBackend(relPath) {
  return fs.readFileSync(path.resolve(BACKEND, relPath), 'utf8');
}

// Convenience: a single pattern-must-NOT-match assertion.
function expectNoBadPattern(source, label, pattern) {
  if (pattern.test(source)) {
    throw new Error(`[MR round-2] ${label}: bad pattern still present (${pattern})`);
  }
}

// And a pattern-must-match (the fix is in place).
function expectRequiredPattern(source, label, pattern) {
  if (!pattern.test(source)) {
    throw new Error(`[MR round-2] ${label}: required fix pattern missing (${pattern})`);
  }
}

// ----- Adapter / wrapper layer -----

describe('MELT wrapper (components/shared/lib/melt)', () => {
  const indexSrc = readBackend('../shared/lib/melt/index.js');
  const adapterSrc = readBackend('../shared/lib/melt/victorialogs-client.js');

  it('finding #1 — VictoriaLogsClient.count proxy is defined', () => {
    expectRequiredPattern(
      indexSrc,
      'melt/index.js count proxy',
      /async\s+count\s*\(\s*query\s*\)\s*\{[^}]*this\._adapter\.count/
    );
  });

  it('finding #2 — VictoriaLogsAdapter.count reads `first.fields.total` (not top-level)', () => {
    // After _normalizeRow, `total` lives under `fields`. Old code read `first.total` (undefined → 0).
    expectRequiredPattern(
      adapterSrc,
      'victorialogs-client.js count().fields.total',
      /first\.(?:fields)\.(?:total|Total|_total)/
    );
  });

  it('finding #6 — _ensureHealth adds a negative-cache TTL on probe failure', () => {
    // Existing inline comment lines 397 already admit the bug.
    // After fix: a short TTL (e.g. _healthNegCacheUntilMs) gates retries.
    expectRequiredPattern(
      adapterSrc,
      '_ensureHealth negative-cache',
      /_healthNegCacheUntil|_healthProbeNegUntil|negative.{0,20}cache/i
    );
  });
});

// ----- LogsService -----

describe('LogsService (components/gov-chat-backend/services/logs-service.js)', () => {
  const src = readBackend('services/logs-service.js');

  it('finding #4 — _getVlClient resets _vlClientPromise on constructor failure', () => {
    // The IIFE wraps `new VictoriaLogsClient(...)` + assignment. On rejection
    // the catch clause must reset `this._vlClientPromise = null` so the next
    // call retries. v1 only resets on success — stuck forever.
    expectRequiredPattern(src, '_getVlClient failure reset', /catch[\s\S]{0,200}_vlClientPromise\s*=\s*null/);
  });

  it('finding #11 — searchLogs wires client.count() for `total` (not allRows.length)', () => {
    // Tight regex: the actual call site is `client.count({ q, start, end })`.
    // Anchoring on a comment that mentions "client.count" by name would also
    // pass and let a future regression through silently.
    expectRequiredPattern(src, 'searchLogs.count call site', /searchLogs[\s\S]*?client\.count\s*\(\s*\{\s*q:/);
  });
});

// ----- SecurityScanService -----

describe('SecurityScanService (services/security-scan-service.js)', () => {
  const src = readBackend('services/security-scan-service.js');

  it('finding #3 — _processLogsViaVL returns failedLogins matched against VL rows (not literal [])', () => {
    // The MAIN return of _processLogsViaVL (the post-scan return, not the
    // empty-client early-return nor the file-mode processFile catch) must
    // populate failedLogins from VL-row matches + dedupe. v1 line 510
    // returned the literal `failedLogins: []` regardless of input.
    //
    // The fix-applied signature is:
    //   `failedLogins: this.removeDuplicateLogEntries(failedLogins)`
    // inside `_processLogsViaVL` (the function whose body accumulates
    // `failedLogins` via `.push(...)` from the VL-row scan loop).
    expectRequiredPattern(
      src,
      '_processLogsViaVL populates failedLogins from VL rows',
      /_processLogsViaVL[\s\S]*?failedLogins:\s*this\.removeDuplicateLogEntries\(\s*failedLogins\s*\)/
    );
  });
});

// ----- AdminDashboardService -----

describe('AdminDashboardService (services/admin-dashboard-service.js)', () => {
  const src = readBackend('services/admin-dashboard-service.js');

  it('finding #10 — getLogs forwards `q` and `offset` to logsService.getLogsInRange', () => {
    // Find `async getLogs` body and assert `q` / `offset` reach the inner call.
    const body = src.match(/async\s+getLogs[\s\S]{0,800}return[\s\S]{0,400}/);
    expect(body && body[0]).toBeTruthy();
    expectRequiredPattern(body[0], 'getLogs forwards q', /\bq\b[\s\S]{0,200}logsService\.getLogsInRange/);
    expectRequiredPattern(body[0], 'getLogs forwards offset', /\boffset\b[\s\S]{0,200}logsService\.getLogsInRange/);
  });

  it('finding #7 — searchUsers parses limit without falling through to default on 0', () => {
    // v1: `parseInt(limit, 10) || 20` — parseInt('0') is 0 (falsy) → 20.
    // Fix: `Math.max(0, Math.min(... parsedLimit, 1000))` or `=== 0 ? 0 : ...`.
    expectNoBadPattern(src, 'searchUsers falsy-zero fallback', /parseInt\([^)]+\)\s*\|\|\s*\d+/);
  });

  it('finding #12 — searchUsers uses bindVars for LIMIT (no template-literal injection)', () => {
    // v1: `LIMIT ${parsedOffset}, ${parsedLimit}` — parseInt consumes only the leading
    // digit prefix; payloads like `limit=10;FOR u IN users REMOVE u IN users;//`
    // pass through and execute multi-statement AQL. Fix: bindVars.
    expectNoBadPattern(src, 'AQL LIMIT template-literal', /LIMIT\s+\$\{[^}]+\}/g);
    // And: the bindVars-driven query must declare @limit / @offset.
    expectRequiredPattern(src, 'AQL LIMIT bindVars declared', /@(?:limit|offset)/i);
  });
});

// ----- Admin routes -----

describe('Admin routes (routes/admin-routes.js)', () => {
  const src = readBackend('routes/admin-routes.js');

  it('finding #6b — wire contract is canonical (all /logs/* endpoints unwrap or wrap consistently)', () => {
    // v1: /logs/summary wraps `{data: result}` while /logs, /logs/search,
    // /logs/debug-yesterday return raw. Pick ONE shape. Assert the summary
    // either drops the wrapper OR the siblings gain one —- here we assert
    // the wrap is gone (matches the established sibling contract).
    expectNoBadPattern(
      src,
      '/logs/summary wrap inconsistency',
      /router\.get\(['"]\/logs\/summary['"][\s\S]{0,400}res\.json\(\{\s*data:/
    );
  });

  it('finding #12 — /user-stats does NOT debug-log the full user envelope', () => {
    // v1: logger.debug('[ADMIN-ROUTES] User stats response sent to client', { result })
    expectNoBadPattern(
      src,
      'user-stats debug log full envelope',
      /User stats response sent to client[\s\S]{0,80}\{\s*result/
    );
  });
});

// ----- PII routes -----

describe('PII route logging (routes/chat-history-routes.js, routes/query-routes.js)', () => {
  const chat = readBackend('routes/chat-history-routes.js');
  const query = readBackend('routes/query-routes.js');

  it('finding #8a — chat-history: raw POST body not logged', () => {
    expectNoBadPattern(chat, 'chat-history raw body leak', /Raw request body for conversation/);
  });

  it('finding #8b — chat-history: message `content` not logged verbatim via "Parsed request body"', () => {
    expectNoBadPattern(chat, 'chat-history Parsed request body', /Parsed request body:[^\n]*\{\s*content/);
  });

  it('finding #8c — chat-history: search term not logged in /search conversations', () => {
    expectNoBadPattern(
      chat,
      'chat-history search-term leak',
      /Searching conversations for user[^\n]*term "\$\{searchTerm\}"|term "?".*\$\{searchTerm\}/
    );
  });

  it('finding #9 — query-routes: POST /queries/:queryId/feedback body not logged', () => {
    expectNoBadPattern(
      query,
      'query-routes feedback body leak',
      /Adding feedback to query[^\n]*body: \$\{JSON\.stringify\(req\.body\)\}/
    );
  });
});

// ----- Logger + tracing -----

describe('Logger service-name', () => {
  const loggerSrc = readBackend('../shared/lib/logger.js');

  it('finding #5 — logger.js does not hardcode `service` to backend', () => {
    // doc-repo doesn't forward OTEL_SERVICE_NAME; the hardcoded fallback
    // attributes doc-repo logs to `backend`. Fix: read package.json name
    // (chatbot-analytics-backend / document-repository) or compose-block name.
    expectNoBadPattern(
      loggerSrc,
      'logger hardcode service=backend',
      /info\.service\s*=\s*process\.env\.OTEL_SERVICE_NAME\s*\|\|\s*['"]backend['"]/
    );
  });
});

// ----- Test runner -----

describe('source-inspection contract (sanity)', () => {
  it('reads source files from the resolved paths', () => {
    const fs = require('fs');
    expect(fs.existsSync(path.resolve(BACKEND, 'services/logs-service.js'))).toBe(true);
    expect(fs.existsSync(path.resolve(COMPONENTS_SHARED, 'lib/melt/index.js'))).toBe(true);
  });
});
