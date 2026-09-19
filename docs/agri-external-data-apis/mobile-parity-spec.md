# Mobile Parity — Build Specification (v1.0)

Companion to `mobile-parity-workplan.md` (tracker) — THIS document is the
build contract for `feat/agri-mobile-parity`. Every algorithm, threshold,
string and i18n key is stated exactly; where behavior exists on the web
the authoritative source file is cited. Target:
`mobile/genie_ai_mobile` · Flutter 3.x · fl_chart (pinned in pubspec).

Reference web files (branch `feat/agri-external-data-apis`):
- `components/gov-chat-backend/services/agri/agri-service.js` (envelope)
- `components/gov-chat-frontend/src/components/charts/MarketPriceChart.vue`
- `components/gov-chat-frontend/src/components/charts/MarketPriceSummaryCard.vue`
- `components/gov-chat-backend/services/agri/series.js` (monthEndAggregate)

---

## 0. Reuse mandate (binding)

The mobile app implements **ZERO data logic of its own**. All data comes
from the SAME backend harness the Vue app uses — the 20-adapter pluggable
system (`components/gov-chat-backend/services/agri/`) with its scheduler,
3-tier cache and degradation — consumed through the shared API:

| Endpoint | Purpose | Mobile usage |
|---|---|---|
| `GET /api/agri/market-prices/:category` | all 8 market categories (this spec) | existing `getMarketPrices` — keep |
| `GET /api/agri/crop-health` | 14-department NDVI | existing `getCropHealth` — keep |
| `GET /api/agri/pest-alerts` | advisories/regional/sightings | existing `getPestAlerts` — keep |
| `GET /api/agri/news?scope=&lang=` | relevance-gated, AI-translated news | existing `getNews` — keep |
| `GET /api/agri/health` | adapter diagnostics | optional diagnostics screen |

Rules:
1. **No upstream calls from the app.** WFP/GT/NIC, World Bank Pink Sheet,
   IMF, Comtrade, FAOSTAT, BLS, GDELT, RSS, HDX, iNaturalist are reached
   ONLY by the backend adapters. Any feature needing new data = a new/extended
   BACKEND adapter + envelope field, then this spec updated — never a
   Flutter-side fetch.
2. **No derivation on the client.** Aggregation (month-end), unit
   conversion, CPI estimation, relevance gating, translation happen
   server-side; mobile renders envelopes as-is (§0 contract below).
3. **Same auth + base URL** as every other backend route
   (`agri_api_service.dart` httpService base config). No separate mobile
   API surface, no feature flags on the backend for mobile.

## 0bis. Envelope contract (server-given — never recompute on mobile)

```jsonc
// GET /api/agri/market-prices/:category →
{
  "data": {
    "title": "Maize, Beans & Grains",
    "unit": "USD/quintal (46 kg)",        // PRIMARY series' unit
    "trend": "up|down|stable|unknown",     // primary series' trend
    "latest": 26.61,                        // primary's newest value
    "series": [
      {
        "name": "Maize (white), San Salvador wholesale",
        "unit": "USD/quintal (46 kg)",     // per-series (may differ pre-normalization)
        "country": "El Salvador",
        "source": "wfp-vam|world-bank-cmo|imf-pcps|faostat-pp|comtrade|bls-ppi|faostat-sdg",
        "data": [ { "date": "2026-08-15", "value": 26.61, "quality": "actual|estimated" } ]
      }
      // 1..N series; grains=15, vegetables=5, fertilizer=5, livestock=2..5,
      // aquaculture=3, cropProtection=2, apiary=2, harvestStorage=1
    ]
  },
  "meta": { "fetchedAt": "ISO-8601", "source": "...", "coverage": "...",
            "estimation": "...|null", "attribution": "...|null",
            "stale": false, "caveats": [ { "code": "...", "params": {} } ] }
}
```

Server already guarantees: **one point per calendar month per series**
(month-end observation), unit normalization to the category axis
(benchmarks arrive with `[converted to …]` in `name`), aquaculture
windowed. Mobile MUST NOT aggregate, convert, or window again.

## 1. Data layer (Phase A)

**S1 — Full mapping.** Replace the `series[0]` mapping in
`lib/services/agri_api_service.dart` (≈line 70-95) with a pass-through:
map EVERY element of `data.series` to
`{ name, unit, country, points: [{date, value, quality}] }` (value as
`double`, date as raw `String`). Keep envelope `meta` on the result.
The existing primary-only shape stays available as
`result.primarySeries = result.series[0]` so current screens don't break
before Phase B lands.

**S2 — Never-fail.** Keep the existing LKG cache semantics
(`agri-lkg:v2:*` keys). On fetch failure return cached + `meta.stale`
(injected `STALE_CACHE` caveat); on no cache return an envelope with
`series: []` and `meta.source = 'unavailable'`.

**Acceptance:** fixture envelope with 3 series/2 units/1 estimated point
maps 1:1; empty-envelope path returns `--` not an exception.

## 2. Display-name algorithm (shared by legend, toggles, table, Latest)

Implement ONCE (lib/components/charts/series_display.dart) and reuse
everywhere — the web ships these exact regexes
(MarketPriceChart.vue `baseSeriesName`/`countryTag`/`dispName`):

```
baseSeriesName(name):
  s = name
  s = s.replace(RegExp(r'\s*\[(regional|converted[^\]]*)\]', caseSensitive: false), '')
  s = s.replace(RegExp(r'\s*\([^)]*(?:intl|international|benchmark|fob|cif)[^)]*\)', caseSensitive: false), '')
  s = s.split(',')[0].trim()
  if (count('(', s) > count(')', s)) s = s.replace(RegExp(r'\s*\([^)]*$'), '').trim()
  return s.isEmpty ? name : s

countryTag(name):           // first match wins
  intl benchmark|US Gulf → 'intl'; San Salvador|El Salvador → 'SV';
  Guatemala → 'GT'; Nicaragua → 'NIC'; Honduras → 'HN';
  Costa Rica → 'CR'; Brazil → 'BR'; Middle East → 'ME'; else ''

displayName(name, allNames): // tag ONLY on base collision
  base = baseSeriesName(name)
  if (others share base): tag = countryTag(name); return tag.isEmpty ? base : '$base ($tag)'
  return base
```

Verified grains output: `Maize (white) (SV)`, `Beans (red) (SV)`,
`Beans (silk red)`, `Rice (SV)`, `Sorghum (SV)`, `Beans (black)`,
`Rice (first quality)`, `Maize (white) (NIC)`, `Beans (red) (NIC)`,
`Beans`, `Sorghum (NIC)`, `Maize`, `Rice (intl)`, `Sorghum (intl)`,
`Wheat`.

## 3. Palette & color stability

**S3 — Palette (5 semantic slots, resolved at render from theme):**
slot0 = category color (web: `resolvedCategoryColor`, the `--fg` token
fallback chain — on mobile use the category color map already in
`_categoryConfig`), slot1 = warning (web `--warning`), slot2 = muted,
slot3 = info, slot4 = danger. Mobile equivalents from the app theme;
hard-fail soft: unresolved → `Colors.grey`.

**S4 — Index rule (critical):** a series' color = `palette[originalIndex % 5]`
where `originalIndex` is its position in the FULL `series` array — never
the position in a filtered/visible list. Filtering or toggling MUST NOT
re-color survivors. The estimated overlay series uses slot1 (warning)
regardless. (Regression guard: this is the web's black-marker bug class.)

## 4. Chart core (Phase B)

**S5 — Spots.** `FlSpot(DateTime.parse(date).millisecondsSinceEpoch.toDouble(), value)`
— date-keyed, NOT index-keyed. Parse accepts `YYYY-MM-DD`, `YYYY-MM`,
`YYYY` (day/month = 01). Points with unparseable dates are dropped.

**S6 — X window.** `minX` = min over ALL ACTIVE series' spot x;
`maxX` = max. With the start-year filter active, `minX` = max(dataMin,
`DateTime(startYear,1,1)`) — the axis must never show time before the
selected year. Bottom ticks: `interval` = months span ≤ 24 → 1 month,
≤ 120 → 1 year, else 5 years; label format `MMM yy` / `yyyy`
(intl default locale).

**S7 — Series rendering.** One `LineChartBarData` per active series:
width 2, `isCurved: true` (smooth), dot radius 2 (dense: >120 visible
points → 1.5), `dotStrokes` off. The estimated subset of the primary
(`quality == 'estimated'`) renders as a SEPARATE bar with
`dashArray: [6, 6]` and palette slot1; actual points of the same month
window render in the primary's color. `belowBarArea` off (web uses 15 %
fill; fl_chart area under 15 series becomes mud — parity target is
readability, deviation recorded here).

**S8 — Y axes.** Group active series by `unit` string. Per group compute
`minVal`, `maxVal` over the group's VISIBLE window (after S6/S20 filters);
`range = maxVal - minVal || 1`; `step = 10^floor(log10(range/4))`
(min 1); `yMin = max(0, floor((minVal - range*0.05)/step)*step)` when
`minVal >= 0` else the unclamped floor; `yMax = round(maxVal*1.5*100)/100`.
One group → left axis only. Two+ groups → first group left, others right,
each with its unit as axis title. Tick labels: currency units
(unit contains `USD`, case-insensitive) get a `$` prefix; `%` units a
`%` suffix; others bare. (Web: MarketPriceChart.vue `axisFor`.)

**S9 — Legend.** Custom chip row ABOVE the chart (fl_chart has none):
color dot (6 px) + `displayName`, wrapping, font 11. Tapping a legend
chip toggles that series (same handler as S15) — one control surface,
two entries.

**S10 — Height.** `chartHeight = max(320, 240 + 45 * activeSeriesCount)`
logical pixels.

## 5. Latest card & tooltips

**S11 — Multi-Latest.** If `activeSeries.length <= 1` → single figure
`latestValue` (last finite point of the primary). Else a list: one row
per active series — color dot + `displayName` + latest value. Row order
= original series order.

**S12 — Tooltip text (exact template):** every Latest figure (headline
and rows) shows on long-press/hover:
`Latest month-end price of {full series name} — {value}{ ' ' + unit}`
(value = last finite point, 2 decimals). Non-price categories read the
same template (the unit explanation carries the semantics).

**S13 — Unit explanation (long-press on the unit label).** Port the web
`unitExplanation` switch verbatim (EN/ES): quintal, PPI, index, %
(SDG 12.3.1 wording incl. the "8.3 means about 8 of every 100 kg"
example), USD/mt, USD/kg, USD/lb, short ton, dozen, generic. The mobile
`_unitExplanation` already matches; update ONLY the `%` branch to:
"Latest = the share of the Central American food harvest, by mass, lost
between harvest and retail (FAO SDG 12.3.1 modeled regional estimate —
not a price). Example: 8.3 means about 8 of every 100 kg of food grown
never reaches a consumer." (ES translation in the web i18n files).

**S14 — Chart touch tooltip.** LineTouch tooltip per touched spot:
line 1 `dd MMM yyyy` (or `MMM yyyy`/`yyyy` per cadence), line 2
`{value}{ ' ' + unit}` where unit = the TOUCHED series' unit.

## 6. Global series toggles (Phase C)

**S15 — Widget.** A wrapping row of checkbox chips between the
prediction button and the Price History title (rendered only when
`series.length > 1`). Chip = Checkbox + color dot + `displayName`; full
name in its own tooltip. State: `Set<String> hiddenSeries` (default
empty) — NOT persisted.

**S16 — Semantics (exact).** Unchecking adds the series name to
`hiddenSeries`; checking removes it. A chip whose series is the LAST
active is rendered disabled (`onChanged: null`). Every downstream
surface — chart lines, legend, Latest card, table columns, CSV — derives
from `activeSeries = series.where(!hidden)` in original order. No
surface reads the raw series list directly.

## 7. Start-year filter (Phase C)

**S17 — Options.** `earliestDataYear` = min year over ALL series' points
(fallback: currentYear − 5). Options list = years from
`max(earliest, currentYear − 5)` DOWN TO `earliest` (inclusive,
descending). Default selection 2015, clamped up to `earliest` if data
starts later (auto-corrected by listener when the envelope loads).

**S18 — Effect.** `visibleSeries = activeSeries.where(point.date >= '$startYear-01-01')`
— drives chart, table, CSV and the Latest card's underlying data (NOT
the Latest values themselves: latest always uses the full history).
`minX` pinned per S6. Label: EN `From` / ES `Desde`; DsSelect-equivalent
dropdown, width ≥ 84 lp.

## 8. Data table & CSV (Phase C)

**S19 — Table.** Columns: `Period` + one per active series
(header = `displayName`, tooltip = `full name (unit)`) + `Quality`.
Rows = the UNION of all active series' dates, sorted ascending; a cell
is empty when that series has no point for the row's date; Quality
column reflects the PRIMARY series' quality for that date
(`Estimated`/`Actual` localized). Horizontal `SingleChildScrollView`;
never widen the dialog.

**S20 — CSV (exact).** Export the S19 rows: first cell `Period` (i18n),
then one column per active series with header
`{full series name} ({unit})`, then `Quality`. Values raw (no thousands
separators), empty for missing. Encoding: UTF-8 with BOM `﻿`, CRLF
line endings, RFC-4180 quoting (quote fields containing `,"`\n;`,
double the quote). Filename `market-prices-{category}-{yyyy-MM-dd}.csv`.
Delivered via `Share.shareXFiles` (existing implementation — extend to
the multi-series rows; current mobile export is primary-only).

## 9. Summary-card dashboard (Phase C)

**S21 — Acronym chips.** Cards show the primary headline + trend pill
(unchanged) plus chips for NON-primary series (up to 23):
`commodityCode(name)`:
  1. base = `baseSeriesName(name)`; code = first word of base, first 3
     chars, uppercase (min 3, pad `?`).
  2. Country tag appended when the FULL name contains: El Salvador→SV,
     Honduras→HN, Guatemala→GT, Costa Rica→CR, Nicaragua→NI, Brazil→BR,
     US Gulf|United States→US, Middle East→ME, World→INT.
  3. Duplicate codes in one category get a second-word initial:
     `CODE-X`.
Chip render: 0.65rem-equivalent text, 1 px border, dot colored
`palette[(seriesOriginalIndex) % 5]`, `cursor: help` equivalent
(long-press tooltip). Tooltip: `{full series name} — {latest value}
{unit}`.

**S22 — Headline tooltip.** The card's big number gets the S12 template
with the PRIMARY series.

## 10. About panel & caveats (Phase D)

**S23.** Below the caveat banner, a collapsible "About this data"
section: Source, Coverage, Estimates, Attribution rows from `meta`
(rendered only when non-null), i18n keys per the web
(`charts.caveats.*`). Caveat chips already exist — keep.

## 11. Debug logging (Phase D)

**S24 — Exact formats (debugPrint, kDebugMode only):**
- on load: `[MarketPriceChart:{category}] loaded {n} series, {m} points,
  unit={unit}, stale={bool}` plus one compact map per series
  `{name, unit, n}`.
- on axis build: `[MarketPriceChart:{category}] series={n} groups={k}`
  + per group `{axis: i, unit, series: count, yMin, yMax}`.

## 12. i18n keys (EN/ES translated; other locale files EN fallback)

```
market.startYear: From / Desde
market.series:    Series / Series
market.exportCsv: Export CSV / Exportar CSV          (exists on mobile? verify)
market.period:    Period / Periodo
market.value:     Value / Valor
market.quality:   Quality / Calidad
market.estimated: Estimated / Estimado
market.actual:    Actual / Real
caveats.aboutData / .source / .coverage / .estimation / .attribution  (port if absent)
```
On-screen language selector stays EN/ES (flavor-driven) — unchanged.
Other locale files stay key-complete (CI + country reuse).

## 13. Widget tests (must ship with the code)

1. Data mapping: 3-series/2-unit/1-estimated fixture → 1:1 (S1).
2. Display names: the 15 grains names → the exact outputs in §2.
3. Palette stability: hiding series[1] does not change series[2]'s color (S4).
4. Y-axis math: chicken/beef group → yMin 0, yMax 12.32 (0.3-8.21 data) (S8).
5. Toggle guard: unchecking the last active series is a no-op (S16).
6. Start-year: default 2015; options bounds; axis min pinned (S17/S18).
7. Table/CSV: union rows, empty cells for missing dates, BOM+CRLF, quoting (S19/S20).
8. Chips: `Maize (US #2, US Gulf intl benchmark)` → `MAI-US`; duplicate
   codes get the second-word initial (S21).

## 14. Definition of done (binding)

- All S-items implemented; §13 tests green; `flutter analyze` clean;
  `dart format` clean.
- **Reuse mandate (§0) holds: zero upstream calls, zero data derivation
  in Dart** — grep-review confirms the app only ever calls the five
  `/api/agri/*` endpoints.
- Manual parity pass on Android + iOS emulators against 10.0.0.101 for
  ALL 8 categories: series counts, units, colors vs legend vs toggles,
  filter + toggles + zoom composition, table/CSV contents.
- jrevillard review on the `feat/agri-mobile-parity` MR.
