/**
 * ornl-modis — ORNL DAAC MODIS subsetting API (MOD13Q1 NDVI).
 *
 * Independent fallback/cross-check for hdx-ndvi. Verified 2026-09-16:
 * no auth, CORS-open, band 250m_16_days_NDVI, latest granule 2026-08-13.
 * Point-based: median of valid pixels (fill -3000 filtered) around each
 * department centroid. Latency 2-11 s/query — only ever called by the
 * scheduler.
 */
const { fetchJson } = require('../http');
const nodeCrypto = require('node:crypto');

// Department centroids (verified against the WFP dataset departments)
const CENTROIDS = {
  Ahuachapán: [13.9833, -89.8333],
  'Santa Ana': [13.9923, -89.5553],
  Sonsonate: [13.7167, -89.7267],
  Chalatenango: [13.9833, -88.9333],
  'La Libertad': [13.5833, -89.4167],
  'San Salvador': [13.6929, -89.2182],
  Cuscatlán: [13.7333, -88.9],
  'La Paz': [13.45, -88.9167],
  Cabañas: [13.85, -88.6667],
  'San Vicente': [13.6167, -88.7833],
  Usulután: [13.4167, -88.4167],
  'San Miguel': [13.4833, -88.1833],
  Morazán: [13.75, -88.0],
  'La Unión': [13.3167, -87.85]
};

/** Convert a JS Date to a MODIS "AYYYYDDD" day-of-year string. */
const toDoy = (date) => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start) / 86400000) + 1;
  return `A${date.getUTCFullYear()}${String(doy).padStart(3, '0')}`;
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

module.exports = {
  id: 'ornl-modis',
  configPrefix: 'ORNL_MODIS',
  cadence: '24h',
  defaults: {
    product: 'MOD13Q1',
    band: '250m_16_days_NDVI',
    kmBox: 20, // kmAboveBelow / kmLeftRight — covers a department core
    daysBack: 60
  },
  endpoints: ['crop-health'],

  async resolve(cfg) {
    const end = new Date();
    const start = new Date(end.getTime() - cfg.daysBack * 86400000);
    return { start: toDoy(start), end: toDoy(end) };
  },

  async fetch(window, cfg) {
    const results = {};
    // Sequential to stay polite to the API (2-11 s each, scheduler-only path)
    for (const [dept, [lat, lon]] of Object.entries(CENTROIDS)) {
      try {
        const url =
          `https://modis.ornl.gov/rst/api/v1/${cfg.product}/subset` +
          `?latitude=${lat}&longitude=${lon}&band=${encodeURIComponent(cfg.band)}` +
          `&startDate=${window.start}&endDate=${window.end}` +
          `&kmAboveBelow=${cfg.kmBox}&kmLeftRight=${cfg.kmBox}`;
        results[dept] = await fetchJson(url, { timeoutMs: 30000, maxRetries: 1 });
      } catch (error) {
        results[dept] = { error: error.message };
      }
    }
    return results;
  },

  parse(raw) {
    return raw; // already JSON per department
  },

  normalize(byDept) {
    const docs = [];
    for (const [dept, payload] of Object.entries(byDept)) {
      const subsets = payload && payload.subset;
      if (!Array.isArray(subsets)) continue;

      // Group pixels by granule date, take the median of valid ones
      const byDate = new Map();
      for (const subset of subsets) {
        for (const point of subset.data || []) {
          const value = parseFloat(point[1]);
          if (!Number.isFinite(value) || value <= -2000) continue; // fill/cloud
          if (!byDate.has(subset.date)) byDate.set(subset.date, []);
          byDate.get(subset.date).push(value * 0.0001); // scale factor
        }
      }

      for (const [date, values] of byDate) {
        const ndvi = median(values);
        const logical = `ornl:${dept}:${date}`;
        docs.push({
          _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
          kind: 'ndvi',
          department: dept,
          date: date.replace(/^A(\d{4})(\d{3})$/, '$1-$2'), // A2026225 -> 2026-225
          vim: Math.round(ndvi * 1000) / 1000,
          source: 'ornl-modis'
        });
      }
    }
    return { collection: 'agri_ndvi', docs };
  }
};
