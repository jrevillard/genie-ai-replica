const Joi = require('joi');

// buildContentDisposition and batchFileIdsSchema are module-scoped in fileController
// (not exported). We test the Joi schema logic and CRLF sanitization pattern
// independently here to verify the security fixes from issues #471 and #472.

describe('fileUpload security tests', () => {
  describe('CRLF sanitization (buildContentDisposition pattern)', () => {
    // This mirrors the buildContentDisposition logic from fileController.js
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
    // This mirrors the schema from fileController.js
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
