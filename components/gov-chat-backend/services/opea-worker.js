const { parentPort } = require('worker_threads');
const axios = require('axios');
const http = require('http');
const https = require('https');

// Dedicated HTTP Agents to prevent socket starvation on the main pool
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 300000 // 120s hard timeout
});

parentPort.on('message', async (task) => {
  const { url, payload } = task;

  try {
    const start = Date.now();
    
    // Perform the long-running request
    const response = await axiosInstance.post(url, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const duration = Date.now() - start;

    // Return only the necessary data
    // Support both vLLM (choices[0].message.content) and legacy OPEA (response) formats
    const data = response.data;
    const responseText = (data.choices && data.choices[0] && data.choices[0].message)
      ? data.choices[0].message.content
      : data.response;
    const metadata = data.metadata || null;

    parentPort.postMessage({
      status: 'success',
      data: {
        response: responseText,
        metadata: metadata,
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