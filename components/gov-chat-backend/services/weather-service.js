const axios = require('axios');
const fs = require('fs');
// kdbush v4 ships ESM with a CJS-compatible default export. The
// `require('kdbush').default` form is the documented Node.js usage.
const KDBush = require('kdbush').default;
const { around: geokdbushAround } = require('geokdbush');
const { logger, dbService } = require('../shared-lib');

// Max distance (km) for geokdbush nearest-neighbor reverse geocoding. 25 km
// covers rural users between cities; anything further throws a typed 503
// CITY_NOT_FOUND rather than pinning them to a city they are not actually in.
const CITY_LOOKUP_RADIUS_KM = 25;

class WeatherService {
  constructor() {
    this.dbService = dbService;
    this.db = null;
    this.weatherRequests = null;
    this.analyticsService = null;
    this.initialized = false;
    // Offline reverse-geocoding index. Populated in init() from the
    // GeoNames cities500 dataset, downloaded by the Dockerfile at build
    // time (CC-BY 4.0, see docs/DATA-LICENSES.md). Path: /app/geo-data/cities500.txt
    // in the running container.
    this.cityIndex = null;
    this.cityMeta = null;
    logger.info('WeatherService constructor called');
  }

  /**
   * Initialize the WeatherService
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      logger.debug('WeatherService already initialized, skipping');
      return;
    }

    // Offline reverse-geocoding index — bundled GeoNames cities500.
    // Isolated try/catch so any FS / parse failure leaves city lookups
    // returning null (which the caller surfaces as CITY_NOT_FOUND) instead
    // of aborting init.
    try {
      this._loadCityIndex();
    } catch (indexError) {
      logger.error('WeatherService.city_index_unavailable', {
        error: indexError.message,
        stack: indexError.stack
      });
      this.cityIndex = null;
      this.cityMeta = null;
    }

    // DB collection handle — isolated try/catch so a transient ArangoDB
    // outage does not abort init. If this fails, getWeather() degrades to
    // "skip persistence" mode (see guard at the .save() call site).
    try {
      this.db = await this.dbService.getConnection('default');
      this.weatherRequests = this.db.collection('weatherRequests');
      logger.info('WeatherService.weather_requests_collection_ready');
    } catch (dbError) {
      logger.error('WeatherService.weather_requests_collection_unavailable', {
        error: dbError.message,
        stack: dbError.stack
      });
      this.weatherRequests = null;
    }

    this.initialized = true;
    logger.info('WeatherService initialized successfully');
  }

  /**
   * Load the offline reverse-geocoding index from the GeoNames cities500
   * dataset (downloaded by the Dockerfile at build time). Builds an
   * in-memory KDBush spatial index over all populated places
   * (feature_class = 'P') for O(log n) nearest-neighbor lookup at request
   * time. Dataset license: CC-BY 4.0.
   */
  _loadCityIndex() {
    // Path: /app/geo-data/. Not /app/data/ — compose mounts a named
    // volume there that would shadow the image-baked file.
    // Override via WEATHER_DATASET_PATH for tests.
    const dataPath = process.env.WEATHER_DATASET_PATH || '/app/geo-data/cities500.txt';
    const content = fs.readFileSync(dataPath, 'utf8');
    const lines = content.split('\n');

    // GeoNames tab-separated columns (indexed from 1 in the docs):
    //   1 geonameid, 2 name, 3 asciiname, 4 alternatenames,
    //   5 latitude, 6 longitude, 7 feature_class, 8 feature_code,
    //   9 country_code, ...
    const points = [];
    const meta = [];
    let populatedCount = 0;

    for (const line of lines) {
      if (!line) continue;
      const cols = line.split('\t');
      if (cols.length < 9) continue;
      if (cols[6] !== 'P') continue; // 'P' = populated place, skip others
      const lat = Number(cols[4]);
      const lon = Number(cols[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // kdbush.add(x, y) — we use [lon, lat] ordering.
      points.push(lon, lat);
      meta.push({ name: cols[1], country: cols[8] });
      populatedCount += 1;
    }

    const index = new KDBush(populatedCount);
    for (let i = 0; i < points.length; i += 2) {
      index.add(points[i], points[i + 1]);
    }
    index.finish();

    this.cityIndex = index;
    this.cityMeta = meta;
    logger.info('WeatherService.city_index_loaded', { count: populatedCount });
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
    logger.info('WeatherService.analytics_service_set');
  }

  /**
   * Reverse-geocode coordinates to a "City, Country" string using the
   * bundled GeoNames index. Offline, instant, no rate limit.
   * Returns null when no city is within CITY_LOOKUP_RADIUS_KM (e.g. mid-
   * ocean or desert coords); the caller is expected to surface this as a
   * structured error rather than rendering a literal "Unknown" string.
   * @param {number} latitude
   * @param {number} longitude
   * @returns {string|null} "City, Country" or null
   */
  getCityName(latitude, longitude) {
    if (!this.cityIndex) return null;
    const ids = geokdbushAround(this.cityIndex, longitude, latitude, 1, CITY_LOOKUP_RADIUS_KM);
    if (ids.length === 0) return null;
    const entry = this.cityMeta[ids[0]];
    return `${entry.name}, ${entry.country}`;
  }

  /**
   * Fetch weather data for a location
   * @param {Object} locationData - Location data { latitude, longitude, userId }
   * @returns {Promise<Object>} Weather data
   */
  async getWeather(locationData) {
    const startTime = Date.now();
    try {
      logger.info('WeatherService.get_weather_start', { locationData });

      // Coordinates are mandatory: the browser supplies them via
      // navigator.geolocation on every dashboard mount, and the route layer
      // rejects requests that omit them with 400. We never invent a
      // position — the route is the contract boundary that guarantees
      // privacy-respecting behavior (no silent fallback to a server location).
      // Use Number() instead of parseFloat(): Number([13.7942, 0]) is NaN
      // (caught) while parseFloat would silently coerce to 13.7942 and
      // produce a response for the wrong coords. String-numeric inputs
      // ("13.7942") still parse via Number().
      const latitudeRaw = Number(locationData.latitude);
      const longitudeRaw = Number(locationData.longitude);
      if (
        !Number.isFinite(latitudeRaw) ||
        !Number.isFinite(longitudeRaw) ||
        latitudeRaw < -90 ||
        latitudeRaw > 90 ||
        longitudeRaw < -180 ||
        longitudeRaw > 180
      ) {
        const typedError = new Error('Valid latitude and longitude are required');
        typedError.statusCode = 400;
        typedError.code = 'LOCATION_REQUIRED';
        throw typedError;
      }

      // Round to 4 decimal places to avoid Open-Meteo precision issues.
      const latitude = Math.round(latitudeRaw * 10000) / 10000;
      const longitude = Math.round(longitudeRaw * 10000) / 10000;
      const userId = locationData.userId;

      // City name from the offline index. No external call. If no city
      // is within the lookup radius (mid-ocean, remote desert, etc.),
      // throw a typed 503 — the dashboard falls back to
      // weatherErrorDefault rather than rendering a literal "Unknown"
      // location, which would look like a silent failure to the user.
      const city = this.getCityName(latitude, longitude);
      if (!city) {
        logger.warn('WeatherService.city_not_found', { latitude, longitude, radiusKm: CITY_LOOKUP_RADIUS_KM });
        const typedError = new Error('No city found near the provided coordinates');
        typedError.statusCode = 503;
        typedError.code = 'CITY_NOT_FOUND';
        throw typedError;
      }

      logger.debug('WeatherService.location_selected', { latitude, longitude, city });

      // Open-Meteo API request
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=4`;
      logger.debug('WeatherService.api_request', { weatherUrl });

      // Fetch weather data — wrap in try/catch. A flaky upstream (timeouts,
      // ECONNREFUSED, 5xx) must NOT surface as a generic 500 to the
      // dashboard; instead we throw a typed error the route layer maps to
      // 503, so the UI keeps rendering. Open-Meteo is the only external call.
      let response;
      try {
        logger.debug('WeatherService.fetching_weather');
        response = await axios.get(weatherUrl, { timeout: 4000 });
      } catch (upstreamError) {
        // External upstream failures surface as a typed 503 (logged here,
        // mapped to a 503 response in the route layer) instead of a generic
        // 500. The frontend collapses all weather fetch failures to the same
        // i18n key (weatherErrorDefault) since there is no actionable
        // difference for the end user between a network blip and an
        // upstream outage.
        logger.error('WeatherService.weather_upstream_unavailable', {
          error: upstreamError.message,
          statusCode: upstreamError.response?.status
        });
        const typedError = new Error('Weather service temporarily unavailable');
        typedError.statusCode = 503;
        typedError.code = 'WEATHER_UPSTREAM_UNAVAILABLE';
        throw typedError;
      }
      logger.debug('WeatherService.weather_response', {
        status: response.status,
        data: response.data
      });

      // Parse weather data
      const weatherCodeToCondition = (code) => {
        if ([61, 63, 65, 66, 67].includes(code)) return 'Rain';
        if ([71, 73, 75, 77].includes(code)) return 'Snow';
        if ([51, 53, 55].includes(code)) return 'Drizzle';
        if ([95, 96, 99].includes(code)) return 'Thunderstorm';
        if ([3].includes(code)) return 'Cloudy';
        if ([2].includes(code)) return 'Partly Cloudy';
        if ([0, 1].includes(code)) return 'Clear';
        return 'Unknown';
      };

      const weatherData = {
        location: city,
        current: {
          temperature: Math.round(response.data.current.temperature_2m),
          condition: weatherCodeToCondition(response.data.current.weather_code),
          humidity: response.data.current.relative_humidity_2m,
          windSpeed: Math.round(response.data.current.wind_speed_10m)
        },
        forecast: response.data.daily.time.slice(1, 4).map((date, index) => ({
          date: new Date(date).toISOString(),
          condition: weatherCodeToCondition(response.data.daily.weather_code[index + 1]),
          highTemp: Math.round(response.data.daily.temperature_2m_max[index + 1]),
          lowTemp: Math.round(response.data.daily.temperature_2m_min[index + 1])
        }))
      };

      // Store request in ArangoDB
      //
      // If `init()` failed (e.g. ipapi.co was unreachable at startup,
      // `this.weatherRequests` stays null), the analytics/persistence step
      // would throw `Cannot read properties of null (reading 'save')` and
      // surface as a 500 to the frontend. The weather data itself is valid;
      // we log and continue so the user still gets an answer. A subsequent
      // request after the operator restarts the backend will recover
      // persistence normally.
      const requestDoc = {
        userId: userId || null,
        latitude,
        longitude,
        city,
        timestamp: new Date().toISOString()
      };
      let requestId = null;
      if (!this.weatherRequests) {
        logger.warn('WeatherService.persistence_unavailable_skipping_save', {
          reason: 'weatherRequests collection not initialized (init() likely failed)'
        });
      } else {
        try {
          logger.debug('WeatherService.saving_request', { requestDoc });
          const request = await this.weatherRequests.save(requestDoc);
          requestId = request._key;
        } catch (saveErr) {
          // Persistence is best-effort; surface the failure but still return data
          logger.error('WeatherService.save_request_failed', {
            error: saveErr.message,
            stack: saveErr.stack
          });
        }
      }

      // Record in analytics
      if (requestId && this.analyticsService) {
        try {
          logger.debug('WeatherService.recording_analytics', { requestId });
          await this.analyticsService.recordWeatherRequest({
            _key: requestId,
            userId: userId || null,
            city,
            timestamp: requestDoc.timestamp
          });
          logger.info('WeatherService.analytics_recorded', { requestId });
        } catch (error) {
          logger.error('WeatherService.record_analytics_failed', { requestId, error: error.message });
        }
      }

      logger.info('WeatherService.weather_fetched', {
        requestId,
        city,
        durationMs: Date.now() - startTime
      });
      return weatherData;
    } catch (error) {
      // Outer catch logs at warn — the typed errors thrown from this
      // method (LOCATION_REQUIRED, CITY_NOT_FOUND, WEATHER_UPSTREAM_UNAVAILABLE)
      // are already a structured 4xx/5xx contract; the route layer logs
      // them too. Logging here at warn avoids double-logging at error level
      // for the same recoverable failure.
      logger.warn('WeatherService.get_weather_failed', {
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }
}

// Singleton instance
const instance = new WeatherService();
module.exports = instance;
