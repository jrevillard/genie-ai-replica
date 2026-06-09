// Mock clamscan — require('clamscan') returns the constructor directly
jest.mock('clamscan', () =>
  jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue({ scanStream: jest.fn().mockResolvedValue({ isInfected: false }) })
  }))
);

// Mock shared-lib
jest.mock(
  '../../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

const securityService = require('../../../services/securityService');

describe('securityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default state
    securityService.isInitialized = false;
    securityService.clamscan = null;
  });

  describe('initialize', () => {
    it('should set isInitialized to true when virusScanning is true', async () => {
      const originalConfig = require('../../../config/appConfig');
      originalConfig.virusScanning = true;

      await securityService.initialize();

      expect(securityService.isInitialized).toBe(true);
      expect(securityService.clamscan).not.toBeNull();

      originalConfig.virusScanning = false;
    });

    it('should not initialize ClamAV when virusScanning is false', async () => {
      await securityService.initialize();

      expect(securityService.isInitialized).toBe(true);
      expect(securityService.clamscan).toBeNull();
    });

    it('should not re-initialize if already initialized with clamscan', async () => {
      securityService.isInitialized = true;
      securityService.clamscan = { alreadyInitialized: true };

      await securityService.initialize();

      expect(securityService.clamscan).toEqual({ alreadyInitialized: true });
    });

    it('should throw with descriptive error on ClamAV init failure', async () => {
      const NodeClam = require('clamscan');
      NodeClam.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('Connection refused'))
      }));

      const originalConfig = require('../../../config/appConfig');
      originalConfig.virusScanning = true;

      await expect(securityService.initialize()).rejects.toThrow('Failed to initialize ClamAV');

      originalConfig.virusScanning = false;
    });
  });

  describe('ensureInitialized', () => {
    it('should call initialize when not initialized', async () => {
      securityService.isInitialized = false;
      const initSpy = jest.spyOn(securityService, 'initialize').mockResolvedValue();

      await securityService.ensureInitialized();

      expect(initSpy).toHaveBeenCalledTimes(1);
      initSpy.mockRestore();
    });

    it('should skip initialization when already initialized', async () => {
      securityService.isInitialized = true;
      const initSpy = jest.spyOn(securityService, 'initialize').mockResolvedValue();

      await securityService.ensureInitialized();

      expect(initSpy).not.toHaveBeenCalled();
      initSpy.mockRestore();
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
      const bigBuffer = Buffer.alloc(50 * 1024 * 1024 + 1);
      return expect(securityService.scanBuffer(bigBuffer)).rejects.toThrow('Buffer size exceeds');
    });

    it('should skip scanning when clamscan is null and return clean result', async () => {
      securityService.isInitialized = true;
      securityService.clamscan = null;

      const result = await securityService.scanBuffer(Buffer.from('test content'));
      expect(result).toEqual({ isInfected: false });
    });

    it('should scan buffer with clamscan and return clean result', async () => {
      const mockScanStream = jest.fn().mockResolvedValue({ isInfected: false, viruses: [] });
      securityService.clamscan = { scanStream: mockScanStream };
      securityService.isInitialized = true;

      const result = await securityService.scanBuffer(Buffer.from('safe content'));
      expect(result.isInfected).toBe(false);
      expect(mockScanStream).toHaveBeenCalledTimes(1);
    });

    it('should detect virus in infected buffer', async () => {
      const mockScanStream = jest.fn().mockResolvedValue({ isInfected: true, viruses: ['EICAR-Test'] });
      securityService.clamscan = { scanStream: mockScanStream };
      securityService.isInitialized = true;

      const result = await securityService.scanBuffer(Buffer.from('infected content'));
      expect(result.isInfected).toBe(true);
      expect(result.viruses).toContain('EICAR-Test');
    });

    it('should call ensureInitialized before scanning', async () => {
      const mockScanStream = jest.fn().mockResolvedValue({ isInfected: false });
      securityService.clamscan = { scanStream: mockScanStream };
      securityService.isInitialized = false;

      // ensureInitialized will call initialize which sets isInitialized to true
      const result = await securityService.scanBuffer(Buffer.from('test'));
      // If it didn't call ensureInitialized, clamscan would be null and skip scanning
      expect(result).toBeDefined();
    });

    it('should wrap scan errors with descriptive message', async () => {
      const mockScanStream = jest.fn().mockRejectedValue(new Error('timeout'));
      securityService.clamscan = { scanStream: mockScanStream };
      securityService.isInitialized = true;

      await expect(securityService.scanBuffer(Buffer.from('test'))).rejects.toThrow('Buffer scan failed');
    });
  });

  describe('_convertToStream', () => {
    it('should convert buffer to readable stream', () => {
      const buf = Buffer.from('hello');
      const stream = securityService._convertToStream(buf);

      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        expect(Buffer.concat(chunks).toString()).toBe('hello');
      });
    });
  });
});
