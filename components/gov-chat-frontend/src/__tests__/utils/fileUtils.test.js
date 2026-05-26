'use strict';

const { formatFileSize, isImage, isDocument, getFileExtension } = require('@/utils/fileUtils');

describe('fileUtils', () => {
  describe('formatFileSize', () => {
    it('returns "0 Bytes" for null', () => {
      expect(formatFileSize(null)).toBe('0 Bytes');
    });

    it('returns "0 Bytes" for 0', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
    });

    it('formats bytes', () => {
      expect(formatFileSize(500)).toBe('500 Bytes');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1 MB');
    });

    it('formats gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });

    it('handles fractional sizes', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('handles values less than 1 byte', () => {
      expect(formatFileSize(0.5)).toBe('0.5 Bytes');
    });

    it('formats terabytes', () => {
      expect(formatFileSize(1099511627776)).toBe('1 TB');
    });
  });

  describe('isImage', () => {
    it('returns true for image MIME types', () => {
      expect(isImage('image/png')).toBe(true);
      expect(isImage('image/jpeg')).toBe(true);
      expect(isImage('image/gif')).toBe(true);
      expect(isImage('image/svg+xml')).toBe(true);
    });

    it('returns false for non-image MIME types', () => {
      expect(isImage('application/pdf')).toBe(false);
      expect(isImage('text/plain')).toBe(false);
    });

    it('returns falsy for null/undefined', () => {
      expect(isImage(null)).toBeFalsy();
      expect(isImage(undefined)).toBeFalsy();
    });
  });

  describe('isDocument', () => {
    it('returns true for document MIME types', () => {
      expect(isDocument('application/pdf')).toBe(true);
      expect(isDocument('application/msword')).toBe(true);
      expect(isDocument('text/plain')).toBe(true);
      expect(isDocument('text/csv')).toBe(true);
    });

    it('returns false for non-document MIME types', () => {
      expect(isDocument('image/png')).toBe(false);
      expect(isDocument('video/mp4')).toBe(false);
    });
  });

  describe('getFileExtension', () => {
    it('extracts lowercase extension', () => {
      expect(getFileExtension('report.PDF')).toBe('pdf');
    });

    it('handles multiple dots', () => {
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
    });

    it('handles no extension', () => {
      expect(getFileExtension('filename')).toBe('filename');
    });
  });
});
