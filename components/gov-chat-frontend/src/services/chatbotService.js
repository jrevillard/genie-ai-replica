// src/services/chatbotService.js - Chatbot Service
import httpService from './httpService';
import keycloakAuthService from './keycloakAuthService';

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
      console.error(
        'Error submitting query:',
        error.message,
        error.response ? JSON.stringify(error.response.data, null, 2) : 'No response data'
      );
      throw error;
    }
  },

  /**
   * Submit a streaming query via SSE.
   * Uses native Fetch API (not axios) for streaming response support.
   * @param {Object} queryData - Query data
   * @param {Object} callbacks - { onChunk, onMetadata, onTranslation, onDone, onError }
   * @returns {AbortController} Controller to cancel the stream
   */
  submitQueryStream(queryData, callbacks) {
    const controller = new AbortController();
    const baseUrl = window.APP_CONFIG?.apiUrl || process.env.VUE_APP_API_URL || 'http://localhost:3000/api';
    const token = keycloakAuthService.getAccessToken();
    const url = `${baseUrl}/queries/stream`;

    const payload = {
      ...queryData,
      timestamp: new Date().toISOString()
    };

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) {
          return response
            .json()
            .then((err) => {
              throw new Error(err.message || `HTTP ${response.status}`);
            })
            .catch(() => {
              throw new Error(`HTTP ${response.status}`);
            });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function processChunk({ done, value }) {
          if (done) return;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            if (trimmed.startsWith(': ')) continue; // SSE comment/keepalive

            try {
              const data = JSON.parse(trimmed.slice(6));
              switch (data.type) {
                case 'chunk':
                  callbacks.onChunk?.(data.content);
                  break;
                case 'metadata':
                  callbacks.onMetadata?.(data);
                  break;
                case 'translation':
                  callbacks.onTranslation?.(data.content);
                  break;
                case 'done':
                  callbacks.onDone?.(data);
                  return;
                case 'error':
                  callbacks.onError?.(new Error(data.message || 'Stream error'));
                  return;
              }
            } catch (e) {
              // Ignore JSON parse errors for non-data lines
            }
          }

          return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        callbacks.onError?.(error);
      });

    return controller;
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
