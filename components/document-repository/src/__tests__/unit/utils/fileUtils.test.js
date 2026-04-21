const path = require('path');
const {
  generateUniqueFileId,
  getMetadataFilePath,
} = require('../../../utils/fileUtils');

describe('fileUtils', () => {
  describe('generateUniqueFileId', () => {
    it('should return a string in timestamp_uuid format', () => {
      const id = generateUniqueFileId();
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^\d+_[a-f0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateUniqueFileId()));
      expect(ids.size).toBe(100);
    });

    it('should start with a numeric timestamp', () => {
      const id = generateUniqueFileId();
      const timestamp = parseInt(id.split('_')[0], 10);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
      expect(timestamp).toBeGreaterThan(Date.now() - 10000);
    });
  });

  describe('getMetadataFilePath', () => {
    it('should append _meta.json to the filename', () => {
      const result = getMetadataFilePath(path.join('/app/uploads', 'document.pdf'));
      expect(result).toMatch(/document\.pdf_meta\.json$/);
      expect(result).toContain('uploads');
    });

    it('should handle nested directories', () => {
      const result = getMetadataFilePath(path.join('/app/uploads/sub/dir', 'file.txt'));
      expect(result).toMatch(/file\.txt_meta\.json$/);
      expect(result).toContain('uploads');
    });
  });
});
