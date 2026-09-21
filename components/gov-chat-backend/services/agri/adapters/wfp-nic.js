/**
 * wfp-nic — WFP VAM food prices for Nicaragua (regional reference).
 *
 * Verified 2026-09-16: from Jan 2024 the only "market" is National Average
 * (retail) — Eggs, Chicken, Pork, Beef, Tomatoes, Onions, Cabbage, Peppers,
 * Squashes, Potatoes — 28+ continuous months (latest 2026-05-15). This is
 * the current protein/vegetable reference for categories with no
 * El-Salvador-local monthly source. Rendered with REGIONAL_DATA caveats.
 */
const { createWfpAdapter } = require('./_wfp-factory');

module.exports = createWfpAdapter({
  id: 'wfp-nic',
  configPrefix: 'WFP_NIC',
  dataset: 'wfp-food-prices-for-nicaragua',
  file: 'wfp_food_prices_nic.csv',
  fallbackUrl:
    'https://data.humdata.org/dataset/b89df9fc-3522-4950-80d0-e384059c2376/resource/9fa93b8c-3b50-4db5-a67b-97c079eb3269/download/wfp_food_prices_nic.csv',
  country: 'Nicaragua'
});
