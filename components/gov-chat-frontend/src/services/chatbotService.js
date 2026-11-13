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

    // #1820 (dead SSO session on the chat surface): the stream rides native
    // fetch, not the axios instance — its 401s never reach httpService's
    // 401→refresh→escalate interceptor, so a session past its wall surfaced
    // as endless processing errors with no login bounce. The same contract,
    // applied here: ONE silent refresh on a 401, one retried stream, then
    // the same escalation arm on the terminal 401 — only a user the stored
    // state reports gone/expired goes to login (one transient failure must
    // never discard a good session — the 2026-10-11 ruling).
    const escalateDeadSession = async () => {
      try {
        const user = await keycloakAuthService.getUser();
        if ((!user || user.expired) && typeof window !== 'undefined') {
          await keycloakAuthService.login();
        }
      } catch (escalationError) {
        console.error('[ChatbotService] Session escalation failed:', escalationError.message);
      }
    };

    const recoverDeadSession = async () => {
      try {
        const refreshed = await keycloakAuthService.signinSilent();
        if (refreshed && refreshed.access_token) return refreshed.access_token;
      } catch (refreshError) {
        console.error('[ChatbotService] Token refresh failed:', refreshError.message);
      }
      return null;
    };

    const doFetch = (authToken) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

    const startStream = async (authToken, retried) => {
      const response = await doFetch(authToken);
      if (!response.ok) {
        // Read the body first, then throw once: the backend says why it
        // refused (an unsupported language, a validation error), and that
        // reason must reach the user instead of a bare status code.
        //
        // The status travels with the error so the caller can tell a
        // refused request (4xx — the deployment is up, the request was not
        // acceptable) from a broken one (5xx — the deployment is down).
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = err.error;
        if (response.status === 401) {
          if (!retried) {
            const freshToken = await recoverDeadSession();
            if (freshToken) return startStream(freshToken, true);
          }
          // The terminal 401 — the retry's own, or the first when the
          // refresh yielded nothing. Escalate WITHOUT refreshing again: a
          // "successful" refresh carrying a clamped-to-death token lands
          // exactly here, and it must bounce, not loop.
          await escalateDeadSession();
        }
        throw error;
      }
      return response;
    };

    startStream(token, false)
      // startStream resolves only on an ok response — every refusal (and the
      // 401 recovery round's terminal 401) throws into the .catch below.
      .then((response) => {
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
                  // An empty frame message stays empty: the store's
                  // generic floor renders it localized, and a hard-coded
                  // developer string would surface as server prose. The
                  // || '' keeps a JSON null from stringifying into the
                  // status line.
                  const error = new Error(data.message || '');
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
