/**
 * wfp-slv — WFP VAM food prices for El Salvador (official MAG/SIMMAG data).
 * Primary source for local maize/beans/rice/sorghum/wheat-flour prices.
 *
 * Verified 2026-09-16: latest row 2026-08-15; zero rows 2023–2025; since
 * Jan 2026 only San Salvador reports — the estimation engine + regional
 * adapters cover the gap and the UI discloses it.
 */
const { createWfpAdapter } = require('./_wfp-factory');

module.exports = createWfpAdapter({
  id: 'wfp-slv',
  configPrefix: 'WFP_SLV',
  dataset: 'wfp-food-prices-for-el-salvador',
  file: 'wfp_food_prices_slv.csv',
  fallbackUrl:
    'https://data.humdata.org/dataset/0ff64070-c95b-4962-9d99-09d989d43f75/resource/843fb265-6f80-4d86-ae41-ef89b6daff15/download/wfp_food_prices_slv.csv',
  country: 'El Salvador'
});
