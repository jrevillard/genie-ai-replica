const jwt = require('jsonwebtoken');

// Mock clamscan — require('clamscan') returns the constructor directly
jest.mock('clamscan', () =>
  jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue({ scanStream: jest.fn().mockResolvedValue({ isInfected: false }) }),
  }))
);

const securityService = require('../../../services/securityService');

const TEST_JWT_SECRET = 'test-secret-key-for-unit-tests';

describe('securityService', () => {
  describe('initialize', () => {
    it('should set isInitialized to true when virusScanning is true', async () => {
      securityService.isInitialized = false;
      securityService.clamscan = null;

      const originalConfig = require('../../../config/appConfig');
      originalConfig.virusScanning = true;

      await securityService.initialize();

      expect(securityService.isInitialized).toBe(true);
      expect(securityService.clamscan).not.toBeNull();

      // Restore
      originalConfig.virusScanning = false;
    });

    it('should not initialize ClamAV when virusScanning is false', async () => {
      securityService.isInitialized = false;
      securityService.clamscan = null;

      await securityService.initialize();

      expect(securityService.isInitialized).toBe(true);
      expect(securityService.clamscan).toBeNull();
    });

    it('should not re-initialize if already initialized', async () => {
      securityService.isInitialized = true;
      securityService.clamscan = { alreadyInitialized: true };

      await securityService.initialize();

      expect(securityService.clamscan).toEqual({ alreadyInitialized: true });
    });
  });

  describe('scanBuffer', () => {
    it('should reject non-Buffer input', async () => {
      await expect(securityService.scanBuffer('not a buffer')).rejects.toThrow('Input must be a Buffer');
    });

    it('should reject empty buffer', async () => {
      await expect(securityService.scanBuffer(Buffer.alloc(0))).rejects.toThrow('Buffer is empty');
    });

    it('should reject oversized buffer', () => {
      // maxBufferSize is 50MB
      const bigBuffer = Buffer.alloc(50 * 1024 * 1024 + 1);
      return expect(securityService.scanBuffer(bigBuffer)).rejects.toThrow('Buffer size exceeds');
    });

    it('should skip scanning when clamscan is null and return clean result', async () => {
      securityService.isInitialized = true;
      securityService.clamscan = null;

      const result = await securityService.scanBuffer(Buffer.from('test content'));
      expect(result).toEqual({ isInfected: false });
    });
  });

  describe('verifyToken', () => {
    it('should return decoded token for valid JWT', async () => {
      const originalConfig = require('../../../config/appConfig');
      originalConfig.security.jwtSecret = TEST_JWT_SECRET;

      const token = jwt.sign({ userId: 'test-user', role: 'Admin' }, TEST_JWT_SECRET, { expiresIn: '1h' });
      const decoded = await securityService.verifyToken(token);

      expect(decoded).toEqual(expect.objectContaining({ userId: 'test-user', role: 'Admin' }));

      // Restore
      originalConfig.security.jwtSecret = 'default-jwt-secret';
    });

    it('should return null for invalid token', async () => {
      const originalConfig = require('../../../config/appConfig');
      originalConfig.security.jwtSecret = TEST_JWT_SECRET;

      const result = await securityService.verifyToken('invalid.token.here');
      expect(result).toBeNull();

      originalConfig.security.jwtSecret = 'default-jwt-secret';
    });
  });
});
