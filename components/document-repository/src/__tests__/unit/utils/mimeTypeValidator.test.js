jest.unstable_mockModule('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue(null)
}));
const {
  getFileExtension,
  getMimeType,
  getFileCategory,
  isTextExtractable
} = require('../../../utils/mimeTypeValidator');

describe('mimeTypeValidator', () => {
  describe('getFileExtension', () => {
    it('should return extension including the dot', () => {
      expect(getFileExtension('document.pdf')).toBe('.pdf');
    });

    it('should handle uppercase filenames', () => {
      expect(getFileExtension('REPORT.PDF')).toBe('.pdf');
    });

    it('should handle filenames with multiple dots', () => {
      expect(getFileExtension('archive.tar.gz')).toBe('.gz');
    });

    it('should return the full lowercase string when no extension', () => {
      // substring(-1) returns the whole string when lastIndexOf returns -1
      expect(getFileExtension('README')).toBe('readme');
    });

    it('should handle dotfiles', () => {
      expect(getFileExtension('.gitignore')).toBe('.gitignore');
    });
  });

  describe('getMimeType', () => {
    it('should return correct MIME type for known extensions', () => {
      expect(getMimeType('file.pdf')).toBe('application/pdf');
      expect(getMimeType('file.txt')).toBe('text/plain');
      expect(getMimeType('file.html')).toBe('text/html');
    });

    it('should return application/octet-stream for unknown extensions', () => {
      expect(getMimeType('file.xyz123')).toBe('application/octet-stream');
    });
  });

  describe('getFileCategory', () => {
    it('should categorize pdf', () => {
      expect(getFileCategory('application/pdf')).toBe('pdf');
    });

    it('should categorize docx', () => {
      expect(getFileCategory('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
        'document'
      );
    });

    // NOTE: The xlsx MIME type contains 'document', which matches before 'sheet'
    // in the sequential if-else chain. This is existing behavior.
    it('should categorize xlsx as document (contains "document" before "sheet" check)', () => {
      expect(getFileCategory('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('document');
    });

    it('should categorize markdown', () => {
      expect(getFileCategory('text/markdown')).toBe('markdown');
    });

    it('should categorize html', () => {
      expect(getFileCategory('text/html')).toBe('html');
    });

    it('should categorize plain text', () => {
      expect(getFileCategory('text/plain')).toBe('text');
    });

    it('should categorize unknown as other', () => {
      expect(getFileCategory('application/octet-stream')).toBe('other');
    });

    it('should throw TypeError for null mimeType (uses String.includes)', () => {
      expect(() => getFileCategory(null)).toThrow(TypeError);
    });

    it('should throw TypeError for undefined mimeType (uses String.includes)', () => {
      expect(() => getFileCategory(undefined)).toThrow(TypeError);
    });
  });

  describe('isTextExtractable', () => {
    it('should return true for pdf', () => {
      expect(isTextExtractable('application/pdf')).toBe(true);
    });

    it('should return true for docx', () => {
      expect(isTextExtractable('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    });

    it('should return true for markdown', () => {
      expect(isTextExtractable('text/markdown')).toBe(true);
    });

    it('should return true for html', () => {
      expect(isTextExtractable('text/html')).toBe(true);
    });

    it('should return true for plain text', () => {
      expect(isTextExtractable('text/plain')).toBe(true);
    });

    it('should return false for xlsx', () => {
      expect(isTextExtractable('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(isTextExtractable('application/octet-stream')).toBe(false);
    });

    it('should return false for null mimeType (Array.includes is safe)', () => {
      expect(isTextExtractable(null)).toBe(false);
    });

    it('should return false for undefined mimeType (Array.includes is safe)', () => {
      expect(isTextExtractable(undefined)).toBe(false);
    });

    it('should return true for application/msword (legacy Word MIME)', () => {
      expect(isTextExtractable('application/msword')).toBe(true);
    });
  });
});
