/**
 * Estimation engine — inflation-adjusted fill for missing years
 * (remediation-plan.md §5.1, user interview decision 2026-09-17).
 *
 * Where a price series has missing years (FAOSTAT ends 2022; WFP SLV has a
 * 2023–25 hole), fill them with CPI-adjusted estimates from the wb-cpi
 * adapter (El Salvador, WB FP.CPI.TOTL):
 *
 * - Trailing gaps:  est(Y) = lastActual * CPI(Y) / CPI(baseYear)
 *   For the current year with no published CPI yet, apply the last known
 *   YoY rate and flag the estimate as partial.
 * - Interior gaps: same CPI chain from the last pre-gap actual; when actuals
 *   resume, actuals override. If the CPI-scaled estimate at the resume point
 *   deviates > 15% from the resumed actual, bridge actual-to-actual along
 *   the CPI path instead and disclose the deviation.
 *
 * Output series items are quality-tagged:
 *   { date, value, quality: 'actual' | 'estimated', estMethod, baseYear }
 */

const DEVIATION_THRESHOLD_PCT = 15;

/**
 * @param {Map<number, number>} cpiByYear - CPI index by year (any base)
 * @returns {Map<number, number>} year-over-year ratio by year
 */
function yoyRatios(cpiByYear) {
  const ratios = new Map();
  const years = [...cpiByYear.keys()].sort((a, b) => a - b);
  for (let i = 1; i < years.length; i += 1) {
    const prev = cpiByYear.get(years[i - 1]);
    const cur = cpiByYear.get(years[i]);
    if (prev > 0 && cur > 0) {
      ratios.set(years[i], cur / prev);
    }
  }
  return ratios;
}

/**
 * Estimated CPI index for years beyond the last published one, by holding
 * the last known YoY rate constant.
 * @returns {Map<number, number>}
 */
function projectedCpi(cpiByYear, throughYear) {
  const projected = new Map(cpiByYear);
  const ratios = yoyRatios(cpiByYear);
  const years = [...cpiByYear.keys()].sort((a, b) => a - b);
  let lastYear = years[years.length - 1];
  let lastIndex = cpiByYear.get(lastYear);
  const lastRatio = [...ratios.values()].pop() || 1;

  while (lastYear < throughYear) {
    lastYear += 1;
    lastIndex *= lastRatio;
    projected.set(lastYear, lastIndex);
  }
  return projected;
}

/**
 * Fill missing years of an annual price series with CPI-adjusted estimates.
 *
 * @param {Array<{year:number, value:number}>} actuals - sparse actual observations
 * @param {Map<number, number>} cpiByYear - CPI index by year
 * @param {number} throughYear - fill estimates up to and including this year
 * @returns {{series: Array<{date:string, value:number, quality:string, estMethod?:string, baseYear?:number, partial?:boolean}>,
 *            estimation: string|null}} - filled series + disclosure text
 */
function fillMissingYears(actuals, cpiByYear, throughYear) {
  if (!actuals || actuals.length === 0) {
    return { series: [], estimation: null };
  }

  const sorted = [...actuals].sort((a, b) => a.year - b.year);
  const cpi = projectedCpi(cpiByYear, throughYear);
  const series = [];
  const baseYears = [];

  const estFor = (baseYear, targetYear) => {
    const baseCpi = cpi.get(baseYear);
    const targetCpi = cpi.get(targetYear);
    if (!baseCpi || !targetCpi) return null;
    return (sorted.find((a) => a.year === baseYear) || {}).value * (targetCpi / baseCpi);
  };

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    series.push({ date: String(current.year), value: current.value, quality: 'actual' });

    const next = sorted[i + 1];
    const gapEnd = next ? next.year - 1 : throughYear;
    const gapStart = current.year + 1;

    if (gapStart > gapEnd) continue;

    // Interior gap: check the CPI estimate against the resumed actual
    let useBridge = false;
    if (next) {
      const resumeEst = estFor(current.year, next.year);
      if (resumeEst !== null && next.value > 0) {
        const deviation = (Math.abs(resumeEst - next.value) / next.value) * 100;
        useBridge = deviation > DEVIATION_THRESHOLD_PCT;
      }
    }

    for (let y = gapStart; y <= gapEnd; y += 1) {
      let value;
      if (!next || !useBridge) {
        value = estFor(current.year, y);
      } else {
        // Bridge actual-to-actual along the CPI path:
        // linear interpolation between the two actuals, shaped by relative CPI
        const span = next.year - current.year;
        const t = (y - current.year) / span;
        const lin = current.value + (next.value - current.value) * t;
        const cpiAdj = estFor(current.year, y);
        const resumeCpiAdj = estFor(current.year, next.year) || next.value;
        const cpiShape = cpiAdj !== null && resumeCpiAdj !== 0 ? cpiAdj / resumeCpiAdj : 1;
        value = lin * cpiShape;
      }

      if (value !== null && Number.isFinite(value)) {
        series.push({
          date: String(y),
          value: Math.round(value * 100) / 100,
          quality: 'estimated',
          estMethod: 'cpi',
          baseYear: current.year,
          partial: !cpiByYear.has(y)
        });
        baseYears.push(current.year);
      }
    }
  }

  if (baseYears.length === 0) {
    return { series, estimation: null };
  }

  const uniqueBaseYears = [...new Set(baseYears)];
  const estimatedYears = series.filter((s) => s.quality === 'estimated').map((s) => Number(s.date));
  const range = estimatedYears.length > 0 ? `${Math.min(...estimatedYears)}–${Math.max(...estimatedYears)}` : '';
  const partial = series.some((s) => s.quality === 'estimated' && s.partial);

  const estimation =
    `${range} values are inflation-adjusted estimates ` +
    `(base: ${uniqueBaseYears.join(', ')} actual, El Salvador CPI)` +
    (partial ? '; current-year CPI projected at last known rate' : '');

  return { series, estimation };
}

module.exports = { fillMissingYears, yoyRatios, projectedCpi, DEVIATION_THRESHOLD_PCT };
