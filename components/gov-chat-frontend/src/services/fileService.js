// src/services/fileService.js - File Upload Service
import httpService from './httpService';

export default {
  /**
   * Upload a file
   * @param {File} file - File to upload
   * @param {String} context - Upload context (e.g., 'userProfile', 'document')
   * @param {String} entityId - ID of the entity the file belongs to
   * @returns {Promise} Upload result with file URL
   */
  async uploadFile(file, context, entityId) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('context', context);
      formData.append('entityId', entityId);

      const response = await httpService.post('files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  },

  /**
   * Upload multiple files
   * @param {Array} files - Array of files to upload
   * @param {String} context - Upload context
   * @param {String} entityId - ID of the entity the files belong to
   * @returns {Promise} Upload results with file URLs
   */
  async uploadMultipleFiles(files, context, entityId) {
    try {
      const formData = new FormData();

      files.forEach((file, index) => {
        formData.append(`files[${index}]`, file);
      });

      formData.append('context', context);
      formData.append('entityId', entityId);

      const response = await httpService.post('files/upload-multiple', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error uploading multiple files:', error);
      throw error;
    }
  },

  /**
   * Get file URL
   * @param {String} fileId - File ID
   * @returns {String} File URL
   */
  getFileUrl(fileId) {
    return `${httpService.baseUrl}/files/${fileId}`;
  },

  /**
   * Delete a file
   * @param {String} fileId - File ID
   * @returns {Promise} Deletion result
   */
  async deleteFile(fileId) {
    try {
      const response = await httpService.delete(`files/${fileId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  },

  /**
   * Get file metadata
   * @param {String} fileId - File ID
   * @returns {Promise} File metadata
   */
  async getFileMetadata(fileId) {
    try {
      const response = await httpService.get(`files/${fileId}/metadata`);
      return response.data;
    } catch (error) {
      console.error('Error getting file metadata:', error);
      throw error;
    }
  },

  /**
   * Get files for an entity
   * @param {String} entityId - Entity ID
   * @param {String} context - File context
   * @returns {Promise} Files for the entity
   */
  async getEntityFiles(entityId, context) {
    try {
      const response = await httpService.get('files', {
        params: { entityId, context }
      });

      return response.data;
    } catch (error) {
      console.error('Error getting entity files:', error);
      throw error;
    }
  },

  /**
   * Create a file preview URL (for images)
   * @param {String} fileId - File ID
   * @param {Object} options - Preview options (width, height, quality)
   * @returns {String} Preview URL
   */
  getPreviewUrl(fileId, options = {}) {
    const { width, height, quality } = options;
    let url = `${httpService.baseUrl}/files/${fileId}/preview`;

    const params = new URLSearchParams();
    if (width) params.append('width', width);
    if (height) params.append('height', height);
    if (quality) params.append('quality', quality);

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    return url;
  }
};
