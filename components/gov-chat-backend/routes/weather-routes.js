const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

module.exports = (weatherService) => {
  // Apply authentication middleware
  router.use(keycloakAuthMiddleware.authenticate);

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
   *         description: Missing or invalid coordinates — no silent fallback to a default location.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [LOCATION_REQUIRED]
   *                 message:
   *                   type: string
   *               required: [error, message]
   *       401:
   *         description: Unauthorized - Invalid or missing authentication token
   *       503:
   *         description: Transient upstream failure — the dashboard renders the weatherErrorDefault i18n key.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [WEATHER_UPSTREAM_UNAVAILABLE, CITY_NOT_FOUND]
   *                 message:
   *                   type: string
   *               required: [error, message]
   *       500:
   *         description: Server error
   */
  router.post('/', async (req, res) => {
    try {
      const { latitude, longitude } = req.body;

      // Coordinates are required — we never invent a position for the
      // user. The browser supplies them via navigator.geolocation; if the
      // user denied geolocation, the frontend surfaces that as an error
      // before it ever reaches this route. Empty bodies and legacy callers
      // get an explicit 400 instead of a silently-mislocated forecast.
      // Range + type validation lives in the service (typed error path) so
      // backend and frontend stay aligned on a single LOCATION_REQUIRED
      // contract.
      if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
        return res.status(400).json({
          error: 'LOCATION_REQUIRED',
          message: 'Valid latitude and longitude are required'
        });
      }

      const userId = req.user?.iss_sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
      }

      logger.info(`Fetching weather for user ${userId} at lat:${latitude}, lon:${longitude}`);

      const weatherData = await weatherService.getWeather({ latitude, longitude, userId });
      res.json(weatherData);
    } catch (error) {
      // Typed errors (carrying statusCode/code) propagate as their declared
      // status instead of generic 500.
      if (error.statusCode && error.code) {
        logger.warn(`Weather service unavailable: ${error.message}`, { code: error.code });
        return res.status(error.statusCode).json({
          error: error.code,
          message: error.message
        });
      }
      logger.error(`Error fetching weather: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  return router;
};
