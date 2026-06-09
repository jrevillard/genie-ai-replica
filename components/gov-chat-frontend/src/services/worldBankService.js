/**
 * World Bank Open Data Service
 *
 * Fetches agricultural and economic indicator data from World Bank Open Data API (v2)
 * All data is cached for 24 hours to reduce API calls and improve performance.
 *
 * API Documentation: https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information
 *
 * No API key required - open data access.
 */

const API_BASE_URL = 'https://api.worldbank.org/v2';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// World Bank Indicator Codes
const INDICATORS = {
  MAIZE: 'AG.PRD.CROP.XD', // Crop production index (2014-2016 = 100)
  CROP_PROTECTION: 'TM.VAL.AGRI.ZS.UN', // Agricultural raw materials exports (% of total merchandise exports)
  VEGETABLES: 'AG.PRD.FOOD.XD', // Food production index (2014-2016 = 100)
  LIVESTOCK: 'AG.PRD.LVSK.XD', // Livestock production index (2014-2016 = 100)
  FERTILIZER: 'AG.CON.FERT.ZS', // Fertilizer consumption (kilograms per hectare of arable land)
  AQUACULTURE: 'ER.FSH.AQUA.MT' // Aquaculture production (metric tons)
};

class WorldBankService {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Fetch data from World Bank API
   * @param {Object} options - Fetch options
   * @param {string} options.countryCode - ISO country code (default: 'SLV' for El Salvador)
   * @param {string} options.indicator - World Bank indicator code
   * @param {number} options.startDate - Start year (default: 2020)
   * @param {number} options.endDate - End year (default: current year)
   * @returns {Promise<Object|null>} Parsed JSON data or null on error
   */
  async _fetchIndicator({ countryCode = 'SLV', indicator, startDate = 2020, endDate = null }) {
    const endYear = endDate || new Date().getFullYear();
    const url = `${API_BASE_URL}/country/${countryCode}/indicator/${indicator}?format=json&date=${startDate}:${endYear}&per_page=100`;

    try {
      console.log(`[WorldBankService] Fetching: ${indicator} for ${countryCode}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        console.log(`[WorldBankService] HTTP ${response.status} for ${indicator}`);
        return null;
      }

      const json = await response.json();

      // World Bank returns [metadata, data]
      if (Array.isArray(json) && json.length >= 2) {
        const metadata = json[0] || {};
        const data = json[1] || [];
        const page = metadata.page || 0;
        const pages = metadata.pages || 0;

        // Handle pagination warning
        if (pages > 1 && page === 1) {
          console.log(`[WorldBankService] Warning: Data is paginated (${pages} pages). Only first page returned.`);
        }

        return {
          metadata,
          data,
          indicator,
          country: countryCode
        };
      }

      return null;
    } catch (error) {
      console.error(`[WorldBankService] Error fetching ${indicator}:`, error);
      return null;
    }
  }

  /**
   * Fetch data with fallback to regional/global averages
   * Tries country-specific data first, then falls back to:
   * 1. Regional average (LCN for Latin America & Caribbean)
   * 2. Global average (1W for World)
   *
   * @param {Object} options - Fetch options
   * @param {string} options.indicator - World Bank indicator code
   * @param {number} options.startDate - Start year
   * @param {number} options.endDate - End year
   * @returns {Promise<Object|null>} Data with source attribution or null
   */
  async _fetchWithFallback({ indicator, startDate = 2020, endDate = null }) {
    // Try El Salvador first
    let data = await this._fetchIndicator({
      countryCode: 'SLV',
      indicator,
      startDate,
      endDate
    });

    if (data && data.data && data.data.length > 0) {
      return {
        ...data,
        dataSource: 'El Salvador'
      };
    }

    console.log(`[WorldBankService] No SLV data for ${indicator}, trying regional`);

    // Try Latin America & Caribbean regional average
    data = await this._fetchIndicator({
      countryCode: 'LCN',
      indicator,
      startDate,
      endDate
    });

    if (data && data.data && data.data.length > 0) {
      return {
        ...data,
        dataSource: 'Regional Average (Latin America)'
      };
    }

    console.log(`[WorldBankService] No regional data for ${indicator}, trying global`);

    // Try global average
    data = await this._fetchIndicator({
      countryCode: '1W',
      indicator,
      startDate,
      endDate
    });

    if (data && data.data && data.data.length > 0) {
      return {
        ...data,
        dataSource: 'Global Average'
      };
    }

    console.log(`[WorldBankService] No data available for ${indicator}`);
    return null;
  }

  /**
   * Get cached data or fetch fresh data
   * @param {Object} options - Cache options
   * @param {string} options.cacheKey - Cache key
   * @param {Function} options.fetchFn - Function to fetch fresh data
   * @returns {Promise<any>} Cached or fresh data
   */
  async _getCachedOrFetch({ cacheKey, fetchFn }) {
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`[WorldBankService] Returning cached data for ${cacheKey}`);
        return cached.data;
      }
    }

    // Fetch fresh data
    const data = await fetchFn();

    if (data) {
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });
    }

    return data;
  }

  /**
   * Process raw World Bank time series data into simplified format
   * @param {Array} rawData - Raw data from API
   * @returns {Array} Processed time series data
   */
  _processTimeSeriesData(rawData) {
    if (!rawData || !Array.isArray(rawData)) return [];

    const processed = [];

    for (const item of rawData) {
      if (!item || typeof item !== 'object') continue;

      const value = item.value;
      const year = item.date;

      if (value !== null && value !== undefined && year) {
        processed.push({
          year: String(year),
          value: Number(value),
          decimal: Number(value)
        });
      }
    }

    // Sort by year
    processed.sort((a, b) => a.year.localeCompare(b.year));

    return processed;
  }

  /**
   * Calculate trend from time series data
   * @param {Array} rawData - Raw data from API
   * @returns {string} Trend: 'up', 'down', or 'stable'
   */
  _calculateTrend(rawData) {
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      return 'unknown';
    }

    const data = this._processTimeSeriesData(rawData);
    if (data.length < 2) return 'unknown';

    // Compare last value to previous value
    const last = data[data.length - 1].value;
    const previous = data[data.length - 2].value;

    const change = ((last - previous) / previous) * 100;

    if (change > 2) return 'up';
    if (change < -2) return 'down';
    return 'stable';
  }

  // ==================== MARKET DATA METHODS ====================

  /**
   * 1. Get Maize (Basic Grains) Price Data
   * Used by: Plant Basic Grains quick help category
   */
  async getMaizePrices() {
    return await this._getCachedOrFetch({
      cacheKey: 'maize-prices',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.MAIZE
        });

        if (!data) return null;

        return {
          category: 'maize',
          title: 'Maize & Basic Grains',
          unit: 'Production Index (2014-2016=100)',
          color: '#2E7D32',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 2. Get Crop Protection (Pesticide) Cost Data
   * Used by: Diagnose Pest & Disease quick help category
   */
  async getCropProtectionCosts() {
    return await this._getCachedOrFetch({
      cacheKey: 'crop-protection-costs',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.CROP_PROTECTION
        });

        if (!data) return null;

        return {
          category: 'cropProtection',
          title: 'Crop Protection Costs',
          unit: '% of Total Exports',
          color: '#D84315',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 3. Get Vegetable Price Index
   * Used by: Grow Fruits & Veggies quick help category
   */
  async getVegetablePrices() {
    return await this._getCachedOrFetch({
      cacheKey: 'vegetable-prices',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.VEGETABLES
        });

        if (!data) return null;

        return {
          category: 'vegetables',
          title: 'Fruits & Vegetables',
          unit: 'Production Index (2014-2016=100)',
          color: '#558B2F',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 4. Get Poultry & Pork Feed Cost Data
   * Used by: Manage Poultry & Pigs quick help category
   */
  async getPoultryPorkFeedCosts() {
    return await this._getCachedOrFetch({
      cacheKey: 'poultry-pork-feed',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.LIVESTOCK
        });

        if (!data) return null;

        return {
          category: 'livestock',
          title: 'Poultry & Pork Feed',
          unit: 'Production Index (2014-2016=100)',
          color: '#8D6E63',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 5. Get Fertilizer Price Data
   * Used by: Fertilizer & Soil Advice quick help category
   */
  async getFertilizerPrices() {
    return await this._getCachedOrFetch({
      cacheKey: 'fertilizer-prices',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.FERTILIZER
        });

        if (!data) return null;

        return {
          category: 'fertilizer',
          title: 'Fertilizer & Soil',
          unit: 'kg per Hectare',
          color: '#F9A825',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 6. Get Honey (Apiary) Market Data
   * Used by: Start & Manage Apiary quick help category
   */
  async getHoneyMarketData() {
    return await this._getCachedOrFetch({
      cacheKey: 'honey-market',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.LIVESTOCK
        });

        if (!data) return null;

        return {
          category: 'apiary',
          title: 'Apiary & Honey',
          unit: 'Production Index (2014-2016=100)',
          color: '#F57F17',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 7. Get Tilapia (Aquaculture) Market Data
   * Used by: Tilapia Pond Care quick help category
   */
  async getTilapiaMarketData() {
    return await this._getCachedOrFetch({
      cacheKey: 'tilapia-market',
      fetchFn: async () => {
        const data = await this._fetchWithFallback({
          indicator: INDICATORS.AQUACULTURE
        });

        if (!data) return null;

        return {
          category: 'aquaculture',
          title: 'Tilapia & Aquaculture',
          unit: 'Metric Tons',
          color: '#0288D1',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * 8. Get Harvest & Storage Loss Data
   * Used by: Harvest & Storage quick help category
   */
  async getHarvestStorageData() {
    return await this._getCachedOrFetch({
      cacheKey: 'harvest-storage',
      fetchFn: async () => {
        // Use rural population as proxy for storage capacity
        const data = await this._fetchWithFallback({
          indicator: 'SP.RUR.TOTL.ZS'
        });

        if (!data) return null;

        return {
          category: 'harvestStorage',
          title: 'Harvest & Storage',
          unit: 'Rural Population %',
          color: '#00838F',
          dataSource: data.dataSource,
          data: this._processTimeSeriesData(data.data),
          trend: this._calculateTrend(data.data),
          lastUpdated: new Date().toISOString()
        };
      }
    });
  }

  /**
   * Get all market data in a single call
   * Returns a map with all 8 categories
   */
  async getAllMarketData() {
    const results = await Promise.all([
      this.getMaizePrices(),
      this.getCropProtectionCosts(),
      this.getVegetablePrices(),
      this.getPoultryPorkFeedCosts(),
      this.getFertilizerPrices(),
      this.getHoneyMarketData(),
      this.getTilapiaMarketData(),
      this.getHarvestStorageData()
    ]);

    return {
      maize: results[0],
      cropProtection: results[1],
      vegetables: results[2],
      livestock: results[3],
      fertilizer: results[4],
      apiary: results[5],
      aquaculture: results[6],
      harvestStorage: results[7],
      lastUpdated: new Date().toISOString()
    };
  }

  // ==================== CACHE MANAGEMENT ====================

  /**
   * Clear all cached data
   */
  clearCache() {
    const count = this.cache.size;
    this.cache.clear();
    console.log(`[WorldBankService] Cleared all cache (${count} entries)`);
  }

  /**
   * Get cache information
   * @returns {Object} Cache info
   */
  getCacheInfo() {
    const cacheKeys = Array.from(this.cache.keys());
    const info = {
      size: this.cache.size,
      keys: cacheKeys,
      duration: '24 hours',
      entries: {}
    };

    for (const key of cacheKeys) {
      const cached = this.cache.get(key);
      const age = Date.now() - cached.timestamp;

      info.entries[key] = {
        timestamp: cached.timestamp,
        age_minutes: Math.floor(age / 1000 / 60),
        age_hours: (age / 1000 / 60 / 60).toFixed(2),
        expired: age >= CACHE_DURATION
      };
    }

    return info;
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache() {
    const now = Date.now();
    const keysToRemove = [];

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp >= CACHE_DURATION) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.cache.delete(key);
    }

    if (keysToRemove.length > 0) {
      console.log(`[WorldBankService] Cleared ${keysToRemove.length} expired entries`);
    }
  }
}

// Export singleton instance
export default new WorldBankService();
