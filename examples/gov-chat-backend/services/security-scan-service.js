// src/services/securityScanService.js - with critical display and date fixes
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../logger');
const logsService = require('./logs-service');
const axios = require('axios');
const config = require('../config'); // Assume config has API endpoints and base URLs

/**
 * Service for handling security scans and related operations
 */
const securityScanService = {
  /**
   * Run a comprehensive security scan
   * @returns {Promise<Object>} Security scan results
   */
  async runSecurityScan() {
    try {
      logger.info('Starting comprehensive security scan');
      
      // Store the start time for performance metrics
      const startTime = Date.now();
      
      // Run security checks
      const loginIssues = await this.checkFailedLogins();
      const suspiciousActivities = await this.checkSuspiciousActivities();
      const vulnerabilityDetails = await this.scanForVulnerabilities();
      
      // Run new security checks for HTTP headers and info leakage
      const missingHeaders = await this.checkSecurityHeaders();
      const serverLeakageIssues = await this.checkServerLeakage();
      const timestampIssues = await this.checkTimestampDisclosure();
      const corsIssues = await this.checkCorsConfiguration();
      const hiddenFiles = await this.checkHiddenFiles();
      
      // Add new findings to vulnerabilities
      missingHeaders.forEach(issue => {
        if (issue.severity === 'medium') vulnerabilityDetails.medium.push(issue);
        else vulnerabilityDetails.low.push(issue);
      });
      
      serverLeakageIssues.forEach(issue => {
        vulnerabilityDetails.medium.push(issue);
      });
      
      timestampIssues.forEach(issue => {
        vulnerabilityDetails.medium.push(issue);
      });
      
      corsIssues.forEach(issue => {
        vulnerabilityDetails.medium.push(issue);
      });
      
      hiddenFiles.forEach(issue => {
        vulnerabilityDetails.medium.push(issue);
      });
      
      // Calculate scan duration
      const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Create scan summary with detailed findings
      const scanResults = {
        timestamp: new Date().toISOString(),
        duration: `${scanDuration} seconds`,
        failedLoginAttempts: loginIssues.count,
        failedLoginDetails: loginIssues.details,
        suspiciousActivities: suspiciousActivities.count,
        suspiciousDetails: suspiciousActivities.details,
        vulnerabilities: {
          critical: vulnerabilityDetails.critical.length,
          medium: vulnerabilityDetails.medium.length,
          low: vulnerabilityDetails.low.length
        },
        vulnerabilityDetails: {
          critical: vulnerabilityDetails.critical,
          medium: vulnerabilityDetails.medium,
          low: vulnerabilityDetails.low
        },
        recommendations: this.generateRecommendations(
          loginIssues, 
          suspiciousActivities, 
          vulnerabilityDetails
        )
      };
      
      // Save scan results
      await this.saveScanResults(scanResults);
      
      logger.info(`Security scan completed in ${scanDuration} seconds`);
      return {
        success: true,
        data: scanResults
      };
    } catch (error) {
      logger.error(`Error during security scan: ${error.message}`, { stack: error.stack });
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Get details about the last security scan
   * @returns {Promise<Object>} Last scan details
   */
  async getLastScanDetails() {
    try {
      // Load the last scan results from storage
      const resultsPath = path.join(__dirname, '../data/security/last-scan-results.json');
      let lastScan;
      
      try {
        const data = await fs.readFile(resultsPath, 'utf8');
        lastScan = JSON.parse(data);
      } catch (err) {
        // If file doesn't exist or is invalid, return default values
        if (err.code === 'ENOENT' || err instanceof SyntaxError) {
          return {
            lastScan: 'Never',
            vulnerabilities: {
              critical: 0,
              medium: 0,
              low: 0
            },
            vulnerabilityDetails: {
              critical: [],
              medium: [],
              low: []
            }
          };
        }
        throw err;
      }
      
      // Format the timestamp as a human-readable date
      const scanDate = new Date(lastScan.timestamp);
      const now = new Date();
      
      // Calculate time difference
      const diffMs = now - scanDate;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      let lastScanFormatted;
      if (diffDays > 0) {
        lastScanFormatted = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
      } else if (diffHours > 0) {
        lastScanFormatted = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
      } else {
        lastScanFormatted = 'Just now';
      }
      
      return {
        lastScan: lastScanFormatted,
        vulnerabilities: lastScan.vulnerabilities,
        vulnerabilityDetails: lastScan.vulnerabilityDetails || {
          critical: [],
          medium: [],
          low: []
        },
        failedLoginDetails: lastScan.failedLoginDetails || [],
        suspiciousDetails: lastScan.suspiciousDetails || []
      };
    } catch (error) {
      logger.error(`Error getting last scan details: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Check for failed login attempts in the logs
   * @returns {Promise<Object>} Count and details of failed login attempts
   */
  async checkFailedLogins() {
    try {
      // Keywords that indicate login failures or account issues
      const loginKeywords = [
        "login",
        "failed",
        "unauthorized",
        "disabled",
        "expired",
        "invalid",
        "access denied",
        "account"
      ];
      
      let loginIssues = [];
      
      // Search for each keyword in ERROR and WARN logs
      const logLevels = ["ERROR", "WARN"];
      
      for (const keyword of loginKeywords) {
        for (const level of logLevels) {
          try {
            // FIX: Use 'week' instead of 'today' to include the last 7 days
            const results = await logsService.searchLogs({
              term: keyword,
              level: level,
              dateRange: 'week',
              includeArchived: true
            });
            
            if (results.logs && results.logs.length > 0) {
              // Add each log to our issues list with additional metadata
              for (const log of results.logs) {
                loginIssues.push({
                  timestamp: `${log.date} ${log.time}`,
                  level: log.level,
                  message: log.message,
                  service: log.service,
                  type: 'Authentication Issue',
                  matchedTerm: keyword
                });
              }
            }
          } catch (error) {
            logger.error(`Error searching for ${keyword} in ${level} logs: ${error.message}`);
          }
        }
      }
      
      // Remove duplicate entries (same timestamp and message)
      const uniqueIssues = this.removeDuplicateLogEntries(loginIssues);
      
      return {
        count: uniqueIssues.length,
        details: uniqueIssues
      };
    } catch (error) {
      logger.error(`Error checking failed logins: ${error.message}`);
      return {
        count: 0,
        details: []
      };
    }
  },
  
  /**
   * Check for suspicious activities in the logs
   * @returns {Promise<Object>} Count and details of suspicious activities
   */
  async checkSuspiciousActivities() {
    try {
      // Keywords that indicate suspicious activity
      const suspiciousKeywords = [
        "suspicious",
        "brute force",
        "injection",
        "unauthorized",
        "attack",
        "breach",
        "security",
        "vulnerability",
        "exploit"
      ];
      
      let suspiciousIssues = [];
      
      // Search for each keyword in ERROR and WARNING logs
      const logLevels = ["ERROR", "WARN"];
      
      for (const keyword of suspiciousKeywords) {
        for (const level of logLevels) {
          try {
            // FIX: Use 'week' instead of 'today' to include the last 7 days
            const results = await logsService.searchLogs({
              term: keyword,
              level: level,
              dateRange: 'week',
              includeArchived: true
            });
            
            if (results.logs && results.logs.length > 0) {
              for (const log of results.logs) {
                suspiciousIssues.push({
                  timestamp: `${log.date} ${log.time}`,
                  level: log.level,
                  message: log.message,
                  service: log.service,
                  type: 'Suspicious Activity',
                  matchedTerm: keyword
                });
              }
            }
          } catch (error) {
            logger.error(`Error searching for ${keyword} in ${level} logs: ${error.message}`);
          }
        }
      }
      
      // Remove duplicate entries
      const uniqueIssues = this.removeDuplicateLogEntries(suspiciousIssues);
      
      return {
        count: uniqueIssues.length,
        details: uniqueIssues
      };
    } catch (error) {
      logger.error(`Error checking suspicious activities: ${error.message}`);
      return {
        count: 0,
        details: []
      };
    }
  },
  
  /**
   * Scan for system vulnerabilities
   * @returns {Promise<Object>} Detailed vulnerability findings by severity
   */
  async scanForVulnerabilities() {
    try {
      // Track vulnerability findings by severity
      const criticalVulnerabilities = [];
      const mediumVulnerabilities = [];
      const lowVulnerabilities = [];
  
      /**
       * Helper function to compare timestamps
       * @param {string} timestamp1 - First timestamp in format "YYYY-MM-DD HH:MM:SS"
       * @param {string} timestamp2 - Second timestamp in format "YYYY-MM-DD HH:MM:SS"
       * @returns {number} -1 if timestamp1 is earlier, 1 if timestamp1 is later, 0 if equal
       */
      function compareTimestamps(timestamp1, timestamp2) {
        // Convert to Date objects for proper comparison
        const date1 = new Date(timestamp1);
        const date2 = new Date(timestamp2);
        
        // Return comparison result
        if (date1 < date2) return -1;  // timestamp1 is earlier
        if (date1 > date2) return 1;   // timestamp1 is later
        return 0;  // timestamps are equal
      }
  
      // COMPLETE REWRITE: Day-by-day approach
      // First, determine all the dates we need to search
      const today = new Date();
      const dates = [];
      
      // Generate list of dates to search (today and 7 days back)
      for (let i = 0; i <= 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        dates.push(date.toISOString().split('T')[0]);
      }
      
      logger.info(`Security scan will examine these dates individually: ${dates.join(', ')}`);
      
      // Master collection for security probes found across all dates
      const securityProbesMaster = {};
      
      // CRITICAL FIX: Process each date individually
      for (const date of dates) {
        logger.info(`Processing security events for date: ${date}`);
        
        // APPROACH 1: Search for security-related logs with this specific date
        try {
          // Look for "SECURITY" keyword
          const securityResults = await logsService.searchLogs({
            term: "SECURITY",
            dateRange: 'custom',
            startDate: date,
            endDate: date,
            includeArchived: true
          });
          
          if (securityResults.logs && securityResults.logs.length > 0) {
            logger.info(`Found ${securityResults.logs.length} logs with term 'SECURITY' on ${date}`);
            
            // Process these logs to extract security probe attempts
            for (const log of securityResults.logs) {
              const timestamp = `${log.date} ${log.time}`;
              let probeUrl = null;
              
              // Check for "SECURITY: Blocked access to sensitive path: /path" format
              const blockedPathMatch = log.message.match(/Blocked access to sensitive path: ([^\s]+)/);
              if (blockedPathMatch && blockedPathMatch[1]) {
                probeUrl = blockedPathMatch[1];
                logger.debug(`Found blocked path: ${probeUrl} at ${timestamp}`);
              }
              
              // If we found a probe URL, track it in master collection
              if (probeUrl) {
                if (!securityProbesMaster[probeUrl]) {
                  securityProbesMaster[probeUrl] = {
                    count: 1,
                    firstSeen: timestamp,
                    lastSeen: timestamp
                  };
                } else {
                  // Update existing entry
                  securityProbesMaster[probeUrl].count++;
                  
                  // Update timestamps
                  if (compareTimestamps(timestamp, securityProbesMaster[probeUrl].firstSeen) < 0) {
                    // This timestamp is earlier than the current firstSeen
                    securityProbesMaster[probeUrl].firstSeen = timestamp;
                    logger.debug(`Updated firstSeen for ${probeUrl} to ${timestamp}`);
                  }
                  if (compareTimestamps(timestamp, securityProbesMaster[probeUrl].lastSeen) > 0) {
                    // This timestamp is later than the current lastSeen
                    securityProbesMaster[probeUrl].lastSeen = timestamp;
                    logger.debug(`Updated lastSeen for ${probeUrl} to ${timestamp}`);
                  }
                }
              }
            }
          }
        } catch (error) {
          logger.error(`Error processing SECURITY logs for date ${date}: ${error.message}`);
        }
        
        // APPROACH 2: Look for 404 errors on this specific date
        try {
          const notFoundResults = await logsService.searchLogs({
            term: "404",
            dateRange: 'custom',
            startDate: date, 
            endDate: date,
            includeArchived: true
          });
          
          if (notFoundResults.logs && notFoundResults.logs.length > 0) {
            logger.info(`Found ${notFoundResults.logs.length} logs with 404 errors on ${date}`);
            
            for (const log of notFoundResults.logs) {
              const timestamp = `${log.date} ${log.time}`;
              let probeUrl = null;
              
              // Check multiple patterns to extract the URL
              // Pattern 1: Standard format with GET or POST
              const standardMatch = log.message.match(/\[0m(GET|POST|PUT|DELETE) ([^ ]+) \[33m404/);
              if (standardMatch && standardMatch[2]) {
                probeUrl = standardMatch[2];
              }
              
              // Pattern 2: Simple format without color codes
              if (!probeUrl) {
                const simpleMatch = log.message.match(/(GET|POST|PUT|DELETE) ([^ ]+) 404/);
                if (simpleMatch && simpleMatch[2]) {
                  probeUrl = simpleMatch[2];
                }
              }
              
              // Pattern 3: "404 Not Found: GET /path" format
              if (!probeUrl) {
                const notFoundMatch = log.message.match(/404 Not Found: (GET|POST|PUT|DELETE) ([^\s]+)/);
                if (notFoundMatch && notFoundMatch[2]) {
                  probeUrl = notFoundMatch[2];
                }
              }
              
              // Pattern 4: Extract from URL pattern
              if (!probeUrl && log.message.includes('404')) {
                const urlMatch = log.message.match(/\/api\/([^\s\?]+)(\?[^\s]+)?/);
                if (urlMatch) {
                  probeUrl = `/api/${urlMatch[1]}`;
                  if (urlMatch[2]) {
                    probeUrl += urlMatch[2];
                  }
                }
              }
              
              // Check if this is a security-relevant URL
              if (probeUrl) {
                const isSecurityProbe = 
                  probeUrl.includes('.env') ||
                  probeUrl.includes('.git') ||
                  probeUrl.includes('wp-') ||
                  probeUrl.includes('/admin') ||
                  probeUrl.includes('/config') ||
                  probeUrl.includes('/install') ||
                  probeUrl.includes('/backup') ||
                  probeUrl.includes('/phpMyAdmin') ||
                  probeUrl.includes('/client/update') ||
                  probeUrl.includes('security') ||
                  probeUrl.includes('.npmrc') ||
                  probeUrl.includes('node_modules');
                  
                if (isSecurityProbe) {
                  // Add to master collection
                  if (!securityProbesMaster[probeUrl]) {
                    securityProbesMaster[probeUrl] = {
                      count: 1,
                      firstSeen: timestamp,
                      lastSeen: timestamp
                    };
                    logger.debug(`Found new security probe: ${probeUrl} at ${timestamp}`);
                  } else {
                    // Update existing entry
                    securityProbesMaster[probeUrl].count++;
                    
                    // Update timestamps
                    if (compareTimestamps(timestamp, securityProbesMaster[probeUrl].firstSeen) < 0) {
                      // This timestamp is earlier than the current firstSeen
                      securityProbesMaster[probeUrl].firstSeen = timestamp;
                      logger.debug(`Updated firstSeen for ${probeUrl} to ${timestamp}`);
                    }
                    if (compareTimestamps(timestamp, securityProbesMaster[probeUrl].lastSeen) > 0) {
                      // This timestamp is later than the current lastSeen
                      securityProbesMaster[probeUrl].lastSeen = timestamp;
                      logger.debug(`Updated lastSeen for ${probeUrl} to ${timestamp}`);
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          logger.error(`Error processing 404 logs for date ${date}: ${error.message}`);
        }
        
        // APPROACH 3: Look for other keywords on this date
        for (const term of ['.env', '.git', 'admin', 'probe', 'attack']) {
          try {
            const termResults = await logsService.searchLogs({
              term: term,
              dateRange: 'custom',
              startDate: date,
              endDate: date,
              includeArchived: true
            });
            
            if (termResults.logs && termResults.logs.length > 0) {
              logger.info(`Found ${termResults.logs.length} logs with term '${term}' on ${date}`);
              
              for (const log of termResults.logs) {
                // Skip logs we've already processed via other searches
                if (log.message.includes('SECURITY:') || log.message.includes('404')) {
                  continue;
                }
                
                const timestamp = `${log.date} ${log.time}`;
                let probeUrl = null;
                
                // Extract URLs from message
                const urlMatch = log.message.match(/\/api\/([^\s\?]+)(\?[^\s]+)?/);
                if (urlMatch) {
                  probeUrl = `/api/${urlMatch[1]}`;
                  if (urlMatch[2]) {
                    probeUrl += urlMatch[2];
                  }
                  
                  // Check if security-related
                  const isSecurityProbe = 
                    probeUrl.includes('.env') ||
                    probeUrl.includes('.git') ||
                    probeUrl.includes('wp-') ||
                    probeUrl.includes('/admin') ||
                    probeUrl.includes('/config') ||
                    probeUrl.includes('/install') ||
                    probeUrl.includes('/backup') ||
                    probeUrl.includes('/phpMyAdmin') ||
                    probeUrl.includes('/client/update') ||
                    probeUrl.includes('security') ||
                    probeUrl.includes('.npmrc') ||
                    probeUrl.includes('node_modules');
                    
                  if (isSecurityProbe) {
                    // Add to master collection
                    if (!securityProbesMaster[probeUrl]) {
                      securityProbesMaster[probeUrl] = {
                        count: 1,
                        firstSeen: timestamp,
                        lastSeen: timestamp
                      };
                    } else {
                      // Update existing entry
                      securityProbesMaster[probeUrl].count++;
                      
                      // Update timestamps
                      if (compareTimestamps(timestamp, securityProbesMaster[probeUrl].firstSeen) < 0) {
                        securityProbesMaster[probeUrl].firstSeen = timestamp;
                      }
                      if (compareTimestamps(timestamp, securityProbesMaster[probeUrl].lastSeen) > 0) {
                        securityProbesMaster[probeUrl].lastSeen = timestamp;
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            logger.error(`Error processing ${term} logs for date ${date}: ${error.message}`);
          }
        }
      }
      
      // Now, convert the master collection to medium vulnerabilities
      logger.info(`Found ${Object.keys(securityProbesMaster).length} unique security probes across all dates`);
      
      for (const [url, data] of Object.entries(securityProbesMaster)) {
        mediumVulnerabilities.push({
          type: 'Security Probe Attempt',
          severity: 'medium',
          description: `Security probe detected: ${url}`,
          occurrences: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          recommendation: 'Monitor these attempts for patterns. Consider implementing rate limiting or blocking persistent offenders.'
        });
        
        logger.info(`Added security probe: ${url} with firstSeen=${data.firstSeen}, lastSeen=${data.lastSeen}`);
      }
      
      // Continue with check for auth failures across full 7-day range
      const startDate = dates[dates.length - 1]; // Oldest date (7 days ago)
      const endDate = dates[0]; // Most recent date (today)
      
      // Check for auth failures in the last week
      try {
        const authFailures = await logsService.searchLogs({
          term: "Invalid password",
          level: "ERROR",
          dateRange: 'custom',
          startDate: startDate,
          endDate: endDate,
          includeArchived: true
        });
        
        if (authFailures.logs && authFailures.logs.length > 0) {
          // Sort logs chronologically
          authFailures.logs.sort((a, b) => {
            const timestampA = a.date + ' ' + a.time;
            const timestampB = b.date + ' ' + b.time;
            return compareTimestamps(timestampA, timestampB);
          });
          
          // First element is the earliest, last element is the latest
          const firstLog = authFailures.logs[0];
          const lastLog = authFailures.logs[authFailures.logs.length - 1];
          
          criticalVulnerabilities.push({
            type: 'Authentication Security Issue',
            severity: 'critical',
            description: 'Multiple invalid password attempts detected',
            occurrences: authFailures.logs.length,
            firstSeen: firstLog.date + ' ' + firstLog.time,
            lastSeen: lastLog.date + ' ' + lastLog.time,
            recommendation: 'Implement account lockout policies and monitor for brute force attempts'
          });
        }
      } catch (error) {
        logger.error(`Error checking for auth failures: ${error.message}`);
      }
      
      // Add token expiration errors as critical
      try {
        const tokenErrors = await logsService.searchLogs({
          term: "jwt expired",
          level: "ERROR",
          dateRange: 'custom',
          startDate: startDate,
          endDate: endDate,
          includeArchived: true
        });
        
        if (tokenErrors.logs && tokenErrors.logs.length > 0) {
          // Sort logs chronologically
          tokenErrors.logs.sort((a, b) => {
            const timestampA = a.date + ' ' + a.time;
            const timestampB = b.date + ' ' + b.time;
            return compareTimestamps(timestampA, timestampB);
          });
          
          // First element is the earliest, last element is the latest
          const firstLog = tokenErrors.logs[0];
          const lastLog = tokenErrors.logs[tokenErrors.logs.length - 1];
          
          criticalVulnerabilities.push({
            type: 'JWT Token Security Issue',
            severity: 'critical',
            description: 'Token verification errors detected',
            occurrences: tokenErrors.logs.length,
            firstSeen: firstLog.date + ' ' + firstLog.time,
            lastSeen: lastLog.date + ' ' + lastLog.time,
            recommendation: 'Review token expiration settings and implement proper token refresh mechanism'
          });
        }
      } catch (error) {
        logger.error(`Error checking for token errors: ${error.message}`);
      }
      
      // Add login errors as critical
      try {
        const loginErrors = await logsService.searchLogs({
          term: "Login error",
          level: "ERROR",
          dateRange: 'custom',
          startDate: startDate,
          endDate: endDate,
          includeArchived: true
        });
        
        if (loginErrors.logs && loginErrors.logs.length > 0) {
          // Sort logs chronologically
          loginErrors.logs.sort((a, b) => {
            const timestampA = a.date + ' ' + a.time;
            const timestampB = b.date + ' ' + b.time;
            return compareTimestamps(timestampA, timestampB);
          });
          
          // First element is the earliest, last element is the latest
          const firstLog = loginErrors.logs[0];
          const lastLog = loginErrors.logs[loginErrors.logs.length - 1];
          
          criticalVulnerabilities.push({
            type: 'Authentication Security Issue',
            severity: 'critical',
            description: 'Multiple login failures detected',
            occurrences: loginErrors.logs.length,
            firstSeen: firstLog.date + ' ' + firstLog.time,
            lastSeen: lastLog.date + ' ' + lastLog.time,
            recommendation: 'Review authentication logs and implement additional security measures'
          });
        }
      } catch (error) {
        logger.error(`Error checking for login errors: ${error.message}`);
      }
  
      // Check for server errors (500 level)
      try {
        const serverErrorResults = await logsService.searchLogs({
          term: "500",
          level: "INFO",
          dateRange: 'custom',
          startDate: startDate,
          endDate: endDate,
          includeArchived: true
        });
  
        if (serverErrorResults.logs && serverErrorResults.logs.length > 0) {
          const endpoints = {};
  
          for (const log of serverErrorResults.logs) {
            // Extract endpoint from log message using regex
            let endpoint = null;
  
            // Try different patterns to match the endpoint
            const postMatch = log.message.match(/\[0mPOST ([^ ]+) \[31m500\]/);
            if (postMatch && postMatch[1]) {
              endpoint = postMatch[1];
            } else {
              const getMatch = log.message.match(/\[0mGET ([^ ]+) \[31m500\]/);
              if (getMatch && getMatch[1]) {
                endpoint = getMatch[1];
              } else {
                // Simple format without color codes
                const simpleMatch = log.message.match(/(GET|POST|PUT|DELETE) ([^ ]+) 500/);
                if (simpleMatch && simpleMatch[2]) {
                  endpoint = simpleMatch[2];
                }
              }
            }
  
            if (endpoint) {
              const timestamp = log.date + ' ' + log.time;
              
              if (!endpoints[endpoint]) {
                endpoints[endpoint] = {
                  count: 0,
                  firstSeen: timestamp,
                  lastSeen: timestamp
                };
              }
  
              endpoints[endpoint].count++;
              
              // Update timestamps using proper comparison
              if (compareTimestamps(timestamp, endpoints[endpoint].firstSeen) < 0) {
                endpoints[endpoint].firstSeen = timestamp;
              }
              if (compareTimestamps(timestamp, endpoints[endpoint].lastSeen) > 0) {
                endpoints[endpoint].lastSeen = timestamp;
              }
            }
          }
  
          // Convert grouped endpoints to vulnerability entries
          for (const [endpoint, data] of Object.entries(endpoints)) {
            criticalVulnerabilities.push({
              type: 'Server Error',
              severity: 'critical',
              description: `Server error on endpoint: ${endpoint}`,
              occurrences: data.count,
              firstSeen: data.firstSeen,
              lastSeen: data.lastSeen,
              recommendation: 'Investigate and fix server errors to prevent service disruption'
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking for server errors: ${error.message}`);
      }
  
      // Check for JWT token issues
      try {
        const tokenResults = await logsService.searchLogs({
          term: "jwt",
          level: "ERROR",
          dateRange: 'custom',
          startDate: startDate,
          endDate: endDate,
          includeArchived: true
        });
  
        if (tokenResults.logs && tokenResults.logs.length > 0) {
          const uniqueErrors = new Set();
          
          // Sort logs chronologically
          tokenResults.logs.sort((a, b) => {
            const timestampA = a.date + ' ' + a.time;
            const timestampB = b.date + ' ' + b.time;
            return compareTimestamps(timestampA, timestampB);
          });
          
          // First element is the earliest, last element is the latest
          const firstLog = tokenResults.logs[0];
          const lastLog = tokenResults.logs[tokenResults.logs.length - 1];
          
          let firstSeen = firstLog.date + ' ' + firstLog.time;
          let lastSeen = lastLog.date + ' ' + lastLog.time;
          
          for (const log of tokenResults.logs) {
            uniqueErrors.add(log.message);
          }
  
          if (uniqueErrors.size > 0) {
            mediumVulnerabilities.push({
              type: 'JWT Token Issues',
              severity: 'medium',
              description: 'Problems with authentication tokens detected',
              occurrences: tokenResults.logs.length,
              firstSeen: firstSeen,
              lastSeen: lastSeen,
              examples: Array.from(uniqueErrors),
              recommendation: 'Review token expiration settings and authentication flow'
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking for JWT token issues: ${error.message}`);
      }
  
      // Check for missing security headers
      try {
        // Get API base URL from config
        const apiUrl = config.api.baseUrl || config.services.api.url;
        const endpoint = config.api.healthEndpoint || '/api/health';
        const fullUrl = `${apiUrl}${endpoint}`;
        
        const response = await axios.get(fullUrl);
        
        const headers = response.headers;
        const missingHeaders = [];
        
        // Check for critical security headers
        if (!headers['content-security-policy']) 
          missingHeaders.push({ 
            type: 'Content Security Policy Header Missing', 
            severity: 'medium',
            description: 'CSP header not set, increasing risk of XSS attacks',
            recommendation: 'Implement CSP header with appropriate directives'
          });
        
        if (!headers['strict-transport-security'])
          missingHeaders.push({ 
            type: 'Strict-Transport-Security Header Missing', 
            severity: 'medium',
            description: 'HSTS header not set, increasing risk of protocol downgrade attacks',
            recommendation: 'Add Strict-Transport-Security header with appropriate max-age'
          });
        
        if (!headers['x-content-type-options'])
          missingHeaders.push({ 
            type: 'X-Content-Type-Options Header Missing', 
            severity: 'medium',
            description: 'X-Content-Type-Options header not set, increasing risk of MIME type confusion attacks',
            recommendation: 'Add X-Content-Type-Options: nosniff header'
          });
        
        if (!headers['x-frame-options'])
          missingHeaders.push({ 
            type: 'X-Frame-Options Header Missing', 
            severity: 'medium',
            description: 'X-Frame-Options header not set, increasing risk of clickjacking attacks',
            recommendation: 'Add X-Frame-Options: SAMEORIGIN header'
          });
        
        if (!headers['referrer-policy'])
          missingHeaders.push({ 
            type: 'Referrer-Policy Header Missing', 
            severity: 'low',
            description: 'Referrer-Policy header not set, potentially leaking referrer information',
            recommendation: 'Add Referrer-Policy: no-referrer-when-downgrade header'
          });
        
        // Add missing headers to vulnerability list  
        missingHeaders.forEach(issue => {
          if (issue.severity === 'medium') {
            mediumVulnerabilities.push(issue);
          } else {
            lowVulnerabilities.push(issue);
          }
        });
      } catch (error) {
        logger.error(`Error checking security headers: ${error.message}`);
      }
      
      // Check for server information leakage
      try {
        // Get API base URL from config
        const apiUrl = config.api.baseUrl || config.services.api.url;
        const endpoint = config.api.healthEndpoint || '/api/health';
        const fullUrl = `${apiUrl}${endpoint}`;
        
        const response = await axios.get(fullUrl);
        
        const headers = response.headers;
        const leakageIssues = [];
        
        if (headers['x-powered-by'])
          leakageIssues.push({ 
            type: 'Server Leaks Information via X-Powered-By', 
            severity: 'medium',
            description: `X-Powered-By header reveals server technology: ${headers['x-powered-by']}`,
            recommendation: 'Remove X-Powered-By header in server configuration' 
          });
        
        if (headers['server'] && headers['server'].includes('/'))
          leakageIssues.push({ 
            type: 'Server Leaks Version Information', 
            severity: 'medium',
            description: `Server header reveals version information: ${headers['server']}`,
            recommendation: 'Configure server to remove version information from Server header' 
          });
        
        // Add server leakage issues to medium vulnerabilities  
        leakageIssues.forEach(issue => {
          mediumVulnerabilities.push(issue);
        });
      } catch (error) {
        logger.error(`Error checking server information leakage: ${error.message}`);
      }
      
      // Check for timestamp disclosure in API responses
      try {
        // Get list of endpoints to check from config
        const apiUrl = config.api.baseUrl || config.services.api.url;
        const endpointsToCheck = config.api.endpoints || [
          '/api/users',
          '/api/logs',
          '/api/status'
        ];
        
        const disclosureIssues = [];
        
        for (const endpoint of endpointsToCheck) {
          try {
            const response = await axios.get(`${apiUrl}${endpoint}`);
            
            // Check for Unix timestamps in the response
            const responseText = JSON.stringify(response.data);
            const timestampRegex = /\b\d{10}\b/g; // Basic Unix timestamp regex
            
            const matches = responseText.match(timestampRegex);
            if (matches && matches.length > 0) {
              disclosureIssues.push({
                type: 'Timestamp Disclosure',
                severity: 'medium',
                description: `Unix timestamps exposed in ${endpoint} response`,
                count: matches.length,
                recommendation: 'Format timestamps as ISO strings or human-readable dates before sending to client'
              });
            }
          } catch (err) {
            // Skip failed requests
            logger.debug(`Skipping timestamp check for ${endpoint}: ${err.message}`);
            continue;
          }
        }
        
        // Add timestamp disclosure issues to medium vulnerabilities
        disclosureIssues.forEach(issue => {
          mediumVulnerabilities.push(issue);
        });
      } catch (error) {
        logger.error(`Error checking timestamp disclosure: ${error.message}`);
      }
      
      // Check for CORS misconfiguration
      try {
        // Get API base URL from config
        const apiUrl = config.api.baseUrl || config.services.api.url;
        const endpoint = config.api.healthEndpoint || '/api/health';
        const fullUrl = `${apiUrl}${endpoint}`;
        
        // Test with a preflight OPTIONS request
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
        
        // Check if CORS is too permissive
        if (headers['access-control-allow-origin'] === '*') {
          corsIssues.push({
            type: 'Cross-Domain Misconfiguration',
            severity: 'medium',
            description: 'CORS allows requests from any origin (*)',
            recommendation: 'Configure CORS to allow only specific trusted domains'
          });
        }
        
        // Add CORS issues to medium vulnerabilities  
        corsIssues.forEach(issue => {
          mediumVulnerabilities.push(issue);
        });
      } catch (error) {
        logger.error(`Error checking CORS configuration: ${error.message}`);
      }
      
      // Check for accessible hidden files
      try {
        // Get API base URL from config
        const apiUrl = config.api.baseUrl || config.services.api.url;
        const hiddenFiles = [
          '/.env',
          '/.git/config',
          '/.gitignore',
          '/.npmrc',
          '/node_modules/.package-lock.json'
        ];
        
        const foundFiles = [];
        
        for (const file of hiddenFiles) {
          try {
            const response = await axios.get(`${apiUrl}${file}`);
            if (response.status !== 404) {
              foundFiles.push({
                type: 'Hidden File Found',
                severity: 'medium',
                description: `Hidden file accessible: ${file}`,
                recommendation: 'Block access to hidden files and development artifacts'
              });
            }
          } catch (err) {
            // 404 errors are expected and good
            if (err.response && err.response.status !== 404) {
              // Non-404 errors might indicate the file exists but with access issues
              foundFiles.push({
                type: 'Potential Hidden File',
                severity: 'low',
                description: `Unusual response for hidden file: ${file} (${err.response?.status})`,
                recommendation: 'Verify server configuration for handling hidden files'
              });
            }
          }
        }
        
        // Add found files to vulnerabilities  
        foundFiles.forEach(issue => {
          if (issue.severity === 'medium') {
            mediumVulnerabilities.push(issue);
          } else {
            lowVulnerabilities.push(issue);
          }
        });
      } catch (error) {
        logger.error(`Error checking hidden files: ${error.message}`);
      }
  
      // VALIDATION - Log the date ranges of found vulnerabilities for debugging
      logger.info(`--- Vulnerability Date Ranges ---`);
      logger.info(`Critical vulnerabilities: ${criticalVulnerabilities.length}`);
      criticalVulnerabilities.forEach((v, i) => {
        logger.info(`Critical #${i+1}: ${v.description} - First: ${v.firstSeen}, Last: ${v.lastSeen}`);
      });
      
      logger.info(`Medium vulnerabilities: ${mediumVulnerabilities.length}`);
      mediumVulnerabilities.forEach((v, i) => {
        if (v.firstSeen && v.lastSeen) {
          logger.info(`Medium #${i+1}: ${v.description} - First: ${v.firstSeen}, Last: ${v.lastSeen}`);
        } else {
          logger.info(`Medium #${i+1}: ${v.description} (no date range)`);
        }
      });
  
      // Return all vulnerability findings
      return {
        critical: criticalVulnerabilities,
        medium: mediumVulnerabilities,
        low: lowVulnerabilities
      };
    } catch (error) {
      logger.error(`Error scanning for vulnerabilities: ${error.message}`);
      return {
        critical: [],
        medium: [],
        low: []
      };
    }
  },
  
  /**
   * Check for missing security headers
   * @returns {Promise<Array>} Array of security header issues
   */
  async checkSecurityHeaders() {
    try {
      // Get API base URL from config
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      
      const response = await axios.get(fullUrl);
      
      const headers = response.headers;
      const missingHeaders = [];
      
      // Check for critical security headers
      if (!headers['content-security-policy']) 
        missingHeaders.push({ 
          type: 'Content Security Policy Header Missing', 
          severity: 'medium',
          description: 'CSP header not set, increasing risk of XSS attacks',
          recommendation: 'Implement CSP header with appropriate directives'
        });
      
      if (!headers['strict-transport-security'])
        missingHeaders.push({ 
          type: 'Strict-Transport-Security Header Missing', 
          severity: 'medium',
          description: 'HSTS header not set, increasing risk of protocol downgrade attacks',
          recommendation: 'Add Strict-Transport-Security header with appropriate max-age'
        });
      
      if (!headers['x-content-type-options'])
        missingHeaders.push({ 
          type: 'X-Content-Type-Options Header Missing', 
          severity: 'medium',
          description: 'X-Content-Type-Options header not set, increasing risk of MIME type confusion attacks',
          recommendation: 'Add X-Content-Type-Options: nosniff header'
        });
      
      if (!headers['x-frame-options'])
        missingHeaders.push({ 
          type: 'X-Frame-Options Header Missing', 
          severity: 'medium',
          description: 'X-Frame-Options header not set, increasing risk of clickjacking attacks',
          recommendation: 'Add X-Frame-Options: SAMEORIGIN header'
        });
      
      if (!headers['referrer-policy'])
        missingHeaders.push({ 
          type: 'Referrer-Policy Header Missing', 
          severity: 'low',
          description: 'Referrer-Policy header not set, potentially leaking referrer information',
          recommendation: 'Add Referrer-Policy: no-referrer-when-downgrade header'
        });
      
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
      // Get API base URL from config
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      
      const response = await axios.get(fullUrl);
      
      const headers = response.headers;
      const leakageIssues = [];
      
      if (headers['x-powered-by'])
        leakageIssues.push({ 
          type: 'Server Leaks Information via X-Powered-By', 
          severity: 'medium',
          description: `X-Powered-By header reveals server technology: ${headers['x-powered-by']}`,
          recommendation: 'Remove X-Powered-By header in server configuration' 
        });
      
      if (headers['server'] && headers['server'].includes('/'))
        leakageIssues.push({ 
          type: 'Server Leaks Version Information', 
          severity: 'medium',
          description: `Server header reveals version information: ${headers['server']}`,
          recommendation: 'Configure server to remove version information from Server header' 
        });
      
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
      // Get list of endpoints to check from config
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpointsToCheck = config.api.endpoints || [
        '/api/users',
        '/api/logs',
        '/api/status'
      ];
      
      const disclosureIssues = [];
      
for (const endpoint of endpointsToCheck) {
        try {
          const response = await axios.get(`${apiUrl}${endpoint}`);
          
          // Check for Unix timestamps in the response
          const responseText = JSON.stringify(response.data);
          const timestampRegex = /\b\d{10}\b/g; // Basic Unix timestamp regex
          
          const matches = responseText.match(timestampRegex);
          if (matches && matches.length > 0) {
            disclosureIssues.push({
              type: 'Timestamp Disclosure',
              severity: 'medium',
              description: `Unix timestamps exposed in ${endpoint} response`,
              count: matches.length,
              recommendation: 'Format timestamps as ISO strings or human-readable dates before sending to client'
            });
          }
        } catch (err) {
          // Skip failed requests
          logger.debug(`Skipping timestamp check for ${endpoint}: ${err.message}`);
          continue;
        }
      }
      
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
      // Get API base URL from config
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const endpoint = config.api.healthEndpoint || '/api/health';
      const fullUrl = `${apiUrl}${endpoint}`;
      
      // Test with a preflight OPTIONS request
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
      
      // Check if CORS is too permissive
      if (headers['access-control-allow-origin'] === '*') {
        corsIssues.push({
          type: 'Cross-Domain Misconfiguration',
          severity: 'medium',
          description: 'CORS allows requests from any origin (*)',
          recommendation: 'Configure CORS to allow only specific trusted domains'
        });
      }
      
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
      // Get API base URL from config
      const apiUrl = config.api.baseUrl || config.services.api.url;
      const hiddenFiles = [
        '/.env',
        '/.git/config',
        '/.gitignore',
        '/.npmrc',
        '/node_modules/.package-lock.json'
      ];
      
      const foundFiles = [];
      
      for (const file of hiddenFiles) {
        try {
          const response = await axios.get(`${apiUrl}${file}`);
          if (response.status !== 404) {
            foundFiles.push({
              type: 'Hidden File Found',
              severity: 'medium',
              description: `Hidden file accessible: ${file}`,
              recommendation: 'Block access to hidden files and development artifacts'
            });
          }
        } catch (err) {
          // 404 errors are expected and good
          if (err.response && err.response.status !== 404) {
            // Non-404 errors might indicate the file exists but with access issues
            foundFiles.push({
              type: 'Potential Hidden File',
              severity: 'low',
              description: `Unusual response for hidden file: ${file} (${err.response?.status})`,
              recommendation: 'Verify server configuration for handling hidden files'
            });
          }
        }
      }
      
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
    
    // Sort entries by timestamp to ensure chronological order
    // This helps get the correct first/last seen dates
    logEntries.sort((a, b) => {
      return a.timestamp.localeCompare(b.timestamp);
    });
    
    return logEntries.filter(entry => {
      // Create a unique key based on timestamp and message
      const key = `${entry.timestamp}|${entry.message}`;
      
      if (seen.has(key)) {
        return false;
      }
      
      seen.add(key);
      return true;
    });
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

    // Login-related recommendations
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

    // Recommendations based on vulnerabilities
    if (vulnerabilities.critical.length > 0) {
      recommendations.push({
        severity: 'critical',
        title: 'Fix Critical Server Errors',
        description: `${vulnerabilities.critical.length} critical server errors detected`,
        action: 'Investigate and fix server errors immediately to prevent service disruption and potential security breaches'
      });
    }

    if (vulnerabilities.medium.length > 0) {
      // Database-specific recommendations
      const dbIssues = vulnerabilities.medium.filter(
        v => v.type.includes('Database')
      );

      if (dbIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Resolve Database Issues',
          description: `${dbIssues.length} database-related issues detected`,
          action: 'Review database configuration, connections, and query handling'
        });
      }

      // JWT-specific recommendations
      const jwtIssues = vulnerabilities.medium.filter(
        v => v.type.includes('JWT')
      );

      if (jwtIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix Authentication Token Issues',
          description: 'JWT token verification failures detected',
          action: 'Review token expiration settings and refresh token implementation'
        });
      }
      
      // Header-specific recommendations
      const headerIssues = vulnerabilities.medium.filter(
        v => v.type.includes('Header')
      );
      
      if (headerIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Implement Security Headers',
          description: `${headerIssues.length} missing security headers detected`,
          action: 'Configure server to add proper security headers for all responses'
        });
      }
      
      // Information leakage recommendations
      const leakageIssues = vulnerabilities.medium.filter(
        v => v.type.includes('Leaks') || v.type.includes('Disclosure')
      );
      
      if (leakageIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Prevent Information Leakage',
          description: `${leakageIssues.length} instances of information leakage detected`,
          action: 'Configure server to prevent leaking version information and hide internal details'
        });
      }
      
      // CORS recommendations
      const corsIssues = vulnerabilities.medium.filter(
        v => v.type.includes('Cross-Domain')
      );
      
      if (corsIssues.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Fix CORS Configuration',
          description: 'Cross-Origin Resource Sharing (CORS) is too permissive',
          action: 'Restrict CORS to only allow trusted domains instead of wildcard (*) origin'
        });
      }

      // Security probe recommendations
      const securityProbes = vulnerabilities.medium.filter(
        v => v.type === 'Security Probe Attempt'
      );

      if (securityProbes.length > 0) {
        recommendations.push({
          severity: 'medium',
          title: 'Security Probe Attempts Detected',
          description: `${securityProbes.length} attempts to access sensitive files or endpoints detected`,
          action: 'Consider implementing rate limiting, IP blocking for persistent offenders, and ensure proper server hardening is in place'
        });

        // If we have multiple types of probes, add more specific recommendations
        const envProbes = securityProbes.filter(p => p.description.includes('.env'));
        const gitProbes = securityProbes.filter(p => p.description.includes('.git'));
        const clientProbes = securityProbes.filter(p => p.description.includes('client/update'));

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
      // 404-specific recommendations
      const missingResources = vulnerabilities.low.filter(
        v => v.type === 'Missing Resource'
      );

      if (missingResources.length > 0) {
        recommendations.push({
          severity: 'low',
          title: 'Fix Missing Resources',
          description: `${missingResources.length} endpoints returning 404 errors`,
          action: 'Update application to remove references to non-existent endpoints or implement the missing resources'
        });
      }
    }

    // Add general recommendations
    recommendations.push({
      severity: 'low',
      title: 'Regular Security Maintenance',
      description: 'Proactive security measures',
      action: 'Implement regular security audits, keep dependencies updated, and consider penetration testing'
    });

    return recommendations;
  },
  
  /**
   * Save scan results to storage
   * @param {Object} results - Scan results to save
   * @returns {Promise<void>}
   */
  async saveScanResults(results) {
    try {
      // Ensure directory exists
      const dataDir = path.join(__dirname, '../data/security');
      await fs.mkdir(dataDir, { recursive: true });
      
      // Save the results
      const resultsPath = path.join(dataDir, 'last-scan-results.json');
      await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
      
      // Log the successful save
      logger.info(`Security scan results saved to ${resultsPath}`);
    } catch (error) {
      logger.error(`Error saving scan results: ${error.message}`);
      throw error;
    }
  }
};

module.exports = securityScanService;