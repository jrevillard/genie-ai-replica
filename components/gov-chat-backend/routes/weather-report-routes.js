const express = require('express');
const axios = require('axios');
const { logger } = require('../shared-lib');

const router = express.Router();
const WEATHER_MCP_URL = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';

// Drought PDF report names as written by drought_monitoring: drought_<district>_<yyyymmdd>.pdf
const DROUGHT_REPORT_NAME_RE = /^drought_[a-z0-9_'-]{1,40}_\d{8}\.pdf$/i;

/**
 * Public drought PDF report (mounted at /api/weather/drought-report WITHOUT the
 * Keycloak guard, and before the protected /api/weather router). The link is
 * opened as a plain browser navigation from the alert banner and from chat
 * markdown, so no bearer header is sent. The report is an aggregate district
 * document with no user data; the strict filename pattern rules out path
 * traversal and enumeration of anything else on the shared volume.
 */
module.exports = () => {
  router.get('/:filename', async (req, res) => {
    const { filename } = req.params;
    if (!DROUGHT_REPORT_NAME_RE.test(filename)) {
      return res.status(400).json({ message: 'Invalid report name' });
    }
    try {
      const resp = await axios.get(`${WEATHER_MCP_URL}/drought/report/${encodeURIComponent(filename)}`, {
        responseType: 'stream',
        timeout: 15000
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return resp.data.pipe(res);
    } catch (err) {
      if (err.response?.status === 404) return res.status(404).json({ message: 'Report not found' });
      logger.error(`[RISK] Drought report proxy error for ${filename}: ${err.message}`);
      return res.status(502).json({ message: 'Report service unavailable' });
    }
  });
  return router;
};
