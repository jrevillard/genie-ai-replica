const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const axios = require('axios');
const translationService = require('../services/translation-service');
const { nearestDistrict } = require('../data/bd-districts');

// Weather MCP service (PolisenseAI). Serves /geocode for the chat map command;
// resolves Bangladesh district names locally, falls back to Mapbox Geocoding.
const WEATHER_MCP_URL = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';
const { getDefaultLocation } = require('../services/default-location');

module.exports = (weatherService) => {
  // Apply authentication middleware
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * /api/weather/geocode:
   *   get:
   *     summary: Resolve a place name to coordinates for the chat map view
   *     description: Proxies to the weather MCP service. Bangladesh districts resolve locally; other places via Mapbox Geocoding.
   *     parameters:
   *       - in: query
   *         name: location
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: '{ lat, lon, name, zoom }' }
   *       404: { description: Location not found }
   *       502: { description: Geocoding service unavailable }
   */
  /**
   * Latest deterministic risk assessments for the crop early-warning banner
   * (CropAlertBanner.vue). Both proxy weather-mcp-service, which reads the
   * warning_system_engine / drought_monitoring outputs from ArangoDB.
   */
  /**
   * Translate the free-text parts of a risk assessment (message + triggers)
   * into the UI language. English is returned untouched. translateMarkdown is
   * used per string because it is cached permanently in Redis by content hash,
   * so the one-minute banner poll only pays the translation cost when the
   * assessment text actually changes. Any failure falls back to English.
   */
  const localizeRisk = async (data, lang) => {
    const target = (lang || 'en').toLowerCase();
    if (target === 'en' || !data || typeof data !== 'object') return data;
    const texts = [data.message || '', ...(Array.isArray(data.triggers) ? data.triggers : [])];
    try {
      await translationService.init();
      const translated = await Promise.all(
        texts.map((t) => (t ? translationService.translateMarkdown(t, 'en', target) : Promise.resolve(t)))
      );
      // translateMarkdown re-serialises markdown and appends a trailing newline.
      const clean = translated.map((t) => (typeof t === 'string' ? t.trim() : t));
      return { ...data, message: clean[0], triggers: clean.slice(1), language: target };
    } catch (err) {
      logger.warn(`[RISK] Translation to ${target} failed, returning English: ${err.message}`);
      return data;
    }
  };

  const proxyLatestRisk = (mcpPath) => async (req, res) => {
    const { location, lang } = req.query;
    if (!location) return res.status(400).json({ message: 'location query parameter is required' });
    try {
      const resp = await axios.get(`${WEATHER_MCP_URL}${mcpPath}`, { params: { location }, timeout: 8000 });
      return res.json(await localizeRisk(resp.data, lang));
    } catch (err) {
      if (err.response?.status === 404) return res.status(404).json({ message: `No assessment for '${location}'` });
      logger.error(`[RISK] Proxy error ${mcpPath} for ${location}: ${err.message}`);
      return res.status(502).json({ message: 'Risk service unavailable' });
    }
  };
  router.get('/potato-risk', proxyLatestRisk('/potato/risk/latest'));
  router.get('/drought-risk', proxyLatestRisk('/drought/risk/latest'));
  router.get('/flood-risk', proxyLatestRisk('/flood/risk/latest'));

  /**
   * Deployment fallback location (DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON).
   * Clients without runtime config injection (e.g. mobile) read it from here so
   * every surface falls back to the same place as the services.
   */
  router.get('/default-location', (_req, res) => {
    const { name, latitude, longitude } = getDefaultLocation();
    return res.json({ location: name, lat: latitude, lon: longitude });
  });

  /**
   * Browser geolocation -> district whose alerts the web banner should show.
   * Falls back to null (client falls back to the configured default location,
   * see GET /default-location) when the point is outside Bangladesh.
   */
  router.get('/nearest-district', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ message: 'lat and lon query parameters are required' });
    }
    return res.json(nearestDistrict(lat, lon) || { district: null, distanceKm: null });
  });

  router.get('/geocode', async (req, res) => {
    const { location } = req.query;
    if (!location) return res.status(400).json({ message: 'location query parameter is required' });
    try {
      const resp = await axios.get(`${WEATHER_MCP_URL}/geocode`, { params: { location }, timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      if (err.response?.status === 404) return res.status(404).json({ message: `Location '${location}' not found` });
      logger.error(`[GEOCODE] Proxy error for ${location}: ${err.message}`);
      return res.status(502).json({ message: 'Geocoding service unavailable' });
    }
  });

  /**
   * @swagger
   * /api/weather:
   *   post:
   *     summary: Get weather data for a location
   *     description: Fetches current weather and forecast for the specified location. Defaults to server location if no coordinates provided.
   *     tags: [Weather]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               latitude:
   *                 type: number
   *                 description: Latitude of the location
   *               longitude:
   *                 type: number
   *                 description: Longitude of the location
   *           example:
   *             latitude: -6.2088
   *             longitude: 106.8456
   *     responses:
   *       200:
   *         description: Weather data retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 location:
   *                   type: string
   *                 current:
   *                   type: object
   *                   properties:
   *                     temperature:
   *                       type: integer
   *                     condition:
   *                       type: string
   *                     humidity:
   *                       type: integer
   *                     windSpeed:
   *                       type: integer
   *                 forecast:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       date:
   *                         type: string
   *                         format: date-time
   *                       condition:
   *                         type: string
   *                       highTemp:
   *                         type: integer
   *                       lowTemp:
   *                         type: integer
   *       400:
   *         description: Invalid location data
   *       401:
   *         description: Unauthorized - Invalid or missing authentication token
   *       500:
   *         description: Server error
   */
  router.post('/', async (req, res) => {
    try {
      const { latitude, longitude } = req.body;

      // Validate coordinates if provided
      if ((latitude && !longitude) || (!latitude && longitude)) {
        return res.status(400).json({ message: 'Both latitude and longitude must be provided' });
      }
      if (latitude && (latitude < -90 || latitude > 90)) {
        return res.status(400).json({ message: 'Invalid latitude' });
      }
      if (longitude && (longitude < -180 || longitude > 180)) {
        return res.status(400).json({ message: 'Invalid longitude' });
      }

      const userId = req.user?.iss_sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
      }

      logger.info(`Fetching weather for user ${userId} at lat:${latitude}, lon:${longitude}`);

      const weatherData = await weatherService.getWeather({ latitude, longitude, userId });
      res.json(weatherData);
    } catch (error) {
      logger.error(`Error fetching weather: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  return router;
};
