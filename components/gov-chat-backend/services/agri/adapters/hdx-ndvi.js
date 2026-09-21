/**
 * hdx-ndvi — WFP subnational NDVI for El Salvador (dekadal, ADM1).
 *
 * Verified 2026-09-16: all 14 departments, latest dekad 2026-09-01, CC-BY 4.0.
 * Uses the 5ytd file for current values; SV11 carries a sliver adm_id —
 * dedupe by highest n_pixels per PCODE+date.
 */
const { fetchUrl } = require('../http');
const { parseCsvObjects } = require('../csv');
const { resolveHdxResource } = require('../resolvers');
const nodeCrypto = require('node:crypto');

// PCODE -> department name (verified against the dataset)
const DEPARTMENTS = {
  SV01: 'Ahuachapán',
  SV02: 'Santa Ana',
  SV03: 'Sonsonate',
  SV04: 'Chalatenango',
  SV05: 'La Libertad',
  SV06: 'San Salvador',
  SV07: 'Cuscatlán',
  SV08: 'La Paz',
  SV09: 'Cabañas',
  SV10: 'San Vicente',
  SV11: 'Usulután',
  SV12: 'San Miguel',
  SV13: 'Morazán',
  SV14: 'La Unión'
};

module.exports = {
  id: 'hdx-ndvi',
  configPrefix: 'HDX_NDVI',
  cadence: '24h',
  defaults: {
    dataset: 'slv-ndvi-subnational',
    file: 'slv-ndvi-subnat-5ytd.csv',
    fallbackUrl:
      'https://data.humdata.org/dataset/b84f0c2e-2b7f-41c0-bf5d-8d0d7407a228/resource/331b851f-1bb4-4244-91d1-247c23ec1d15/download/slv-ndvi-subnat-5ytd.csv'
  },
  endpoints: ['crop-health'],

  async resolve(cfg) {
    return resolveHdxResource(cfg.dataset, cfg.file, cfg.fallbackUrl);
  },

  async fetch(url) {
    const res = await fetchUrl(url, { timeoutMs: 120000 }); // full CSV is ~2.4 MB
    return res.bodyText;
  },

  parse(text) {
    return parseCsvObjects(text, { maxRows: 300000 });
  },

  normalize(rows) {
    // rows: date,adm_level,adm_id,PCODE,n_pixels,vim,vim_avg,viq
    const best = new Map(); // PCODE:date -> doc (highest n_pixels wins)
    for (const row of rows) {
      if (String(row.adm_level) !== '1') continue;
      const name = DEPARTMENTS[row.PCODE];
      if (!name) continue;
      const vim = parseFloat(row.vim);
      const pixels = parseInt(row.n_pixels, 10) || 0;
      if (!Number.isFinite(vim)) continue;

      const logical = `${row.PCODE}:${row.date}`;
      const existing = best.get(logical);
      if (existing && existing.nPixels >= pixels) continue; // SV11 sliver loses

      best.set(logical, {
        _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
        kind: 'ndvi',
        department: name,
        pcode: row.PCODE,
        date: row.date,
        vim: Math.round(vim * 1000) / 1000,
        nPixels: pixels,
        source: 'wfp-hdx'
      });
    }
    return { collection: 'agri_ndvi', docs: [...best.values()] };
  }
};
