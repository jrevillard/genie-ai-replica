// src/services/securityScanService.js - with detailed vulnerability reporting
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../logger');
const logsService = require('./logs-service');

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
      
      // Search for each keyword in ERROR logs
      for (const keyword of loginKeywords) {
        try {
          const errorResults = await logsService.searchLogs({
            term: keyword,
            level: "ERROR",
            dateRange: "today",
            includeArchived: true
          });
          
          if (errorResults.logs && errorResults.logs.length > 0) {
            // Add each log to our issues list with additional metadata
            for (const log of errorResults.logs) {
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
          logger.error(`Error searching for ${keyword} in ERROR logs: ${error.message}`);
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
      for (const keyword of suspiciousKeywords) {
        // Check ERROR logs
        try {
          const errorResults = await logsService.searchLogs({
            term: keyword,
            level: "ERROR",
            dateRange: "today",
            includeArchived: true
          });
          
          if (errorResults.logs && errorResults.logs.length > 0) {
            for (const log of errorResults.logs) {
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
          logger.error(`Error searching for ${keyword} in ERROR logs: ${error.message}`);
        }
        
        // Check WARNING logs
        try {
          const warningResults = await logsService.searchLogs({
            term: keyword,
            level: "WARNING",
            dateRange: "today",
            includeArchived: true
          });
          
          if (warningResults.logs && warningResults.logs.length > 0) {
            for (const log of warningResults.logs) {
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
          logger.error(`Error searching for ${keyword} in WARNING logs: ${error.message}`);
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
      
      // Check for 404 errors (missing resources)
      try {
        const notFoundResults = await logsService.searchLogs({
          term: "404",
          level: "INFO",
          dateRange: "today",
          includeArchived: true
        });
        
        if (notFoundResults.logs && notFoundResults.logs.length > 0) {
          // Group 404 errors by endpoint to avoid listing each occurrence separately
          const endpoints = {};
          
          for (const log of notFoundResults.logs) {
            // Extract endpoint from log message using regex
            const endpointMatch = log.message.match(/\[0mGET ([^ ]+) \[33m404\]/);
            if (endpointMatch && endpointMatch[1]) {
              const endpoint = endpointMatch[1];
              if (!endpoints[endpoint]) {
                endpoints[endpoint] = {
                  count: 0,
                  firstSeen: log.date + ' ' + log.time,
                  lastSeen: log.date + ' ' + log.time
                };
              }
              
              endpoints[endpoint].count++;
              endpoints[endpoint].lastSeen = log.date + ' ' + log.time;
            }
          }
          
          // Convert grouped endpoints to vulnerability entries
          for (const [endpoint, data] of Object.entries(endpoints)) {
            lowVulnerabilities.push({
              type: 'Missing Resource',
              severity: 'low',
              description: `Endpoint not found: ${endpoint}`,
              occurrences: data.count,
              firstSeen: data.firstSeen,
              lastSeen: data.lastSeen,
              recommendation: 'Review API routes and update application to remove references to this endpoint'
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking for 404 errors: ${error.message}`);
      }
      
      // Check for database errors
      try {
        const dbErrorResults = await logsService.searchLogs({
          term: "database",
          level: "ERROR",
          dateRange: "today",
          includeArchived: true
        });
        
        if (dbErrorResults.logs && dbErrorResults.logs.length > 0) {
          const dbIssues = {};
          
          for (const log of dbErrorResults.logs) {
            // Extract the specific error type
            // This is a simplified approach - a more robust implementation would use
            // regex patterns to categorize different types of database errors
            const errorMessage = log.message.toLowerCase();
            let errorType = 'Database Error';
            
            if (errorMessage.includes('index')) {
              errorType = 'Database Index Error';
            } else if (errorMessage.includes('reindex')) {
              errorType = 'Reindexing Error';
            } else if (errorMessage.includes('collection')) {
              errorType = 'Collection Error';
            }
            
            if (!dbIssues[errorType]) {
              dbIssues[errorType] = {
                count: 0,
                examples: [],
                firstSeen: log.date + ' ' + log.time,
                lastSeen: log.date + ' ' + log.time
              };
            }
            
            dbIssues[errorType].count++;
            dbIssues[errorType].lastSeen = log.date + ' ' + log.time;
            
            // Keep track of unique error messages (up to 5)
            if (dbIssues[errorType].examples.length < 5 && 
                !dbIssues[errorType].examples.includes(log.message)) {
              dbIssues[errorType].examples.push(log.message);
            }
          }
          
          // Convert grouped database issues to vulnerability entries
          for (const [errorType, data] of Object.entries(dbIssues)) {
            mediumVulnerabilities.push({
              type: errorType,
              severity: 'medium',
              description: `Database operation failures detected`,
              occurrences: data.count,
              firstSeen: data.firstSeen,
              lastSeen: data.lastSeen,
              examples: data.examples,
              recommendation: 'Review database configuration and operations for errors'
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking for database errors: ${error.message}`);
      }
      
      // Check for server errors (500 level)
      try {
        const serverErrorResults = await logsService.searchLogs({
          term: "500",
          level: "INFO",
          dateRange: "today",
          includeArchived: true
        });
        
        if (serverErrorResults.logs && serverErrorResults.logs.length > 0) {
          const endpoints = {};
          
          for (const log of serverErrorResults.logs) {
            // Extract endpoint from log message using regex
            const endpointMatch = log.message.match(/\[0mPOST ([^ ]+) \[31m500\]/);
            if (endpointMatch && endpointMatch[1]) {
              const endpoint = endpointMatch[1];
              if (!endpoints[endpoint]) {
                endpoints[endpoint] = {
                  count: 0,
                  firstSeen: log.date + ' ' + log.time,
                  lastSeen: log.date + ' ' + log.time
                };
              }
              
              endpoints[endpoint].count++;
              endpoints[endpoint].lastSeen = log.date + ' ' + log.time;
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
          dateRange: "today",
          includeArchived: true
        });
        
        if (tokenResults.logs && tokenResults.logs.length > 0) {
          const uniqueErrors = new Set();
          for (const log of tokenResults.logs) {
            uniqueErrors.add(log.message);
          }
          
          if (uniqueErrors.size > 0) {
            mediumVulnerabilities.push({
              type: 'JWT Token Issues',
              severity: 'medium',
              description: 'Problems with authentication tokens detected',
              occurrences: tokenResults.logs.length,
              examples: Array.from(uniqueErrors),
              recommendation: 'Review token expiration settings and authentication flow'
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking for JWT token issues: ${error.message}`);
      }
      
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
   * Remove duplicate log entries based on timestamp and message
   * @param {Array} logEntries - Array of log entries
   * @returns {Array} Deduplicated log entries
   */
  removeDuplicateLogEntries(logEntries) {
    const seen = new Set();
    
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