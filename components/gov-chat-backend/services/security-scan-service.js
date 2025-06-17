const fs = require('fs');
const path = require('path');
const { logger } = require('../shared-lib');
const { DateTime } = require('luxon');
const axios = require('axios');
const config = require('../config');
const readline = require('readline');
const zlib = require('zlib');

/**
 * Service for handling security scans and related operations
 */
const securityScanService = {
  /**
   * Run a comprehensive security scan
   * @param {Object} logsService - Instance of LogsService
   * @returns {Promise<Object>} Security scan results
   */
  async runSecurityScan(logsService) {
    try {
      logger.info('Running security scan');
      const vulnerabilities = await this.checkLogsForIssues(logsService);
      const failedLogins = await this.checkFailedLogins(logsService);
      const suspiciousActivities = await this.checkSuspiciousActivities(logsService);

      const scanResult = {
        scanTime: new Date().toISOString(),
        vulnerabilities: {
          critical: vulnerabilities.critical.length,
          medium: vulnerabilities.medium.length,
          low: vulnerabilities.low.length,
          details: [...vulnerabilities.critical, ...vulnerabilities.medium, ...vulnerabilities.low]
        },
        vulnerabilityDetails: vulnerabilities,
        failedLoginDetails: failedLogins,
        suspiciousDetails: suspiciousActivities,
        status: 'completed',
        message: 'Security scan completed successfully'
      };

      await fs.promises.writeFile('/app/data/security/last-scan-results.json', JSON.stringify(scanResult));
      logger.info('Security scan completed successfully');
      return scanResult;
    } catch (error) {
      logger.error(`Error in runSecurityScan: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Deduplicate vulnerabilities across all checks
   * @param {Object} vulnerabilities - Object with critical, medium, low arrays
   * @returns {Object} Deduplicated vulnerabilities
   */
  deduplicateVulnerabilities(vulnerabilities) {
    const deduplicated = { critical: [], medium: [], low: [] };
    const seen = new Set();

    for (const severity of ['critical', 'medium', 'low']) {
      for (const vuln of vulnerabilities[severity]) {
        // Include timestamp in key to avoid merging distinct events
        const key = `${vuln.type}_${vuln.service}_${vuln.matchedTerm}_${vuln.firstSeen}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduplicated[severity].push(vuln);
        }
      }
    }

    return deduplicated;
  },

  /**
   * Consolidated log search for failed logins and suspicious activities
   * @param {Object} logsService - Instance of LogsService
   * @returns {Promise<Object>} Login issues and suspicious activities
   */
  async checkLogsForIssues(logsService) {
    if (!logsService) {
      throw new Error('LogsService is required for checkLogsForIssues');
    }

    const today = DateTime.now();
    const startDate = today.minus({ days: 2 }).toFormat('yyyy-MM-dd');
    const endDate = today.toFormat('yyyy-MM-dd');
    const vulnerabilities = { critical: [], medium: [], low: [] };
    const issueMap = new Map();
    const maxVulnerabilitiesPerSeverity = 50;
    const maxFiles = 5;
    const maxLinesPerFile = 50000; // Increased to reduce skipped lines
    const maxFileSizeBytes = 50 * 1024 * 1024;
    const vulnerabilityPatterns = [
      { type: 'token_issue', severity: 'critical', regex: /invalid token/i, description: 'Invalid or expired token usage detected', recommendation: 'Review token expiration policies.', service: 'auth' },
      { type: 'attack_attempt', severity: 'critical', regex: /SQL injection|XSS|CSRF/i, description: 'Potential attack attempt detected', recommendation: 'Implement WAF and input sanitization.', service: 'http' },
      { type: 'sensitive_file_access', severity: 'critical', regex: /SECURITY: Blocked access to sensitive path.*\.env/i, description: 'Attempt to access .env file detected', recommendation: 'Ensure sensitive files are not web-accessible.', service: 'http' },
      { type: 'sensitive_file_access', severity: 'medium', regex: /SECURITY: Blocked access to sensitive path.*\.git/i, description: 'Attempt to access .git directory detected', recommendation: 'Secure .git directories from web access.', service: 'http' },
      { type: 'sensitive_file_access', severity: 'medium', regex: /SECURITY: Blocked access to sensitive path/i, description: 'Attempt to access sensitive path detected', recommendation: 'Review server configuration to block sensitive paths.', service: 'http' },
      { type: 'unauthorized_access', severity: 'medium', regex: /not authorized/i, description: 'Unauthorized access attempt detected', recommendation: 'Check access control policies.', service: 'auth' },
      { type: 'brute_force', severity: 'medium', regex: /brute force/i, description: 'Brute force attempt detected', recommendation: 'Implement rate limiting.', service: 'auth' },
      { type: 'failed_login', severity: 'low', regex: /Invalid credentials|failed login/i, description: 'Failed login attempt detected', recommendation: 'Monitor for suspicious activity.', service: 'auth' },
    ];

    const invalidLogFile = path.join('/app/logs', `invalid-log-formats-${DateTime.now().toFormat('yyyy-MM-dd-HH-mm-ss')}.log`);
    const invalidLogStream = fs.createWriteStream(invalidLogFile, { flags: 'a' });

    try {
      logger.info(`Starting log scan for period ${startDate} to ${endDate}`);
      const logFiles = (await logsService.getLogFilesInRange(startDate, endDate, true)).slice(0, maxFiles);
      logger.info(`Found ${logFiles.length} log files to scan`);

      let totalLinesProcessed = 0;
      let totalLinesSkipped = 0;

      for (const file of logFiles) {
        if (vulnerabilities.critical.length >= maxVulnerabilitiesPerSeverity &&
          vulnerabilities.medium.length >= maxVulnerabilitiesPerSeverity &&
          vulnerabilities.low.length >= maxVulnerabilitiesPerSeverity) {
          logger.warn(`Reached max vulnerabilities limit, stopping scan`);
          break;
        }

        const stats = fs.statSync(file);
        logger.debug(`File ${file} size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        if (stats.size > maxFileSizeBytes) {
          logger.warn(`Skipping ${file}: File size (${stats.size} bytes) exceeds limit (${maxFileSizeBytes} bytes)`);
          continue;
        }

        logger.debug(`Processing file: ${file}`);
        let stream;
        try {
          stream = fs.createReadStream(file);
          if (file.endsWith('.gz')) {
            const gunzip = zlib.createGunzip();
            stream.pipe(gunzip);
            stream = gunzip;
            stream.on('error', (err) => {
              logger.warn(`Error decompressing ${file}: ${err.message}`);
              invalidLogStream.write(`[${DateTime.now().toISO()}] Error decompressing ${file}: ${err.message}\n`);
            });
          }
        } catch (err) {
          logger.warn(`Error opening ${file}: ${err.message}`);
          invalidLogStream.write(`[${DateTime.now().toISO()}] Error opening ${file}: ${err.message}\n`);
          continue;
        }

        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('error', (err) => {
          logger.warn(`Error reading ${file}: ${err.message}`);
          invalidLogStream.write(`[${DateTime.now().toISO()}] Error reading ${file}: ${err.message}\n`);
        });

        let lineNumber = 0;
        try {
          for await (const line of rl) {
            lineNumber++;
            totalLinesProcessed++;
            if (lineNumber > maxLinesPerFile) {
              logger.warn(`Reached line limit (${maxLinesPerFile}) for ${file}, stopping processing`);
              totalLinesSkipped += 1; // Avoid hardcoded assumption
              break;
            }

            // Primary log format: 2023-06-15 12:34:56 [LEVEL] message
            let match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[(\w+)\](?::\s*|\s+)(.+)$/);
            let timestamp, message, date, time;

            if (!match) {
              // Fallback parser for morgan format: GET /path 404 12.34 ms - Headers: ...
              const morganMatch = line.match(/^(GET|POST|PUT|DELETE|OPTIONS)\s+([^\s]+)\s+(\d{3})\s+([\d.]+)\s+ms\s+-\s+Headers:\s+([^\s]+)\s+(.+)$/i);
              if (morganMatch) {
                const [, method, path, status, responseTime, contentType, userAgent] = morganMatch;
                date = today.toFormat('yyyy-MM-dd');
                time = today.toFormat('HH:mm:ss');
                timestamp = DateTime.now().toISO(); // Approximate timestamp
                message = `${method} ${path} ${status} ${responseTime}ms Headers: ${contentType} ${userAgent}`;
              } else {
                // Log invalid format with full line for debugging
                invalidLogStream.write(`[${DateTime.now().toISO()}] Invalid log format in ${file} at line ${lineNumber}: ${line}\n`);
                totalLinesSkipped++;
                continue;
              }
            } else {
              [, date, time, , message] = match;
              timestamp = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm:ss').toISO() || DateTime.now().toISO();
            }

            const urlMatch = message.match(/https?:\/\/[^\s]+|(GET|POST|PUT|DELETE) ([^\s]+)/i);
            const url = urlMatch ? (urlMatch[2] || urlMatch[0]) : 'N/A';

            if (/Initiating security scan|Starting comprehensive security scan|Parsed \d+ total log entries|Security scan completed/i.test(message)) {
              totalLinesSkipped++;
              continue;
            }

            vulnerabilityPatterns.forEach(pattern => {
              if (vulnerabilities[pattern.severity].length >= maxVulnerabilitiesPerSeverity) return;

              const match = message.match(pattern.regex);
              if (match) {
                const matchedTerm = match[0] || 'unknown';
                const key = `${pattern.type}_${date}_${pattern.service}_${matchedTerm}`;
                if (issueMap.has(key)) {
                  const issue = issueMap.get(key);
                  issue.instanceCount++;
                  issue.lastSeen = timestamp; // Update to log timestamp
                  issue.lineNumbers.push(lineNumber);
                } else {
                  const issue = {
                    type: pattern.type,
                    severity: pattern.severity,
                    description: pattern.description,
                    recommendation: pattern.recommendation,
                    matchedTerm,
                    timestamp,
                    service: pattern.service,
                    url,
                    firstSeen: timestamp, // Set to log timestamp
                    lastSeen: timestamp, // Set to log timestamp
                    instanceCount: 1,
                    lineNumbers: [lineNumber],
                  };
                  issueMap.set(key, issue);
                  vulnerabilities[pattern.severity].push(issue);
                }
              }
            });

            if (lineNumber % 1000 === 0) {
              const mem = process.memoryUsage();
              logger.debug(`Memory usage for ${file} at line ${lineNumber}: RSS=${(mem.rss / 1024 / 1024).toFixed(2)}MB, Heap=${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB`);
            }
          }
        } catch (err) {
          logger.warn(`Error processing ${file}: ${err.message}`);
          invalidLogStream.write(`[${DateTime.now().toISO()}] Error processing ${file}: ${err.message}\n`);
        } finally {
          rl.close();
          issueMap.clear();
          global.gc && global.gc();
        }
        logger.info(`Finished processing ${file}: ${lineNumber} lines processed, ${totalLinesSkipped} lines skipped`);
      }

      logger.info(`Total lines processed: ${totalLinesProcessed}, Total lines skipped: ${totalLinesSkipped}`);
      const deduplicated = this.deduplicateVulnerabilities(vulnerabilities);
      logger.info(`Detected vulnerabilities: Critical=${deduplicated.critical.length}, Medium=${deduplicated.medium.length}, Low=${deduplicated.low.length}`);
      return deduplicated;
    } catch (error) {
      logger.error(`Error in checkLogsForIssues: ${error.message}`, { stack: error.stack });
      throw error;
    } finally {
      invalidLogStream.end();
    }
  },

  /**
   * Get details about the last security scan
   * @returns {Promise<Object>} Last scan details
   */
  async getLastScanDetails() {
    try {
      logger.info('Fetching last scan details');
      const scanResultsFile = '/app/data/security/last-scan-results.json';
      let scanDetails = {
        lastScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [],
        suspiciousDetails: []
      };

      try {
        const data = await fs.promises.readFile(scanResultsFile, 'utf8');
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

  /**
   * Check for failed login attempts in the logs
   * @param {Object} logsService - Instance of LogsService
   * @returns {Promise<Object>} Count and details of failed login attempts
   */
  async checkFailedLogins(logsService) {
    if (!logsService) {
      throw new Error('LogsService is required for checkFailedLogins');
    }

    const today = DateTime.now();
    const startDate = today.minus({ days: 2 }).toFormat('yyyy-MM-dd');
    const endDate = today.toFormat('yyyy-MM-dd');
    const failedLogins = [];
    const maxFiles = 5;
    const maxLinesPerFile = 50000;
    const maxFileSizeBytes = 50 * 1024 * 1024;

    try {
      logger.info(`Checking failed logins for period ${startDate} to ${endDate}`);
      const logFiles = (await logsService.getLogFilesInRange(startDate, endDate, true)).slice(0, maxFiles);
      logger.info(`Found ${logFiles.length} log files for failed logins`);

      for (const file of logFiles) {
        const stats = fs.statSync(file);
        if (stats.size > maxFileSizeBytes) {
          logger.warn(`Skipping ${file}: File size (${stats.size} bytes) exceeds limit (${maxFileSizeBytes} bytes)`);
          continue;
        }

        let stream = fs.createReadStream(file);
        if (file.endsWith('.gz')) {
          const gunzip = zlib.createGunzip();
          stream.pipe(gunzip);
          stream = gunzip;
        }

        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let lineNumber = 0;

        try {
          for await (const line of rl) {
            lineNumber++;
            if (lineNumber > maxLinesPerFile) {
              logger.warn(`Reached line limit (${maxLinesPerFile}) for ${file}`);
              break;
            }

            const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[(\w+)\](?::\s*|\s+)(.+)$/);
            if (!match) continue;

            const [, date, time, , message] = match;
            const timestamp = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm:ss').toISO();
            if (/Invalid credentials|failed login/i.test(message)) {
              failedLogins.push({ timestamp, message });
            }
          }
        } finally {
          rl.close();
        }
      }

      logger.info(`Found ${failedLogins.length} failed login attempts`);
      return failedLogins;
    } catch (error) {
      logger.error(`Error in checkFailedLogins: ${error.message}`, { stack: error.stack });
      return [];
    }
  },

  /**
   * Check for suspicious activities in the logs
   * @param {Object} logsService - Instance of LogsService
   * @returns {Promise<Object>} Count and details of suspicious activities
   */
  async checkSuspiciousActivities(logsService) {
    if (!logsService) {
      throw new Error('LogsService is required for checkSuspiciousActivities');
    }

    const today = DateTime.now();
    const startDate = today.minus({ days: 2 }).toFormat('yyyy-MM-dd');
    const endDate = today.toFormat('yyyy-MM-dd');
    const suspiciousActivities = [];
    const maxFiles = 5;
    const maxLinesPerFile = 50000;
    const maxFileSizeBytes = 50 * 1024 * 1024;

    try {
      logger.info(`Checking suspicious activities for period ${startDate} to ${endDate}`);
      const logFiles = (await logsService.getLogFilesInRange(startDate, endDate, true)).slice(0, maxFiles);
      logger.info(`Found ${logFiles.length} log files for suspicious activities`);

      for (const file of logFiles) {
        const stats = fs.statSync(file);
        if (stats.size > maxFileSizeBytes) {
          logger.warn(`Skipping ${file}: File size (${stats.size} bytes) exceeds limit (${maxFileSizeBytes} bytes)`);
          continue;
        }

        let stream = fs.createReadStream(file);
        if (file.endsWith('.gz')) {
          const gunzip = zlib.createGunzip();
          stream.pipe(gunzip);
          stream = gunzip;
        }

        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let lineNumber = 0;

        try {
          for await (const line of rl) {
            lineNumber++;
            if (lineNumber > maxLinesPerFile) {
              logger.warn(`Reached line limit (${maxLinesPerFile}) for ${file}`);
              break;
            }

            const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[(\w+)\](?::\s*|\s+)(.+)$/);
            if (!match) continue;

            const [, date, time, , message] = match;
            const timestamp = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm:ss').toISO();
            if (/SQL injection|XSS|CSRF|brute force/i.test(message)) {
              suspiciousActivities.push({ timestamp, message });
            }
          }
        } finally {
          rl.close();
        }
      }

      logger.info(`Found ${suspiciousActivities.length} suspicious activities`);
      return suspiciousActivities;
    } catch (error) {
      logger.error(`Error in checkSuspiciousActivities: ${error.message}`, { stack: error.stack });
      return [];
    }
  },

  /**
   * Scan for system vulnerabilities
   * @returns {Promise<Object>} Detailed vulnerability findings by severity
   */
  async scanForVulnerabilities() {
    const vulnerabilities = { critical: [], medium: [], low: [] };

    try {
      logger.info('Starting HTTP header vulnerability scan');
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
      headerChecks.forEach(check => {
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

      logger.info(`Detected header vulnerabilities: Critical=${vulnerabilities.critical.length}, Medium=${vulnerabilities.medium.length}, Low=${vulnerabilities.low.length}`);
      return vulnerabilities;
    } catch (error) {
      logger.error(`Error in scanForVulnerabilities: ${error.message}`, { stack: error.stack });
      return vulnerabilities;
    }
  },

  /**
   * Check for missing security headers
   * @returns {Promise<Array>} Array of security header issues
   */
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

      logger.debug(`Missing headers found: ${missingHeaders.length}`);
      return missingHeaders;
    } catch (error) {
      logger.error(`Error checking security headers: ${error.message}`);
      return [];
    }
  },

  /**
   * Check for server information leakage
   * @returns {Promise<Array>} Array of server information leakage issues
   */
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

      logger.debug(`Server leakage issues found: ${leakageIssues.length}`);
      return leakageIssues;
    } catch (error) {
      logger.error(`Error checking server information leakage: ${error.message}`);
      return [];
    }
  },

  /**
   * Check for timestamp disclosure in API responses
   * @returns {Promise<Array>} Array of timestamp disclosure issues
   */
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
          logger.debug(`Skipping timestamp check for ${endpoint}: ${err.message}`);
          continue;
        }
      }

      logger.debug(`Timestamp disclosure issues found: ${disclosureIssues.length}`);
      return disclosureIssues;
    } catch (error) {
      logger.error(`Error checking timestamp disclosure: ${error.message}`);
      return [];
    }
  },

  /**
   * Check for CORS misconfiguration
   * @returns {Promise<Array>} Array of CORS misconfiguration issues
   */
  async checkCorsConfiguration() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      const response = await axios({
        method: 'options',
        url: fullUrl,
        headers: {
          'Origin': 'https://example.com',
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

      logger.debug(`CORS issues found: ${corsIssues.length}`);
      return corsIssues;
    } catch (error) {
      logger.error(`Error checking CORS configuration: ${error.message}`);
      return [];
    }
  },

  /**
   * Check for accessible hidden files
   * @returns {Promise<Array>} Array of hidden file issues
   */
  async checkHiddenFiles() {
    try {
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const hiddenFiles = ['/.env', '/.git/config', '/.gitignore', '/.npmrc', '/node_modules/.package-lock.json'];
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

      logger.debug(`Hidden file issues found: ${foundFiles.length}`);
      return foundFiles;
    } catch (error) {
      logger.error(`Error checking hidden files: ${error.message}`);
      return [];
    }
  },

  /**
   * Remove duplicate log entries based on timestamp and message
   * @param {Array} logEntries - Array of log entries
   * @returns {Array} Deduplicated log entries
   */
  removeDuplicateLogEntries(logEntries) {
    const seen = new Set();
    logEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return logEntries.filter(entry => {
      const key = `${entry.timestamp}|${entry.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  /**
   * Consolidated log search for failed logins and suspicious activities
   * @param {Object} logsService - Instance of LogsService
   * @returns {Promise<Object>} Login issues array
   */
  async loginIssues(logsService) {
    if (!logsService) {
      throw new Error('LogsService is required for loginIssues');
    }
    try {
      const loginKeywords = [
        'login', 'failed', 'unauthorized', 'disabled', 'expired', 'invalid', 'access denied', 'account'
      ];
      const suspiciousKeywords = [
        'suspicious', 'brute force', 'injection', 'attack', 'breach', 'security', 'vulnerability', 'exploit'
      ];
      const allKeywords = [...new Set([...loginKeywords, ...suspiciousKeywords])];
      logger.debug(`Checking logs with keywords: ${allKeywords.join(', ')}`);

      let loginIssues = [];
      let suspiciousIssues = [];

      const today = new Date();
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(today.getDate() - 3);

      try {
        const results = await logsService.searchLogs({
          term: allKeywords.join('|'),
          dateRange: 'custom',
          startDate: threeDaysAgo.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
          includeArchived: true
        });
        logger.debug(`Found ${results.logs?.length || 0} logs matching keywords`);

        if (results.logs && results.logs.length > 0) {
          for (const log of results.logs) {
            const messageLower = log.message.toLowerCase();
            const timestamp = `${log.date} ${log.time}`;
            const loginMatch = loginKeywords.find(keyword => messageLower.includes(keyword.toLowerCase()));
            const suspiciousMatch = suspiciousKeywords.find(keyword => messageLower.includes(keyword.toLowerCase()));

            if (loginMatch) {
              loginIssues.push({
                timestamp,
                level: log.level,
                message: log.message,
                service: log.service,
                type: 'authentication_issue',
                matchedTerm: loginMatch
              });
              logger.debug(`Added login issue: ${log.message}`);
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
              logger.debug(`Added suspicious issue: ${log.message}`);
            }
          }
        }
      } catch (error) {
        logger.error(`Error searching logs: ${error.message}`, { stack: error.stack });
      }

      const uniqueLoginIssues = this.removeDuplicateLogEntries(loginIssues);
      const uniqueSuspiciousIssues = this.removeDuplicateLogEntries(suspiciousIssues);
      logger.debug(`Unique login issues: ${uniqueLoginIssues.length}`, JSON.stringify(uniqueLoginIssues, null, 2));
      logger.debug(`Unique suspicious activities: ${uniqueSuspiciousIssues.length}`, JSON.stringify(uniqueSuspiciousIssues, null, 2));

      return {
        loginIssues: {
          count: uniqueLoginIssues.length,
          details: uniqueLoginIssues
        },
        suspiciousActivities: {
          count: uniqueSuspiciousIssues.length,
          details: uniqueSuspiciousIssues
        }
      };
    } catch (error) {
      logger.error(`Error checking logs: ${error.message}`, { stack: error.stack });
      return {
        loginIssues: { count: 0, details: [] },
        suspiciousActivities: { count: 0, details: [] }
      };
    }
  },

  /**
   * Generate security recommendations based on scan results
   * @param {Object} loginIssues - Failed login attempts details
   * @param {Object} suspiciousActivities - Suspicious activity details
   * @param {Object} vulnerabilities - Vulnerability details by severity
   * @returns {Array<Object>} List of recommendations with severity and details
   */
  generateRecommendations(loginIssues, suspiciousActivities, vulnerabilities) {
    const recommendations = [];

    if (loginIssues.count > 0) {
      const disabledAccountCount = loginIssues.details.filter(
        issue => issue.message.includes('disabled')
      ).length;

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
        action: 'Investigate and fix server errors immediately to prevent service disruption and potential security breaches'
      });
    }

    if (vulnerabilities.medium.length > 0) {
      const dbIssues = vulnerabilities.medium.filter(v => v.type.includes('database'));
      if (dbIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Resolve Database Issues',
          description: `${dbIssues.length} database-related issues detected`,
          action: 'Review database configuration, connections, and query handling'
        });
      }

      const jwtIssues = vulnerabilities.medium.filter(v => v.type.includes('jwt'));
      if (jwtIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix Authentication Token Issues',
          description: 'JWT token verification failures detected',
          action: 'Review token expiration settings and refresh token implementation'
        });
      }

      const headerIssues = vulnerabilities.medium.filter(v => v.type.includes('header'));
      if (headerIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Implement Security Headers',
          description: `${headerIssues.length} missing security headers detected`,
          action: 'Configure server to add proper security headers for all responses'
        });
      }

      const leakageIssues = vulnerabilities.medium.filter(v => v.type.includes('leaks') || v.type.includes('disclosure'));
      if (leakageIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Prevent Information Leakage',
          description: `${leakageIssues.length} instances of information leakage detected`,
          action: 'Configure server to prevent leaking version information and hide internal details'
        });
      }

      const corsIssues = vulnerabilities.medium.filter(v => v.type.includes('cross_domain'));
      if (corsIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix CORS Configuration',
          description: 'Cross-Origin Resource Sharing (CORS) is too permissive',
          action: 'Restrict CORS to only allow trusted domains instead of wildcard (*) origin'
        });
      }

      const securityProbes = vulnerabilities.medium.filter(v => v.type === 'security_probe_attempt');
      if (securityProbes.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Security Probe Attempts Detected',
          description: `${securityProbes.length} attempts to access sensitive files or endpoints detected`,
          action: 'Consider implementing rate limiting, IP blocking for persistent offenders, and ensure proper server hardening is in place'
        });

        const envProbes = securityProbes.filter(p => p.description.includes('.env'));
        const gitProbes = securityProbes.filter(p => p.description.includes('.git'));
        if (envProbes.length > 0) {
          recommendations.push({
            severity: 'medium',
            title: 'Environment File Access Attempts',
            description: `${envProbes.length} attempts to access .env files detected`,
            action: 'Ensure environment files are not accessible from web directories and server configurations properly block access to sensitive files'
          });
        }
        if (gitProbes.length > 0) {
          recommendations.push({
            severity: 'medium',
            title: 'Git Repository Access Attempts',
            description: `${gitProbes.length} attempts to access Git repository files detected`,
            action: 'Make sure .git directories are properly secured and not accessible from the web'
          });
        }
      }
    }

    if (vulnerabilities.low.length > 0) {
      const missingResources = vulnerabilities.low.filter(v => v.type === 'missing_resource');
      if (missingResources.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Fix Missing Resources',
          description: `${missingResources.length} endpoints returning 404 errors`,
          action: 'Update application to remove references to non-existent endpoints or implement the missing resources'
        });
      }
    }

    recommendations.push({
      severity: 'low',
      title: 'Regular Security Maintenance',
      description: 'Proactive security measures',
      action: 'Implement regular security audits, keep dependencies updated, and consider penetration testing'
    });

    logger.debug(`Generated recommendations: ${recommendations.length}`);
    return recommendations;
  },

  /**
   * Save scan results to storage
   * @param {Object} results - Scan results to save
   * @returns {Promise<void>}
   */
  async saveScanResults(results) {
    console.log('*** SAVE_SCAN_RESULTS_CALLED ***');
    logger.info('*** SAVE_SCAN_RESULTS_START ***');
    try {
      const dataDir = '/app/data/security';
      const resultsPath = '/app/data/security/last-scan-results.json';
      logger.info(`Saving scan results to directory: ${dataDir}, file: ${resultsPath}`);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), { mode: 0o666 });
      logger.info(`Security scan results saved to ${resultsPath}`);
    } catch (error) {
      logger.error(`Error saving scan results: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
};

module.exports = securityScanService;