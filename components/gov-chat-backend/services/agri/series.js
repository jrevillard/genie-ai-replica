/**
 * Price-series normalization helpers (remediation-plan.md §6).
 *
 * - Canonical storage: USD per kg (WFP `usdprice` column, NOT local `price`)
 * - Display unit: USD per Central American quintal (45.97 kg) per interview
 *   decision — conversion happens at render; canonical values stay USD/kg
 * - Quintal drift guard: WFP units switch between "45 KG"/"46 KG" (both ≈
 *   one quintal) — normalize to USD/kg so no step artifact appears
 * - Trend: minimum 3 observations; monthly series use a 3-point slope,
 *   annual series last-vs-previous (never a 2-point trend on gapped data)
 */

const KG_PER_QUINTAL = 45.97; // Central American quintal

/**
 * Parse a WFP unit string ("45 KG", "46 KG", "Libra", "LB") to kg, or null.
 * @param {string} unit
 * @returns {number|null}
 */
function unitToKg(unit) {
  if (!unit) return null;
  const m = String(unit)
    .trim()
    .match(/^([\d.]+)\s*KG$/i);
  if (m) return parseFloat(m[1]);
  if (/^(libra|lb)$/i.test(String(unit).trim())) return 0.45359237;
  return null;
}

/**
 * Convert one WFP price row to a canonical USD/kg observation.
 * Uses `usdprice` (the USD-normalized column present in all WFP VAM CSVs —
 * NIC/GT files also carry local-currency `price` which must NOT be used).
 *
 * @param {{usdprice?: string|number, price?: string|number, unit?: string}} row
 * @returns {{usdPerKg: number, isRetail: boolean}|null}
 */
function wfpRowToUsdPerKg(row) {
  const usd = parseFloat(row.usdprice);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const kg = unitToKg(row.unit);
  if (!kg || kg <= 0) return null;
  return {
    usdPerKg: usd / kg,
    isRetail: /libra|lb/i.test(String(row.unit || ''))
  };
}

const usdPerKgToQuintal = (usdPerKg) => usdPerKg * KG_PER_QUINTAL;

/**
 * Trend over a sorted series with a minimum-3-observations rule.
 * Monthly (or denser) series: slope of last 3 points. Annual/sparse: last
 * vs previous. Returns 'up' | 'down' | 'stable' | 'unknown' using the ±2 %
 * threshold.
 *
 * @param {Array<{date:string, value:number}>} series - sorted ascending by date
 * @param {Object} [opts] - { dense: boolean } force 3-point slope
 */
function computeTrend(series, opts = {}) {
  const points = (series || []).filter((p) => Number.isFinite(p.value));
  if (points.length < 3) return 'unknown';

  const isDense = opts.dense || points.length >= 6;
  if (isDense) {
    const [a, b, c] = points.slice(-3);
    const slope = (c.value - a.value) / Math.max(Math.abs(a.value), 1e-9);
    // Two consecutive movements in the same direction beat noise
    const up1 = b.value > a.value;
    const up2 = c.value > b.value;
    if (up1 && up2 && slope > 0.02) return 'up';
    if (!up1 && !up2 && slope < -0.02) return 'down';
    return 'stable';
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const change = (last.value - prev.value) / Math.max(Math.abs(prev.value), 1e-9);
  if (change > 0.02) return 'up';
  if (change < -0.02) return 'down';
  return 'stable';
}

/**
 * Reduce a series to its LAST observation per calendar month (month-end
 * price, market convention). This is the rendering cadence for every market
 * chart: sub-monthly WFP market rows are visual noise at chart scale, and a
 * uniform monthly grid keeps daily/monthly/annual series comparable on the
 * datetime axis. Raw observations stay in agri_series — only the served
 * envelope is aggregated. Estimated (CPI) points compete for their month's
 * slot by date order like any other point.
 *
 * @param {Array<{date:string, value:number, quality?:string}>} data
 * @returns {{data: Array, aggregated: boolean}} aggregated=false when the
 *   input was already month-spaced (or shorter) — nothing was collapsed
 */
function monthEndAggregate(data) {
  const sorted = (data || [])
    .filter((p) => p && p.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map();
  for (const p of sorted) byMonth.set(p.date.slice(0, 7), p);
  const out = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, p]) => p);
  return { data: out, aggregated: out.length !== sorted.length };
}

module.exports = { unitToKg, wfpRowToUsdPerKg, usdPerKgToQuintal, computeTrend, monthEndAggregate, KG_PER_QUINTAL };
