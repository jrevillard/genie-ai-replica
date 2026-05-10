// src/services/chatbotService.js - Chatbot Service
import httpService from './httpService';

export default {
  /**
   * Submit a query to the chatbot
   * @param {Object} queryData - Query data
   * @returns {Promise} Query result
   */
  async submitQuery(queryData) {
    try {
      console.log('Submitting query:', JSON.stringify(queryData, null, 2));
      const startTime = Date.now();

      const response = await httpService.post('queries', {
        ...queryData,
        timestamp: new Date().toISOString()
      });

      if (response.data.response && response.data.response.startsWith('Error:')) {
        console.error('OPEA service error in response:', response.data.response);
        throw new Error(response.data.response);
      }

      const responseTime = Date.now() - startTime;
      console.log('Received response:', JSON.stringify(response.data, null, 2));
      console.log('Response time:', responseTime, 'ms');
      console.log('OPEA response content:', response.data.response || 'No response content available');

      if (response.data.metadata) {
        console.log('Metadata:', JSON.stringify(response.data.metadata, null, 2));
      }

      const queryId = response.data.queryId;
      if (queryId) {
        await this.updateQueryResponseTime(queryId, responseTime);
        await this.markQueryAsAnswered(queryId, responseTime);
      } else {
        console.warn('No queryId in response; skipping updates');
      }

      return response.data;
    } catch (error) {
      const body = error.data ?? error.response?.data;
      console.error(
        'Error submitting query:',
        error.message,
        body != null ? JSON.stringify(body, null, 2) : '(no response body — see error.data for HttpService shape)'
      );
      throw error;
    }
  },

  /**
   * Update query response time
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise} Update result
   */
  async updateQueryResponseTime(queryId, responseTime) {
    try {
      const response = await httpService.patch(`queries/${queryId}/responsetime`, {
        responseTime
      });
      return response.data;
    } catch (error) {
      console.error('Error updating query response time:', error);
      return null;
    }
  },

  /**
   * Mark a query as answered
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise} Update result
   */
  async markQueryAsAnswered(queryId, responseTime) {
    try {
      const response = await httpService.patch(`queries/${queryId}/answered`, {
        responseTime
      });
      return response.data;
    } catch (error) {
      console.error('Error marking query as answered:', error);
      throw error;
    }
  },

  /**
   * Submit feedback for a query
   * @param {String} queryId - Query ID
   * @param {Object} feedback - Feedback data
   * @returns {Promise} Update result
   */
  async submitFeedback(queryId, feedback) {
    try {
      const response = await httpService.post(`queries/${queryId}/feedback`, feedback);
      return response.data;
    } catch (error) {
      console.error('Error submitting feedback:', error);
      throw error;
    }
  }
};
