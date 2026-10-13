const fsPromises = require('fs').promises;
const path = require('path');
const { logger } = require('../shared-lib');
const { DateTime } = require('luxon');
const axios = require('axios');
const config = require('../config');
const { LogsService } = require('./logs-service');
const DAYS_TO_PROCESS = 10;

// Bare-phrase patterns: reported as pattern matches, not as severities.
// Their regex is a word or two that ordinary operational prose contains,
// so a hit reports that the substring was present, not that anything was
// attempted. Everything else in `vulnerabilityPatterns` pins attack
// syntax or a specific operational event.
const PATTERN_MATCH_TYPES = new Set(['token_issue', 'attack_attempt', 'unauthorized_access']);

const securityScanService = {
  async checkCachedResults() {
    try {
      const scanResultsFile = '/app/data/security/last-scan-results.json';
      const stats = await fsPromises.stat(scanResultsFile);
      const now = DateTime.now();
      const fileTime = DateTime.fromJSDate(stats.mtime);
      if (now.diff(fileTime, 'hours').hours < 1) {
        const data = await fsPromises.readFile(scanResultsFile, 'utf8');
        logger.info('Returning cached security scan results');
        return JSON.parse(data);
      }
    } catch {
      console.debug('No valid cached results found');
    }
    return null;
  },

  async runSecurityScan(logsService) {
    const startTime = Date.now();
    try {
      logger.info('Running security scan');
      if (!logsService) throw new Error('LogsService is required for security scan');

      const { vulnerabilities, patternMatches, failedLogins, suspiciousActivities, skipped, reason } =
        await this.processLogsInParallel(logsService);

      const scanResult = {
        scanTime: new Date().toISOString(),
        vulnerabilities: {
          critical: vulnerabilities.critical.length,
          medium: vulnerabilities.medium.length,
          low: vulnerabilities.low.length,
          details: [...vulnerabilities.critical, ...vulnerabilities.medium, ...vulnerabilities.low]
        },
        vulnerabilityDetails: vulnerabilities,
        patternMatches,
        patternMatchCount: patternMatches.length,
        failedLoginDetails: failedLogins,
        suspiciousDetails: suspiciousActivities,
        status: skipped ? 'skipped' : 'completed',
        message: skipped ? `Security scan skipped: ${reason}` : 'Security scan completed successfully',
        skipped: skipped === true,
        reason: reason || null
      };

      await this.saveScanResults(scanResult);
      logger.info(`Security scan completed in ${(Date.now() - startTime) / 1000}s`);
      return scanResult;
    } catch (error) {
      logger.error(`Error in runSecurityScan: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  // VL-only security scan — runs the full VL LogSQL scan and
  // returns the categorised vulnerability buckets. File-mode +
  // ADMIN_LOGS_SOURCE=file were dropped in T8.
  //
  // A finding means "this substring was present in a log line", not
  // "an attack happened". Patterns split in two:
  //
  //   - signatures — the regex pins attack syntax or a specific
  //     operational event: `sleep \d+`, `__import__('subprocess')`,
  //     `Blocked access to sensitive path: …`, `404 Not Found: GET
  //     /api/api/…`. Ordinary traffic does not contain them, so a hit
  //     is worth a severity.
  //   - bare phrases — the regex is a word or two that operational
  //     prose contains. "invalid token" is what an expired tab emits,
  //     "not authorized" is what a revoked session emits, and
  //     Grafana logs `var="GF_SECURITY_CSRF_TRUSTED_ORIGINS=…"` at
  //     startup (logfmt, not the Winston JSON envelope, so the
  //     unwrap below never applies to it). These are reported as
  //     pattern matches with the real log line, and carry no severity.
  //
  // The split is by what the regex can distinguish, not by how alarming
  // the phrase sounds. A context gate that separates "the word appeared
  // in prose" from "this is an attack" would need per-pattern rules and
  // would miss uncanonical attacks; the sample line is shown instead so
  // the operator makes that call.
  async processLogsInParallel(logsService) {
    const vulnerabilityPatterns = [
      {
        type: 'token_issue',
        severity: 'critical',
        regex: /invalid token/i,
        description: 'Invalid or expired token usage detected',
        recommendation: 'Review token expiration policies.',
        service: 'auth'
      },
      {
        type: 'attack_attempt',
        severity: 'critical',
        regex: /SQL injection|XSS|CSRF/i,
        description: 'Potential attack attempt detected',
        recommendation: 'Implement WAF and input sanitization.',
        service: 'http'
      },
      {
        type: 'command_injection',
        severity: 'critical',
        regex:
          /(sleep\s+\d+|__import__\(\s*['"]subprocess['"]\)|execSync\(\s*['"]sleep\s+\d+['"]\)|%x\(\s*sleep\s+\d+\s*\))/i,
        description: 'Command injection attempt detected in token or request',
        recommendation: 'Sanitize all inputs and implement strict validation.',
        service: 'auth'
      },
      {
        type: 'sensitive_file_access',
        severity: 'medium',
        regex:
          /Blocked access to sensitive path:\s*((?:\/api\/)?(?:\.env|\.git\/config|\.gitignore|\.npmrc|node_modules\/\.package-lock\.json|\.well-known\/security\.txt))/i,
        description: 'Attempt to access sensitive file detected',
        recommendation: 'Ensure sensitive files are not exposed and access is blocked.',
        service: 'http'
      },
      {
        type: 'ip_blocked',
        severity: 'medium',
        regex: /IP Blocked/i,
        description: 'IP blocked due to suspicious activity',
        recommendation: 'Review blocked IPs for false positives and enhance rate limiting.',
        service: 'system'
      },
      {
        type: 'auth_failure_401',
        severity: 'medium',
        regex: /Authentication Failure - 401/i,
        description: 'HTTP 401 unauthorized access attempt detected',
        recommendation: 'Monitor for brute force and review access controls.',
        service: 'system'
      },
      {
        type: 'db_error',
        severity: 'medium',
        regex: /collection\.save failed.*expecting both `_from` and `_to` attributes/i,
        description: 'Database operation failed due to misconfiguration',
        recommendation: 'Review ArangoDB edge document configuration.',
        service: 'database'
      },
      {
        type: 'non_critical_file_access',
        severity: 'low',
        regex: /Blocked access to sensitive path:\s*(\/\.well-known\/appspecific\/com\.chrome\.devtools\.json)/i,
        description: 'Attempt to access non-critical configuration file detected',
        recommendation: 'Verify if access to such files should be blocked.',
        service: 'http'
      },
      {
        type: 'unauthorized_access',
        severity: 'medium',
        regex: /not authorized/i,
        description: 'Unauthorized access attempt detected',
        recommendation: 'Check access control policies.',
        service: 'auth'
      },
      {
        type: 'brute_force',
        severity: 'medium',
        regex: /brute force/i,
        description: 'Brute force attempt detected',
        recommendation: 'Implement rate limiting.',
        service: 'auth'
      },
      {
        type: 'failed_login',
        severity: 'low',
        regex: /Invalid credentials|failed login/i,
        description: 'Failed login attempt detected',
        recommendation: 'Monitor for suspicious activity.',
        service: 'auth'
      },
      {
        type: 'not_found_404',
        severity: 'low',
        regex: /404 Not Found: (GET|POST|PUT|DELETE)\s+\/api\/api\//i,
        description: 'Invalid API endpoint access attempt detected',
        recommendation: 'Review for probing attempts and ensure proper routing.',
        service: 'http'
      },
      {
        type: 'registration_failure',
        severity: 'low',
        regex: /(Email|Username) already exists|Registration failed/i,
        description: 'Registration attempt failed due to existing credentials',
        recommendation: 'Monitor for automated registration attempts.',
        service: 'system'
      },
      {
        type: 'log_limit_exceeded',
        severity: 'low',
        regex: /Too many log lines.*limiting to/i,
        description: 'Log file exceeds processing limit',
        recommendation: 'Optimize log rotation or increase scan limits.',
        service: 'system'
      }
    ];
    const suspiciousPatterns = [/SQL injection|XSS|CSRF|brute force|command injection|threat detection|ip blocked/i];

    try {
      logger.info(
        'Security scan running in VL mode (synthetic descriptors): running LogSQL-based regex scan via logsService.'
      );
      return await this._processLogsViaVL(logsService, {
        vulnerabilityPatterns,
        suspiciousPatterns
      });
    } catch (error) {
      // Re-throw typed VL-outage errors verbatim so the route layer's
      // 503 + `{error:'vl_unreachable', message}` contract holds
      // (mirrors `LogsService._vlOrThrow` — security-scan reads VL
      // through `logsService._getVlClient()` so the same connection-
      // class classification applies). Any other error is a real
      // program bug and propagates as 500.
      if (error && error.statusCode && error.body) throw error;
      if (LogsService && typeof LogsService._vlOrThrow === 'function') {
        try {
          LogsService._vlOrThrow(error);
        } catch (classified) {
          logger.error(`Error in processLogsInParallel (vl-outage): ${classified.message}`, {
            stack: classified.stack
          });
          throw classified;
        }
      }
      logger.error(`Error in processLogsInParallel: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  // CORRECTED: Restored original functions for backward compatibility, now implemented efficiently.
  async checkLogsForIssues(logsService) {
    logger.info('Legacy checkLogsForIssues called. Checking cache or running full scan.');
    const cached = await this.checkCachedResults();
    if (cached) return cached.vulnerabilityDetails;
    const results = await this.runSecurityScan(logsService);
    return results.vulnerabilityDetails;
  },

  /**
   * VL-mode scan — runs LogSQL substring queries against the scan
   * window via `logsService._getVlClient()`.
   *
   * For each vulnerability pattern, extract the first literal token
   * (regex source up to the first metachar) and run a LogsQL
   * `_msg:~"token"` substring query against the scan window. The
   * full regex is then re-applied to each returned row in JS so
   * regex precision is preserved — VL only acts as the fetch layer.
   *
   * @param {Object} logsService
   * @param {{vulnerabilityPatterns: Array, suspiciousPatterns: Array}} opts
   * @returns {Promise<Object>}
   */
  async _processLogsViaVL(logsService, { vulnerabilityPatterns, suspiciousPatterns }) {
    const today = DateTime.now();
    const startIso = today.minus({ days: DAYS_TO_PROCESS }).toISO();
    const endIso = today.toISO();
    const client = logsService._getVlClient ? await logsService._getVlClient() : null;
    if (!client) {
      logger.warn('_processLogsViaVL: logsService has no _getVlClient — returning empty result.');
      return {
        vulnerabilities: { critical: [], medium: [], low: [] },
        patternMatches: [],
        failedLogins: [],
        suspiciousActivities: [],
        skipped: true,
        reason: 'vl_mode_no_client'
      };
    }

    // Extract ALL literal tokens from a regex source string. VL substring
    // queries need a literal token (no metachars), so we read every
    // alphanumeric run separated by regex metachars and OR them in the
    // `_msg` clause. Capturing only the first literal missed the other
    // alternatives (e.g. `/SQL injection|XSS|CSRF/i` only scanned for
    // `SQL injection`, silently undercounting XSS and CSRF matches).
    //
    // Known limit: a 3-character floor discards the regex structure. A
    // tight pattern is widened into a loose one before it reaches VL —
    // `/IP Blocked/i` is fetched as `_msg:~"Blocked"`, and the
    // `/404 Not Found: (GET|POST|PUT|DELETE)/` pattern as an OR over
    // `_msg:~"GET" | "POST" | "PUT" | "DELETE"`, which on a web server
    // returns a thousand unrelated lines. The re-test below keeps the
    // result precise; the fetch is what over-collects. Narrowing this
    // means either hand-written LogSQL per pattern or a longer literal
    // floor, both of which change what each severity bucket counts and
    // are a product decision, not a refactor.
    const extractLiterals = (regex) => {
      const src = regex && regex.source ? regex.source : String(regex || '');
      const seen = new Set();
      for (const m of src.matchAll(/[A-Za-z0-9_][A-Za-z0-9_ .:/=+-]{2,}/g)) {
        const t = m[0].trim();
        if (t.length >= 3) seen.add(t);
      }
      return [...seen];
    };

    // Name the alternative that fired, so a hit on one branch of an
    // alternation is not reported under another branch. `regex` is
    // reused across rows, so it is cloned before `exec` to keep it
    // stateless (a `lastIndex` left behind by a global flag would skip
    // matches on the next row).
    const firstMatchOf = (regex, text) => {
      if (typeof text !== 'string' || text === '') return null;
      const m = new RegExp(regex.source, regex.flags.replace(/[gy]/g, '')).exec(text);
      return m ? m[0] : null;
    };

    const vulnerabilities = { critical: [], medium: [], low: [] };
    const suspiciousActivities = [];
    const failedLogins = [];
    const finalIssueMap = new Map();
    const patternMatches = new Map();

    // Yield to the event loop between pattern queries so health probes
    // (/api/health) and OTel SDK exporter flushes are not starved by a
    // 1-3s scan over 14 patterns. Mirrors the file-mode batch yield.
    const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

    for (const pattern of vulnerabilityPatterns) {
      await yieldEventLoop();
      const literals = extractLiterals(pattern.regex);
      if (literals.length === 0) continue;
      // OR-join the literals: `_msg:~"a" OR _msg:~"b" ...` — VL applies
      // each substring filter independently and unions results.
      const msgClause = literals.map((t) => `_msg:~"${t.replace(/"/g, '\\"')}"`).join(' OR ');
      let rows;
      try {
        rows = await client.query({
          q: msgClause,
          start: startIso,
          end: endIso,
          limit: 1000
        });
      } catch (err) {
        // A VL outage must abort the scan, not shrink its coverage.
        // Swallowing it here meant all 14 patterns could fail, the
        // result set stayed empty, and the caller still reported
        // `status: 'completed'` — a clean bill of health produced by a
        // backend that never answered a single query. Re-throw so the
        // wrapper classifies it as a VlUnavailableError and the route
        // answers 503.
        if (LogsService && typeof LogsService._isVlUnavailable === 'function' && LogsService._isVlUnavailable(err)) {
          logger.error('VL unavailable during security scan — aborting rather than reporting a partial result');
          throw err;
        }
        logger.warn(`VL scan query failed for pattern ${pattern.type}: ${err.message}`);
        continue;
      }
      if (!Array.isArray(rows) || rows.length === 0) continue;

      let matchedCount = 0;
      let lastSeen = '';
      let sample = null;
      for (const row of rows) {
        // VL `_msg` for Node services is the raw Winston JSON envelope
        // (e.g. `{"level":"info","message":"…"}`). Pull `.message` out
        // before testing the regex so the pattern runs on the same
        // string the file-path scan used.
        const raw = row.message || row._msg || '';
        let text = raw;
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.message === 'string') text = parsed.message;
          } catch {
            // Not valid JSON — keep raw as text.
          }
        }
        if (pattern.regex.test(text)) {
          matchedCount += 1;
          const ts = row._time || row.timestamp || '';
          if (sample === null) {
            sample = {
              text,
              timestamp: ts,
              service: row.service || row['service.name'] || pattern.service
            };
          }
          if (typeof ts === 'string' && ts > lastSeen) lastSeen = ts;
          // Failed-login detection: collect the matching row as a side
          // effect of the main loop (instead of re-running a separate
          // VL query + 1000-row scan — see original lines 513-551).
          if (pattern.type === 'failed_login') {
            failedLogins.push({
              timestamp: ts || new Date().toISOString(),
              level: (row.level || pattern.severity || '').toString().toUpperCase(),
              type: pattern.type,
              severity: pattern.severity,
              service: row.service || row['service.name'] || pattern.service,
              message: text
            });
          }
        }
      }

      if (matchedCount > 0) {
        // `matchedTerm` names the alternative that actually fired on
        // the rows we kept, not the longest literal in the alternation.
        // Sorting by length reported "SQL injection" for every hit of
        // `/SQL injection|XSS|CSRF/i` — the count was real, the label
        // beside it was not, and an operator who went looking for SQL
        // injection found none and concluded the panel was noise.
        const matchedTerm = firstMatchOf(pattern.regex, sample && sample.text) || literals[0];
        const key = `${pattern.type}_${pattern.service}_${matchedTerm}`;

        if (PATTERN_MATCH_TYPES.has(pattern.type)) {
          patternMatches.set(key, {
            type: pattern.type,
            pattern: matchedTerm,
            occurrences: matchedCount,
            sample: sample ? sample.text : '',
            sampleTimestamp: sample ? sample.timestamp : lastSeen,
            service: sample ? sample.service : pattern.service,
            lastSeen: lastSeen || new Date().toISOString()
          });
          continue;
        }

        finalIssueMap.set(key, {
          type: pattern.type,
          severity: pattern.severity,
          matchedTerm,
          instanceCount: matchedCount,
          lastSeen: lastSeen || new Date().toISOString(),
          timestamp: lastSeen || new Date().toISOString(),
          description: pattern.description,
          recommendation: pattern.recommendation,
          service: pattern.service
        });
      }
    }

    for (const issue of finalIssueMap.values()) {
      if (vulnerabilities[issue.severity]) {
        vulnerabilities[issue.severity].push(issue);
      }
    }

    // Suspicious patterns share the same VL path (regex over free-text).
    // Same extractLiterals + re-test approach.
    for (const re of suspiciousPatterns || []) {
      await yieldEventLoop();
      const literals = extractLiterals(re);
      if (literals.length === 0) continue;
      const msgClause = literals.map((t) => `_msg:~"${t.replace(/"/g, '\\"')}"`).join(' OR ');
      let rows;
      try {
        rows = await client.query({
          q: msgClause,
          start: startIso,
          end: endIso,
          limit: 1000
        });
      } catch (err) {
        // Same rule as the vulnerability loop: a VL outage aborts the
        // scan rather than returning a partial result dressed up as a
        // completed one.
        if (LogsService && typeof LogsService._isVlUnavailable === 'function' && LogsService._isVlUnavailable(err)) {
          logger.error('VL unavailable during security scan — aborting rather than reporting a partial result');
          throw err;
        }
        logger.warn(`VL scan query failed for suspicious term: ${err.message}`);
        continue;
      }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const raw = row.message || row._msg || '';
        let text = raw;
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.message === 'string') text = parsed.message;
          } catch {
            // keep raw as text
          }
        }
        if (re.test(text)) {
          suspiciousActivities.push({
            timestamp: row._time || row.timestamp || new Date().toISOString(),
            pattern: firstMatchOf(re, text) || literals[0],
            service: row.service || row['service.name'] || 'unknown',
            sample: text.length > 200 ? `${text.slice(0, 200)}…` : text
          });
        }
      }
    }

    return {
      vulnerabilities,
      patternMatches: [...patternMatches.values()].sort((a, b) => b.occurrences - a.occurrences),
      failedLogins: this.removeDuplicateLogEntries(failedLogins),
      suspiciousActivities: this.removeDuplicateLogEntries(suspiciousActivities),
      // Explicit `skipped: false, reason: null` — the runSecurityScan
      // destructure (`{ skipped, reason } = ...`) would otherwise
      // fall through to `skipped ? 'skipped' : 'completed'` =
      // 'completed' for both "clean scan" AND "zero data scanned",
      // making the operator toast silently green in the second case.
      // The previous shape omitted these fields.
      skipped: false,
      reason: null
    };
  },
  async checkFailedLogins(logsService) {
    logger.info('Legacy checkFailedLogins called. Checking cache or running full scan.');
    const cached = await this.checkCachedResults();
    if (cached) return cached.failedLoginDetails;
    const results = await this.runSecurityScan(logsService);
    return results.failedLoginDetails;
  },
  async checkSuspiciousActivities(logsService) {
    logger.info('Legacy checkSuspiciousActivities called. Checking cache or running full scan.');
    const cached = await this.checkCachedResults();
    if (cached) return cached.suspiciousDetails;
    const results = await this.runSecurityScan(logsService);
    return results.suspiciousDetails;
  },

  deduplicateVulnerabilities(vulnerabilities) {
    const deduplicated = { critical: [], medium: [], low: [] };
    const seen = new Set();
    for (const severity of ['critical', 'medium', 'low']) {
      for (const vuln of vulnerabilities[severity]) {
        const key = `${vuln.type}_${vuln.service}_${vuln.matchedTerm}_${vuln.timestamp}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduplicated[severity].push(vuln);
        }
      }
    }
    return deduplicated;
  },

  async getLastScanDetails() {
    try {
      console.log('Fetching last scan details');
      const scanResultsFile = '/app/data/security/last-scan-results.json';
      let scanDetails = {
        lastScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        patternMatches: [],
        patternMatchCount: 0,
        failedLoginDetails: [],
        suspiciousDetails: []
      };

      try {
        const data = await fsPromises.readFile(scanResultsFile, 'utf8');
        scanDetails = JSON.parse(data);
      } catch (error) {
        logger.warn(`No previous scan results found: ${error.message}`);
      }

      return scanDetails;
    } catch (error) {
      logger.error(`Error in getLastScanDetails: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  async scanForVulnerabilities() {
    const vulnerabilities = { critical: [], medium: [], low: [] };
    try {
      console.log('Starting HTTP header vulnerability scan');
      const response = await axios.get('http://localhost:3000', { validateStatus: () => true });
      const headers = response.headers;
      const headerChecks = [
        {
          header: 'content-security-policy',
          type: 'missing_csp',
          severity: 'medium',
          description: 'Missing Content-Security-Policy header',
          recommendation: 'Implement a strict CSP to prevent XSS attacks.'
        },
        {
          header: 'strict-transport-security',
          type: 'missing_hsts',
          severity: 'medium',
          description: 'Missing Strict-Transport-Security header',
          recommendation: 'Enable HSTS to enforce HTTPS.'
        },
        {
          header: 'x-frame-options',
          type: 'missing_frame_options',
          severity: 'medium',
          description: 'Missing X-Frame-Options header',
          recommendation: 'Set X-Frame-Options to prevent clickjacking.'
        }
      ];

      const now = DateTime.now().toISO();
      headerChecks.forEach((check) => {
        if (!headers[check.header]) {
          vulnerabilities[check.severity].push({
            type: check.type,
            severity: check.severity,
            description: check.description,
            recommendation: check.recommendation,
            matchedTerm: check.header,
            timestamp: now,
            service: 'http',
            lineNumber: 0,
            url: 'http://localhost:3000',
            firstSeen: now,
            lastSeen: now,
            instanceCount: 1,
            lineNumbers: [0]
          });
        }
      });

      console.log(
        `Detected header vulnerabilities: Critical=${vulnerabilities.critical.length}, Medium=${vulnerabilities.medium.length}, Low=${vulnerabilities.low.length}`
      );
      return vulnerabilities;
    } catch (error) {
      logger.error(`Error in scanForVulnerabilities: ${error.message}`, { stack: error.stack });
      return vulnerabilities;
    }
  },

  async checkSecurityHeaders() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios.get(fullUrl);
      const headers = response.headers;
      const missingHeaders = [];

      if (!headers['content-security-policy'])
        missingHeaders.push({
          type: 'content_security_policy_header_missing',
          severity: 'medium',
          description: 'CSP header not set, increasing risk of XSS attacks',
          recommendation: 'Implement CSP header with appropriate directives'
        });

      if (!headers['strict-transport-security'])
        missingHeaders.push({
          type: 'strict_transport_security_header_missing',
          severity: 'medium',
          description: 'HSTS header not set, increasing risk of protocol downgrade attacks',
          recommendation: 'Add Strict-Transport-Security header with appropriate max-age'
        });

      if (!headers['x-content-type-options'])
        missingHeaders.push({
          type: 'x_content_type_options_header_missing',
          severity: 'medium',
          description: 'X-Content-Type-Options header not set, increasing risk of MIME type confusion attacks',
          recommendation: 'Add X-Content-Type-Options: nosniff header'
        });

      if (!headers['x-frame-options'])
        missingHeaders.push({
          type: 'x_frame_options_header_missing',
          severity: 'medium',
          description: 'X-Frame-Options header not set, increasing risk of clickjacking attacks',
          recommendation: 'Add X-Frame-Options: SAMEORIGIN header'
        });

      if (!headers['referrer-policy'])
        missingHeaders.push({
          type: 'referrer_policy_header_missing',
          severity: 'low',
          description: 'Referrer-Policy header not set, potentially leaking referrer information',
          recommendation: 'Add Referrer-Policy: no-referrer-when-downgrade header'
        });

      console.debug(`Missing headers found: ${missingHeaders.length}`);
      return missingHeaders;
    } catch (error) {
      logger.error(`Error checking security headers: ${error.message}`);
      return [];
    }
  },

  async checkServerLeakage() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios.get(fullUrl);
      const headers = response.headers;
      const leakageIssues = [];

      if (headers['x-powered-by'])
        leakageIssues.push({
          type: 'server_leaks_x_powered_by',
          severity: 'medium',
          description: `X-Powered-By header reveals server technology: ${headers['x-powered-by']}`,
          recommendation: 'Remove X-Powered-By header in server configuration'
        });

      if (headers['server'] && headers['server'].includes('/'))
        leakageIssues.push({
          type: 'server_leaks_version',
          severity: 'medium',
          description: `Server header reveals version information: ${headers['server']}`,
          recommendation: 'Configure server to remove version information from Server header'
        });

      console.debug(`Server leakage issues found: ${leakageIssues.length}`);
      return leakageIssues;
    } catch (error) {
      logger.error(`Error checking server information leakage: ${error.message}`);
      return [];
    }
  },

  async checkTimestampDisclosure() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpointsToCheck = config.api.endpoints || ['/api/users', '/api/logs', '/api/status'];
      const disclosureIssues = [];

      for (const endpoint of endpointsToCheck) {
        try {
          const response = await axios.get(`${apiUrl}${endpoint}`);
          const responseText = JSON.stringify(response.data);
          const timestampRegex = /\b\d{10}\b/g;
          const matches = responseText.match(timestampRegex);
          if (matches && matches.length > 0) {
            disclosureIssues.push({
              type: 'timestamp_disclosure',
              severity: 'medium',
              description: `Unix timestamps exposed in ${endpoint} response`,
              count: matches.length,
              recommendation: 'Format timestamps as ISO strings or human-readable dates before sending to client'
            });
          }
        } catch (err) {
          console.debug(`Skipping timestamp check for ${endpoint}: ${err.message}`);
          continue;
        }
      }

      console.debug(`Timestamp disclosure issues found: ${disclosureIssues.length}`);
      return disclosureIssues;
    } catch (error) {
      logger.error(`Error checking timestamp disclosure: ${error.message}`);
      return [];
    }
  },

  async checkCorsConfiguration() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios({
        method: 'options',
        url: fullUrl,
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      const headers = response.headers;
      const corsIssues = [];

      if (headers['access-control-allow-origin'] === '*') {
        corsIssues.push({
          type: 'cross_domain_misconfiguration',
          severity: 'medium',
          description: 'CORS allows requests from any origin (*)',
          recommendation: 'Configure CORS to allow only specific trusted domains'
        });
      }

      console.debug(`CORS issues found: ${corsIssues.length}`);
      return corsIssues;
    } catch (error) {
      logger.error(`Error checking CORS configuration: ${error.message}`);
      return [];
    }
  },

  async checkHiddenFiles() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const hiddenFiles = [
        '/.env',
        '/.git/config',
        '/.gitignore',
        '/.npmrc',
        '/node_modules/.package-lock.json',
        '/.well-known/security.txt',
        '/.well-known/appspecific/com.chrome.devtools.json'
      ];
      const foundFiles = [];

      for (const file of hiddenFiles) {
        try {
          const response = await axios.get(`${apiUrl}${file}`);
          if (response.status !== 404) {
            foundFiles.push({
              type: 'hidden_file_found',
              severity: 'medium',
              description: `Hidden file accessible: ${file}`,
              recommendation: 'Block access to hidden files and development artifacts'
            });
          }
        } catch (err) {
          if (err.response && err.response.status !== 404) {
            foundFiles.push({
              type: 'potential_hidden_file',
              severity: 'low',
              description: `Unusual response for hidden file: ${file} (${err.response?.status})`,
              recommendation: 'Verify server configuration for handling hidden files'
            });
          }
        }
      }

      console.debug(`Hidden file issues found: ${foundFiles.length}`);
      return foundFiles;
    } catch (error) {
      logger.error(`Error checking hidden files: ${error.message}`);
      return [];
    }
  },

  removeDuplicateLogEntries(logEntries) {
    const seen = new Set();
    logEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return logEntries.filter((entry) => {
      const key = `${entry.timestamp}|${entry.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  async loginIssues(logsService) {
    if (!logsService) throw new Error('LogsService is required for loginIssues');
    try {
      const loginKeywords = [
        'login',
        'failed',
        'unauthorized',
        'disabled',
        'expired',
        'invalid',
        'access denied',
        'account'
      ];
      const suspiciousKeywords = [
        'suspicious',
        'brute force',
        'injection',
        'attack',
        'breach',
        'security',
        'vulnerability',
        'exploit',
        'ip blocked',
        'threat detection'
      ];
      const allKeywords = [...new Set([...loginKeywords, ...suspiciousKeywords])];
      console.debug(`Checking logs with keywords: ${allKeywords.join(', ')}`);

      const loginIssues = [];
      const suspiciousIssues = [];

      const today = new Date();
      const daysAgo = new Date(today);
      daysAgo.setDate(today.getDate() - DAYS_TO_PROCESS);

      try {
        const results = await logsService.searchLogs({
          term: allKeywords.join('|'),
          dateRange: 'custom',
          startDate: daysAgo.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
          includeArchived: true
        });
        console.debug(`Found ${results.logs?.length || 0} logs matching keywords`);

        if (results.logs && results.logs.length > 0) {
          for (const log of results.logs) {
            const messageLower = log.message.toLowerCase();
            const timestamp = `${log.date} ${log.time}`;
            const loginMatch = loginKeywords.find((keyword) => messageLower.includes(keyword.toLowerCase()));
            const suspiciousMatch = suspiciousKeywords.find((keyword) => messageLower.includes(keyword.toLowerCase()));

            if (loginMatch) {
              loginIssues.push({
                timestamp,
                level: log.level,
                message: log.message,
                service: log.service,
                type: 'authentication_issue',
                matchedTerm: loginMatch
              });
            }

            if (suspiciousMatch && !loginMatch) {
              suspiciousIssues.push({
                timestamp,
                level: log.level,
                message: log.message,
                service: log.service,
                type: 'suspicious',
                matchedTerm: suspiciousMatch
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Error searching logs: ${error.message}`, { stack: error.stack });
      }

      const uniqueLoginIssues = this.removeDuplicateLogEntries(loginIssues);
      const uniqueSuspiciousIssues = this.removeDuplicateLogEntries(suspiciousIssues);

      return {
        loginIssues: { count: uniqueLoginIssues.length, details: uniqueLoginIssues },
        suspiciousActivities: { count: uniqueSuspiciousIssues.length, details: uniqueSuspiciousIssues }
      };
    } catch (error) {
      logger.error(`Error checking logs: ${error.message}`, { stack: error.stack });
      return {
        loginIssues: { count: 0, details: [] },
        suspiciousActivities: { count: 0, details: [] }
      };
    }
  },

  generateRecommendations(loginIssues, suspiciousActivities, vulnerabilities) {
    const recommendations = [];

    if (loginIssues.count > 0) {
      const disabledAccountCount = loginIssues.details.filter((issue) => issue.message.includes('disabled')).length;
      if (disabledAccountCount > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Review Disabled Accounts',
          description: `${disabledAccountCount} login attempts to disabled accounts detected`,
          action: 'Review account status in user management and verify if account disabling is legitimate'
        });
      }
      recommendations.push({
        severity: 'medium',
        title: 'Improve Authentication Security',
        description: `${loginIssues.count} authentication issues detected`,
        action: 'Consider implementing account lockout policies and multi-factor authentication'
      });
    }

    if (vulnerabilities.critical.length > 0) {
      recommendations.push({
        severity: 'critical',
        title: 'Fix Critical Server Errors',
        description: `${vulnerabilities.critical.length} critical server errors detected`,
        action:
          'Investigate and fix server errors immediately to prevent service disruption and potential security breaches'
      });
    }

    if (vulnerabilities.medium.length > 0) {
      const sensitiveFileAccess = vulnerabilities.medium.filter((v) => v.type === 'sensitive_file_access');
      if (sensitiveFileAccess.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Secure Sensitive File Access',
          description: `${sensitiveFileAccess.length} attempts to access sensitive files detected`,
          action:
            'Ensure .env, .git, and other sensitive files are not exposed; implement stricter access controls and consider IP blocking for repeated attempts'
        });
      }

      const dbIssues = vulnerabilities.medium.filter((v) => v.type.includes('database') || v.type === 'db_error');
      if (dbIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Resolve Database Issues',
          description: `${dbIssues.length} database-related issues detected`,
          action: 'Review database configuration, connections, and query handling'
        });
      }

      const jwtIssues = vulnerabilities.medium.filter((v) => v.type.includes('jwt') || v.type === 'token_issue');
      if (jwtIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix Authentication Token Issues',
          description: 'JWT token verification failures detected',
          action: 'Review token expiration settings and refresh token implementation'
        });
      }

      const headerIssues = vulnerabilities.medium.filter((v) => v.type.includes('header'));
      if (headerIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Implement Security Headers',
          description: `${headerIssues.length} missing security headers detected`,
          action: 'Configure server to add proper security headers for all responses'
        });
      }

      const leakageIssues = vulnerabilities.medium.filter(
        (v) => v.type.includes('leaks') || v.type.includes('disclosure')
      );
      if (leakageIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Prevent Information Leakage',
          description: `${leakageIssues.length} instances of information leakage detected`,
          action: 'Configure server to prevent leaking version information and hide internal details'
        });
      }

      const corsIssues = vulnerabilities.medium.filter((v) => v.type.includes('cross_domain'));
      if (corsIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix CORS Configuration',
          description: 'Cross-Origin Resource Sharing (CORS) is too permissive',
          action: 'Restrict CORS to only allow trusted domains instead of wildcard (*) origin'
        });
      }

      const ipBlockedIssues = vulnerabilities.medium.filter((v) => v.type === 'ip_blocked');
      if (ipBlockedIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Review IP Blocking Events',
          description: `${ipBlockedIssues.length} IP blocking events detected`,
          action: 'Investigate blocked IPs for malicious activity and review rate limiting policies'
        });
      }

      const authFailureIssues = vulnerabilities.medium.filter((v) => v.type === 'auth_failure_401');
      if (authFailureIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Address Unauthorized Access Attempts',
          description: `${authFailureIssues.length} 401 unauthorized access attempts detected`,
          action: 'Enhance authentication mechanisms and monitor for brute force attacks'
        });
      }
    }

    if (vulnerabilities.low.length > 0) {
      const nonCriticalFileAccess = vulnerabilities.low.filter((v) => v.type === 'non_critical_file_access');
      if (nonCriticalFileAccess.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Review Non-Critical File Access',
          description: `${nonCriticalFileAccess.length} attempts to access non-critical configuration files detected`,
          action: 'Verify if these files need to be publicly accessible or should be blocked'
        });
      }

      const missingResources = vulnerabilities.low.filter(
        (v) => v.type === 'missing_resource' || v.type === 'not_found_404'
      );
      if (missingResources.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Fix Missing Resources',
          description: `${missingResources.length} endpoints returning 404 errors`,
          action: 'Update application to remove references to non-existent endpoints or implement the missing resources'
        });
      }

      const registrationIssues = vulnerabilities.low.filter((v) => v.type === 'registration_failure');
      if (registrationIssues.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Monitor Registration Attempts',
          description: `${registrationIssues.length} failed registration attempts detected`,
          action: 'Implement CAPTCHA or rate limiting to prevent automated registration abuse'
        });
      }

      const logLimitIssues = vulnerabilities.low.filter((v) => v.type === 'log_limit_exceeded');
      if (logLimitIssues.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Optimize Log Processing',
          description: `${logLimitIssues.length} log files exceeded processing limits`,
          action: 'Adjust log rotation policies or increase scan capacity'
        });
      }
    }

    recommendations.push({
      severity: 'low',
      title: 'Regular Security Maintenance',
      description: 'Proactive security measures',
      action: 'Implement regular security audits, keep dependencies updated, and consider penetration testing'
    });

    console.debug(`Generated recommendations: ${recommendations.length}`);
    return recommendations;
  },

  async saveScanResults(results) {
    logger.info('*** SAVE_SCAN_RESULTS_START ***');
    try {
      const dataDir = '/app/data/security';
      const resultsPath = path.join(dataDir, 'last-scan-results.json');
      console.log(`Saving scan results to directory: ${dataDir}, file: ${resultsPath}`);
      await fsPromises.mkdir(dataDir, { recursive: true });
      await fsPromises.writeFile(resultsPath, JSON.stringify(results, null, 2), { mode: 0o666 });
      logger.info(`Security scan results saved successfully to ${resultsPath}`);
    } catch (error) {
      logger.error(`Error saving scan results: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
};

module.exports = securityScanService;
