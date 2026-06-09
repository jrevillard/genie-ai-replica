/**
 * Agricultural Data Service
 * Fetches crop health and pest alert data from external APIs
 *
 * Data Sources:
 * - NASA Harvest: Crop health (NDVI) data
 * - Sentinel Hub: Satellite imagery statistics
 * - USDA APHIS: Pest alerts for Central America
 * - FAO GIEWS: Backup pest data (requires API key)
 */

import usdaRssService from './usdaRssService.js';

const API_ENDPOINTS = {
  // NASA Harvest - Crop Health (NDVI)
  // Documentation: https://harvest.nasa.gov/
  nasaHarvest: 'https://earthengine.googleapis.com/v1alpha/projects/earthengine-legacy/value:compute',

  // Sentinel Hub - Satellite Imagery Statistics
  // Documentation: https://docs.sentinel-hub.com/api/latest/api/statistics/
  sentinelHub: 'https://services.sentinel-hub.com/api/v1/statistics',

  // USDA APHIS - Pest Alerts (public data)
  // Main URL: https://www.aphis.usda.gov/aphis/ourfocus/planthealth/
  usdaAphis: 'https://www.aphis.usda.gov/aphis/ourfocus/planthealth/plant-pest-and-disease-programs/pest-detection',

  // Backup: FAO GIEWS (requires API key)
  faoGIEWS: 'https://fenixservices.fao.org/faostat/static/v1.0/js/'
};

class AgriculturalService {
  constructor() {
    this.cache = new Map();
    this.CACHE_DURATION = 3600000; // 1 hour in milliseconds
  }

  /**
   * Get crop health data for a region
   * @param {string} region - Geographic region (default: 'El Salvador')
   * @param {string} timeRange - Time period like '30d', '90d' (default: '30d')
   * @returns {Promise<Object>} Crop health data with NDVI values by department
   */
  async getCropHealth(region = 'El Salvador', timeRange = '30d') {
    const cacheKey = `crop-health-${region}-${timeRange}`;

    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
        console.log('[AgriculturalService] Returning cached crop health data');
        return cached.data;
      }
    }

    try {
      // TODO: Replace with actual NASA Harvest API call when API key is available
      const data = await this._fetchCropHealthFromNASA(region, timeRange);

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('[AgriculturalService] Failed to fetch crop health:', error);
      return this._getFallbackCropHealthData(region);
    }
  }

  /**
   * Get pest alerts for a region
   * @param {string} region - Geographic region (default: 'Central America')
   * @returns {Promise<Object>} Pest alert data with current warnings
   */
  async getPestAlerts(region = 'Central America') {
    const cacheKey = `pest-alerts-${region}`;

    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
        console.log('[AgriculturalService] Returning cached pest alerts');
        return cached.data;
      }
    }

    try {
      // TODO: Replace with actual USDA APHIS API call
      // Note: USDA provides RSS feeds and web data - may need web scraping
      const data = await this._fetchPestAlertsFromUSDA(region);

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('[AgriculturalService] Failed to fetch pest alerts:', error);
      return this._getFallbackPestAlertData(region);
    }
  }

  /**
   * Fetch crop health data from NASA Harvest API
   * @private
   * @param {string} region - Geographic region
   * @param {string} timeRange - Time period
   * @returns {Promise<Object>} NDVI data by department
   */
  async _fetchCropHealthFromNASA(region, timeRange) {
    // TODO: Implement actual NASA Harvest API integration
    // Steps needed:
    // 1. Obtain API key from https://harvest.nasa.gov/
    // 2. Setup OAuth authentication
    // 3. Query Earth Engine for NDVI statistics
    // 4. Parse GeoTIFF or JSON response

    console.log(`[AgriculturalService] Fetching crop health from NASA for ${region}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // Return mock data matching El Salvador departments
    // Replace this with actual API response when available
    return {
      region,
      timeRange,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      dataSource: 'NASA Harvest (mock)',
      data: [
        {
          department: 'San Salvador',
          ndvi: 0.72,
          trend: 'improving',
          change: 5.2,
          health: 'good'
        },
        {
          department: 'La Libertad',
          ndvi: 0.68,
          trend: 'stable',
          change: 1.1,
          health: 'good'
        },
        {
          department: 'San Miguel',
          ndvi: 0.55,
          trend: 'declining',
          change: -8.3,
          health: 'moderate'
        },
        {
          department: 'Santa Ana',
          ndvi: 0.71,
          trend: 'improving',
          change: 3.7,
          health: 'good'
        },
        {
          department: 'Usulután',
          ndvi: 0.48,
          trend: 'declining',
          change: -12.1,
          health: 'warning'
        },
        {
          department: 'La Unión',
          ndvi: 0.52,
          trend: 'stable',
          change: -0.5,
          health: 'moderate'
        },
        {
          department: 'Chalatenango',
          ndvi: 0.65,
          trend: 'improving',
          change: 4.2,
          health: 'good'
        }
      ],
      average: {
        ndvi: 0.63,
        trend: 'stable',
        change: -2.1
      }
    };
  }

  /**
   * Fetch pest alerts from USDA APHIS
   * @private
   * @param {string} region - Geographic region
   * @returns {Promise<Object>} Current pest alerts
   */
  async _fetchPestAlertsFromUSDA(region) {
    // Delegate to usdaRssService for enhanced seasonal mock data
    // This ensures consistency with mobile app and proper seasonal logic
    console.log(`[AgriculturalService] Delegating pest alerts to usdaRssService for ${region}`);

    return await usdaRssService.getPestAlerts(region);
  }

  /**
   * Fallback crop health data when API is unavailable
   * @private
   * @param {string} region - Geographic region
   * @returns {Object} Fallback data structure
   */
  _getFallbackCropHealthData(region) {
    return {
      region,
      timeRange: '30d',
      offline: true,
      dataSource: 'Fallback (offline mode)',
      data: [],
      average: {
        ndvi: 0,
        trend: 'unknown',
        change: 0
      },
      message: 'Unable to fetch data. Please check your connection.'
    };
  }

  /**
   * Fallback pest alert data when API is unavailable
   * @private
   * @param {string} region - Geographic region
   * @returns {Object} Fallback data structure
   */
  _getFallbackPestAlertData(region) {
    return {
      region,
      offline: true,
      dataSource: 'Fallback (offline mode)',
      alerts: [],
      summary: {
        total: 0,
        high: 0,
        moderate: 0,
        low: 0
      },
      message: 'Unable to fetch pest alerts. Please check your connection.'
    };
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache.clear();
    console.log('[AgriculturalService] Cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache info
   */
  getCacheInfo() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      duration: `${this.CACHE_DURATION / 1000 / 60} minutes`
    };
  }
}

// Export singleton instance
export default new AgriculturalService();
