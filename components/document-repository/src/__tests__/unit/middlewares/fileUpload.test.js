const multer = require('multer');

// buildContentDisposition + batchFileIdsSchema are now exported from
// fileController.js so the test exercises the canonical implementation
// instead of an inline copy. The two describe blocks below (CRLF
// sanitization + batch validation) test the real exports — same contract
// as the inline copies they replaced, with stronger coverage:
//   * batchFileIdsSchema in production rejects purely-numeric IDs
//     (anti-_key-regression guard, see fileController.js comment)
//   * buildContentDisposition emits RFC 5987 filename* for non-ASCII
const fileController = require('../../../controllers/fileController');
const { buildContentDisposition, batchFileIdsSchema, singleIngestSchema, MAX_BATCH_SIZE } = fileController;

// Mock config before requiring middleware
jest.mock('../../../config/appConfig', () => ({
  upload: {
    uploadDir: 'uploads',
    allowedMimeTypes: ['application/pdf', 'text/plain', 'text/html'],
    allowedExtensions: ['.pdf', '.txt', '.html'],
    maxFileSize: 52428800,
    maxFilesUpload: 5
  },
  // Required because fileController.js -> fileService.js -> securityService.js
  // chain reads appConfig.clamscan at module load.
  // Shape MUST mirror appConfig.js (flat — no nested clamdscan sub-object,
  // no removed fields). A drift here silently bypasses test verification.
  clamscan: {
    removeInfected: false,
    quarantineInfected: false,
    debugMode: false,
    socket: false,
    host: '127.0.0.1',
    port: 3310,
    timeout: 60000,
    localFallback: true,
    path: '/usr/bin/clamdscan',
    active: true
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
  describe('buildContentDisposition (issue #471)', () => {
    it('should strip CRLF from filename in the header', () => {
      const header = buildContentDisposition('attachment', 'file\r\nContent-Disposition: evil');
      expect(header).not.toContain('\r');
      expect(header).not.toContain('\n');
      expect(header).toContain('filename="fileContent-Disposition: evil"');
      expect(header.startsWith('attachment;')).toBe(true);
    });

    it('should build attachment header for ASCII-only filenames', () => {
      const header = buildContentDisposition('attachment', 'report.pdf');
      expect(header).toBe('attachment; filename="report.pdf"');
    });

    it('should build inline header for ASCII-only filenames', () => {
      const header = buildContentDisposition('inline', 'preview.png');
      expect(header).toBe('inline; filename="preview.png"');
    });

    it('should strip CRLF from non-ASCII filenames', () => {
      const header = buildContentDisposition('attachment', 'rédigé\r\nEvil: true.pdf');
      expect(header).not.toContain('\r');
      expect(header).not.toContain('\n');
      // RFC 5987 encoded form must be present for non-ASCII
      expect(header).toContain("filename*=UTF-8''");
    });

    it('should handle filenames with spaces', () => {
      const header = buildContentDisposition('attachment', 'my document.pdf');
      expect(header).toBe('attachment; filename="my document.pdf"');
    });

    it('should handle empty filename', () => {
      const header = buildContentDisposition('attachment', '');
      expect(header).toBe('attachment; filename=""');
    });

    it('should emit RFC 5987 filename* for non-ASCII filenames', () => {
      const header = buildContentDisposition('attachment', 'documént.pdf');
      expect(header).toContain('filename="documént.pdf"');
      expect(header).toContain("filename*=UTF-8''");
    });

    it('should not emit RFC 5987 for ASCII-only filenames', () => {
      const header = buildContentDisposition('attachment', 'report.pdf');
      expect(header).not.toContain('filename*=');
    });

    it('should strip NUL byte from filename (RFC 7230 §3.2.4)', () => {
      const header = buildContentDisposition('attachment', 'evil\u0000name.pdf');
      expect(header).not.toContain('\u0000');
      expect(header).toBe('attachment; filename="evilname.pdf"');
    });

    it('should strip embedded double-quote to prevent quoted-string break-out', () => {
      const header = buildContentDisposition('attachment', 'evil"name.pdf');
      expect(header).not.toContain('"evil"');
      expect(header).toBe('attachment; filename="evilname.pdf"');
    });

    it('should coerce null filename to empty string', () => {
      const header = buildContentDisposition('attachment', null);
      expect(header).toBe('attachment; filename=""');
    });

    it('should coerce undefined filename to empty string', () => {
      const header = buildContentDisposition('attachment', undefined);
      expect(header).toBe('attachment; filename=""');
    });

    // !494 follow-up: empirically Node rejects ALL C0 controls (BEL/ESC/etc.)
    // with ERR_INVALID_CHAR, not just CR/LF/NUL. The hardened regex strips
    // the whole 0x00-0x1F range. This test pins that contract.
    it('should strip BEL and other C0 controls (Node ERR_INVALID_CHAR guard)', () => {
      const header = buildContentDisposition('attachment', 'evil\u0007report.pdf');
      expect(header).not.toContain('\u0007');
      expect(header).toBe('attachment; filename="evilreport.pdf"');
    });

    // !494 second-pass: DEL (0x7F) is also ERR_INVALID_CHAR on setHeader,
    // but lives outside 0x00-0x1F — must be stripped explicitly.
    it('should strip DEL (0x7F) (Node ERR_INVALID_CHAR guard)', () => {
      const header = buildContentDisposition('attachment', 'evil\u007Freport.pdf');
      expect(header).not.toContain('\u007F');
      expect(header).toBe('attachment; filename="evilreport.pdf"');
    });

    it('should strip C0 controls from the disposition parameter', () => {
      const header = buildContentDisposition('attach\u0007ment', 'report.pdf');
      expect(header.startsWith('attachment; filename=')).toBe(true);
      expect(header).not.toContain('\u0007');
    });
  });

  describe('batchFileIdsSchema validation (issue #472)', () => {
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

    it('should reject arrays exceeding MAX_BATCH_SIZE', () => {
      const ids = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => `id${i}`);
      const { error } = batchFileIdsSchema.validate({ fileIds: ids });
      expect(error).toBeDefined();
      expect(error.details[0].message).toContain(`must contain less than or equal to ${MAX_BATCH_SIZE}`);
    });

    it('should accept exactly MAX_BATCH_SIZE IDs', () => {
      const ids = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => `id${i}`);
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

    // Stronger than the inline copy: production also rejects purely numeric
    // IDs (anti-_key-regression guard — see fileController.js comment).
    it('should reject purely numeric file IDs (anti-_key regression)', () => {
      const { error } = batchFileIdsSchema.validate({ fileIds: ['12345', '67890'] });
      expect(error).toBeDefined();
      // Assert on the structural rule identifier (Joi 17+). The string is
      // still coupled to Joi internals — pin to current major and accept
      // that a major version bump will require this test update too.
      expect(error.details[0].type).toBe('string.pattern.invert.base');
      expect(error.details[0].path).toEqual(['fileIds', 0]);
    });

    it('should accept a valid non-negative integer chunkOverlap', () => {
      const { error, value } = batchFileIdsSchema.validate({
        fileIds: ['id1', 'id2'],
        chunkOverlap: 200
      });
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBe(200);
    });

    it('should accept chunkOverlap=0 (boundary)', () => {
      const { error, value } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: 0
      });
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBe(0);
    });

    it('should reject negative chunkOverlap', () => {
      const { error } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: -5
      });
      expect(error).toBeDefined();
      expect(error.details[0].type).toBe('number.min');
      expect(error.details[0].path).toEqual(['chunkOverlap']);
    });

    it('should reject non-integer chunkOverlap', () => {
      const { error } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: 1.5
      });
      expect(error).toBeDefined();
      expect(error.details[0].type).toBe('number.integer');
      expect(error.details[0].path).toEqual(['chunkOverlap']);
    });

    // !494 follow-up: Joi.number() coerces strings by default ("200" -> 200).
    // fileController.js ingestMultipleFiles reads `value.chunkOverlap` (NOT
    // req.body) to honor that coercion. These tests pin the contract.
    it('should coerce a numeric-string chunkOverlap to a number', () => {
      const { error, value } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: '200'
      });
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBe(200);
    });

    it('should reject a non-numeric-string chunkOverlap', () => {
      const { error } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: 'abc'
      });
      expect(error).toBeDefined();
      expect(error.details[0].path).toEqual(['chunkOverlap']);
    });

    it('should reject an array chunkOverlap', () => {
      const { error } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: [200]
      });
      expect(error).toBeDefined();
      expect(error.details[0].path).toEqual(['chunkOverlap']);
    });

    it('should accept null chunkOverlap (legacy "use env default" opt-out)', () => {
      // `.allow(null)` preserves the pre-schema behavior where Number.isInteger
      // rejected null and the controller fell back to env DATAPREP_CHUNK_OVERLAP.
      const { error, value } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: null
      });
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBe(null);
    });

    it('should reject chunkOverlap above the LangChain-degenerate cap (1000)', () => {
      const { error } = batchFileIdsSchema.validate({
        fileIds: ['id1'],
        chunkOverlap: 1e15
      });
      expect(error).toBeDefined();
      expect(error.details[0].type).toBe('number.max');
      expect(error.details[0].path).toEqual(['chunkOverlap']);
    });
  });

  // !494 second-pass: ingestFile (single) must mirror the batch endpoint's
  // Joi contract so string-coerced overlap values flow through both paths
  // identically (was a silent asymmetry — single read raw req.body).
  describe('singleIngestSchema (single-file ingest endpoint)', () => {
    it('should accept a missing chunkOverlap (env fallback)', () => {
      const { error, value } = singleIngestSchema.validate({});
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBeUndefined();
    });

    it('should accept an empty body', () => {
      const { error } = singleIngestSchema.validate({});
      expect(error).toBeUndefined();
    });

    it('should accept undefined body', () => {
      const { error } = singleIngestSchema.validate(undefined);
      expect(error).toBeUndefined();
    });

    it('should coerce a numeric-string chunkOverlap to a number', () => {
      const { error, value } = singleIngestSchema.validate({ chunkOverlap: '200' });
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBe(200);
    });

    it('should reject a negative chunkOverlap', () => {
      const { error } = singleIngestSchema.validate({ chunkOverlap: -5 });
      expect(error).toBeDefined();
      expect(error.details[0].path).toEqual(['chunkOverlap']);
    });

    it('should accept null chunkOverlap (legacy "use env default" opt-out)', () => {
      const { error, value } = singleIngestSchema.validate({ chunkOverlap: null });
      expect(error).toBeUndefined();
      expect(value.chunkOverlap).toBe(null);
    });

    it('should reject chunkOverlap above the LangChain-degenerate cap (1000)', () => {
      const { error } = singleIngestSchema.validate({ chunkOverlap: 1e15 });
      expect(error).toBeDefined();
      expect(error.details[0].type).toBe('number.max');
      expect(error.details[0].path).toEqual(['chunkOverlap']);
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
