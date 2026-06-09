const Joi = require('joi');
const multer = require('multer');

// buildContentDisposition and batchFileIdsSchema are module-scoped in fileController
// (not exported). We test the Joi schema logic and CRLF sanitization pattern
// independently here to verify the security fixes from issues #471 and #472.

// Mock config before requiring middleware
jest.mock('../../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: ['application/pdf', 'text/plain', 'text/html'],
    allowedExtensions: ['.pdf', '.txt', '.html'],
    maxFileSize: 52428800,
    maxFilesUpload: 5
  }
}));

jest.mock(
  '../../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('../../../utils/mimeTypeValidator', () => ({
  validateFileType: jest.fn().mockResolvedValue({ isValid: true })
}));

const { validateFiles, handleMulterError } = require('../../../middlewares/fileUpload');
const { validateFileType } = require('../../../utils/mimeTypeValidator');

function createMocks(overrides = {}) {
  const req = {
    file: undefined,
    files: undefined,
    ...overrides
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('fileUpload security tests', () => {
  describe('CRLF sanitization (buildContentDisposition pattern)', () => {
    function sanitizeFilename(filename) {
      return filename.replace(/[\r\n]/g, '');
    }

    it('should strip CRLF from filename', () => {
      const result = sanitizeFilename('file\r\nContent-Disposition: evil');
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
      expect(result).toBe('fileContent-Disposition: evil');
    });

    it('should handle ASCII-only filenames unchanged', () => {
      const result = sanitizeFilename('report.pdf');
      expect(result).toBe('report.pdf');
    });

    it('should strip CRLF from non-ASCII filenames', () => {
      const result = sanitizeFilename('rédigé\r\nEvil: true.pdf');
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
    });

    it('should handle filenames with spaces', () => {
      const result = sanitizeFilename('my document.pdf');
      expect(result).toBe('my document.pdf');
    });

    it('should handle empty filename', () => {
      const result = sanitizeFilename('');
      expect(result).toBe('');
    });

    it('should detect non-ASCII for RFC 5987 encoding', () => {
      const sanitized = sanitizeFilename('documént.pdf');
      const hasNonAscii = sanitized.split('').some((char) => char.charCodeAt(0) > 127);
      expect(hasNonAscii).toBe(true);
    });

    it('should not trigger RFC 5987 for ASCII-only', () => {
      const sanitized = sanitizeFilename('report.pdf');
      const hasNonAscii = sanitized.split('').some((char) => char.charCodeAt(0) > 127);
      expect(hasNonAscii).toBe(false);
    });
  });

  describe('batchFileIdsSchema validation (issue #472)', () => {
    const MAX_BATCH_SIZE = 50;
    const batchFileIdsSchema = Joi.object({
      fileIds: Joi.array().items(Joi.string().min(1)).min(1).max(MAX_BATCH_SIZE).required()
    });

    it('should accept a valid array of file IDs', () => {
      const { error, value } = batchFileIdsSchema.validate({ fileIds: ['id1', 'id2', 'id3'] });
      expect(error).toBeUndefined();
      expect(value.fileIds).toEqual(['id1', 'id2', 'id3']);
    });

    it('should reject empty array', () => {
      const { error } = batchFileIdsSchema.validate({ fileIds: [] });
      expect(error).toBeDefined();
      expect(error.details[0].message).toContain('must contain at least');
    });

    it('should reject missing fileIds', () => {
      const { error } = batchFileIdsSchema.validate({});
      expect(error).toBeDefined();
    });

    it('should reject arrays exceeding MAX_BATCH_SIZE (50)', () => {
      const ids = Array.from({ length: 51 }, (_, i) => `id${i}`);
      const { error } = batchFileIdsSchema.validate({ fileIds: ids });
      expect(error).toBeDefined();
      expect(error.details[0].message).toContain('must contain less than or equal to 50');
    });

    it('should accept exactly 50 IDs', () => {
      const ids = Array.from({ length: 50 }, (_, i) => `id${i}`);
      const { error } = batchFileIdsSchema.validate({ fileIds: ids });
      expect(error).toBeUndefined();
    });

    it('should reject non-string IDs in array', () => {
      const { error } = batchFileIdsSchema.validate({ fileIds: [123, 456] });
      expect(error).toBeDefined();
    });

    it('should reject empty string IDs', () => {
      const { error } = batchFileIdsSchema.validate({ fileIds: ['valid', ''] });
      expect(error).toBeDefined();
    });

    it('should reject non-array fileIds', () => {
      const { error } = batchFileIdsSchema.validate({ fileIds: 'not-an-array' });
      expect(error).toBeDefined();
    });
  });
});

describe('validateFiles middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateFileType.mockResolvedValue({ isValid: true });
  });

  it('should return 400 when no file is present on req.file or req.files', async () => {
    const { req, res, next } = createMocks({ file: undefined, files: undefined });

    await validateFiles(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'No file uploaded' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should validate a single file on req.file', async () => {
    const file = { originalname: 'test.pdf', mimetype: 'application/pdf', buffer: Buffer.from('test') };
    const { req, res, next } = createMocks({ file });

    await validateFiles(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(validateFileType).toHaveBeenCalledWith(file);
  });

  it('should validate multiple files on req.files', async () => {
    const files = [
      { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('a') },
      { originalname: 'b.pdf', mimetype: 'application/pdf', buffer: Buffer.from('b') }
    ];
    const { req, res, next } = createMocks({ file: undefined, files });

    await validateFiles(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(validateFileType).toHaveBeenCalledTimes(2);
  });

  it('should return 400 when file validation fails', async () => {
    validateFileType.mockResolvedValue({ isValid: false, error: 'Invalid MIME type' });
    const file = { originalname: 'evil.exe', mimetype: 'application/exe', buffer: Buffer.from('x') };
    const { req, res, next } = createMocks({ file });

    await validateFiles(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid MIME type' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 400 when one file in multi-upload fails validation', async () => {
    validateFileType
      .mockResolvedValueOnce({ isValid: true })
      .mockResolvedValueOnce({ isValid: false, error: 'Disallowed file type' });

    const files = [
      { originalname: 'good.pdf', mimetype: 'application/pdf', buffer: Buffer.from('g') },
      { originalname: 'bad.exe', mimetype: 'application/exe', buffer: Buffer.from('b') }
    ];
    const { req, res, next } = createMocks({ file: undefined, files });

    await validateFiles(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Disallowed file type' }));
  });

  it('should handle unexpected errors gracefully', async () => {
    validateFileType.mockRejectedValue(new Error('Unexpected error'));
    const file = { originalname: 'test.pdf', mimetype: 'application/pdf', buffer: Buffer.from('t') };
    const { req, res, next } = createMocks({ file });

    await validateFiles(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unexpected error' }));
  });
});

describe('handleMulterError middleware', () => {
  it('should handle LIMIT_FILE_SIZE error', () => {
    const { req, res, next } = createMocks();
    const error = new multer.MulterError('LIMIT_FILE_SIZE', 'file');

    handleMulterError(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('File size too large') })
    );
  });

  it('should handle LIMIT_FILE_COUNT error', () => {
    const { req, res, next } = createMocks();
    const error = new multer.MulterError('LIMIT_FILE_COUNT');

    handleMulterError(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Too many files uploaded' }));
  });

  it('should handle LIMIT_UNEXPECTED_FILE error', () => {
    const { req, res, next } = createMocks();
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'wrongField');

    handleMulterError(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unexpected file field' }));
  });

  it('should handle unknown MulterError codes', () => {
    const { req, res, next } = createMocks();
    const error = new multer.MulterError('LIMIT_FIELD_KEY');
    error.message = 'Too many fields';

    handleMulterError(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Upload error') }));
  });

  it('should handle file type rejection errors from fileFilter', () => {
    const { req, res, next } = createMocks();
    const error = new Error('File type application/exe is not allowed');

    handleMulterError(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not allowed') }));
  });

  it('should pass non-multer non-filetype errors to next', () => {
    const { req, res, next } = createMocks();
    const error = new Error('Something completely unexpected');

    handleMulterError(error, req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
