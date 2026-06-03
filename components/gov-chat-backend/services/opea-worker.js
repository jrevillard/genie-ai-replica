const { parentPort } = require("worker_threads");
const axios = require("axios");
const http = require("http");
const https = require("https");

/**
 * OPEA Worker Thread
 *
 * Service-to-Service Authentication:
 * - User's Bearer token (Authorization header) is forwarded for JWKS validation
 *   by downstream services (ChatQnA, document-repository)
 * - Each service validates the token independently against Keycloak JWKS
 */

// Dedicated HTTP Agents to prevent socket starvation on the main pool
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 120000, // 120s hard timeout
});

parentPort.on("message", async (task) => {
  const { url, payload, headers } = task;

  try {
    const start = Date.now();

    // Build headers: Content-Type + user identity headers
    const requestHeaders = {
      "Content-Type": "application/json",
      ...(headers || {}),
    };

    // Perform the long-running request
    const response = await axiosInstance.post(url, payload, {
      headers: requestHeaders,
    });

    const duration = Date.now() - start;

    // Return only the necessary data
    parentPort.postMessage({
      status: "success",
      data: {
        response: response.data.response,
        metadata: response.data.metadata,
        responseTime: duration,
      },
    });
  } catch (error) {
    // Serialize error object safely for transport
    parentPort.postMessage({
      status: "error",
      error: {
        message: error.message,
        code: error.code || "UNKNOWN",
        response: error.response
          ? {
              status: error.response.status,
              data: error.response.data,
            }
          : null,
      },
    });
  }
});
