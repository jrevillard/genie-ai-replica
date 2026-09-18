'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('axios');

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('fs', () => ({
  readFileSync: jest.fn()
}));

jest.mock('kdbush', () => {
  // Mirror kdbush v4 ESM shape. kdbush v4 exports the constructor as a
  // named default property of the ESM namespace; the documented CJS
  // entry point is `require('kdbush').default`.
  const KDBush = jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    finish: jest.fn()
  }));
  return { __esModule: true, default: KDBush };
});

jest.mock('geokdbush', () => ({
  around: jest.fn()
}));

const axios = require('axios');
const fs = require('fs');
const { around: geokdbushAround } = require('geokdbush');
const { logger, dbService } = require('../../shared-lib');

// One-line-per-row GeoNames TSV with two populated places so getCityName has
// data to return from the index without depending on the real 39MB
// dataset (downloaded by the Dockerfile at build time, not present at test).
const CITIES_FIXTURE = [
  '3038832\tVila\tVila\t\t42.53176\t1.56654\tP\tPPL\tAD\t\t\t\t\t0\t\t',
  '3583360\tSan Salvador\tSan Salvador\t\t13.7942\t-88.8965\tP\tPPLC\tSV\t\t\t\t\t0\t\t'
].join('\n');

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'wr-1' })
  };
}

function setupService({ cityIndexLoaded = true } = {}) {
  if (cityIndexLoaded) {
    fs.readFileSync.mockReturnValue(CITIES_FIXTURE);
  } else {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });
  }

  const mockWeatherRequests = createMockCollection();
  const mockDb = {
    collection: jest.fn().mockReturnValue(mockWeatherRequests)
  };
  dbService.getConnection.mockResolvedValue(mockDb);

  let service;
  jest.isolateModules(() => {
    service = require('../../services/weather-service');
  });

  return { service, mockDb, mockWeatherRequests };
}

async function initService(service) {
  service.initialized = false;
  await service.init();
}

const formatDate = (d) => d.toISOString().split('T')[0];
const today = new Date();
const dates = [
  formatDate(today),
  formatDate(new Date(today.getTime() + 86400000)),
  formatDate(new Date(today.getTime() + 2 * 86400000)),
  formatDate(new Date(today.getTime() + 3 * 86400000))
];

const openMeteoResponse = {
  data: {
    current: { temperature_2m: 22, relative_humidity_2m: 55, weather_code: 0, wind_speed_10m: 10 },
    daily: {
      time: dates,
      weather_code: [0, 1, 3, 61],
      temperature_2m_max: [25, 24, 20, 18],
      temperature_2m_min: [15, 14, 12, 10]
    }
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockReset();
  fs.readFileSync.mockReset();
  // Default to "first city in the fixture" (idx 1 = San Salvador) so most
  // tests get a usable city name without per-test setup. Tests that need
  // no-city / a different lookup result override with mockReturnValueOnce.
  geokdbushAround.mockReset();
  geokdbushAround.mockReturnValue([1]);
});

describe('WeatherService', () => {
  describe('init', () => {
    it('should mark itself initialized', async () => {
      const { service } = setupService();
      await initService(service);

      expect(service.initialized).toBe(true);
      expect(service.cityIndex).not.toBeNull();
    });

    it('should skip re-initialization if already initialized', async () => {
      const { service } = setupService();
      await initService(service);
      await service.init();

      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
    });

    it('should build the offline city index from the bundled dataset', async () => {
      const { service } = setupService();
      await initService(service);

      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('cities500.txt'), 'utf8');
      // Real kdbush index built from the fixture: 2 populated places
      // produce 2 entries in service.cityMeta (in file order).
      expect(service.cityIndex).not.toBeNull();
      expect(service.cityMeta).toEqual([
        { name: 'Vila', country: 'AD' },
        { name: 'San Salvador', country: 'SV' }
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        'WeatherService.city_index_loaded',
        expect.objectContaining({ count: 2 })
      );
    });

    it('should not throw when the bundled city dataset is missing', async () => {
      // Mirrors the ea3e08253 pattern: a degraded init must not abort startup.
      const { service } = setupService({ cityIndexLoaded: false });

      await expect(initService(service)).resolves.toBeUndefined();
      expect(service.cityIndex).toBeNull();
      expect(service.cityMeta).toBeNull();
      expect(service.initialized).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        'WeatherService.city_index_unavailable',
        expect.objectContaining({ error: 'File not found' })
      );
    });

    it('should not throw on DB collection failure (persistence skipped later)', async () => {
      const { service } = setupService();
      dbService.getConnection.mockRejectedValueOnce(new Error('ArangoDB unreachable'));
      service.initialized = false;

      await expect(service.init()).resolves.toBeUndefined();
      expect(service.weatherRequests).toBeNull();
      expect(service.initialized).toBe(true);
    });
  });

  describe('setAnalyticsService', () => {
    it('should set analytics service', () => {
      const { service } = setupService();
      const analytics = { recordWeatherRequest: jest.fn() };
      service.setAnalyticsService(analytics);
      expect(service.analyticsService).toBe(analytics);
    });
  });

  describe('getCityName', () => {
    let service;

    beforeEach(async () => {
      const setup = setupService();
      service = setup.service;
      await initService(service);
    });

    it('should return the closest populated place within the lookup radius', () => {
      // San Salvador coords (fixture has San Salvador at 13.7942,-88.8965).
      // beforeEach already mocks geokdbushAround to return [1] (San Salvador).
      const result = service.getCityName(13.7942, -88.8965);
      expect(result).toBe('San Salvador, SV');
      expect(geokdbushAround).toHaveBeenCalledWith(
        service.cityIndex,
        -88.8965,
        13.7942,
        1,
        expect.any(Number) // CITY_LOOKUP_RADIUS_KM
      );
    });

    it('should return null when no city is within the lookup radius', () => {
      geokdbushAround.mockReturnValueOnce([]);

      expect(service.getCityName(0, 0)).toBeNull();
    });

    it('should return null when the city index failed to load', async () => {
      const setup = setupService({ cityIndexLoaded: false });
      await initService(setup.service);

      expect(setup.service.getCityName(46.2, 6.15)).toBeNull();
    });
  });

  describe('getWeather', () => {
    let service;
    let mockWeatherRequests;

    beforeEach(async () => {
      const setup = setupService();
      service = setup.service;
      mockWeatherRequests = setup.mockWeatherRequests;
      await initService(service);
    });

    it('should fetch and return weather data for the given coordinates', async () => {
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 13.7942, longitude: -88.8965, userId: 'user-1' });

      expect(result.location).toBe('San Salvador, SV');
      expect(result.current).toEqual({
        temperature: 22,
        condition: 'Clear',
        humidity: 55,
        windSpeed: 10
      });
      expect(result.forecast).toHaveLength(3);
      expect(mockWeatherRequests.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', latitude: 13.7942, longitude: -88.8965 })
      );
    });

    it('should throw a typed 400 LOCATION_REQUIRED when coordinates are missing', async () => {
      // Privacy-respectful: the service refuses to invent a position. The
      // route layer catches this typed error and returns 400 to the client.
      await expect(service.getWeather({ userId: 'user-1' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      });
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should throw a typed 400 LOCATION_REQUIRED when coordinates are out of range', async () => {
      await expect(service.getWeather({ latitude: 200, longitude: -300, userId: 'user-1' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      });
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should accept a string-numeric coordinate (Number() parses it)', async () => {
      // Browser code path never sends strings (navigator.geolocation yields
      // numbers), but JSON-stringified inputs from other clients should
      // still work. Number("13.7942") = 13.7942 → accepted.
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: '13.7942', longitude: '-88.8965', userId: 'user-1' });

      expect(result.location).toBe('San Salvador, SV');
      expect(mockWeatherRequests.save).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 13.7942, longitude: -88.8965 })
      );
    });

    it('should reject array coordinates (parseFloat would silently coerce, Number() returns NaN)', async () => {
      // The parseFloat-coercion gap: parseFloat([13.7942, 0]) === 13.7942
      // would have produced a response for the wrong coords. Number() rejects
      // it cleanly.
      await expect(
        service.getWeather({ latitude: [13.7942, 0], longitude: [-88.8965, 0], userId: 'user-1' })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      });
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should reject object coordinates', async () => {
      await expect(
        service.getWeather({ latitude: { foo: 'bar' }, longitude: { baz: 'qux' }, userId: 'user-1' })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      });
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should accept latitude boundaries (+90, -90)', async () => {
      axios.get.mockResolvedValue(openMeteoResponse);

      await service.getWeather({ latitude: 90, longitude: 0, userId: 'user-1' });
      await service.getWeather({ latitude: -90, longitude: 0, userId: 'user-1' });

      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('invalid_coordinates'), expect.any(Object));
    });

    it('should accept longitude boundaries (+180, -180)', async () => {
      axios.get.mockResolvedValue(openMeteoResponse);

      await service.getWeather({ latitude: 0, longitude: 180, userId: 'user-1' });
      await service.getWeather({ latitude: 0, longitude: -180, userId: 'user-1' });

      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('invalid_coordinates'), expect.any(Object));
    });

    it('should accept coordinates just inside boundaries', async () => {
      axios.get.mockResolvedValue(openMeteoResponse);

      await service.getWeather({ latitude: 89.99, longitude: 179.99, userId: 'user-1' });

      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('invalid_coordinates'), expect.any(Object));
    });

    it('should map weather codes correctly', async () => {
      const codeMap = [
        [0, 'Clear'],
        [1, 'Clear'],
        [2, 'Partly Cloudy'],
        [3, 'Cloudy'],
        [51, 'Drizzle'],
        [61, 'Rain'],
        [71, 'Snow'],
        [95, 'Thunderstorm'],
        [99, 'Thunderstorm']
      ];

      for (const [code, expected] of codeMap) {
        jest.clearAllMocks();
        const testDates = [
          formatDate(new Date(today.getTime() + 86400000)),
          formatDate(new Date(today.getTime() + 2 * 86400000)),
          formatDate(new Date(today.getTime() + 3 * 86400000)),
          formatDate(new Date(today.getTime() + 4 * 86400000))
        ];
        axios.get.mockResolvedValueOnce({
          data: {
            current: { temperature_2m: 20, relative_humidity_2m: 50, weather_code: code, wind_speed_10m: 5 },
            daily: {
              time: testDates,
              weather_code: [0, 0, 0, 0],
              temperature_2m_max: [22, 22, 22, 22],
              temperature_2m_min: [12, 12, 12, 12]
            }
          }
        });

        const result = await service.getWeather({ latitude: 13.7942, longitude: -88.8965 });
        expect(result.current.condition).toBe(expected);
      }
    });

    it('should record analytics when analyticsService is set', async () => {
      const mockAnalytics = { recordWeatherRequest: jest.fn().mockResolvedValue({}) };
      service.setAnalyticsService(mockAnalytics);
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      await service.getWeather({ latitude: 13.7942, longitude: -88.8965, userId: 'user-1' });

      expect(mockAnalytics.recordWeatherRequest).toHaveBeenCalledWith(
        expect.objectContaining({ _key: 'wr-1', userId: 'user-1', city: 'San Salvador, SV' })
      );
    });

    it('should handle analytics recording failure gracefully', async () => {
      const mockAnalytics = { recordWeatherRequest: jest.fn().mockRejectedValue(new Error('Analytics down')) };
      service.setAnalyticsService(mockAnalytics);
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 13.7942, longitude: -88.8965 });

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('record_analytics_failed'), expect.any(Object));
    });

    it('should throw a typed 503 CITY_NOT_FOUND when no city is within the lookup radius', async () => {
      // Mid-ocean / remote desert coords → no city within 25 km → the
      // dashboard falls back to weatherErrorDefault instead of rendering
      // a literal 'Unknown' location.
      geokdbushAround.mockReturnValueOnce([]);

      await expect(service.getWeather({ latitude: 13.7942, longitude: -88.8965 })).rejects.toMatchObject({
        statusCode: 503,
        code: 'CITY_NOT_FOUND'
      });
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should throw a typed 503 error when Open-Meteo request fails (graceful degradation)', async () => {
      // Mirrors the ea3e08253 pattern: the only remaining external call
      // (Open-Meteo) must NOT surface as a generic 500 — the route layer
      // maps the typed error to a 503 response.
      axios.get.mockRejectedValueOnce(new Error('timeout of 4000ms exceeded'));

      await expect(service.getWeather({ latitude: 13.7942, longitude: -88.8965 })).rejects.toMatchObject({
        statusCode: 503,
        code: 'WEATHER_UPSTREAM_UNAVAILABLE'
      });
    });

    it('should log a structured error when Open-Meteo fails', async () => {
      axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.getWeather({ latitude: 13.7942, longitude: -88.8965 })).rejects.toMatchObject({
        code: 'WEATHER_UPSTREAM_UNAVAILABLE'
      });
      expect(logger.error).toHaveBeenCalledWith(
        'WeatherService.weather_upstream_unavailable',
        expect.objectContaining({ error: 'ECONNREFUSED' })
      );
    });

    it('should resolve city name from offline index for non-server coordinates', () => {
      // No external call expected — the bundled GeoNames index handles this.
      // Direct getCityName test (no axios mock needed)
      const city = service.getCityName(13.7942, -88.8965);
      expect(city).toBe('San Salvador, SV');
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should return weather data even when weatherRequests collection is unavailable', async () => {
      // Simulates the prod failure mode: init() failed and this.weatherRequests
      // stayed null. Without this guard, every /api/weather call returned 500
      // "Cannot read properties of null (reading 'save')" for 30 days.
      service.weatherRequests = null;
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 13.7942, longitude: -88.8965, userId: 'user-1' });

      expect(result).toBeDefined();
      expect(result.location).toBe('San Salvador, SV');
      expect(result.current).toEqual({
        temperature: 22,
        condition: 'Clear',
        humidity: 55,
        windSpeed: 10
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'WeatherService.request_persistence_skipped',
        expect.objectContaining({ reason: 'collection_unavailable' })
      );
    });
  });
});
