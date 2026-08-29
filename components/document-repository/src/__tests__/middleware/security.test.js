'use strict';

// Mock shared-lib before anything else
jest.mock('../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

// Mock config
jest.mock('../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: ['application/pdf', 'text/plain', 'text/html'],
    allowedExtensions: ['.pdf', '.txt', '.html'],
    maxFileSize: 52428800,
    maxFilesUpload: 5
  },
  virusScanning: true,
  clamscan: {
    socket: null,
    port: 3310,
    timeout: 60000,
    localFallback: false,
    path: '/usr/bin/clamdscan',
    active: true,
    removeInfected: false,
    quarantineInfected: false,
    debugMode: false
  }
}));

// file-type 21 is ESM-only: the module is mocked via unstable_mockModule (Jest
// runs under --experimental-vm-modules). The factory reads the shared jest.fn
// lazily through a getter, so per-test mockResolvedValue calls are visible.
const fileTypeFromBuffer = jest.fn();
jest.unstable_mockModule('file-type', () => ({
  get fileTypeFromBuffer() {
    return fileTypeFromBuffer;
  }
}));
const { validateFileType } = require('../../utils/mimeTypeValidator');

const fs = require('fs');
const path = require('path');
const securityService = require('../../services/securityService');
const { cleanClamAV, infectedClamAV } = require('../mocks/clamav');

describe('Security Middleware Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    securityService.isInitialized = false;
    securityService.clamscan = null;
  });

  describe('ClamAV virus scanning', () => {
    it('should detect EICAR test signature as infected', async () => {
      const eicarBuffer = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

      // Use Story 5.1 mock factory for infected ClamAV
      securityService.clamscan = infectedClamAV;
      securityService.isInitialized = true;

      const result = await securityService.scanBuffer(eicarBuffer);

      expect(result.isInfected).toBe(true);
      expect(result.viruses).toContain('EICAR-Test-Signature');
    });

    it('should return clean result for safe file content', async () => {
      const safeBuffer = Buffer.from('This is a safe document with normal content');

      // Use Story 5.1 mock factory for clean ClamAV
      securityService.clamscan = cleanClamAV;
      securityService.isInitialized = true;

      const result = await securityService.scanBuffer(safeBuffer);

      expect(result.isInfected).toBe(false);
      expect(result.viruses).toEqual([]);
    });

    it('should read and scan the EICAR test fixture file', async () => {
      // EICAR test signature (inline fallback if AV deletes the fixture file)
      const EICAR_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      let eicarContent;

      try {
        const eicarPath = path.join(__dirname, '..', 'fixtures', 'eicar.txt');
        eicarContent = fs.readFileSync(eicarPath, 'utf-8').trim();
        // Verify the fixture file contains the EICAR signature
        expect(eicarContent).toContain('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
      } catch {
        // AV may have deleted the fixture; use inline fallback
        eicarContent = EICAR_STRING;
      }

      // Use Story 5.1 mock factory for infected ClamAV
      securityService.clamscan = infectedClamAV;
      securityService.isInitialized = true;

      const result = await securityService.scanBuffer(Buffer.from(eicarContent));
      expect(result.isInfected).toBe(true);
    });

    it('should reject non-Buffer input', async () => {
      await expect(securityService.scanBuffer('not a buffer')).rejects.toThrow('Input must be a Buffer');
    });

    it('should reject empty buffer', async () => {
      await expect(securityService.scanBuffer(Buffer.alloc(0))).rejects.toThrow('Buffer is empty');
    });

    it('should reject oversized buffer exceeding limit', async () => {
      const originalMax = securityService.maxBufferSize;
      securityService.maxBufferSize = 10;
      try {
        const bigBuffer = Buffer.alloc(11);
        await expect(securityService.scanBuffer(bigBuffer)).rejects.toThrow('Buffer size exceeds');
      } finally {
        securityService.maxBufferSize = originalMax;
      }
    });

    it('should skip scanning when ClamAV is disabled (clamscan is null)', async () => {
      securityService.isInitialized = true;
      securityService.clamscan = null;

      const result = await securityService.scanBuffer(Buffer.from('some content'));

      expect(result).toEqual({ isInfected: false });
    });

    it('should wrap scan errors with descriptive message', async () => {
      // Create a custom mock that throws error
      const errorClamAV = {
        scanStream: jest.fn().mockRejectedValue(new Error('connection timeout'))
      };
      securityService.clamscan = errorClamAV;
      securityService.isInitialized = true;

      await expect(securityService.scanBuffer(Buffer.from('test'))).rejects.toThrow('Buffer scan failed');
    });
  });

  describe('File type validation', () => {
    it('should accept PDF with valid extension and magic bytes', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' });

      const result = await validateFileType({
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4')
      });

      expect(result.isValid).toBe(true);
      expect(fileTypeFromBuffer).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should accept TXT file with valid extension (text files often return null from magic byte check)', async () => {
      fileTypeFromBuffer.mockResolvedValue(null); // text files often can't be detected by magic bytes

      const result = await validateFileType({
        originalname: 'notes.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('plain text content')
      });

      expect(result.isValid).toBe(true);
      expect(fileTypeFromBuffer).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should accept HTML file with valid extension (text files often return null from magic byte check)', async () => {
      fileTypeFromBuffer.mockResolvedValue(null); // HTML files often can't be detected by magic bytes

      const result = await validateFileType({
        originalname: 'page.html',
        mimetype: 'text/html',
        buffer: Buffer.from('<html></html>')
      });

      expect(result.isValid).toBe(true);
      expect(fileTypeFromBuffer).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should reject file with disallowed extension (.exe)', async () => {
      // Extension check happens first, so magic bytes won't even be checked
      const result = await validateFileType({
        originalname: 'malware.exe',
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('MZ')
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('File extension .exe is not allowed');
      expect(fileTypeFromBuffer).not.toHaveBeenCalled();
    });

    it('should reject file when magic bytes detect disallowed MIME type', async () => {
      // File has .pdf extension (allowed) but magic bytes detect it's actually an executable
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/x-msdownload' });

      const result = await validateFileType({
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('MZ')
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Detected MIME type application/x-msdownload does not match allowed types');
      expect(fileTypeFromBuffer).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it("should accept file when magic byte check returns null (can't detect type)", async () => {
      // Some text files can't be detected by magic bytes - should still be accepted if extension is valid
      fileTypeFromBuffer.mockResolvedValue(null);

      const result = await validateFileType({
        originalname: 'readme.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('Some text content')
      });

      expect(result.isValid).toBe(true);
      expect(fileTypeFromBuffer).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should handle errors during validation gracefully', async () => {
      fileTypeFromBuffer.mockRejectedValue(new Error('Buffer read error'));

      const result = await validateFileType({
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('pdf content')
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Error validating file type');
    });
  });

  describe('Authentication middleware rejects unauthenticated requests', () => {
    // Reset modules so keycloak-auth-middleware is re-required fresh
    beforeEach(() => {
      jest.resetModules();

      jest.mock('jose', () => ({
        createRemoteJWKSet: jest.fn(),
        jwtVerify: jest.fn()
      }));

      jest.mock('../../config/appConfig', () => ({
        security: {
          keycloakUrl: 'https://localhost/auth',
          keycloakRealm: 'genie',
          keycloakClientId: 'genie-app'
        }
      }));

      jest.mock(
        '../../../shared-lib',
        () => ({
          logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
        }),
        { virtual: true }
      );
    });

    it('should return 401 when Authorization header is missing', async () => {
      const { authenticateToken } = require('../../middlewares/keycloak-auth-middleware');

      const req = { originalUrl: '/api/files', headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header uses wrong scheme (Basic)', async () => {
      const { authenticateToken } = require('../../middlewares/keycloak-auth-middleware');

      const req = { originalUrl: '/api/files', headers: { authorization: 'Basic abc123' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    });

    it('should return 401 when JWT signature is invalid', async () => {
      const jose = require('jose');
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockRejectedValue(new Error('Invalid signature'));

      const { authenticateToken } = require('../../middlewares/keycloak-auth-middleware');

      const req = { originalUrl: '/api/files', headers: { authorization: 'Bearer invalid-token' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    });

    it('should return 401 for expired tokens', async () => {
      const jose = require('jose');
      jose.createRemoteJWKSet.mockReturnValue({});
      const expiredError = new Error('JWT expired');
      expiredError.name = 'JWTExpired';
      jose.jwtVerify.mockRejectedValue(expiredError);

      const { authenticateToken } = require('../../middlewares/keycloak-auth-middleware');

      const req = { originalUrl: '/api/files', headers: { authorization: 'Bearer expired-token' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_EXPIRED' }));
    });

    it('should skip auth for public routes (/health)', async () => {
      const { authenticateToken } = require('../../middlewares/keycloak-auth-middleware');

      const req = { originalUrl: '/health', headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
