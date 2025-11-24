import httpService from './httpService';

/**
 * Service for handling all document file-related API requests for the document repository.
 */
const documentFileService = {
  /**
   * Gets a paginated and filtered list of file metadata.
   * @param {Object} params - The query parameters.
   * @param {number} [params.page=1] - Page number.
   * @param {number} [params.limit=10] - Items per page.
   * @param {string} [params.category] - Filter by category.
   * @param {string} [params.search] - Search term.
   * @returns {Promise<Object>} The paginated list of files.
   */
  async getFiles(params) {
    try {
      const response = await httpService.get('/files', { params });

      // <-- ADD THIS LINE to inspect the raw API response
      console.log('[documentFileService] Raw API Response:', response);

      return response.data;
    } catch (error) {
      console.error('Error fetching files:', error);
      throw error;
    }
  },

  /**
   * Gets the metadata for a single file.
   * @param {string} fileId - The unique ID of the file.
   * @returns {Promise<Object>} The file metadata object.
   */
  async getFileMetadata(fileId) {
    try {
      const response = await httpService.get(`/files/${fileId}`);

      // This is the key change:
      // Instead of returning the whole response.data object,
      // we extract and return the nested 'data' property which contains the file.
      return response.data.data;

    } catch (error) {
      console.error(`Error fetching metadata for file ${fileId}:`, error);
      throw error;
    }
  },

  /**
   * Uploads a single file using FormData.
   * @param {FormData} formData - The FormData object containing the file and any metadata.
   * @returns {Promise<Object>} The response from the server.
   */
  async uploadFile(formData) {
    try {
      const response = await httpService.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    } catch (error) {
      console.error('Error uploading single file:', error);
      throw error;
    }
  },

  /**
   * Uploads a file by crawling a public URL (Synchronous / Single Page).
   * @param {string} url - The URL to crawl.
   * @returns {Promise<Object>} The response from the server.
   */
  async uploadLink(url) {
    try {
      const response = await httpService.post('/files/upload-link', { url });
      return response.data;
    } catch (error) {
      console.error('Error uploading link:', error);
      throw error;
    }
  },

  /**
   * Updates the metadata for a specific file.
   * @param {string} fileId - The ID of the file to update.
   * @param {Object} updates - An object containing the fields to update.
   * @returns {Promise<Object>} The updated file metadata.
   */
  async updateFile(fileId, updates) {
    try {
      const response = await httpService.patch(`/files/${fileId}`, updates);
      return response.data;
    } catch (error) {
      console.error(`Error updating file ${fileId}:`, error);
      throw error;
    }
  },

  /**
   * Deletes a single file.
   * @param {string} fileId - The ID of the file to delete.
   * @returns {Promise<Object>} The confirmation response.
   */
  async deleteFile(fileId) {
    try {
      const response = await httpService.delete(`/files/${fileId}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting file ${fileId}:`, error);
      throw error;
    }
  },

  /**
   * Triggers the ingestion process for a single file.
   * @param {string} fileId - The ID of the file to ingest.
   * @returns {Promise<Object>} The confirmation response.
   */
  async ingestFile(fileId) {
    try {
      // This corresponds to the backend route: POST /api/files/:fileId/ingest
      const response = await httpService.post(`/files/${fileId}/ingest`);
      return response.data;
    } catch (error) {
      console.error(`Error ingesting file ${fileId}:`, error);
      throw error;
    }
  },

  /**
   * Triggers the ingestion process for multiple files.
   * @param {string[]} fileIds - An array of file IDs to ingest.
   * @returns {Promise<Object>} The confirmation response.
   */
  async ingestMultipleFiles(fileIds) {
    try {
      const response = await httpService.post('/files/ingest', { fileIds });
      return response.data;
    } catch (error) {
      console.error('Error ingesting multiple files:', error);
      throw error;
    }
  },

  /**
   * Retracts multiple files from the system.
   * @param {string[]} fileIds - An array of file IDs to retract.
   * @returns {Promise<Object>} The confirmation response.
   */
  async retractMultipleFiles(fileIds) {
    try {
      const response = await httpService.post('/files/retract', { fileIds });
      return response.data;
    } catch (error) {
      console.error('Error retracting multiple files:', error);
      throw error;
    }
  },

  /**
   * Gets all ingestion logs for a specific file.
   * @param {string} fileId - The ID of the file.
   * @returns {Promise<Object>} The API response containing the list of logs.
   */
  async getIngestionLogs(fileId) {
    try {
      // This corresponds to the backend route: GET /api/files/:fileId/ingestion-log
      const response = await httpService.get(`/files/${fileId}/ingestion-log`);
      return response.data; // Assumes backend returns { success: true, data: [...] }
    } catch (error) {
      console.error(`Error fetching ingestion logs for file ${fileId}:`, error);
      throw error;
    }
  },

  // --- NEW CRAWLER METHODS ---

  /**
   * Schedules a new asynchronous full-site crawl.
   * @param {Object} options - The crawl options.
   * @param {string} options.url - The URL to crawl.
   * @param {number} options.depth - The depth of the crawl (1-20).
   * @returns {Promise<Object>} The response containing the new file stub.
   */
  async scheduleSiteCrawl(options) {
    try {
      const response = await httpService.post('/files/crawl/schedule', options);
      return response.data;
    } catch (error) {
      console.error('Error scheduling site crawl:', error);
      throw error;
    }
  },

  /**
   * Gets the crawl job status for a specific file.
   * @param {string} fileId - The ID of the file associated with the crawl job.
   * @returns {Promise<Object>} The API response containing the crawl job details.
   */
  async getCrawlJob(fileId) {
    try {
      const response = await httpService.get(`/files/${fileId}/crawl-job`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching crawl job for file ${fileId}:`, error);
      throw error;
    }
  },

  /**
   * Gets the crawl logs for a specific file.
   * @param {string} fileId - The ID of the file.
   * @returns {Promise<Object>} The API response containing the list of crawl logs.
   */
  async getCrawlLogs(fileId) {
    try {
      const response = await httpService.get(`/files/${fileId}/crawl-log`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching crawl logs for file ${fileId}:`, error);
      throw error;
    }
  },

  /**
   * Sends a kill signal to a running crawl task.
   * @param {string} fileId - The ID of the file associated with the crawl job.
   * @returns {Promise<Object>} The API response confirming the kill signal.
   */
  async killCrawl(fileId) {
    try {
      const response = await httpService.post(`/files/${fileId}/kill-crawl`);
      return response.data;
    } catch (error) {
      console.error(`Error sending kill signal for file ${fileId}:`, error);
      throw error;
    }
  },
};

export default documentFileService;