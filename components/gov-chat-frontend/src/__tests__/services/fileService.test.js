'use strict';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: (...args) => mockPut(...args),
  delete: (...args) => mockDelete(...args),
  patch: (...args) => mockPatch(...args),
  baseUrl: '/api'
}));

const fileService = require('@/services/fileService').default;

describe('fileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadFile', () => {
    it('uploads a file with FormData', async () => {
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
      const uploadResult = { url: '/files/123', id: '123' };
      mockPost.mockResolvedValue({ data: uploadResult });

      const result = await fileService.uploadFile(file, 'document', 'entity-1');

      expect(mockPost).toHaveBeenCalledWith('files/upload', expect.any(FormData), {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      expect(result).toEqual(uploadResult);
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Upload failed'));

      await expect(fileService.uploadFile({}, 'doc', '1')).rejects.toThrow('Upload failed');
    });
  });

  describe('uploadMultipleFiles', () => {
    it('uploads multiple files with FormData', async () => {
      const files = [
        new File(['a'], 'a.pdf', { type: 'application/pdf' }),
        new File(['b'], 'b.pdf', { type: 'application/pdf' })
      ];
      const uploadResult = [{ url: '/files/1' }, { url: '/files/2' }];
      mockPost.mockResolvedValue({ data: uploadResult });

      const result = await fileService.uploadMultipleFiles(files, 'document', 'entity-1');

      expect(mockPost).toHaveBeenCalledWith('files/upload-multiple', expect.any(FormData), {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      expect(result).toEqual(uploadResult);
    });

    it('throws on API failure', async () => {
      mockPost.mockRejectedValue(new Error('Upload failed'));

      await expect(fileService.uploadMultipleFiles([], 'doc', '1')).rejects.toThrow('Upload failed');
    });
  });

  describe('getFileUrl', () => {
    it('returns file URL', () => {
      const url = fileService.getFileUrl('123');

      expect(url).toBe('/api/files/123');
    });
  });

  describe('deleteFile', () => {
    it('deletes a file', async () => {
      mockDelete.mockResolvedValue({ data: { success: true } });

      const result = await fileService.deleteFile('123');

      expect(mockDelete).toHaveBeenCalledWith('files/123');
      expect(result).toEqual({ success: true });
    });

    it('throws on API failure', async () => {
      mockDelete.mockRejectedValue(new Error('Delete failed'));

      await expect(fileService.deleteFile('123')).rejects.toThrow('Delete failed');
    });
  });

  describe('getFileMetadata', () => {
    it('fetches file metadata', async () => {
      const metadata = { id: '123', name: 'test.pdf', size: 1024 };
      mockGet.mockResolvedValue({ data: metadata });

      const result = await fileService.getFileMetadata('123');

      expect(mockGet).toHaveBeenCalledWith('files/123/metadata');
      expect(result).toEqual(metadata);
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(fileService.getFileMetadata('123')).rejects.toThrow('Server error');
    });
  });

  describe('getEntityFiles', () => {
    it('fetches files for an entity', async () => {
      const files = [{ id: '1', name: 'doc.pdf' }];
      mockGet.mockResolvedValue({ data: files });

      const result = await fileService.getEntityFiles('entity-1', 'document');

      expect(mockGet).toHaveBeenCalledWith('files', { params: { entityId: 'entity-1', context: 'document' } });
      expect(result).toEqual(files);
    });

    it('throws on API failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(fileService.getEntityFiles('1', 'doc')).rejects.toThrow('Server error');
    });
  });

  describe('getPreviewUrl', () => {
    it('returns preview URL without options', () => {
      const url = fileService.getPreviewUrl('123');

      expect(url).toBe('/api/files/123/preview');
    });

    it('returns preview URL with size options', () => {
      const url = fileService.getPreviewUrl('123', { width: 200, height: 150, quality: 80 });

      expect(url).toContain('/api/files/123/preview?');
      expect(url).toContain('width=200');
      expect(url).toContain('height=150');
      expect(url).toContain('quality=80');
    });

    it('omits undefined options from query string', () => {
      const url = fileService.getPreviewUrl('123', { width: 200 });

      expect(url).toContain('width=200');
      expect(url).not.toContain('height');
      expect(url).not.toContain('quality');
    });
  });
});
