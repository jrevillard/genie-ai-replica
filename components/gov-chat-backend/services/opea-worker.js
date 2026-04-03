const { parentPort } = require('worker_threads');
const axios = require('axios');
const http = require('http');
const https = require('https');

/**
 * OPEA Worker Thread
 *
 * Service-to-Service Authentication:
 * - OPEA services communicate via internal Docker network with NO authentication
 * - This is "network isolation" trust model (not formal auth mechanisms like JWT/mTLS)
 * - User identity is passed via X-User-Id, X-User-Roles, X-Issuer headers (injected by middleware)
 * - Authorization header is NEVER forwarded to OPEA (worker cannot access req.headers)
 */

// Dedicated HTTP Agents to prevent socket starvation on the main pool
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 120000 // 120s hard timeout
});

parentPort.on('message', async (task) => {
  const { url, payload, headers } = task;

  try {
    const start = Date.now();
    
    // Build headers: Content-Type + user identity headers
    const requestHeaders = { 
      'Content-Type': 'application/json',
      ...(headers || {})
    };
    
    // Perform the long-running request
    const response = await axiosInstance.post(url, payload, {
      headers: requestHeaders
    });

    const duration = Date.now() - start;

    // Return only the necessary data
    parentPort.postMessage({
      status: 'success',
      data: {
        response: response.data.response,
        metadata: response.data.metadata,
        responseTime: duration
      }
    });

  } catch (error) {
    // Serialize error object safely for transport
    parentPort.postMessage({
      status: 'error',
      error: {
        message: error.message,
        code: error.code || 'UNKNOWN',
        response: error.response ? {
          status: error.response.status,
          data: error.response.data
        } : null
      }
    });
  }
});