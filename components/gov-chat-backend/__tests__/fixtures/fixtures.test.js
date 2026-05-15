'use strict';

const jwt = require('jsonwebtoken');
const { createMockUser, createMockAdmin, defaultUser } = require('./users');
const { createValidToken, createExpiredToken, TEST_JWT_SECRET } = require('./tokens');
const { createMockReq, createMockRes, createMockNext } = require('./requests');

describe('Fixtures', () => {
  describe('createMockUser', () => {
    it('returns expected default shape', () => {
      const user = createMockUser();
      expect(user).toEqual({
        _key: 'user-123',
        sub: 'user-123',
        iss_sub: 'http://localhost:8080/realms/genie#user-123',
        iss: 'http://localhost:8080/realms/genie',
        name: 'Test User',
        email: 'test@example.com',
        email_verified: true,
        realm_roles: ['user'],
        resource_access: { 'genie-app': { roles: ['user'] } },
        preferred_username: 'testuser'
      });
    });

    it('overrides work', () => {
      const user = createMockUser({ name: 'Custom', email: 'custom@test.com' });
      expect(user.name).toBe('Custom');
      expect(user.email).toBe('custom@test.com');
      expect(user._key).toBe('user-123');
    });
  });

  describe('createMockAdmin', () => {
    it('returns user with admin roles', () => {
      const admin = createMockAdmin();
      expect(admin.realm_roles).toEqual(['admin']);
      expect(admin.resource_access).toEqual({ 'genie-app': { roles: ['admin'] } });
    });

    it('overrides work on admin', () => {
      const admin = createMockAdmin({ name: 'Super Admin' });
      expect(admin.name).toBe('Super Admin');
      expect(admin.realm_roles).toEqual(['admin']);
    });
  });

  describe('createValidToken', () => {
    it('returns a decodable JWT string', () => {
      const token = createValidToken();
      const decoded = jwt.verify(token, TEST_JWT_SECRET);
      expect(decoded.sub).toBe('user-123');
      expect(decoded.iss).toBe('http://localhost:8080/realms/genie');
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('accepts claim overrides', () => {
      const token = createValidToken({ sub: 'custom-user' });
      const decoded = jwt.verify(token, TEST_JWT_SECRET);
      expect(decoded.sub).toBe('custom-user');
    });
  });

  describe('createExpiredToken', () => {
    it('returns an expired JWT', () => {
      const token = createExpiredToken();
      expect(() => jwt.verify(token, TEST_JWT_SECRET)).toThrow('jwt expired');
    });

    it('expired token is still decodable with ignoreExpiration', () => {
      const token = createExpiredToken();
      const decoded = jwt.verify(token, TEST_JWT_SECRET, { ignoreExpiration: true });
      expect(decoded.sub).toBe('user-123');
      expect(decoded.exp).toBeLessThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('createMockReq', () => {
    it('returns expected default shape with user', () => {
      const req = createMockReq();
      expect(req.user).toEqual(defaultUser);
      expect(req.params).toEqual({});
      expect(req.query).toEqual({});
      expect(req.body).toEqual({});
      expect(req.headers).toEqual({});
      expect(req.method).toBe('GET');
      expect(req.path).toBe('/');
    });

    it('overrides work', () => {
      const req = createMockReq({ method: 'POST', path: '/api/test', body: { foo: 'bar' } });
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/api/test');
      expect(req.body).toEqual({ foo: 'bar' });
      expect(req.user).toEqual(defaultUser);
    });
  });

  describe('createMockRes', () => {
    it('returns mock with jest functions', () => {
      const res = createMockRes();
      expect(typeof res.json).toBe('function');
      expect(typeof res.status).toBe('function');
      expect(typeof res.send).toBe('function');
      expect(typeof res.set).toBe('function');
      expect(typeof res.setHeader).toBe('function');
      expect(typeof res.getHeader).toBe('function');
      expect(res.status.mockReturnThis).toBeDefined();
    });

    it('status returns this for chaining', () => {
      const res = createMockRes();
      const result = res.status(400);
      expect(result).toBe(res);
    });

    it('setHeader returns this for chaining', () => {
      const res = createMockRes();
      const result = res.setHeader('X-Custom', 'value');
      expect(result).toBe(res);
    });
  });

  describe('createMockNext', () => {
    it('returns a jest mock function', () => {
      const next = createMockNext();
      expect(typeof next).toBe('function');
      expect(next._isMockFunction).toBe(true);
    });
  });

  describe('shared-lib mock', () => {
    it('has all 4 exports', () => {
      const sharedLib = require('../mocks/shared-lib');
      expect(sharedLib.logger).toBeDefined();
      expect(sharedLib.dbService).toBeDefined();
      expect(sharedLib.securityHeaders).toBeDefined();
      expect(sharedLib.SecurityMiddleware).toBeDefined();
    });

    it('logger has info/error/warn/debug jest fns', () => {
      const { logger } = require('../mocks/shared-lib');
      ['info', 'error', 'warn', 'debug'].forEach((method) => {
        expect(typeof logger[method]).toBe('function');
        expect(logger[method]._isMockFunction).toBe(true);
      });
    });

    it('dbService has getConnection jest fn', () => {
      const { dbService } = require('../mocks/shared-lib');
      expect(typeof dbService.getConnection).toBe('function');
      expect(dbService.getConnection._isMockFunction).toBe(true);
    });

    it('securityHeaders is a pass-through middleware', () => {
      const { securityHeaders } = require('../mocks/shared-lib');
      const next = jest.fn();
      const req = {};
      const res = {};
      securityHeaders(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('SecurityMiddleware has applySecurityMiddleware jest fn', () => {
      const { SecurityMiddleware } = require('../mocks/shared-lib');
      expect(typeof SecurityMiddleware.applySecurityMiddleware).toBe('function');
      expect(SecurityMiddleware.applySecurityMiddleware._isMockFunction).toBe(true);
    });
  });
});
