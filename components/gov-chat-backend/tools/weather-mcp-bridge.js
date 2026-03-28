// components/gov-chat-backend/tools/weather-mcp-bridge.js
// HTTP adapter used by the tool-calling loop (TOOLS_ENABLED path).
// Calls /mcp/tools/call for a direct BMD scrape without the Gemini explanation layer.
const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';

const definition = {
  type: 'function',
  function: {
    name: 'retrieve_weather_forecast',
    description: 'Fetches official 3-7 day weather forecasts for Bangladesh districts from BMD.',
    parameters: {
      type: 'object',
      properties: {
        district_name: { type: 'string', description: 'Bangladesh district name (e.g. "Dhaka", "Pabna")' },
        forecast_days: { type: 'integer', description: 'Number of forecast days (1-7)', default: 3 }
      },
      required: ['district_name']
    }
  }
};

async function handler(args) {
  const response = await axios.post(`${PYTHON_SERVICE_URL}/mcp/tools/call`, {
    name: 'retrieve_weather_forecast',
    arguments: args
  });
  return JSON.parse(response.data.content[0].text);
}

module.exports = { definition, handler };
