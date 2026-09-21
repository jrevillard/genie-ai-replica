/**
 * wfp-gtm — WFP VAM food prices for Guatemala (regional reference).
 *
 * Verified 2026-09-16: current only for Guatemala City wholesale "La
 * Terminal" — Carrots, Onions (white), Potatoes, Tomatoes plus staples,
 * 20 continuous months (latest 2026-08-15). Protein items are dead (eggs
 * 2019, chicken 2022) — filter to staples + vegetables only.
 */
const { createWfpAdapter } = require('./_wfp-factory');

module.exports = createWfpAdapter({
  id: 'wfp-gtm',
  configPrefix: 'WFP_GTM',
  dataset: 'wfp-food-prices-for-guatemala',
  file: 'wfp_food_prices_gtm.csv',
  fallbackUrl:
    'https://data.humdata.org/dataset/wfp-food-prices-for-guatemala/resource/63084d67-8c50-4a24-8b45-4d2c4b7bb2fb/download/wfp_food_prices_gtm.csv',
  country: 'Guatemala'
});
