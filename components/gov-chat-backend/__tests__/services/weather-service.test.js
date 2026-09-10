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

const axios = require('axios');
const { logger, dbService } = require('../../shared-lib');

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'wr-1' })
  };
}

function setupService() {
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

const ipapiResponse = {
  status: 200,
  data: { latitude: 46.2, longitude: 6.15, city: 'Geneva', country_name: 'Switzerland' }
};

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
});

describe('WeatherService', () => {
  describe('init', () => {
    it('should initialize with server location from ipapi', async () => {
      axios.get.mockResolvedValueOnce(ipapiResponse);
      const { service } = setupService();
      await initService(service);

      expect(service.serverLocation).toEqual({
        latitude: 46.2,
        longitude: 6.15,
        city: 'Geneva, Switzerland'
      });
      expect(service.initialized).toBe(true);
    });

    it('should skip re-initialization if already initialized', async () => {
      axios.get.mockResolvedValueOnce(ipapiResponse);
      const { service } = setupService();
      await initService(service);
      await service.init();

      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
    });

    it('should throw on ipapi failure', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network error'));
      const { service } = setupService();
      service.initialized = false;

      await expect(service.init()).rejects.toThrow('Network error');
    });

    it('should warn when server location returns 0,0 coordinates', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { latitude: 0, longitude: 0, city: '', country_name: '' }
      });
      const { service } = setupService();
      await initService(service);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Server location fetch failed'));
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
      axios.get.mockResolvedValueOnce(ipapiResponse);
      const setup = setupService();
      service = setup.service;
      await initService(service);
    });

    it('should return city name from nominatim response', async () => {
      axios.get.mockResolvedValueOnce({
        data: { address: { city: 'Lausanne', country: 'Switzerland' } }
      });

      const result = await service.getCityName(46.5, 6.6);
      expect(result).toBe('Lausanne, Switzerland');
      expect(axios.get).toHaveBeenCalledWith(
        'https://nominatim.openstreetmap.org/reverse',
        expect.objectContaining({
          params: expect.objectContaining({ lat: 46.5, lon: 6.6, format: 'json', zoom: 10 })
        })
      );
    });

    it('should fall back to town when city is not present', async () => {
      axios.get.mockResolvedValueOnce({
        data: { address: { town: 'Morges', country: 'Switzerland' } }
      });
      expect(await service.getCityName(46.5, 6.5)).toBe('Morges, Switzerland');
    });

    it('should fall back to village when city and town not present', async () => {
      axios.get.mockResolvedValueOnce({
        data: { address: { village: 'Nyon', country: 'Switzerland' } }
      });
      expect(await service.getCityName(46.4, 6.2)).toBe('Nyon, Switzerland');
    });

    it('should fall back to county when no city/town/village', async () => {
      axios.get.mockResolvedValueOnce({
        data: { address: { county: 'Vaud', country: 'Switzerland' } }
      });
      expect(await service.getCityName(46.5, 6.5)).toBe('Vaud, Switzerland');
    });

    it('should return Unknown on API failure', async () => {
      axios.get.mockRejectedValueOnce(new Error('Timeout'));
      expect(await service.getCityName(46.5, 6.5)).toBe('Unknown');
    });
  });

  describe('getWeather', () => {
    let service;
    let mockWeatherRequests;

    beforeEach(async () => {
      axios.get.mockResolvedValueOnce(ipapiResponse);
      const setup = setupService();
      service = setup.service;
      mockWeatherRequests = setup.mockWeatherRequests;
      await initService(service);
    });

    it('should fetch and return weather data for server location', async () => {
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 46.2, longitude: 6.15, userId: 'user-1' });

      expect(result.location).toBe('Geneva, Switzerland');
      expect(result.current).toEqual({
        temperature: 22,
        condition: 'Clear',
        humidity: 55,
        windSpeed: 10
      });
      expect(result.forecast).toHaveLength(3);
      expect(mockWeatherRequests.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', latitude: 46.2, longitude: 6.15 })
      );
    });

    it('should use server location when no coordinates provided', async () => {
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ userId: 'user-1' });
      expect(result.current).toBeDefined();
      expect(result.location).toBe('Geneva, Switzerland');
    });

    it('should fallback to server location for invalid coordinates', async () => {
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      await service.getWeather({ latitude: 200, longitude: -300, userId: 'user-1' });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid_coordinates'), expect.any(Object));
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

        const result = await service.getWeather({ latitude: 46.2, longitude: 6.15 });
        expect(result.current.condition).toBe(expected);
      }
    });

    it('should record analytics when analyticsService is set', async () => {
      const mockAnalytics = { recordWeatherRequest: jest.fn().mockResolvedValue({}) };
      service.setAnalyticsService(mockAnalytics);
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      await service.getWeather({ latitude: 46.2, longitude: 6.15, userId: 'user-1' });

      expect(mockAnalytics.recordWeatherRequest).toHaveBeenCalledWith(
        expect.objectContaining({ _key: 'wr-1', userId: 'user-1', city: 'Geneva, Switzerland' })
      );
    });

    it('should handle analytics recording failure gracefully', async () => {
      const mockAnalytics = { recordWeatherRequest: jest.fn().mockRejectedValue(new Error('Analytics down')) };
      service.setAnalyticsService(mockAnalytics);
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 46.2, longitude: 6.15 });

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('record_analytics_failed'), expect.any(Object));
    });

    it('should throw when weather API fails', async () => {
      axios.get.mockRejectedValueOnce(new Error('Weather API unavailable'));

      await expect(service.getWeather({ latitude: 46.2, longitude: 6.15 })).rejects.toThrow('Weather API unavailable');
    });

    it('should use default server location when serverLocation is null', async () => {
      service.serverLocation = null;
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({});
      expect(result).toBeDefined();
    });

    it('should resolve city name for non-server coordinates', async () => {
      axios.get
        .mockResolvedValueOnce({ data: { address: { city: 'Zurich', country: 'Switzerland' } } })
        .mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 47.37, longitude: 8.54 });
      expect(result.location).toBe('Zurich, Switzerland');
    });

    // Bug fix: WeatherService crashed with 500 when init() never ran (e.g. ipapi.co
    // unreachable at boot) — `weatherRequests` stayed null and `.save()` threw
    // `Cannot read properties of null (reading 'save')`. The service must now
    // return weather data and skip persistence with a clear log line.
    it('should return weather data and skip persistence when weatherRequests is null', async () => {
      // Simulate init() never ran successfully
      service.initialized = true;
      service.weatherRequests = null;
      service.serverLocation = { latitude: 46.2, longitude: 6.15, city: 'Geneva, Switzerland' };
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 46.2, longitude: 6.15, userId: 'user-1' });

      expect(result).toBeDefined();
      expect(result.current).toEqual(expect.objectContaining({ temperature: 22 }));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('persistence_unavailable'), expect.any(Object));
    });

    // Bug fix: if .save() itself throws (e.g. transient Arango error), the
    // service must still return the weather data — persistence is best-effort.
    it('should return weather data when weatherRequests.save throws', async () => {
      mockWeatherRequests.save.mockRejectedValueOnce(new Error('Arango unavailable'));
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      const result = await service.getWeather({ latitude: 46.2, longitude: 6.15, userId: 'user-1' });

      expect(result).toBeDefined();
      expect(result.current).toEqual(expect.objectContaining({ temperature: 22 }));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('save_request_failed'), expect.any(Object));
    });

    // Bug fix: analytics must NOT be recorded when persistence failed
    // (no requestId to log against).
    it('should skip analytics recording when persistence fails', async () => {
      const mockAnalytics = { recordWeatherRequest: jest.fn().mockResolvedValue({}) };
      service.setAnalyticsService(mockAnalytics);
      mockWeatherRequests.save.mockRejectedValueOnce(new Error('Arango unavailable'));
      axios.get.mockResolvedValueOnce(openMeteoResponse);

      await service.getWeather({ latitude: 46.2, longitude: 6.15, userId: 'user-1' });

      expect(mockAnalytics.recordWeatherRequest).not.toHaveBeenCalled();
    });
  });
});
