// src/services/chatbotService.js - Chatbot Service
import httpService from './httpService';
import keycloakAuthService from './keycloakAuthService';

// The one thumb→rating mapping. The dialog's thumbs and the answer card's
// inline thumbs are the same gesture and must reach analytics as the same
// values; explicit star ratings pass through unchanged.
export const THUMB_RATINGS = { up: 5, down: 1 };

export default {
  /**
   * Submit a query to the chatbot
   * @param {Object} queryData - Query data
   * @returns {Promise} Query result
   */
  async submitQuery(queryData) {
    try {
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

      const queryId = response.data.queryId;
      if (queryId) {
        await this.updateQueryResponseTime(queryId, responseTime);
        await this.markQueryAsAnswered(queryId, responseTime);
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

    // A silent stream never recovers on its own: when the assistant is
    // unreachable upstream the connection just stays open. Watch for
    // frames — any resets the watch; silence past the budget aborts the
    // stream and reports, so the UI leaves its thinking state. The
    // budget must outlast the backend's own LLM timeout (180 s) plus
    // retrieval, or a slow-but-healthy answer gets abandoned here.
    const idleMs = Number(window.APP_CONFIG?.streamIdleTimeoutMs) || 300000;
    let idleTimer = null;
    let finished = false;
    const clearIdleWatch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    };
    const armIdleWatch = () => {
      clearIdleWatch();
      idleTimer = setTimeout(() => {
        controller.abort();
        const error = new Error('The assistant is not responding — the request timed out.');
        error.code = 'STREAM_IDLE_TIMEOUT';
        callbacks.onError?.(error);
      }, idleMs);
    };
    armIdleWatch();

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
          if (done) {
            // A transport-level close without a done frame is a failure —
            // otherwise the stream would sit open forever.
            if (!finished) {
              const error = new Error('The stream closed before the answer completed.');
              error.code = 'STREAM_ENDED';
              callbacks.onError?.(error);
            }
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            // Not a data line — SSE comments (the backend's keepalives)
            // fall through here too, and must not reset the idle watch.
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              armIdleWatch();
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
                  finished = true;
                  clearIdleWatch();
                  callbacks.onDone?.(data);
                  return;
                case 'error': {
                  finished = true;
                  clearIdleWatch();
                  const error = new Error(data.message || 'Stream error');
                  error.fromServer = true;
                  callbacks.onError?.(error);
                  return;
                }
              }
            } catch {
              // Ignore JSON parse errors for non-data lines
            }
          }

          return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk).finally(clearIdleWatch);
      })
      .catch((error) => {
        clearIdleWatch();
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
