'use strict';

require('../setup-env');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak-auth-service (used by middleware)
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

// Mock user-provisioning-service (used by middleware)
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// Mock session-service singleton (loaded by index.js)
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

// Mock analytics-service with ALL required methods (controller constructor validates getDashboardAnalytics)
jest.mock('../../services/analytics-service', () => ({
  getDashboardAnalytics: jest.fn(),
  getAnalytics: jest.fn(),
  getUniqueUsersCount: jest.fn(),
  getTimeSeriesData: jest.fn(),
  formatDateLabel: jest.fn((t) => t),
  getSatisfactionGaugeData: jest.fn(),
  getSatisfactionHeatmapData: jest.fn(),
  recordQuery: jest.fn(),
  recordFeedback: jest.fn(),
  trackEvent: jest.fn(),
  db: {
    query: jest.fn().mockResolvedValue({
      all: jest.fn().mockResolvedValue([])
    })
  },
  init: jest.fn()
}));

// Mock swagger dependencies
jest.mock(
  'swagger-jsdoc',
  () => () => ({
    openapi: '3.0.0',
    info: {},
    components: {},
    security: []
  }),
  { virtual: true }
);
jest.mock(
  'swagger-ui-express',
  () => ({
    serve: [],
    setup: () => (req, res, next) => next()
  }),
  { virtual: true }
);

// Mock all other services loaded by index.js
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));

// NOTE: Do NOT mock AnalyticsController — the route file instantiates it internally
// with the mocked analytics-service. The controller constructor validates getDashboardAnalytics.

// Prevent process.exit during tests
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');
const { createMockUser } = require('../fixtures/users');

// Get references to mocked modules
const keycloakAuthService = require('../../services/keycloak-auth-service');
const userProvisioningService = require('../../services/user-provisioning-service');
const analyticsService = require('../../services/analytics-service');

const mockUser = createMockUser();
const validToken = createValidToken();

// Create app once for all tests
let app;
beforeAll(() => {
  app = createApp({ services: { analyticsService } });
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: middleware passes through with valid user
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    realm_access: { roles: ['user'] }
  });
  keycloakAuthService.checkUserStatusInKeycloak.mockResolvedValue(null);
  userProvisioningService.provisionUser.mockResolvedValue(mockUser);

  // Default analytics service mocks
  analyticsService.getDashboardAnalytics.mockResolvedValue({
    queries: { total: 1000, avgResponseTime: 2.8, unanswered: 50, answeredPercentage: 95 },
    categories: [],
    feedback: { total: 200, positive: 150, neutral: 30, negative: 20, positivePercentage: 75, negativePercentage: 10 },
    users: { activeCount: 120 },
    topQueries: []
  });
  analyticsService.getAnalytics.mockResolvedValue({
    queryCount: 500,
    feedbackCount: 100,
    avgRating: 4.2,
    timeDistribution: {},
    categoryDistribution: {}
  });
  analyticsService.getUniqueUsersCount.mockResolvedValue(120);
  analyticsService.getSatisfactionGaugeData.mockResolvedValue({
    currentValue: 85.0,
    previousValue: 80.0,
    changePercentage: 6.25,
    target: 90.0,
    historicalData: [
      { label: 'Jan', value: 80 },
      { label: 'Feb', value: 85 }
    ]
  });
  analyticsService.getSatisfactionHeatmapData.mockResolvedValue([
    { name: 'Category A', data: [{ x: 'Week 1', y: 85 }] }
  ]);
  analyticsService.getTimeSeriesData.mockResolvedValue([
    { timestamp: '2025-01-01T00:00:00Z', value: 100, userCount: 50 }
  ]);
  analyticsService.trackEvent.mockResolvedValue({
    _key: 'event-1',
    userId: mockUser.iss_sub,
    eventType: 'pageView',
    timestamp: '2025-01-01T00:00:00Z'
  });
  analyticsService.db.query.mockResolvedValue({
    all: jest.fn().mockResolvedValue([])
  });
});

// Helpers for authenticated requests
function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// AC1: Auth guard — all analytics routes require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on GET /api/analytics/dashboard without token', async () => {
    const response = await request(app).get('/api/analytics/dashboard');
    expect(response.status).toBe(401);
  });

  it('should return 401 on GET /api/analytics without token', async () => {
    const response = await request(app).get('/api/analytics');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/analytics/events without token', async () => {
    const response = await request(app).post('/api/analytics/events').send({ eventType: 'pageView' });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC2: GET /api/analytics/dashboard
// ============================================================
describe('GET /api/analytics/dashboard (AC2)', () => {
  const dashboardData = {
    queries: { total: 1000, avgResponseTime: 2.8, unanswered: 50, answeredPercentage: 95 },
    categories: [{ categoryId: 'cat-1', name: 'Health', count: 42 }],
    feedback: { total: 200, positive: 150, neutral: 30, negative: 20, positivePercentage: 75, negativePercentage: 10 },
    users: { activeCount: 120 },
    topQueries: [{ text: 'What is AI?', count: 15, avgTime: 1.2 }]
  };

  it('should return 200 with dashboard data when valid token provided', async () => {
    analyticsService.getDashboardAnalytics.mockResolvedValue(dashboardData);

    const response = await authGet('/api/analytics/dashboard?startDate=2025-01-01&endDate=2025-01-31&locale=en');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(dashboardData);
    expect(analyticsService.getDashboardAnalytics).toHaveBeenCalledWith('2025-01-01', '2025-01-31', 'en');
  });

  it('should return 200 without startDate/endDate — defaults applied', async () => {
    analyticsService.getDashboardAnalytics.mockResolvedValue(dashboardData);

    const response = await authGet('/api/analytics/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(dashboardData);
    // Route provides defaults: today's date for startDate, now for endDate, 'en' for locale
    expect(analyticsService.getDashboardAnalytics).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'en');
  });

  it('should return 401 when no token', async () => {
    const response = await request(app).get('/api/analytics/dashboard');
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC3: GET /api/analytics/metric/:metric
// ============================================================
describe('GET /api/analytics/metric/:metric (AC3)', () => {
  it('should return 200 with { metric, value } for totalQueries', async () => {
    analyticsService.getDashboardAnalytics.mockResolvedValue({
      queries: { total: 1000, avgResponseTime: 2.8 }
    });

    const response = await authGet('/api/analytics/metric/totalQueries?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ metric: 'totalQueries', value: 1000 });
  });

  it('should return 200 with { metric, value } for uniqueUsers', async () => {
    analyticsService.getUniqueUsersCount.mockResolvedValue(120);

    const response = await authGet('/api/analytics/metric/uniqueUsers?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ metric: 'uniqueUsers', value: 120 });
  });

  it('should return 200 with { metric, value } for averageResponseTime', async () => {
    analyticsService.getDashboardAnalytics.mockResolvedValue({
      queries: { total: 1000, avgResponseTime: 2.8 }
    });

    const response = await authGet('/api/analytics/metric/averageResponseTime?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ metric: 'averageResponseTime', value: 2.8 });
  });

  it('should return 200 with { metric, value } for satisfactionRate', async () => {
    analyticsService.getSatisfactionGaugeData.mockResolvedValue({ currentValue: 85.0 });

    const response = await authGet('/api/analytics/metric/satisfactionRate?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ metric: 'satisfactionRate', value: 85.0 });
  });

  it('should return 400 for unsupported metric name', async () => {
    const response = await authGet('/api/analytics/metric/invalidMetric?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Unsupported metric: invalidMetric' });
  });

  it('should return 400 when startDate/endDate missing', async () => {
    const response = await authGet('/api/analytics/metric/totalQueries');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing required parameters: startDate and endDate are required' });
  });
});

// ============================================================
// AC4: GET /api/analytics (general)
// ============================================================
describe('GET /api/analytics (AC4)', () => {
  const generalData = {
    queryCount: 500,
    feedbackCount: 100,
    avgRating: 4.2,
    timeDistribution: { morning: 120, afternoon: 200, evening: 180 },
    categoryDistribution: { health: 150, education: 200 }
  };

  it('should return 200 with general analytics data', async () => {
    analyticsService.getAnalytics.mockResolvedValue(generalData);

    const response = await authGet('/api/analytics?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(generalData);
    expect(analyticsService.getAnalytics).toHaveBeenCalledWith({}, '2025-01-01', '2025-01-31');
  });

  it('should pass filters as parsed JSON when provided', async () => {
    analyticsService.getAnalytics.mockResolvedValue(generalData);
    const filters = JSON.stringify({ category: 'health' });

    const response = await authGet(`/api/analytics?filters=${encodeURIComponent(filters)}&locale=fr`);

    expect(response.status).toBe(200);
    expect(analyticsService.getAnalytics).toHaveBeenCalledWith({ category: 'health' }, undefined, undefined);
  });
});

// ============================================================
// AC5: GET /api/analytics/timeseries/:metricType
// ============================================================
describe('GET /api/analytics/timeseries/:metricType (AC5)', () => {
  it('should return 200 with time series array for valid metricType and interval', async () => {
    analyticsService.getTimeSeriesData.mockResolvedValue([
      { timestamp: '2025-01-01T00:00:00Z', value: 100, userCount: 50 },
      { timestamp: '2025-01-02T00:00:00Z', value: 120, userCount: 60 }
    ]);

    const response = await authGet(
      '/api/analytics/timeseries/queries?interval=daily&startDate=2025-01-01&endDate=2025-01-31'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { timestamp: '2025-01-01T00:00:00Z', dateLabel: '2025-01-01T00:00:00Z', value: 100, userCount: 50 },
      { timestamp: '2025-01-02T00:00:00Z', dateLabel: '2025-01-02T00:00:00Z', value: 120, userCount: 60 }
    ]);
    expect(analyticsService.getTimeSeriesData).toHaveBeenCalledWith('queries', 'daily', '2025-01-01', '2025-01-31');
  });

  it('should return 200 for users metricType with weekly interval', async () => {
    analyticsService.getTimeSeriesData.mockResolvedValue([
      { timestamp: '2025-01-06T00:00:00Z', value: 50, userCount: 25 }
    ]);

    const response = await authGet(
      '/api/analytics/timeseries/users?interval=weekly&startDate=2025-01-01&endDate=2025-01-31'
    );

    expect(response.status).toBe(200);
    expect(analyticsService.getTimeSeriesData).toHaveBeenCalledWith('users', 'weekly', '2025-01-01', '2025-01-31');
  });

  it('should return 400 for invalid interval', async () => {
    const response = await authGet(
      '/api/analytics/timeseries/queries?interval=yearly&startDate=2025-01-01&endDate=2025-01-31'
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid interval: yearly. Must be one of: hourly, daily, weekly, monthly'
    });
  });

  it('should return 400 when interval/startDate/endDate missing', async () => {
    const response = await authGet('/api/analytics/timeseries/queries');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Missing required parameters: interval, startDate, and endDate are required'
    });
  });
});

// ============================================================
// AC6: POST /api/analytics/events
// ============================================================
describe('POST /api/analytics/events (AC6)', () => {
  it('should return 201 with created event when valid eventType provided', async () => {
    const createdEvent = {
      _key: 'event-1',
      userId: mockUser.iss_sub,
      eventType: 'pageView',
      timestamp: '2025-01-01T00:00:00Z'
    };
    analyticsService.trackEvent.mockResolvedValue(createdEvent);

    const response = await authPost('/api/analytics/events', { eventType: 'pageView' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(createdEvent);
    expect(analyticsService.trackEvent).toHaveBeenCalledWith(mockUser.iss_sub, 'pageView', {});
  });

  it('should return 400 when eventType missing', async () => {
    const response = await authPost('/api/analytics/events', {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'eventType is required' });
  });

  it('should return 401 when user has no iss_sub claim', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: undefined
    });

    const response = await authPost('/api/analytics/events', { eventType: 'pageView' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
  });
});

// ============================================================
// AC7: GET /api/analytics/records and GET /api/analytics/events
// ============================================================
describe('GET /api/analytics/records (AC7)', () => {
  it('should return 200 with paginated results', async () => {
    const records = [{ _key: 'a-1', timestamp: '2025-01-01T00:00:00Z' }];
    const mockAll = jest.fn().mockResolvedValue(records);
    analyticsService.db.query.mockResolvedValue({ all: mockAll });

    const response = await authGet('/api/analytics/records?limit=10&offset=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(records);
    expect(analyticsService.db.query).toHaveBeenCalled();
  });

  it('should use default limit=20 and offset=0', async () => {
    const mockAll = jest.fn().mockResolvedValue([]);
    analyticsService.db.query.mockResolvedValue({ all: mockAll });

    const response = await authGet('/api/analytics/records');

    expect(response.status).toBe(200);
    expect(analyticsService.db.query).toHaveBeenCalledTimes(1);
    const queryArg = analyticsService.db.query.mock.calls[0][0];
    expect(queryArg).toContain('LIMIT 0, 20');
  });
});

describe('GET /api/analytics/events (AC7)', () => {
  it('should return 200 with paginated results', async () => {
    const events = [{ _key: 'e-1', eventType: 'pageView', timestamp: '2025-01-01T00:00:00Z' }];
    const mockAll = jest.fn().mockResolvedValue(events);
    analyticsService.db.query.mockResolvedValue({ all: mockAll });

    const response = await authGet('/api/analytics/events?limit=5&offset=0');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(events);
    expect(analyticsService.db.query).toHaveBeenCalled();
  });
});

// ============================================================
// AC8: Satisfaction endpoints
// ============================================================
describe('GET /api/analytics/satisfaction/gauge (AC8)', () => {
  const gaugeData = {
    currentValue: 85.0,
    previousValue: 80.0,
    changePercentage: 6.25,
    target: 90.0,
    historicalData: [
      { label: 'Jan', value: 80 },
      { label: 'Feb', value: 85 }
    ]
  };

  it('should return 200 with gauge data', async () => {
    analyticsService.getSatisfactionGaugeData.mockResolvedValue(gaugeData);

    const response = await authGet('/api/analytics/satisfaction/gauge?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(gaugeData);
  });

  it('should return 400 when startDate/endDate missing', async () => {
    const response = await authGet('/api/analytics/satisfaction/gauge');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing required parameters: startDate and endDate are required' });
  });
});

describe('GET /api/analytics/satisfaction/heatmap (AC8)', () => {
  const heatmapData = [{ name: 'Category A', data: [{ x: 'Week 1', y: 85 }] }];

  it('should return 200 with heatmap array', async () => {
    analyticsService.getSatisfactionHeatmapData.mockResolvedValue(heatmapData);

    const response = await authGet('/api/analytics/satisfaction/heatmap?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(heatmapData);
  });

  it('should return 400 when startDate/endDate missing', async () => {
    const response = await authGet('/api/analytics/satisfaction/heatmap');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing required parameters: startDate and endDate are required' });
  });
});

// ============================================================
// AC19: Route catch block error format (500 path)
// ============================================================
describe('Route catch block error format (AC19)', () => {
  it('should return 500 with { message } when service throws', async () => {
    analyticsService.getAnalytics.mockRejectedValue(new Error('Database connection failed'));

    const response = await authGet('/api/analytics?startDate=2025-01-01&endDate=2025-01-31');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Database connection failed' });
  });
});
