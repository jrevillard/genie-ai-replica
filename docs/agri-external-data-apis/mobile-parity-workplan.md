# Flutter Mobile Parity — Comprehensive Work Plan (v4)

Date: 2026-09-19 · Implementation branch: **`feat/agri-mobile-parity`**
(branch off `feat/agri-external-data-apis` once MR !388 merges; own MR,
reviewed after !388) · Status: **plan only — not started**
Scope: bring Crop Health, Pest Alerts and ALL Market Prices screens in
`mobile/genie_ai_mobile` into line with the Vue 3 web app.

**Build contract:** the item-by-item specification lives in
[`mobile-parity-spec.md`](mobile-parity-spec.md) (S1-S24, exact
algorithms, strings, i18n keys, tests). This file is the tracker; the
spec is what gets implemented. Binding constraint: the mobile app reuses
the Vue app's backend adapters/APIs exclusively (spec §0).

> v4 incorporates everything shipped on the web app during the
> 2026-09-18/19 sessions (news pipeline, chart crash fixes, grains
> expansion, history filter, multi-series table). The capability matrix
> is the source of truth; numbered items (M#) are independent so
> adjustments between now and kickoff stay cheap.

## 1. Parity matrix — web capability × mobile status

### Data & content (server-side — automatically at parity once M1/M2 land)

| # | Web capability (as shipped) | Mobile today | Gap |
|---|---|---|---|
| M1 | All series per category — grains now **15 series** (SV wholesale ×5, GT ×2, NIC ×4, intl benchmarks ×4 auto-converted USD/mt→quintal), vegetables 5, fertilizer 5, aquaculture 3 | **Data layer maps `series[0]` only** (`agri_api_service.dart` ~line 73) | **Critical** |
| M2 | Per-series `name`, `unit`, point `quality` consumed | Dropped in the mapping | Critical (blocks M5/M8/M13) |
| M3 | Nicaragua defs are wholesale | Server-side — none once M1 lands | (closed by M1) |
| M4 | Start-year history filter on every dialog (options: earliest→current−5, default 2015, chart+table+CSV re-render; axis pinned to selected year) | Absent | High |
| M5 | CPI-estimated points rendered dashed | No quality handling | High |
| M6 | Wheel-zoom + drag-pan + native +/−/fit toolbar | None (fl_chart has none built-in) | High |
| M7 | Multi-commodity Latest card (per-series figure, color-matched, per-series "latest month-end price of…" tooltips) | Single figure, primary only | High |
| M8 | Relative per-unit y-axes: floor-hug + 1.5× max, `$` on USD ticks, axis unit titles, left/right axes for irreducible unit mixes (cropProtection) | 1.5× top + `$` done; floor differs; single axis; no unit titles | Medium |
| M9 | Tooltips: date + value + unit (sparkline too) | Date + value (no unit) | Medium |
| M10 | Category summary buttons as dashboard: acronym chips (CAB-GT, DAP-US…) with palette dots + full-description/price tooltips; headline number self-explaining tooltip | Rows were dropped for chips on web; mobile has neither — chips needed | Medium |
| M11 | Data table: one column per series, date-aligned union rows, horizontal scroll | Primary-only rows | Medium |
| M12 | CSV export: all series, date-aligned, unit headers, translated quality | **Done** — but mobile's export still assumes primary-only; must switch to the date-aligned multi-series shape | Medium |
| M20 | Global series on/off toggles: one checkbox per commodity (color-dotted, short name, full name on hover) driving chart + table + CSV + Latest card together; stable per-series palette slots; last active series cannot be switched off | Absent (depends on M1) | Medium |
| M21 | Shared short display names + legend layout: compact commodity names (country-tagged on collisions, e.g. "Beans (red) (SV)" vs "(NIC)") used IDENTICALLY by chart legend, toggles, Latest rows and table headers; legend top-left, compact markers; per-series palette slots survive filtering/toggling (no black-marker class bugs) | Absent (depends on M1) | Medium — implement together with M20 |
| M13 | News: language-follows-locale, relevance gate, AI translation fallback (translate-then-persist `_tr<lang>`), wire dedupe, economía feed | **Done** (same endpoints) | — |
| M14 | Caveat chips + About panel (source/coverage/estimation) | Banner only; About panel absent | Low |
| M15 | Unit calibration explanations (quintal/PPI/index/SDG %-of-what incl. the 8-in-100-kg example) | Exists | — |
| M16 | EN/ES i18n for all chart strings (selector stays EN/ES; other locale files key-complete) | **Done** | — |
| M17 | Debug logging: per-load line (series/points/units/stale) + per-axis line (groups/min/max) | Absent | Low |
| M18 | Crop Health: 14 depts, baseline/trend/health buckets | List renders; verify baseline/change display + tooltips | Verify |
| M19 | Pest Alerts: advisories/regional/sightings, severity filter, AI assistance | Exists | Verify |

## 2. Phases

### Phase A — Data layer (M1, M2) · effort S · no UI change
Map the full envelope: every series (name, unit, data incl. `quality`),
meta passthrough. Acceptance: 15-series grains envelope maps 1:1 (fixture
test); existing screens still render from `series[0]`.

### Phase B — Chart core (M3, M5, M7, M8) · effort L
Date-keyed spots (`millisecondsSinceEpoch`), `minX/maxX` from union range,
month/year bottom-tick formatter. Multi-`LineChartBarData` with the web
palette semantics; custom legend chip row; series-count-scaled height.
Estimated overlay split by `quality` with `dashArray`. Per-unit axes with
titles; two unit groups → left/right. Multi-commodity Latest card with
per-series "latest month-end price of…" tooltips (M7), headline-number
tooltip on the summary cards (M10's tooltip half).
Acceptance: grains renders 15 color-matched series with legend;
cropProtection renders dual axes; every Latest row self-explains.

### Phase C — Interaction & filters (M4, M6, M9, M10 chips, M11, M12, M20) · effort M/L
Start-year dropdown (same contract as web: earliest→current−5, default
2015, clamped; chart+table+CSV re-render; axis pinned to the selection).
Global series toggles (M20): a wrap of checkbox chips above the chart —
each toggle drives chart, table, CSV and the Latest card together;
palette slots stay keyed to the series' original index so survivors keep
their color; the last active series' checkbox disables. Pinch-zoom +
drag-pan driving a `minX/maxX` window state (y re-scales to the visible
window) with `[−] [+] [Fit]` buttons. Tooltip gains unit. Summary cards
gain the acronym chips (dot + code, tooltip = description + price).
Table: one column per ACTIVE series over date-aligned union rows,
horizontally scrollable. CSV rebuilt on the same rows.
Acceptance: filter + toggles + zoom compose (zoom respects the filtered,
toggled range); chips and table match the web's information density
without widening the cards; toggling never leaves an empty chart.

### Phase D — Polish, parity verification, logging (M14, M17, M18, M19) · effort S
About panel from meta; `debugPrint` load/axis lines matching the web's
console lines; crop-health and pest-alerts verification passes; flutter
analyze/format/tests green; manual smoke on Android + iOS against
10.0.0.101.

## 3. Sequencing & estimates

A (S) → B (L) → C (M/L) → D (S). B alone fixes the "wrong data on
screen" class; C brings the dashboard interactions. Total: roughly 3–4
focused days (v3 adds the filter, chips, multi-series table/CSV). No
backend changes required — mobile consumes the same envelopes
(month-end cadence, unit conversions, translated news, 15-series grains
all server-side).

## 4. Risks

- fl_chart: pinch/pan math is hand-rolled; if the pinned version fights
  window-state updates, upgrade is contained to Phase C.
- Performance: 15 series × ~200-800 monthly points each is the new
  grains worst case — verify frame timing on a low-end device in Phase B;
  the month-end cadence keeps totals bounded (~1,700 points/category).
- Wide table + chips on small screens: follow the web's answers (scroll
  container, wrapping chips) rather than inventing new layouts.
- i18n: new strings (filter label, zoom buttons, About rows, chip
  tooltips) need EN/ES in `lib/i18n/locales/{en,es}.dart`; other locale
  files stay key-complete with EN fallback (locale-consistency CI +
  reuse by other countries). On-screen language selector stays EN/ES.

## 5. Definition of done

Every Crop Health, Pest Alerts and Market Prices screen shows the same
series set, units, cadence, calibration text, caveats, history filter and
interactive behavior as the Vue app; `flutter analyze` clean; widget
tests cover the data mapping, palette/legend, zoom-window math and the
date-aligned table/CSV; manual sign-off against 10.0.0.101; reviewed by
jrevillard.

## 6. Change log (for pre-kickoff adjustments)

> Standing rule (2026-09-19): EVERY web enhancement/change made from now
> on is tracked here and reflected in the matrix/phases, so the mobile
> catch-up plan never drifts from the web app.

- 2026-09-19 v4.1: shared short display names + legend layout (new M21,
  pair with M20 in Phase C) — the web's marker-color regression (indexOf
  on copied series → -1 → black markers) and legend-overlap fix are
  captured as acceptance criteria: palette slots survive
  filtering/toggling, and one display-name map feeds legend, toggles,
  Latest rows and table headers.
- 2026-09-19 v4: global series on/off toggles (new M20, Phase C) —
  checkbox chips driving chart + table + CSV + Latest card, stable
  palette slots, last-active guard. Plan now under a standing sync rule.
- 2026-09-19 v3: session sync — 15-series grains (M1/M3), start-year
  filter (M4), acronym chips + self-explaining headline (M10), per-series
  tooltips (M7), date-aligned multi-series table + CSV (M11/M12), serve-path
  fixes (empty-LKG miss, obsolete-LKG rebuild, news in the periodic
  rebuild), debug logging (M17). Nicaragua wholesale fix noted (M3).
- 2026-09-19 v2: comprehensive matrix + phases; multi-commodity Latest
  card (M7), zoom toolbar (M6), About panel (M12→M14), debug logging
  (M15→M17), SDG unit-explanation wording, month-end cadence context.
- 2026-09-18 v1: initial assessment (series[0]-only data layer, chart
  core, interaction, polish).
