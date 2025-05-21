// src/services/securityService.js - Frontend service with detailed information methods
import httpService from './httpService';

/**
 * Service for security-related operations
 */
const securityService = {
  /**
   * Get security metrics including failed login attempts and suspicious activities
   * @returns {Promise} Security metrics
   */
  async getSecurityMetrics() {
    try {
      // Use the API endpoint at /api/security/metrics
      const response = await httpService.get('security/metrics');
      return response.data;
    } catch (error) {
      console.error('Error fetching security metrics:', error);
      // Return fallback data if API call fails
      return {
        data: {
          failedLoginAttempts: 0,
          suspiciousActivities: 0,
          lastSecurityScan: 'Never',
          vulnerabilities: {
            critical: 0,
            medium: 0,
            low: 0
          }
        }
      };
    }
  },

  /**
   * Run a comprehensive security scan
   * @returns {Promise} Security scan results
   */
  async runSecurityScan() {
    try {
      // Use the API endpoint at /api/security/scan
      const response = await httpService.post('security/scan');
      return response;
    } catch (error) {
      console.error('Error running security scan:', error);
      throw error;
    }
  },
  
  /**
   * Get detailed information about the last security scan
   * @returns {Promise} Detailed security information
   */
  async getLastScanDetails() {
    try {
      // Use the API endpoint at /api/security/last-scan
      const response = await httpService.get('security/last-scan');
      
      if (response && response.data && response.data.data) {
        return response.data.data;
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching security details:', error);
      return null;
    }
  }
};

export default securityService;